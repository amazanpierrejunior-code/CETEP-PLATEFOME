const fs=require('fs');
const path=require('path');
const root=__dirname;
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const render=fs.readFileSync(path.join(root,'render.yaml'),'utf8');
const checks=[
  ['version updated',server.includes("14.6.8-consolidated-staging")&&pkg.version==='14.6.8'],
  ['Neon dependency declared',Boolean(pkg.dependencies['@neondatabase/serverless'])],
  ['Render DATABASE_URL variable declared',/key: DATABASE_URL\s*\n\s*sync: false/.test(render)],
  ['production refuses missing DATABASE_URL',/IS_PRODUCTION&&!neonSql/.test(server)],
  ['snapshot table created in Neon',server.includes('CREATE TABLE IF NOT EXISTS cetep_persistent_snapshot')],
  ['snapshot stored atomically in one row',server.includes('ON CONFLICT (snapshot_id) DO UPDATE SET payload=EXCLUDED.payload')],
  ['snapshot compressed before upload',server.includes('zlib.gzipSync')],
  ['compressed snapshot decoded on restore',server.includes('zlib.gunzipSync')],
  ['legacy per-table mirror compatibility retained',server.includes('cetep_persistent_tables')],
  ['required core tables validated before restore',/const required=isLegacy\?\['admins','programs','students','payments'\]:\['admins','programs','students','enrollments','payments'\]/.test(server)],
  ['atomic snapshots reject missing local tables before restore',server.includes('Snapshot Neon incomplet: tables absentes')],
  ['atomic snapshots reject unknown tables instead of silently dropping them',server.includes('Snapshot Neon contient des tables inconnues')],
  ['legacy per-table mirror can retain tables added by newer schemas',server.includes("const isLegacy=snapshot.version==='legacy-mirror'")],
  ['legacy mirror can reconstruct enrollments from single-program student records',server.includes('if(isLegacy&&!Array.isArray(snapshot.tables.enrollments))snapshot.tables.enrollments=[]')&&server.includes('SELECT id,program_id,CASE WHEN status=\'Actif\'')],
  ['local backup awaited before restore',/await db\.backup\(localBackup\)/.test(server)],
  ['foreign-key check runs inside restore transaction for rollback safety',server.includes("const violations=db.pragma('foreign_key_check');\n      if(violations.length)throw new Error")],
  ['snapshot size guard present',server.includes('limite de sécurité 8 MiB dépassée')],
  ['writes tracked on SQLite run statements',server.includes("if(context)context.dirty=true")],
  ['SQLite total-change counter catches writes missed by prepared-statement proxy',server.includes('changesAtStart:db.totalChanges')&&server.includes('db.totalChanges!==context.changesAtStart')],
  ['successful JSON response waits for remote persistence',server.includes('return flushNeonSnapshot().then(()=>originalJson(payload))')],
  ['multi-enrollment endpoint retained',server.includes("/api/admin/students/:id/enrollments")],
  ['public admissions retained',server.includes("/api/admissions")],
  ['payment routes retained',server.includes("/api/admin/payments")],
  ['certificate eligibility logic retained',server.includes('completion.percent<100')&&server.includes('payment.fullyPaid')],
  ['teacher lesson authorization retained',server.includes("/api/teacher/lessons")],
  ['backup and restore routes retained',server.includes("/api/admin/backup")&&server.includes("/api/admin/restore")],
  ['health endpoint exposes persistence mode without secrets',server.includes("persistence:neonSql?'sqlite+neon-snapshot':'sqlite-local'")&&server.includes('neonConfigured:Boolean(neonSql)')],
  ['health endpoint checks Neon snapshot and reports failure',server.includes('status.neonReachable=true')&&server.includes('Neon persistence check failed')&&server.includes('res.status(status.ok?200:503)')],
  ['no DATABASE_URL secret hardcoded',!/postgres(?:ql)?:\/\/[^\s'"`]+/.test(server)],
];
let failed=0;
for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${name}`);if(!ok)failed++;}
console.log(`\n${checks.length-failed}/${checks.length} static checks passed.`);
process.exitCode=failed?1:0;
