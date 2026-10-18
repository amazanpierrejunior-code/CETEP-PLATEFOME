"""Independent standard-library test for CETEP's SQLite schema/multi-enrollment.
Run: python test-cetep-sqlite.py
This does not start the Express app or replace integration tests.
"""
import pathlib, re, sqlite3
source = pathlib.Path(__file__).with_name('server.js').read_text(encoding='utf-8')
match = re.search(r"db\.exec\(`(.*?)`\);\s*// Safe schema upgrades", source, re.S)
assert match, 'Could not find initial SQLite schema in server.js'
db = sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys=ON')
db.executescript(match.group(1))
db.execute('ALTER TABLE students ADD COLUMN nif TEXT')
db.execute('ALTER TABLE students ADD COLUMN cin TEXT')
db.execute('ALTER TABLE enrollments ADD COLUMN access_enabled INTEGER DEFAULT 0')
db.execute('ALTER TABLE enrollments ADD COLUMN manual_authorized INTEGER DEFAULT 0')
print('PASS SQLite schema executes')
db.execute("INSERT INTO programs(name) VALUES('Formation A')")
db.execute("INSERT INTO programs(name) VALUES('Formation B')")
db.execute("INSERT INTO students(student_no,name,program_id) VALUES('CETEP-TEST-0001','Test Student',1)")
student_id = db.execute('SELECT id FROM students').fetchone()[0]
db.execute("INSERT INTO enrollments(student_id,program_id,status,access_enabled) VALUES(?,?,'En attente',0)", (student_id, 1))
db.execute("INSERT INTO enrollments(student_id,program_id,status,access_enabled) VALUES(?,?,'En attente',0)", (student_id, 2))
assert db.execute('SELECT COUNT(*) FROM enrollments WHERE student_id=?', (student_id,)).fetchone()[0] == 2
print('PASS same student can enroll in two different programs')
try:
    db.execute("INSERT INTO enrollments(student_id,program_id,status,access_enabled) VALUES(?,?,'En attente',0)", (student_id, 1))
except sqlite3.IntegrityError:
    print('PASS duplicate enrollment in same program rejected')
else:
    raise AssertionError('duplicate enrollment was not rejected')
print('RESULT 3/3 SQLite checks passed')
