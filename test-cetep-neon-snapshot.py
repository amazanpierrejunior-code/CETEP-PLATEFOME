"""Offline simulation of CETEP snapshot/restore safety using Python sqlite3.
This validates schema/restore invariants only; it does not connect to Neon or run Express.
Run: python test-cetep-neon-snapshot.py
"""
import json, pathlib, re, sqlite3
source = pathlib.Path(__file__).with_name('server.js').read_text(encoding='utf-8')
match = re.search(r"db\.exec\(`(.*?)`\);\s*// Safe schema upgrades", source, re.S)
assert match, 'Initial schema not found'

def make_db():
    db = sqlite3.connect(':memory:')
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    db.executescript(match.group(1))
    # Apply the columns that server.js adds to an older database.
    for table, col, definition in [
        ('lessons','meeting_url','TEXT'), ('lessons','scheduled_at','TEXT'),
        ('lessons','duration_minutes','INTEGER DEFAULT 60'),
        ('students','certificate_name','TEXT'), ('students','nif','TEXT'),
        ('students','cin','TEXT'), ('payments','payment_message','TEXT'),
        ('payments','payment_proof','TEXT'), ('payments','program_id','INTEGER'),
        ('enrollments','access_enabled','INTEGER DEFAULT 0'),
        ('enrollments','manual_authorized','INTEGER DEFAULT 0')]:
        cols = {r['name'] for r in db.execute(f'PRAGMA table_info({table})')}
        if col not in cols:
            db.execute(f'ALTER TABLE {table} ADD COLUMN {col} {definition}')
    db.executescript("CREATE UNIQUE INDEX IF NOT EXISTS idx_students_nif_unique ON students(nif) WHERE nif IS NOT NULL AND trim(nif)<>''; CREATE UNIQUE INDEX IF NOT EXISTS idx_students_cin_unique ON students(cin) WHERE cin IS NOT NULL AND trim(cin)<>'';")
    return db

def tables(db):
    names=[r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    return {name:[dict(row) for row in db.execute(f'SELECT * FROM "{name}"')] for name in names}

def restore(db, snap):
    names={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
    if not isinstance(snap,dict) or snap.get('format')!='cetep-snapshot-v1' or not isinstance(snap.get('tables'),dict):
        raise ValueError('invalid snapshot')
    if set(snap['tables']) != names or any(not isinstance(v,list) for v in snap['tables'].values()):
        raise ValueError('incomplete or unknown tables')
    db.execute('PRAGMA foreign_keys=OFF')
    try:
        db.execute('BEGIN')
        for name in names:
            db.execute(f'DELETE FROM "{name}"')
        for name, rows in snap['tables'].items():
            cols={r['name'] for r in db.execute(f'PRAGMA table_info("{name}")')}
            for row in rows:
                keys=[k for k in row if k in cols]
                if keys:
                    sql=f'INSERT INTO "{name}" ({",".join(chr(34)+k+chr(34) for k in keys)}) VALUES ({",".join("?" for _ in keys)})'
                    db.execute(sql,[row[k] for k in keys])
        violations=list(db.execute('PRAGMA foreign_key_check'))
        if violations:
            raise ValueError('foreign key violation')
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.execute('PRAGMA foreign_keys=ON')

# Build representative rows across related tables and multiple enrollments.
db=make_db()
db.execute("INSERT INTO programs(id,name) VALUES(1,'Formation A'),(2,'Formation B')")
db.execute("INSERT INTO students(id,student_no,name,program_id,nif,cin) VALUES(1,'CETEP-TEST-0001','Test Student',1,'NIFTEST','CINTEST')")
db.execute("INSERT INTO enrollments(student_id,program_id,status,access_enabled) VALUES(1,1,'Actif',1),(1,2,'En attente',0)")
db.execute("INSERT INTO payments(student_id,program_id,amount_htg,method,status,reference) VALUES(1,1,500,'MonCash','Confirmé','TEST-PAY-1')")
db.commit()
original=tables(db)
snapshot={'format':'cetep-snapshot-v1','version':'test','tables':original}
# Round-trip through JSON to represent JSONB serialization.
snapshot=json.loads(json.dumps(snapshot))
for name in original:
    db.execute(f'DELETE FROM "{name}"')
db.commit()
restore(db,snapshot)
assert db.execute('SELECT COUNT(*) FROM students').fetchone()[0]==1
assert db.execute('SELECT COUNT(*) FROM enrollments WHERE student_id=1').fetchone()[0]==2
assert db.execute('SELECT COUNT(*) FROM payments WHERE reference=\'TEST-PAY-1\'').fetchone()[0]==1
assert not list(db.execute('PRAGMA foreign_key_check'))
print('PASS JSON snapshot round-trip preserves student, enrollments and payment')

# Incomplete snapshot is rejected before it can clear data.
count_before=db.execute('SELECT COUNT(*) FROM students').fetchone()[0]
bad={'format':'cetep-snapshot-v1','version':'test','tables':dict(snapshot['tables'])}
bad['tables'].pop('students')
try: restore(db,bad)
except ValueError: pass
else: raise AssertionError('incomplete snapshot was accepted')
assert db.execute('SELECT COUNT(*) FROM students').fetchone()[0]==count_before
print('PASS incomplete snapshot rejected without changing local data')

# Bad references fail the integrity check and transaction rolls back.
bad=json.loads(json.dumps(snapshot))
bad['tables']['enrollments'][0]['student_id']=99999
try: restore(db,bad)
except (ValueError,sqlite3.IntegrityError): pass
else: raise AssertionError('snapshot with invalid foreign key was accepted')
assert db.execute('SELECT COUNT(*) FROM students').fetchone()[0]==1
assert db.execute('SELECT COUNT(*) FROM enrollments WHERE student_id=1').fetchone()[0]==2
print('PASS invalid foreign-key snapshot rolls back completely')
print('RESULT 3/3 offline snapshot safety simulations passed')
