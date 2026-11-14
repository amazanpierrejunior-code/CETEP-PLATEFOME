require('dotenv').config();
const crypto=require('crypto');const zlib=require('zlib');const express=require('express');const PDFDocument=require('pdfkit');const QRCode=require('qrcode');const cookieParser=require('cookie-parser');const bcrypt=require('bcryptjs');const jwt=require('jsonwebtoken');const Database=require('better-sqlite3');const path=require('path');const fs=require('fs');const nodemailer=require('nodemailer');
const app=express();app.set('trust proxy',1);const APP_VERSION='15.6.0-english-200-lessons';const CERTIFICATE_MODEL_FILE='cetep-certificate-background-v15-2.png';const PORT=process.env.PORT||10000;const DATA_DIR=process.env.DATA_DIR||path.join(__dirname,'data');fs.mkdirSync(DATA_DIR,{recursive:true});
// Fail closed in production: never sign sessions with a public placeholder secret.
const IS_PRODUCTION=process.env.NODE_ENV==='production';
const CONFIGURED_SECRET=String(process.env.JWT_SECRET||'').trim();
if(IS_PRODUCTION && (!CONFIGURED_SECRET || CONFIGURED_SECRET==='CHANGE_ME_IN_RENDER' || CONFIGURED_SECRET.length<32)){
  throw new Error('Configuration CETEP invalide: définissez JWT_SECRET avec une valeur aléatoire d’au moins 32 caractères dans l’environnement de production.');
}
app.use(express.json({limit:'20mb'}));app.use(express.urlencoded({extended:true,limit:'20mb'}));app.use(cookieParser());
// Neon snapshot persistence: every request that performs a tracked SQLite write
// must wait for the remote snapshot to be committed before returning success.
const {AsyncLocalStorage}=require('async_hooks');
const writeContext=new AsyncLocalStorage();
const neonSql=process.env.DATABASE_URL?require('@neondatabase/serverless').neon(process.env.DATABASE_URL):null;
let flushNeonSnapshot=async()=>{};
app.use((req,res,next)=>{
  const context={dirty:false,changesAtStart:db.totalChanges};
  const originalJson=res.json.bind(res);
  res.json=function(payload){
    // The SQLite change counter catches writes from cached statements, db.exec,
    // or transaction helpers that may bypass the prepared-statement proxy.
    const changed=context.dirty||db.totalChanges!==context.changesAtStart;
    if(!neonSql||!changed)return originalJson(payload);
    context.dirty=false;
    context.changesAtStart=db.totalChanges;
    return flushNeonSnapshot().then(()=>originalJson(payload)).catch(error=>{
      console.error('[CETEP NEON PERSISTENCE]',error.message);
      if(res.headersSent)return res;
      res.statusCode=503;
      return originalJson({error:'La sauvegarde distante CETEP a échoué. La modification n’a pas été confirmée; contactez l’administration avant de réessayer.'});
    });
  };
  writeContext.run(context,next);
});
app.use(express.static(path.join(__dirname,'public'),{etag:true}));
// Static promotion assets live in /promotions at the project root. Serve them explicitly.
app.use('/promotions',express.static(path.join(__dirname,'promotions'),{etag:true,maxAge:'1h'}));
const SECRET=CONFIGURED_SECRET||'local-development-secret-not-for-production';const db=new Database(path.join(DATA_DIR,'cetep.sqlite'));db.pragma('journal_mode=WAL');db.pragma('foreign_keys=ON');
db.exec(`
CREATE TABLE IF NOT EXISTS admins(id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS student_policy(id INTEGER PRIMARY KEY CHECK(id=1),title TEXT NOT NULL,content TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_by TEXT);
CREATE TABLE IF NOT EXISTS student_policy_acceptances(id INTEGER PRIMARY KEY AUTOINCREMENT,student_id INTEGER NOT NULL,policy_version INTEGER NOT NULL,accepted_at TEXT DEFAULT CURRENT_TIMESTAMP,ip_address TEXT,UNIQUE(student_id,policy_version),FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS programs(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,duration TEXT,description TEXT,price_htg REAL DEFAULT 0,active INTEGER DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS students(id INTEGER PRIMARY KEY AUTOINCREMENT,student_no TEXT UNIQUE NOT NULL,name TEXT NOT NULL,birth_date TEXT,birth_place TEXT,phone TEXT,email TEXT,program_id INTEGER,education TEXT,blood_group TEXT,responsible_person TEXT,marital_status TEXT,status TEXT DEFAULT 'En attente',password_hash TEXT,access_enabled INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(program_id) REFERENCES programs(id) ON DELETE SET NULL);
CREATE TABLE IF NOT EXISTS teachers(id INTEGER PRIMARY KEY AUTOINCREMENT,teacher_no TEXT UNIQUE NOT NULL,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,phone TEXT,password_hash TEXT NOT NULL,active INTEGER DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS program_teachers(program_id INTEGER NOT NULL,teacher_id INTEGER NOT NULL,PRIMARY KEY(program_id,teacher_id),FOREIGN KEY(program_id) REFERENCES programs(id) ON DELETE CASCADE,FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS enrollments(id INTEGER PRIMARY KEY AUTOINCREMENT,student_id INTEGER NOT NULL,program_id INTEGER NOT NULL,status TEXT DEFAULT 'Actif',enrolled_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(student_id,program_id),FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,FOREIGN KEY(program_id) REFERENCES programs(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS modules(id INTEGER PRIMARY KEY AUTOINCREMENT,program_id INTEGER NOT NULL,title TEXT NOT NULL,description TEXT,order_no INTEGER DEFAULT 1,active INTEGER DEFAULT 1,FOREIGN KEY(program_id) REFERENCES programs(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS lessons(id INTEGER PRIMARY KEY AUTOINCREMENT,module_id INTEGER NOT NULL,title TEXT NOT NULL,type TEXT DEFAULT 'Texte',content TEXT,video_url TEXT,file_url TEXT,order_no INTEGER DEFAULT 1,active INTEGER DEFAULT 1,created_by_role TEXT DEFAULT 'admin',created_by INTEGER,teacher_editable INTEGER DEFAULT 0,FOREIGN KEY(module_id) REFERENCES modules(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS lesson_progress(student_id INTEGER NOT NULL,lesson_id INTEGER NOT NULL,completed INTEGER DEFAULT 0,completed_at TEXT,PRIMARY KEY(student_id,lesson_id),FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,FOREIGN KEY(lesson_id) REFERENCES lessons(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS assignments(id INTEGER PRIMARY KEY AUTOINCREMENT,module_id INTEGER NOT NULL,title TEXT NOT NULL,instructions TEXT,max_score REAL DEFAULT 100,due_date TEXT,active INTEGER DEFAULT 1,FOREIGN KEY(module_id) REFERENCES modules(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS submissions(id INTEGER PRIMARY KEY AUTOINCREMENT,assignment_id INTEGER NOT NULL,student_id INTEGER NOT NULL,answer TEXT,file_url TEXT,score REAL,feedback TEXT,submitted_at TEXT DEFAULT CURRENT_TIMESTAMP,graded_at TEXT,UNIQUE(assignment_id,student_id),FOREIGN KEY(assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY AUTOINCREMENT,student_id INTEGER,amount_htg REAL NOT NULL,method TEXT NOT NULL,status TEXT DEFAULT 'Confirmé',reference TEXT UNIQUE,payment_message TEXT,payment_proof TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE SET NULL);
CREATE TABLE IF NOT EXISTS support_methods(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,account_name TEXT,account_value TEXT,bank_name TEXT,bank_account TEXT,routing TEXT,instructions TEXT,active INTEGER DEFAULT 1,sort_order INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS donations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,email TEXT,amount REAL,method TEXT,reference TEXT,message TEXT,status TEXT DEFAULT 'En attente',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL DEFAULT '');CREATE TABLE IF NOT EXISTS final_results(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  program_id INTEGER NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  pass_mark REAL NOT NULL DEFAULT 70,
  status TEXT DEFAULT 'En attente',
  notes TEXT,
  evaluated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(student_id,program_id),
  FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY(program_id) REFERENCES programs(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS certificates(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  certificate_no TEXT UNIQUE NOT NULL,
  student_id INTEGER NOT NULL,
  program_id INTEGER NOT NULL,
  result_id INTEGER,
  issued_at TEXT DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'Valide',
  FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY(program_id) REFERENCES programs(id) ON DELETE CASCADE,
  FOREIGN KEY(result_id) REFERENCES final_results(id) ON DELETE SET NULL,
  UNIQUE(student_id,program_id)
);
CREATE TABLE IF NOT EXISTS certificate_admin_audit( id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL, program_id INTEGER NOT NULL, certificate_id INTEGER, actor_id INTEGER, actor_email TEXT, action TEXT NOT NULL, reason TEXT, conditions_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP );
CREATE TABLE IF NOT EXISTS student_document_permissions(id INTEGER PRIMARY KEY AUTOINCREMENT,student_id INTEGER NOT NULL,program_id INTEGER NOT NULL,document_type TEXT NOT NULL CHECK(document_type IN ('certificate','transcript','attestation')),authorized INTEGER NOT NULL DEFAULT 0,updated_by INTEGER,updated_by_email TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(student_id,program_id,document_type),FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,FOREIGN KEY(program_id) REFERENCES programs(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS student_document_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,student_id INTEGER NOT NULL,program_id INTEGER NOT NULL,document_type TEXT NOT NULL,authorized INTEGER NOT NULL,actor_id INTEGER,actor_email TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS attendance(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  program_id INTEGER NOT NULL,
  class_date TEXT NOT NULL,
  present INTEGER DEFAULT 1,
  note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(student_id,program_id,class_date),
  FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY(program_id) REFERENCES programs(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS announcements(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  audience TEXT DEFAULT 'Tous',
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS student_notifications(
 id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL, program_id INTEGER,
 title TEXT NOT NULL, message TEXT NOT NULL, notification_type TEXT NOT NULL DEFAULT 'message',
 dedupe_key TEXT UNIQUE, read_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
 FOREIGN KEY(program_id) REFERENCES programs(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS communication_audit(
 id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id INTEGER, actor_email TEXT, actor_role TEXT,
 action TEXT NOT NULL, audience TEXT, title TEXT, details TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS role_permissions(
 id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, permission TEXT NOT NULL,
 allowed INTEGER NOT NULL DEFAULT 0, updated_by INTEGER, updated_by_email TEXT,
 updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(role,permission)
);
CREATE TABLE IF NOT EXISTS gallery(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT NOT NULL,
  sort_order INTEGER DEFAULT 1,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS academic_terms(
 id INTEGER PRIMARY KEY AUTOINCREMENT, program_id INTEGER NOT NULL, academic_year TEXT NOT NULL,
 term_no INTEGER NOT NULL, term_name TEXT NOT NULL, start_date TEXT, end_date TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(program_id,academic_year,term_no), FOREIGN KEY(program_id) REFERENCES programs(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS academic_subjects(
 id INTEGER PRIMARY KEY AUTOINCREMENT, program_id INTEGER NOT NULL, subject_name TEXT NOT NULL,
 subject_code TEXT, coefficient REAL NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(program_id,subject_name), FOREIGN KEY(program_id) REFERENCES programs(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS academic_grades(
 id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL, program_id INTEGER NOT NULL,
 subject_id INTEGER NOT NULL, term_id INTEGER NOT NULL, intra_score REAL NOT NULL DEFAULT 0,
 final_score REAL NOT NULL DEFAULT 0, weighted_score REAL NOT NULL DEFAULT 0, observation TEXT,
 updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(student_id,subject_id,term_id),
 FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
 FOREIGN KEY(program_id) REFERENCES programs(id) ON DELETE CASCADE,
 FOREIGN KEY(subject_id) REFERENCES academic_subjects(id) ON DELETE CASCADE,
 FOREIGN KEY(term_id) REFERENCES academic_terms(id) ON DELETE CASCADE
);
`);
// Safe schema upgrades for existing CETEP databases.
function ensureColumn(table,column,definition){
  const cols=db.prepare(`PRAGMA table_info(${table})`).all().map(x=>x.name);
  if(!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
ensureColumn('announcements','program_id','INTEGER');
ensureColumn('announcements','student_id','INTEGER');
ensureColumn('announcements','created_by','INTEGER');
ensureColumn('announcements','created_by_email','TEXT');
ensureColumn('announcements','channel',"TEXT DEFAULT 'in_app'");
ensureColumn('announcements','sent_count','INTEGER DEFAULT 0');
ensureColumn('lessons','meeting_url','TEXT');
ensureColumn('lessons','scheduled_at','TEXT');
ensureColumn('lessons','duration_minutes','INTEGER DEFAULT 60');
ensureColumn('students','certificate_name','TEXT');
ensureColumn('students','nif','TEXT');
ensureColumn('students','cin','TEXT');
ensureColumn('enrollments','start_date','TEXT');
ensureColumn('enrollments','end_date','TEXT');
function normalizeIdentity(v){return String(v||'').trim().toUpperCase().replace(/[\s\-\.\/]/g,'');}
function generateTemporaryPassword(){return crypto.randomBytes(12).toString('base64url');}
function passwordIsStrong(v){return typeof v==='string' && v.length>=12;}
// NIF/CIN are unique identity keys for public admissions. Empty values are allowed only for legacy records.
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_students_nif_unique ON students(nif) WHERE nif IS NOT NULL AND trim(nif)<>''; CREATE UNIQUE INDEX IF NOT EXISTS idx_students_cin_unique ON students(cin) WHERE cin IS NOT NULL AND trim(cin)<>'';");
ensureColumn('payments','payment_message','TEXT');
ensureColumn('payments','payment_proof','TEXT');
ensureColumn('payments','program_id','INTEGER');
ensureColumn('payments','billing_month','TEXT');
// Role separation and immutable secretariat payment audit trail.
ensureColumn('admins','role',"TEXT NOT NULL DEFAULT 'admin'");
ensureColumn('admins','active','INTEGER NOT NULL DEFAULT 1');
ensureColumn('students','created_by','INTEGER');
ensureColumn('students','created_by_email','TEXT');
ensureColumn('payments','payment_category','TEXT');
ensureColumn('payments','billing_period','TEXT');
ensureColumn('payments','recorded_by','INTEGER');
ensureColumn('payments','recorded_by_email','TEXT');
db.exec(`CREATE TABLE IF NOT EXISTS secretariat_audit(
 id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id INTEGER NOT NULL, actor_email TEXT NOT NULL,
 action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id INTEGER, details TEXT,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);`);
db.exec(`CREATE TABLE IF NOT EXISTS direction_recommendations(
 id INTEGER PRIMARY KEY AUTOINCREMENT, director_id INTEGER NOT NULL, director_email TEXT NOT NULL,
 director_role TEXT NOT NULL CHECK(director_role IN ('direction_general','direction_studies')),
 subject TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'À examiner',
 admin_note TEXT, reviewed_by INTEGER, reviewed_by_email TEXT, reviewed_at TEXT,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS direction_audit(
 id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id INTEGER NOT NULL, actor_email TEXT NOT NULL,
 actor_role TEXT NOT NULL, action TEXT NOT NULL, details TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);`);

// Additive v15.5.1 migration: accounting tables required by the Expenses
// module and the Direction General financial overview. Existing rows are preserved.
db.exec(`CREATE TABLE IF NOT EXISTS expenses(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 expense_date TEXT NOT NULL,
 category TEXT NOT NULL,
 amount_htg REAL NOT NULL CHECK(amount_htg > 0),
 method TEXT NOT NULL,
 payee TEXT NOT NULL,
 reference TEXT,
 description TEXT NOT NULL,
 receipt TEXT,
 status TEXT NOT NULL DEFAULT 'Confirmé',
 created_by INTEGER,
 created_by_email TEXT,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
CREATE TABLE IF NOT EXISTS expense_audit(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 actor_id INTEGER,
 actor_email TEXT NOT NULL,
 action TEXT NOT NULL,
 expense_id INTEGER,
 details TEXT,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_expense_audit_created ON expense_audit(created_at);`);



ensureColumn('programs','monthly_fee_htg','REAL DEFAULT 0');
ensureColumn('programs','program_group','TEXT');
ensureColumn("programs","fee_period","TEXT DEFAULT 'Mensualité'");
ensureColumn('enrollments','access_enabled','INTEGER DEFAULT 0');
ensureColumn('enrollments','manual_authorized','INTEGER DEFAULT 0');
// Preserve old single-program records when upgrading to multi-program enrollment.
db.prepare("INSERT OR IGNORE INTO enrollments(student_id,program_id,status,access_enabled) SELECT id,program_id,CASE WHEN status='Actif' THEN 'Actif' ELSE COALESCE(status,'En attente') END,CASE WHEN access_enabled=1 THEN 1 ELSE 0 END FROM students WHERE program_id IS NOT NULL").run();
db.prepare('UPDATE payments SET program_id=(SELECT program_id FROM students WHERE students.id=payments.student_id) WHERE program_id IS NULL').run();
db.prepare("UPDATE enrollments SET access_enabled=1 WHERE status='Actif' AND access_enabled=0").run();
// CETEP passing threshold: 70/100. Upgrade legacy results that still carry the old 60/100 default.
db.prepare("UPDATE final_results SET pass_mark=70, status=CASE WHEN score>=70 THEN 'Réussi' ELSE 'Échoué' END WHERE pass_mark=60").run();
const defaults={school_name:'CETEP',school_full_name:"Centre d'Encadrement Technique et Professionnel",slogan:'Formation • Orientation • Insertion professionnelle',address:'Lamentin 54, Ruelle Crispin #856',phone:'+509 3601 8696 / +509 3736 5610 / +1 561-674-2890',email:'cetepecoleprofessionnelle@gmail.com',primary_color:'#0d2b52',secondary_color:'#1677b8',accent_color:'#087443',logo_text:'CETEP',logo_url:'',typography_font_family:'Arial,Helvetica,sans-serif',typography_font_size:'16px',typography_bold:'0',typography_italic:'0',typography_line_height:'1.5',certificate_intro:'Dans le cadre du renforcement des compétences techniques et professionnelles au Centre d’Encadrement Technique et Professionnel (CETEP).',certificate_city:'Carrefour',certificate_dg_name:'Agronome Livenson Fleuriot',certificate_dg_title:'Directeur Général',certificate_studies_name:'Wilio Joseph',certificate_studies_title:'Directeur des Études',certificate_extra_text:'',certificate_name_size:'15',certificate_program_size:'15',certificate_other_size:'12'};
const set=db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)');for(const [k,v] of Object.entries(defaults))set.run(k,v);
// Frais généraux relevés sur le flyer CETEP : conservés en HTG dans la base.
set.run('general_registration_fee_htg','200');
set.run('uniform_badge_fee_htg','400');
db.prepare("INSERT OR IGNORE INTO role_permissions(role,permission,allowed) VALUES('secretary','send_messages',0)").run();
for(const [k,v] of Object.entries({payment_reminders_enabled:'0',payment_reminder_due_day:'5',payment_reminder_email:'0',payment_reminder_text:'Chè {name}, nou fè w sonje gen yon balans {balance} HTG ki poko peye pou fòmasyon {program} pou peryòd {period}. Tanpri kontakte CETEP pou regilarize peman ou. Mèsi.'})) set.run(k,v);
db.exec(`CREATE TABLE IF NOT EXISTS certificate_program_texts(program_id INTEGER PRIMARY KEY, intro TEXT NOT NULL DEFAULT '', extra_text TEXT NOT NULL DEFAULT '', updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`);

// CETEP official contact defaults: fill blank values on existing installations without overwriting admin edits.
const currentSettings=Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(x=>[x.key,x.value]));
if(!String(currentSettings.phone||'').trim())db.prepare("UPDATE settings SET value=? WHERE key='phone'").run(defaults.phone);
if(!String(currentSettings.email||'').trim())db.prepare("UPDATE settings SET value=? WHERE key='email'").run(defaults.email);
// Admin bootstrap/recovery MUST run after the Neon snapshot has been restored.
// Otherwise the snapshot can overwrite the freshly reset password at startup.
function synchronizeAdminAccount(){
  const e=String(process.env.ADMIN_EMAIL||'').trim().toLowerCase();
  const p=String(process.env.ADMIN_PASSWORD||'');
  const reset=String(process.env.FORCE_ADMIN_RESET||'').trim().toLowerCase()==='true';
  const existing=e ? db.prepare('SELECT id FROM admins WHERE lower(email)=?').get(e) : null;
  let changed=false;
  if(reset){
    if(!e || !p || p.length<12) throw new Error('FORCE_ADMIN_RESET=true mande ADMIN_EMAIL ak ADMIN_PASSWORD ki gen omwen 12 karaktè.');
    const hash=bcrypt.hashSync(p,12);
    if(existing) db.prepare("UPDATE admins SET email=?,password_hash=?,role='admin',active=1 WHERE id=?").run(e,hash,existing.id);
    else db.prepare("INSERT INTO admins(email,password_hash,role,active) VALUES(?,?,'admin',1)").run(e,hash);
    changed=true;
    console.warn('[CETEP ADMIN] Admin password reset applied AFTER Neon snapshot restore. Set FORCE_ADMIN_RESET=false or remove it after successful recovery.');
  } else if(!db.prepare('SELECT 1 FROM admins LIMIT 1').get()){
    if(IS_PRODUCTION && (!e || !p || p.length<12)) throw new Error('Configuration CETEP invalide: ADMIN_EMAIL et ADMIN_PASSWORD (12 caractères minimum) sont requis pour créer le premier administrateur.');
    db.prepare("INSERT INTO admins(email,password_hash,role,active) VALUES(?,?,'admin',1)").run(e||'admin@cetep.local',bcrypt.hashSync(p||'local-only-password-change-me',12));
    changed=true;
  }
  return changed;
}
// IMPORTANT: ce catalogue doit être appliqué APRÈS la restauration du snapshot Neon.
// La migration est versionnée et exécutée une seule fois afin de ne pas écraser
// les tarifs que l'administration modifiera ultérieurement.
function applyCatalogMigrations(){
  const migrationKey='catalog_options_v1546_migrated';
  if(db.prepare('SELECT 1 FROM settings WHERE key=?').get(migrationKey)){
    console.log('[CETEP CATALOGUE] Migration v15.4.6 déjà appliquée.');
    return {applied:false};
  }
  const runMigration=db.transaction(()=>{
  // Catalogue de base CETEP : on conserve les formations existantes et on ajoute
  // les formations officielles visibles sur le flyer. Cette logique n'écrase jamais
  // une formation déjà enregistrée dans la base.
  const basePrograms=[
    ['Secourisme de base','9 mois','Formation aux premiers secours et à la sécurité.'],
    ['Aide-soignant(e)','9 mois','Formation orientée vers les soins de base.'],
    ['Électricité bâtiment','6 mois','Installation et maintenance électrique.'],
    ['Plomberie','6 mois','Installation et entretien des réseaux de plomberie.'],
    ['Sérigraphie','3 mois','Techniques professionnelles de sérigraphie.'],
    ['Vidéographie','4 mois','Formation pratique en prise de vue, cadrage et réalisation vidéo.'],
    ['Photographie','4 mois','Formation pratique en prise de vue, lumière et composition photographique.'],
    ['Anglais','9 mois','Formation indépendante en langue anglaise.'],
    ['Espagnol','9 mois','Formation indépendante en langue espagnole.'],
    ['Onglerie','3 à 6 mois','Formation pratique en soins et techniques professionnelles des ongles.'],
    ['Cosmétologie','3 à 6 mois','Formation indépendante en cosmétologie et soins esthétiques.'],
    ['Make-up','3 à 6 mois','Formation indépendante en maquillage professionnel.'],
    ['Décoration événementielle','3 à 6 mois','Formation indépendante en décoration événementielle.'],
    ['Résine','3 à 6 mois','Formation indépendante aux techniques professionnelles de résine.'],
    ['Carrelage','4 à 6 mois','Formation pratique en pose et finition de carrelage.'],
    ['Informatique bureautique','1 an','Formation en informatique et outils bureautiques.'],
    ['Dread Locks','2 mois','Formation pratique en dread locks et coiffure spécialisée.']
  ];
  const insertProgram=db.prepare('INSERT INTO programs(name,duration,description,price_htg) VALUES(?,?,?,?)');
  for(const [name,duration,description] of basePrograms){
    if(!db.prepare('SELECT 1 FROM programs WHERE name=? LIMIT 1').get(name)){
      insertProgram.run(name,duration,description,0);
    }
  }
  // Séparation du catalogue : les anciens parcours regroupés sont conservés pour
  // l'historique, mais désactivés dans les nouveaux formulaires. Aucune inscription,
  // note, facture, paiement, module ou certificat historique n'est déplacé ni supprimé.
  const legacyCombinedPrograms=[
    'Anglais, Espagnol',
    'Vidéographie et Photographie',
    'Onglerie, Cosmétologie, Make-up',
    'Décoration événementielle, Résine',
    'Carrelage, Plomberie, Électricité',
    'Secourisme et Aide-soignant'
  ];
  const deactivateLegacyProgram=db.prepare('UPDATE programs SET active=0 WHERE name=?');
  for(const legacyName of legacyCombinedPrograms) deactivateLegacyProgram.run(legacyName);
  // Vidéographie et Photographie est une seule formation combinée sur le flyer :
  // les anciennes lignes autonomes restent dans l'historique mais ne sont plus proposées.
  for(const legacyName of ['Vidéographie','Photographie']) deactivateLegacyProgram.run(legacyName);
  // Catalogue et tarifs extraits du flyer CETEP fourni le 7 novembre 2026.
  // Chaque option reste un programme autonome (ID, inscriptions, paiements, notes et certificat).
  // program_group sert uniquement à présenter les options sous leur formation principale.
  const flyerPrograms = [
   ['Anglais','1 an','Langues','600','300','Mensualité','Formation en langue anglaise.'],
   ['Espagnol','1 an','Langues','600','300','Mensualité','Formation en langue espagnole.'],
   ['Français','1 an','Langues','600','300','Mensualité','Formation en langue française.'],
   ['Communication','1 an','Langues','600','300','Mensualité','Formation en communication.'],
   ['Cuisine','9 mois','Cuisine et couture','1000','350','Mensualité','Formation en cuisine.'],
   ['Pâtisserie','18 mois','Cuisine et couture','1000','350','Mensualité','Formation en pâtisserie.'],
   ['Couture','18 mois','Cuisine et couture','1000','350','Mensualité','Formation en couture.'],
   ['Décoration gâteau','6 mois','Décoration gâteau','800','300','Mensualité','Formation en décoration de gâteaux.'],
   ['Comptabilité informatisée','14 mois','Comptabilité informatisée','600','350','Mensualité','Formation en comptabilité informatisée.'],
   ['Hôtellerie et Tourisme','14 mois','Hôtellerie et Tourisme','800','500','Mensualité','Formation en hôtellerie et tourisme.'],
   ['Entrepreneuriat','14 mois','Hôtellerie et Tourisme','800','500','Mensualité','Formation en entrepreneuriat.'],
   ['Technique vocal','6 mois','Métiers techniques et artistiques','800','950','Trimestriel','Formation en technique vocale.'],
   ['Montage Vidéo','6 mois','Métiers techniques et artistiques','800','950','Trimestriel','Formation en montage vidéo.'],
   ['Vidéographie et Photographie','6 mois','Vidéographie et Photographie','800','950','Trimestriel','Formation combinée en vidéographie et photographie.'],
   ['Carrelage','6 mois','Métiers techniques et artistiques','800','950','Trimestriel','Formation en carrelage.'],
   ['Plomberie','6 mois','Métiers techniques et artistiques','800','950','Trimestriel','Formation en plomberie.'],
   ['Secourisme de base','6 mois','Métiers techniques et artistiques','800','950','Trimestriel','Formation en secourisme de base.'],
   ['Technique Windows','6 mois','Métiers techniques et artistiques','800','950','Trimestriel','Formation en technique Windows.'],
   ['Aide-soignant(e)','12 mois','Aide-soignant(e)','1500','950','Trimestriel','Formation aide-soignante.'],
   ['Auto-école','2 mois','Auto-école','0','300','Mensualité','Formation de conduite automobile.'],
   ['Peinture','3 mois','Métiers de finition et impression','500','300','Mensualité','Formation en peinture.'],
   ['Sérigraphie','3 mois','Métiers de finition et impression','500','300','Mensualité','Formation en sérigraphie.'],
   ['Dépannage Cellulaire','3 mois','Métiers de finition et impression','500','300','Mensualité','Formation en dépannage de téléphones cellulaires.'],
   ['Make-up','6 mois','Beauté','500','350','Mensualité','Formation en maquillage professionnel.'],
   ['Manicure','6 mois','Beauté','500','350','Mensualité','Formation en manucure.'],
   ['Logistique et Gestion de Stock','3 mois','Logistique et Gestion de Stock','0','500','Mensualité','Formation en logistique et gestion de stock.'],
   ['Électricité','9 mois','Métiers techniques informatiques et électriques','600','400','Mensualité','Formation en électricité.'],
   ['Informatique Bureautique','9 mois','Métiers techniques informatiques et électriques','600','400','Mensualité','Formation en informatique bureautique.'],
   ['Dépannage d’Ordinateur','9 mois','Métiers techniques informatiques et électriques','600','400','Mensualité','Formation en dépannage d’ordinateur.'],
   ['Cosmétologie','9 mois','Beauté','600','500','Mensualité','Formation en cosmétologie.'],
   ['Décoration Événementielle','6 mois','Décoration et création','600','300','Mensualité','Formation en décoration événementielle.'],
   ['Auxiliaire','24 mois','Auxiliaire, Ferronnerie et Pharmacie','1500','600','Mensualité','Formation auxiliaire.'],
   ['Ferronnerie','24 mois','Auxiliaire, Ferronnerie et Pharmacie','1500','600','Mensualité','Formation en ferronnerie.'],
   ['Pharmacie','24 mois','Auxiliaire, Ferronnerie et Pharmacie','1500','600','Mensualité','Formation en pharmacie.']
  ];
  const findProgram=db.prepare('SELECT id FROM programs WHERE lower(trim(name))=lower(trim(?)) ORDER BY active DESC,id LIMIT 1');
  const addFlyerProgram=db.prepare('INSERT INTO programs(name,duration,description,price_htg,monthly_fee_htg,program_group,fee_period,active) VALUES(?,?,?,?,?,?,?,1)');
  const updateFlyerProgram=db.prepare('UPDATE programs SET duration=?,description=CASE WHEN description IS NULL OR trim(description)=\'\' THEN ? ELSE description END,price_htg=?,monthly_fee_htg=?,program_group=?,fee_period=?,active=1 WHERE id=?');
  for(const [name,duration,group,entry,fee,period,description] of flyerPrograms){
   const old=findProgram.get(name);
   if(old) updateFlyerProgram.run(duration,description,Number(entry),Number(fee),group,period,old.id);
   else addFlyerProgram.run(name,duration,description,Number(entry),Number(fee),group,period);
  }
  // Résine est une option indépendante de Décoration événementielle.
  // Le flyer transmis ne donne pas de tarif spécifique pour Résine : on conserve
  // ses montants existants (ou 0 sur une nouvelle installation) sans inventer de prix.
  const resinProgram=findProgram.get('Résine');
  if(resinProgram){
    db.prepare("UPDATE programs SET program_group='Décoration et création', active=1, duration=CASE WHEN duration IS NULL OR trim(duration)='' THEN '3 à 6 mois' ELSE duration END WHERE id=?").run(resinProgram.id);
  }
  // Harmonise quelques variantes historiques sans supprimer les dossiers déjà rattachés.
  for(const [from,to] of [['Informatique bureautique','Informatique Bureautique'],['Dépannage d’ordinateur','Dépannage d’Ordinateur'],['Make-Up','Make-up']]){
   const a=findProgram.get(from), b=findProgram.get(to); if(a && b && a.id!==b.id) db.prepare('UPDATE programs SET active=0 WHERE id=?').run(a.id);
  }

  // Migration unique: l'ancienne version indiquait 6 mois pour l'informatique bureautique.
  // On corrige une seule fois les anciennes installations, puis l'administrateur reste libre
  // de modifier cette durée depuis le bouton Modifier dans Formations.
  if(!db.prepare("SELECT 1 FROM settings WHERE key='informatique_duration_v1_migrated'").get()){
    db.prepare("UPDATE programs SET duration='1 an' WHERE name='Informatique bureautique' AND (duration IS NULL OR TRIM(duration)='' OR duration='6 mois')").run();
    db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('informatique_duration_v1_migrated','1')").run();
  }
    const required=['Anglais','Espagnol','Français','Communication','Carrelage','Plomberie','Électricité','Décoration Événementielle','Résine','Vidéographie et Photographie'];
    const missing=required.filter(name=>!db.prepare('SELECT 1 FROM programs WHERE lower(trim(name))=lower(trim(?)) AND active=1').get(name));
    if(missing.length) throw new Error('Options CETEP manquantes après migration: '+missing.join(', '));
    db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(migrationKey,new Date().toISOString());
    const active=db.prepare('SELECT COUNT(*) AS n FROM programs WHERE active=1').get().n;
    const inactive=db.prepare('SELECT COUNT(*) AS n FROM programs WHERE active=0').get().n;
    return {applied:true,active,inactive};
  });
  const result=runMigration();
  console.log('[CETEP CATALOGUE] Migration v15.4.6 appliquée après restauration Neon:',result);
  return result;
}

// v15.5.2 — Cours original CETEP de préparation à l'anglais/CASAS.
// Cette migration est additive et idempotente: elle ne touche jamais aux dossiers historiques.
function applyCasasCourseMigration(){
  const key='cetep_casas_levels_v1552';
  if(db.prepare('SELECT 1 FROM settings WHERE key=?').get(key)) return {applied:false};
  const tx=db.transaction(()=>{
    // Force le retrait des anciens choix groupés dans le catalogue actif; les lignes
    // historiques restent en base pour préserver inscriptions, paiements et certificats.
    const oldChoices=['Anglais, Espagnol','Décoration événementielle, Résine','Carrelage, Plomberie, Électricité','Onglerie, Cosmétologie, Make-up','Secourisme et Aide-soignant','Vidéographie','Photographie'];
    const deactivate=db.prepare('UPDATE programs SET active=0 WHERE name=?');
    for(const oldName of oldChoices) deactivate.run(oldName);
    db.prepare("UPDATE programs SET active=1 WHERE lower(trim(name))=lower(trim('Vidéographie et Photographie'))").run();
    let program=db.prepare("SELECT id FROM programs WHERE lower(trim(name))=lower(trim(?)) ORDER BY active DESC,id LIMIT 1").get('English & CASAS Preparation — CETEP');
    if(!program){
      const r=db.prepare("INSERT INTO programs(name,duration,description,price_htg,monthly_fee_htg,program_group,fee_period,active) VALUES(?,?,?,?,?,?,?,1)")
        .run('English & CASAS Preparation — CETEP','Par niveaux A à F','Cours original de langue anglaise et préparation aux évaluations de compréhension orale et écrite. Matériel pédagogique conçu par CETEP.',0,0,'Langues','Mensualité');
      program={id:r.lastInsertRowid};
    } else db.prepare('UPDATE programs SET active=1,program_group=? WHERE id=?').run('Langues',program.id);
    const levels=[
      ['Level A — Beginner','Salutations, alphabet, nombres, présentations et consignes simples.',[
        ['A1 — Greetings and introductions','OBJECTIF: saluer et se présenter.\nVOCABULARY: hello = bonjour; good morning = bonjour (matin); goodbye = au revoir; name = nom; please = s’il vous plaît; thank you = merci.\nDIALOGUE ORIGINAL:\nA: Hello! What is your name?\nB: My name is Ana.\nA: Nice to meet you.\nB: Nice to meet you, too.\nPRATIQUE: 1) How do you greet someone in the morning? 2) What question asks for a person’s name?\nRÉPONSES: 1) Good morning. 2) What is your name?'],
        ['A2 — Numbers, dates and personal information','OBJECTIF: comprendre des informations personnelles simples.\nVOCABULARY: age, phone number, address, day, month, today.\nEXEMPLE: My phone number is 555-0142. My birthday is May 12.\nPRATIQUE: Écrivez en anglais votre âge, votre numéro de téléphone fictif et la date du jour.\nCOMPRÉHENSION: “The appointment is on Friday at nine.” Quand est le rendez-vous? RÉPONSE: Friday at nine.'],
        ['A3 — Everyday instructions','OBJECTIF: comprendre des consignes courtes.\nEXPRESSIONS: Open the book; listen carefully; choose an answer; write your name; wait here.\nMISE EN SITUATION: A teacher says, “Please open your book and write your name.” Que devez-vous faire?\nRÉPONSE: Ouvrir le livre et écrire son nom.']
      ]],
      ['Level B — Elementary','Routines quotidiennes, lieux, achats, questions et réponses courantes.',[
        ['B1 — Daily routines','OBJECTIF: parler des habitudes.\nVOCABULARY: wake up, work, study, eat, arrive, leave.\nDIALOGUE ORIGINAL: “I wake up at six. I take the bus at seven. I start work at eight.”\nQUESTIONS: 1) What time does the speaker wake up? 2) How does the speaker travel?\nRÉPONSES: 1) At six. 2) By bus.'],
        ['B2 — Places and directions','OBJECTIF: demander et comprendre un itinéraire.\nEXPRESSIONS: turn left, turn right, go straight, next to, across from.\nDIALOGUE: “Excuse me, where is the library?” “Go straight and turn left. It is next to the bank.”\nQUESTION: Où se trouve la bibliothèque? RÉPONSE: À côté de la banque.'],
        ['B3 — Shopping and services','OBJECTIF: comprendre prix et demandes simples.\nDIALOGUE: “How much is this notebook?” “It is three dollars.” “I will take two, please.”\nQUESTIONS: 1) What item does the customer want? 2) What is the price of one?\nRÉPONSES: 1) A notebook. 2) Three dollars.']
      ]],
      ['Level C — Intermediate','Conversations plus longues, annonces, détails et compréhension globale.',[
        ['C1 — Making an appointment','OBJECTIF: identifier date, heure et motif d’un rendez-vous.\nDIALOGUE ORIGINAL: “Good afternoon. I would like to schedule an appointment for a checkup. Are you available Tuesday at 10:30?” “Tuesday is full, but Wednesday at 11:00 is available.”\nQUESTIONS: 1) What is the appointment for? 2) Which day is available?\nRÉPONSES: 1) A checkup. 2) Wednesday.'],
        ['C2 — Understanding announcements','OBJECTIF: repérer les informations importantes d’une annonce.\nANNONCE: “Attention passengers. Bus 24 to downtown will depart from platform three in ten minutes. Please have your tickets ready.”\nQUESTIONS: 1) Which bus? 2) Which platform? 3) When will it depart?\nRÉPONSES: 1) Bus 24. 2) Platform three. 3) In ten minutes.'],
        ['C3 — Main idea and details','OBJECTIF: distinguer idée principale et détails.\nTEXTE: “The community center offers free computer classes every Saturday. Students should register online because seats are limited.”\nQUESTIONS: 1) What does the center offer? 2) When? 3) Why register online?\nRÉPONSES: 1) Free computer classes. 2) Every Saturday. 3) Seats are limited.']
      ]],
      ['Level D — Upper Intermediate','Conversations complexes, problèmes, opinions et inférences.',[
        ['D1 — Explaining a problem','OBJECTIF: expliquer un problème et comprendre une solution.\nDIALOGUE: “My internet connection keeps dropping during online classes.” “Try restarting the router. If the problem continues, contact technical support.”\nQUESTIONS: 1) What is the problem? 2) What should the person try first?\nRÉPONSES: 1) The internet connection keeps dropping. 2) Restart the router.'],
        ['D2 — Comparing options','OBJECTIF: comparer des choix à partir de critères.\nSITUATION: “The morning class costs $40 and meets twice a week. The evening class costs $35 and meets three times a week.”\nQUESTIONS: 1) Which class costs less? 2) Which meets more often?\nRÉPONSES: 1) Evening class. 2) Evening class.'],
        ['D3 — Making inferences','OBJECTIF: comprendre une information implicite.\nTEXTE: “Maria arrived at the station soaking wet. She placed her umbrella beside the door.”\nQUESTION: What is most likely true about the weather? RÉPONSE: It was raining.']
      ]],
      ['Level E — Advanced','Textes et échanges détaillés, synthèse, intention et arguments.',[
        ['E1 — Workplace communication','OBJECTIF: comprendre une communication professionnelle.\nMESSAGE: “Please submit the revised schedule by Thursday afternoon. Highlight any changes and notify the team if a deadline cannot be met.”\nQUESTIONS: 1) What must be submitted? 2) By when? 3) What should happen if a deadline cannot be met?\nRÉPONSES: 1) The revised schedule. 2) Thursday afternoon. 3) Notify the team.'],
        ['E2 — Identifying purpose and tone','OBJECTIF: identifier l’intention et le ton d’un message.\nMESSAGE: “We appreciate your patience while the repairs are completed. The facility is expected to reopen Monday.”\nQUESTIONS: 1) What is the purpose? 2) What is the tone?\nRÉPONSES: 1) Informing users about repairs and reopening. 2) Polite/reassuring.'],
        ['E3 — Summarizing information','OBJECTIF: résumer les idées essentielles.\nTEXTE: “A neighborhood garden began as a small volunteer project. It now provides fresh vegetables, teaches children about nutrition, and brings residents together.”\nTÂCHE: Résumez le texte en une phrase.\nEXEMPLE DE RÉPONSE: The garden provides food, education, and community connection.']
      ]],
      ['Level F — Exam Preparation','Entraînement global, gestion du temps et simulations originales.',[
        ['F1 — Listening practice test','CONSIGNE: Faites lire le script à voix haute par un enseignant ou utilisez un enregistrement CETEP.\nSCRIPT ORIGINAL: “This is a reminder that the adult education workshop will take place on Saturday, June 14, from 9 a.m. until noon. Participants should bring a photo ID and arrive fifteen minutes early.”\nQUESTIONS: 1) What event is announced? 2) What date? 3) What should participants bring? 4) How early should they arrive?\nRÉPONSES: 1) Adult education workshop. 2) Saturday, June 14. 3) A photo ID. 4) Fifteen minutes early.'],
        ['F2 — Reading practice test','TEXTE ORIGINAL: “Applicants may complete the form online or at the front desk. Incomplete applications will be returned. A confirmation email is sent after the application is received.”\nQUESTIONS: 1) Where can applicants complete the form? 2) What happens to incomplete applications? 3) When is the email sent?\nRÉPONSES: 1) Online or at the front desk. 2) They are returned. 3) After receipt.'],
        ['F3 — Final review and study plan','PLAN: 1) Lisez d’abord toutes les consignes. 2) Repérez les mots-clés: who, what, where, when, why, how. 3) Écoutez ou lisez une première fois pour l’idée générale. 4) Reprenez les détails. 5) Vérifiez chaque réponse.\nÉVALUATION: L’enseignant peut utiliser ces activités pour préparer une évaluation CETEP originale. Cette leçon n’est pas un examen officiel CASAS et ne délivre pas de certification CASAS.']
      ]]
    ];
    const addModule=db.prepare('INSERT INTO modules(program_id,title,description,order_no,active) VALUES(?,?,?,?,1)');
    const addLesson=db.prepare("INSERT INTO lessons(module_id,title,type,content,order_no,active) VALUES(?,?,'Texte',?,?,1)");
    for(let i=0;i<levels.length;i++){
      const [title,description,lessons]=levels[i];
      let module=db.prepare('SELECT id FROM modules WHERE program_id=? AND title=? LIMIT 1').get(program.id,title);
      if(!module) module={id:addModule.run(program.id,title,description,i+1).lastInsertRowid};
      for(let j=0;j<lessons.length;j++){
        const [lessonTitle,content]=lessons[j];
        if(!db.prepare('SELECT 1 FROM lessons WHERE module_id=? AND title=? LIMIT 1').get(module.id,lessonTitle)) addLesson.run(module.id,lessonTitle,content,j+1);
      }
    }
    db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(key,new Date().toISOString());
  });
  tx();
  console.log('[CETEP CASAS] Cours original CETEP créé: niveaux A à F.');
  return {applied:true};
}

// v15.5.12 — Publier le catalogue English & CASAS dans le programme Anglais réellement utilisé.
// Migration additive: conserve les inscriptions, notes, progrès et contenus déjà créés.
function applyAnglaisVideoCourseMigration(){
  const key='cetep_anglais_video_course_v15512';
  if(db.prepare('SELECT 1 FROM settings WHERE key=?').get(key)) return {applied:false};
  const tx=db.transaction(()=>{
    const target=db.prepare("SELECT id FROM programs WHERE lower(trim(name))=lower(trim('Anglais')) AND active=1 ORDER BY id LIMIT 1").get();
    if(!target){
      console.warn('[CETEP ENGLISH] Programme Anglais introuvable; migration remise à la prochaine relance.');
      return {applied:false,missingProgram:true};
    }
    const source=db.prepare("SELECT id FROM programs WHERE lower(trim(name))=lower(trim('English & CASAS Preparation — CETEP')) ORDER BY id LIMIT 1").get();
    if(!source){
      console.warn('[CETEP ENGLISH] Catalogue source CASAS introuvable; aucun contenu modifié.');
      return {applied:false,missingSource:true};
    }
    const resources={
      A:'https://learningenglish.voanews.com/a/lets-learn-english-lesson-one/3111026.html',
      B:'https://learnenglish.britishcouncil.org/free-resources/general/video-series/starting-out',
      C:'https://learnenglish.britishcouncil.org/free-resources/general/video-series/word-street',
      D:'https://learnenglish.britishcouncil.org/free-resources/general/video-series/word-street',
      E:'https://learnenglish.britishcouncil.org/free-resources/general/video-series/britain-great',
      F:'https://learnenglish.britishcouncil.org/free-resources/general/video-zone'
    };
    const sourceModules=db.prepare('SELECT * FROM modules WHERE program_id=? ORDER BY order_no,id').all(source.id);
    const findModule=db.prepare('SELECT id FROM modules WHERE program_id=? AND title=? LIMIT 1');
    const addModule=db.prepare('INSERT INTO modules(program_id,title,description,order_no,active) VALUES(?,?,?,?,1)');
    const sourceLessons=db.prepare('SELECT * FROM lessons WHERE module_id=? ORDER BY order_no,id');
    const findLesson=db.prepare('SELECT id,video_url FROM lessons WHERE module_id=? AND title=? LIMIT 1');
    const addLesson=db.prepare('INSERT INTO lessons(module_id,title,type,content,video_url,file_url,order_no,active) VALUES(?,?,?,?,?,?,?,1)');
    const updateLesson=db.prepare("UPDATE lessons SET video_url=CASE WHEN video_url IS NULL OR trim(video_url)='' THEN ? ELSE video_url END,type=CASE WHEN type IS NULL OR trim(type)='' OR type='Texte' THEN 'Vidéo' ELSE type END WHERE id=?");
    let modules=0,lessons=0,videos=0;
    for(const sm of sourceModules){
      let tm=findModule.get(target.id,sm.title);
      if(!tm){const r=addModule.run(target.id,sm.title,sm.description||'Cours d’anglais CETEP avec vidéo, écoute, vocabulaire, grammaire et pratique orale.',sm.order_no||1);tm={id:Number(r.lastInsertRowid)};modules++;}
      const prefix=String(sm.title||'').trim().charAt(0).toUpperCase();
      for(const sl of sourceLessons.all(sm.id)){
        const videoUrl=String(sl.title||'').startsWith('A1 —')?'https://www.youtube.com/watch?v=WR9_nsLyaEY':(resources[prefix]||resources.A);
        let tl=findLesson.get(tm.id,sl.title);
        if(!tl){const r=addLesson.run(tm.id,sl.title,'Vidéo',sl.content||'',sl.video_url||videoUrl,sl.file_url||'',sl.order_no||1);tl={id:Number(r.lastInsertRowid)};lessons++;videos++;}
        else if(!String(tl.video_url||'').trim()){updateLesson.run(videoUrl,tl.id);videos++;}
      }
    }
    db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(key,new Date().toISOString());
    return {applied:true,program_id:Number(target.id),modules,lessons,videos};
  });
  const result=tx();
  if(result.applied) console.log('[CETEP ENGLISH] Cours vidéo ajouté au programme Anglais:',result);
  return result;
}

// v15.5.13 — Parcours interactif original CETEP pour le Level A.
// Migration additive et idempotente: ne supprime ni ne réinitialise aucun contenu/progrès existant.
function applyEnglishLevelAMigration(){
  const key='cetep_english_level_a_interactive_v15513';
  if(db.prepare('SELECT 1 FROM settings WHERE key=?').get(key)) return {applied:false};
  const tx=db.transaction(()=>{
    const program=db.prepare("SELECT id FROM programs WHERE lower(trim(name))=lower(trim('Anglais')) AND active=1 ORDER BY id LIMIT 1").get();
    if(!program) return {applied:false,missingProgram:true};
    let module=db.prepare("SELECT id FROM modules WHERE program_id=? AND title='Level A — Beginner' ORDER BY id LIMIT 1").get(program.id);
    if(!module) module={id:Number(db.prepare('INSERT INTO modules(program_id,title,description,order_no,active) VALUES(?,?,?,?,1)').run(program.id,'Level A — Beginner','Parcours débutant CETEP: saluer, se présenter, comprendre les consignes et communiquer dans des situations simples.',1).lastInsertRowid)};
    const lessons=[
      ['A4 — Alphabet and spelling names','OBJECTIF: reconnaître les lettres et épeler un prénom ou un nom.\n\nLEARN: The English alphabet has 26 letters.\nUSEFUL QUESTIONS: How do you spell your name? — Can you repeat that, please?\nMODEL: My name is Marie. M-A-R-I-E.\n\nPRONUNCIATION: Écoutez chaque lettre, puis répétez lentement. Faites attention aux noms des lettres E /iː/, I /aɪ/ et A /eɪ/.\n\nPRACTICE: Spell your first name aloud. Then spell CETEP: C-E-T-E-P.\n\nMINI TASK: Ask a partner: “How do you spell your name?”', 'https://learningenglish.voanews.com/a/lets-learn-english-lesson-2-hello/3113733.html'],
      ['A5 — People and the verb BE','OBJECTIF: sèvi ak I, you, he, she ak vèb BE pou prezante moun.\n\nGRAMMAR: I am; You are; He is; She is.\nCONTRACTIONS: I’m; You’re; He’s; She’s.\n\nEXAMPLES: I am a student. You are my teacher. She is Ana. He is Pete.\n\nDIALOGUE ORIGINAL:\nA: Who is she?\nB: She is my teacher.\nA: Are you a student?\nB: Yes, I am.\n\nPRACTICE: Complete aloud: “I ___ a student.” “He ___ my friend.”\nANSWERS: am; is.', 'https://learningenglish.voanews.com/a/lets-learn-english-lesson-2-hello/3113733.html'],
      ['A6 — Everyday objects: this, that, a and an','OBJECTIF: nonmen bagay ki nan klas la epi sèvi ak this/that ak a/an.\n\nVOCABULARY: book = liv; pen = plim; bag = sak; phone = telefòn; chair = chèz; table = tab.\n\nGRAMMAR: This is a book. That is a chair. It is an apple. Use “a” before a consonant sound and “an” before a vowel sound.\n\nDIALOGUE ORIGINAL:\nA: What is this?\nB: It is a pen.\nA: Is that your book?\nB: Yes, it is.\n\nPRACTICE: Point to an object and say: “This is a ___.”', 'https://learningenglish.voanews.com/a/lets-learn-english-lesson-4/3168920.html'],
      ['A7 — Places and simple locations','OBJECTIF: di kote moun ye epi konprann kèk chanm nan kay la.\n\nVOCABULARY: kitchen = kwizin; bedroom = chanm; bathroom = twalèt; living room = salon; here = isit; there = laba.\n\nGRAMMAR: I am in the kitchen. She is in the bedroom.\n\nDIALOGUE ORIGINAL:\nA: Where are you?\nB: I am here, in the kitchen.\nA: Where is Pete?\nB: He is in the living room.\n\nPRACTICE: Answer: “Where are you now?” Use “I am…”', 'https://learningenglish.voanews.com/a/lets-learn-english-lesson-5-where-are-you/3168971.html'],
      ['A8 — Review and beginner checkpoint','OBJECTIF: revize salitasyon, prezantasyon, nimewo, objè ak kote.\n\nREVIEW DIALOGUE ORIGINAL:\nA: Good morning. What is your name?\nB: My name is Jean.\nA: How do you spell it?\nB: J-E-A-N.\nA: Are you a student?\nB: Yes, I am.\n\nCHECKLIST: I can greet someone. I can say my name. I can spell my name. I can understand simple classroom instructions. I can name common objects and say where I am.\n\nFINAL TASK: Record or say a 4-sentence introduction: greeting, name, role, and one place where you are.\n\nCette évaluation est un exercice pédagogique original CETEP; ce n’est pas un examen officiel CASAS.', 'https://learningenglish.voanews.com/a/lets-lear-english-review-lessons-1-5/4053916.html']
    ];
    const find=db.prepare('SELECT id FROM lessons WHERE module_id=? AND title=? LIMIT 1');
    const add=db.prepare("INSERT INTO lessons(module_id,title,type,content,video_url,order_no,active) VALUES(?,?,'Vidéo',?,?,?,1)");
    let added=0,links=0;
    for(let i=0;i<lessons.length;i++){
      const [title,content,url]=lessons[i];
      let row=find.get(module.id,title);
      if(!row){add.run(module.id,title,content,url,i+4);added++;links++;}
      else db.prepare("UPDATE lessons SET video_url=CASE WHEN video_url IS NULL OR trim(video_url)='' THEN ? ELSE video_url END WHERE id=?").run(url,row.id);
    }
    // Use lesson-specific official learning resources instead of repeating one unrelated URL.
    const resourceMap={
      'A1 — Greetings and introductions':'https://learningenglish.voanews.com/a/lets-learn-english-lesson-one/3111026.html',
      'A2 — Numbers, dates and personal information':'https://learningenglish.voanews.com/a/lets-learn-english-lesson-3-i-am-here/3126527.html',
      'A3 — Everyday instructions':''
    };
    for(const [title,url] of Object.entries(resourceMap)){
      db.prepare("UPDATE lessons SET video_url=? WHERE module_id=? AND title=?").run(url,module.id,title);
    }
    db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(key,new Date().toISOString());
    return {applied:true,program_id:Number(program.id),module_id:Number(module.id),lessons_added:added,resource_links:links+3};
  });
  const result=tx();
  if(result.applied) console.log('[CETEP ENGLISH] Level A interactif CETEP installé:',result);
  return result;
}

// v15.6.0 — Catalogue complet CETEP English: 4 niveaux × 50 leçons.
// Migration additive: conserve les modules, leçons, inscriptions et progrès déjà présents.
function applyEnglish200CourseMigration(){
  const key='cetep_english_200_lessons_v1560';
  if(db.prepare('SELECT 1 FROM settings WHERE key=?').get(key)) return {applied:false};
  const catalogPath=path.join(__dirname,'english-curriculum-200.json');
  if(!fs.existsSync(catalogPath)) throw new Error('Catalogue English 200 lessons introuvable: '+catalogPath);
  const catalog=JSON.parse(fs.readFileSync(catalogPath,'utf8'));
  const tx=db.transaction(()=>{
    const lessonColumns=new Set(db.prepare('PRAGMA table_info(lessons)').all().map(c=>c.name));
    if(!lessonColumns.has('created_by_role')) db.exec("ALTER TABLE lessons ADD COLUMN created_by_role TEXT DEFAULT 'admin'");
    if(!lessonColumns.has('created_by')) db.exec('ALTER TABLE lessons ADD COLUMN created_by INTEGER');
    if(!lessonColumns.has('teacher_editable')) db.exec('ALTER TABLE lessons ADD COLUMN teacher_editable INTEGER DEFAULT 0');
    const program=db.prepare("SELECT id FROM programs WHERE lower(trim(name))=lower(trim('Anglais')) AND active=1 ORDER BY id LIMIT 1").get();
    if(!program) return {applied:false,missingProgram:true};
    const findModule=db.prepare('SELECT id FROM modules WHERE program_id=? AND title=? ORDER BY id LIMIT 1');
    const addModule=db.prepare('INSERT INTO modules(program_id,title,description,order_no,active) VALUES(?,?,?,?,1)');
    const countLessons=db.prepare('SELECT COUNT(*) c FROM lessons WHERE module_id=?');
    const addLesson=db.prepare("INSERT INTO lessons(module_id,title,type,content,order_no,active) VALUES(?,?,'Texte',?,?,1)");
    let added=0,modules=0;
    for(let n=0;n<catalog.levels.length;n++){
      const level=catalog.levels[n];
      let module=findModule.get(program.id,level.title);
      if(!module){const r=addModule.run(program.id,level.title,level.description,n+1);module={id:Number(r.lastInsertRowid)};modules++;}
      let current=Number(countLessons.get(module.id).c||0);
      for(const lesson of level.lessons){
        // Existing lessons occupy their original positions; fill only the missing positions.
        if(Number(lesson.order)<=current) continue;
        const existing=db.prepare('SELECT id FROM lessons WHERE module_id=? AND title=? LIMIT 1').get(module.id,lesson.title);
        if(existing) continue;
        addLesson.run(module.id,lesson.title,lesson.content,lesson.order);
        current++;added++;
      }
      db.prepare('UPDATE modules SET active=1,order_no=? WHERE id=?').run(n+1,module.id);
    }
    // The four-level CETEP course is A–D. Older E/F archive modules are retained but hidden.
    db.prepare("UPDATE modules SET active=0 WHERE program_id=? AND (title LIKE 'Level E%' OR title LIKE 'Level F%')").run(program.id);
    db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(key,new Date().toISOString());
    const totals=db.prepare("SELECT m.title,COUNT(l.id) lessons FROM modules m LEFT JOIN lessons l ON l.module_id=m.id AND l.active=1 WHERE m.program_id=? AND m.active=1 AND m.title IN ('Level A — Beginner','Level B — Elementary','Level C — Intermediate','Level D — Advanced') GROUP BY m.id ORDER BY m.order_no").all(program.id);
    return {applied:true,program_id:Number(program.id),modules_added:modules,lessons_added:added,levels:totals};
  });
  const result=tx();
  if(result.applied) console.log('[CETEP ENGLISH] Programme de 200 leçons installé:',result);
  return result;
}

// Promotions CETEP par défaut : elles sont ajoutées automatiquement sans supprimer
// les publications déjà présentes. L'administrateur peut ensuite les modifier ou les supprimer.
const defaultPromotions=[
  ['🎉 Spécial 7e anniversaire CETEP','Découvrez les formations et profitez de la promotion CETEP.','/promotions/promo-1.jpg',1],
  ['📚 Nouvelle session chaque mois','Découvrez les formations, les réductions et les modalités d’inscription CETEP.','/promotions/flyer-cetep-7e-anniversaire-v2.jpeg',2],
  ['PROMOTION INTRÉPIDE 2021–2022','PROMOTION INTRÉPIDE 2021–2022 — Une nouvelle page s’ouvre sur l’avenir.\n\nLa Promotion Intrépide 2021–2022 marque une étape importante dans le parcours de nos finissants. Elle symbolise le courage, la détermination, la persévérance et la volonté de construire un avenir meilleur.\n\nAujourd’hui, une nouvelle page s’ouvre sur l’avenir. Une page remplie de rêves, de projets, d’espérance et de nouvelles opportunités.\n\nÀ travers la formation reçue au CETEP (Centre d’Encadrement Technique et Professionnel), nos jeunes et adultes sont désormais mieux préparés à affronter les défis de la vie professionnelle et à mettre leurs compétences au service de la société.\n\nPromotion Intrépide 2021–2022, avancez avec courage, travaillez avec discipline et gardez toujours confiance en vos capacités.\n\nVotre formation est une clé. Votre détermination ouvre la porte. Votre avenir est entre vos mains.\n\nCETEP — Formation • Orientation • Insertion professionnelle\nPromotion Intrépide 2021–2022 — Une nouvelle page s’ouvre sur l’avenir.','/promotions/promotion-intrepide-2021-2022-1-v2.jpg',3],
  ['PROMOTION INTRÉPIDE 2021–2022 — Souvenir','Photo souvenir de la Promotion Intrépide 2021–2022 du CETEP.','/promotions/promotion-intrepide-2021-2022-2-v2.jpg',4],
  ['PROMOTION INTRÉPIDE 2021–2022 — Couverture','Visuel officiel de la Promotion Intrépide 2021–2022.','/promotions/promotion-cetep-2021-2022-v2.jpg',5],
  ['PROMOTION JUILLET 2026','Une promotion qui garantit notre demain.','/promotions/promotion-juillet-2026-1-v2.jpg',6],
  ['PROMOTION JUILLET 2026 — Cérémonie','Moments de la cérémonie et des finissants de Juillet 2026.','/promotions/promotion-juillet-2026-2-v2.jpg',7],
  ['PROMOTION JUILLET 2026 — Souvenirs','Souvenirs et rencontres autour de la Promotion Juillet 2026.','/promotions/promotion-juillet-2026-3-v2.jpg',8],
  ['PROMOTION JUILLET 2026 — Groupe','Photo de groupe de la Promotion Juillet 2026.','/promotions/promotion-juillet-2026-4-v2.jpg',9],
  ['PROMOTION JUILLET 2026 — Équipe CETEP','Un moment de la Promotion Juillet 2026 avec l’équipe CETEP.','/promotions/promotion-juillet-2026-5-v2.jpg',10],
  ['PROMOTION JUILLET 2026 — Finissants','Des finissants réunis pour célébrer leur parcours.','/promotions/promotion-juillet-2026-6-v2.jpg',11],
  ['PROMOTION JUILLET 2026 — Cérémonie 2','Autre moment fort de la cérémonie Juillet 2026.','/promotions/promotion-juillet-2026-7-v2.jpg',12],
  ['PROMOTION JUILLET 2026 — Cérémonie 3','Souvenir de la cérémonie de remise et de célébration.','/promotions/promotion-juillet-2026-8-v2.jpg',13],
  ['PROMOTION JUILLET 2026 — Cérémonie 4','Une autre image de la Promotion Juillet 2026.','/promotions/promotion-juillet-2026-9-v2.jpg',14]
];
const insertGallery=db.prepare('INSERT INTO gallery(title,description,image_url,sort_order,active) VALUES(?,?,?,?,1)');
for(const [title,description,image_url,sort_order] of defaultPromotions){
  if(!db.prepare('SELECT 1 FROM gallery WHERE title=? LIMIT 1').get(title)) insertGallery.run(title,description,image_url,sort_order);
}
// Si l’ancien visuel de « Nouvelle session chaque mois » existe déjà, il est remplacé par le flyer CETEP fourni par la direction.
db.prepare("UPDATE gallery SET image_url=?, description=? WHERE title=? AND image_url=?").run('/promotions/flyer-cetep-7e-anniversaire-v2.jpeg','Découvrez les formations, les réductions et les modalités d’inscription CETEP.','📚 Nouvelle session chaque mois','/promotions/promo-2.jpg');
db.prepare("UPDATE gallery SET image_url='/promotions/flyer-cetep-7e-anniversaire-v2.jpeg' WHERE image_url='/promotions/flyer-cetep-7e-anniversaire.jpeg'").run();
if(!db.prepare('SELECT 1 FROM gallery WHERE title=? LIMIT 1').get('📢 Flyer officiel CETEP — Nouvelle session')) insertGallery.run('📢 Flyer officiel CETEP — Nouvelle session','Découvrez les formations CETEP, les promotions et les modalités d’inscription.','/promotions/flyer-cetep-7e-anniversaire-v2.jpeg',2);
// V14: keep legacy publications in the database but hide them from the active homepage/dashboard.
// The new Promotion Juillet 2026 campaign becomes the primary published gallery.
db.prepare("UPDATE gallery SET active=0 WHERE title IN (?,?)").run('🎉 Spécial 7e anniversaire CETEP','📚 Nouvelle session chaque mois');
db.prepare("UPDATE gallery SET active=0 WHERE title LIKE '📢 Flyer officiel CETEP%'").run();
// Older Intrépide archive photos remain available to the administrator but are not part of the active campaign.
db.prepare("UPDATE gallery SET active=0 WHERE title LIKE 'PROMOTION INTRÉPIDE%'").run();
// Ensure the official July 2026 cover is always available as the first active promotion.
if(!db.prepare('SELECT 1 FROM gallery WHERE title=? LIMIT 1').get('PROMOTION JUILLET 2026 — Couverture officielle')){
  db.prepare('INSERT INTO gallery(title,description,image_url,sort_order,active) VALUES(?,?,?,?,1)').run('PROMOTION JUILLET 2026 — Couverture officielle','Une promotion qui garantit notre demain.','/promotions/promotion-juillet-2026-cover-v2.png',1);
}else{
  db.prepare("UPDATE gallery SET image_url=?,sort_order=1,active=1 WHERE title=?").run('/promotions/promotion-juillet-2026-cover-v2.png','PROMOTION JUILLET 2026 — Couverture officielle');
}
// Keep all July 2026 campaign photos published and ordered after the cover.
db.prepare("UPDATE gallery SET active=1 WHERE title LIKE 'PROMOTION JUILLET 2026%'").run();
db.prepare("UPDATE gallery SET sort_order=sort_order+1 WHERE title LIKE 'PROMOTION JUILLET 2026%' AND title NOT IN ('PROMOTION JUILLET 2026 — Couverture officielle','PROMOTION JUILLET 2026')").run();
db.prepare("UPDATE gallery SET sort_order=1,active=1 WHERE title='PROMOTION JUILLET 2026 — Couverture officielle'").run();
db.prepare("UPDATE gallery SET sort_order=2,active=1 WHERE title='PROMOTION JUILLET 2026'").run();
// V13.5 asset migration: move public promotion references to versioned files so old browser/CDN
// caches cannot resurrect missing/previous images. This never deletes gallery records.
const assetMap={
  '/promotions/flyer-cetep-7e-anniversaire-v2.jpeg':'/promotions/flyer-cetep-7e-anniversaire-v2.jpeg',
  '/promotions/promotion-juillet-2026-cover.png':'/promotions/promotion-juillet-2026-cover-v2.png',
  '/promotions/promotion-juillet-2026-cover.jpeg':'/promotions/promotion-juillet-2026-cover-v2.jpeg',
  '/promotions/promotion-cetep-2021-2022-v2.jpg':'/promotions/promotion-cetep-2021-2022-v2.jpg',
  '/promotions/promotion-intrepide-2021-2022-1-v2.jpg':'/promotions/promotion-intrepide-2021-2022-1-v2.jpg',
  '/promotions/promotion-intrepide-2021-2022-2-v2.jpg':'/promotions/promotion-intrepide-2021-2022-2-v2.jpg',
  '/promotions/promotion-intrepide-2021-2022-3-v2.jpg':'/promotions/promotion-intrepide-2021-2022-3-v2.jpg',
  '/promotions/promotion-juillet-2026-1-v2.jpg':'/promotions/promotion-juillet-2026-1-v2.jpg',
  '/promotions/promotion-juillet-2026-2-v2.jpg':'/promotions/promotion-juillet-2026-2-v2.jpg',
  '/promotions/promotion-juillet-2026-3-v2.jpg':'/promotions/promotion-juillet-2026-3-v2.jpg',
  '/promotions/promotion-juillet-2026-4-v2.jpg':'/promotions/promotion-juillet-2026-4-v2.jpg',
  '/promotions/promotion-juillet-2026-5-v2.jpg':'/promotions/promotion-juillet-2026-5-v2.jpg',
  '/promotions/promotion-juillet-2026-6-v2.jpg':'/promotions/promotion-juillet-2026-6-v2.jpg',
  '/promotions/promotion-juillet-2026-7-v2.jpg':'/promotions/promotion-juillet-2026-7-v2.jpg',
  '/promotions/promotion-juillet-2026-8-v2.jpg':'/promotions/promotion-juillet-2026-8-v2.jpg',
  '/promotions/promotion-juillet-2026-9-v2.jpg':'/promotions/promotion-juillet-2026-9-v2.jpg'
};
const remapGallery=db.prepare('UPDATE gallery SET image_url=? WHERE image_url=?');
for(const [oldUrl,newUrl] of Object.entries(assetMap)) remapGallery.run(newUrl,oldUrl);

if(db.prepare('SELECT COUNT(*) c FROM support_methods').get().c===0){const q=db.prepare('INSERT INTO support_methods(name,account_name,account_value,instructions,sort_order) VALUES(?,?,?,?,?)');q.run('MonCash','Pierre Junior Amazan','37365610','Voye peman an sou nimewo MonCash sa a. Verifye non moun ki resevwa a anvan ou konfime tranzaksyon an.',1);q.run('Natcash','Martha Cherisene','43785235','Voye peman an sou nimewo NatCash sa a. Verifye non Martha Cherisene anvan ou konfime tranzaksyon an.',2);q.run('Zelle','Estime Esther','5616742890','Voye peman an sou Zelle. Verifye non Estime Esther anvan ou konfime tranzaksyon an.',3);q.run('Cash App','','','Kontakte CETEP pou jwenn enstriksyon yo.',4);q.run('Compte bancaire','','','Kont labank / RIB ap ajoute pita.',5);}
// Payment defaults: fill only missing beneficiary fields; preserve any values edited by CETEP admin.
for(const d of [
 {name:'MonCash',account_name:'Pierre Junior Amazan',account_value:'37365610',instructions:'Voye peman an sou nimewo MonCash sa a. Verifye non moun ki resevwa a anvan ou konfime tranzaksyon an.'},
 {name:'Zelle',account_name:'Estime Esther',account_value:'5616742890',instructions:'Voye peman an sou Zelle. Verifye non Estime Esther anvan ou konfime tranzaksyon an.'},
 {name:'Natcash',account_name:'Martha Cherisene',account_value:'43785235',instructions:'Voye peman an sou nimewo NatCash sa a. Verifye non Martha Cherisene anvan ou konfime tranzaksyon an.'}
]){
 const row=db.prepare('SELECT * FROM support_methods WHERE lower(name)=lower(?) LIMIT 1').get(d.name);
 if(row){
  db.prepare("UPDATE support_methods SET account_name=CASE WHEN trim(COALESCE(account_name,''))='' THEN ? ELSE account_name END, account_value=CASE WHEN trim(COALESCE(account_value,''))='' THEN ? ELSE account_value END, instructions=CASE WHEN trim(COALESCE(instructions,''))='' OR instructions LIKE 'Contactez CETEP%' THEN ? ELSE instructions END WHERE id=?").run(d.account_name,d.account_value,d.instructions,row.id);
 }
}
function settings(){return Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(x=>[x.key,x.value]));}
function sign(p){return jwt.sign(p,SECRET,{expiresIn:'12h'});}
function auth(req,res,next){
  try{
    const t=req.cookies.cetep_token;if(!t)throw 0;
    req.user=jwt.verify(t,SECRET);
    // Recheck privileged accounts against the database on every request so a
    // disabled secretary/admin loses access immediately, even with an old JWT.
    if(['admin','secretary','direction_general','direction_studies'].includes(req.user.role)){
      const account=db.prepare('SELECT role,active FROM admins WHERE id=? AND lower(email)=lower(?)').get(Number(req.user.id),String(req.user.email||''));
      if(!account||account.role!==req.user.role||Number(account.active)!==1){
        res.clearCookie('cetep_token');
        return res.status(401).json({error:'Compte désactivé ou session révoquée. Reconnectez-vous.'});
      }
    }
    next();
  }catch{res.status(401).json({error:'Non autorisé'});}
}
// Règlement étudiant CETEP : initialisé une seule fois, sans écraser les versions publiées.
const defaultStudentPolicy = `1. Respect et discipline\nChaque étudiant respecte les professeurs, les responsables et les autres étudiants. Les insultes, menaces, intimidations et violences sont interdites.\n\n2. Assiduité et ponctualité\nLa présence aux cours et le respect des horaires sont obligatoires. Les absences et retards doivent être justifiés.\n\n3. Travail et réussite académique\nL’étudiant participe aux cours, remet ses travaux dans les délais et respecte les évaluations. La tricherie, le plagiat et la falsification sont interdits.\n\n4. Utilisation de la plateforme CETEP\nL’étudiant protège ses identifiants, ne partage pas son compte et utilise les ressources pédagogiques à des fins éducatives. Toute fraude ou tentative de perturbation est interdite.\n\n5. Respect du matériel et des locaux\nLes équipements doivent être utilisés correctement. Chaque étudiant contribue à maintenir un environnement propre et sécuritaire.\n\n6. Paiements et obligations administratives\nL’étudiant respecte les modalités de paiement communiquées et conserve ses reçus. Toute difficulté doit être signalée à l’administration.\n\n7. Éthique et responsabilité professionnelle\nL’étudiant fait preuve d’honnêteté, de sérieux, de professionnalisme et respecte la confidentialité ainsi que les règles de sécurité de sa formation.\n\n8. Mesures disciplinaires\nSelon la gravité des faits : avertissement verbal ou écrit, convocation, suspension temporaire ou autre mesure prévue par le règlement intérieur. L’étudiant peut présenter sa version des faits avant toute décision disciplinaire importante.\n\n9. Engagement de l’étudiant\nChaque étudiant s’engage à respecter le présent règlement, à participer sérieusement à sa formation et à contribuer à la mission éducative du CETEP.`;
db.prepare("INSERT OR IGNORE INTO student_policy(id,title,content,version) VALUES(1,'Discipline, Éthique et Engagement étudiant',?,1)").run(defaultStudentPolicy);

function role(...roles){return (req,res,next)=>roles.includes(req.user?.role)?next():res.status(403).json({error:'Accès interdit'});} 
function nextNo(prefix,table,col){let n=db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c+1;let x=`${prefix}-${new Date().getFullYear()}-${String(n).padStart(4,'0')}`;while(db.prepare(`SELECT 1 FROM ${table} WHERE ${col}=?`).get(x)){n++;x=`${prefix}-${new Date().getFullYear()}-${String(n).padStart(4,'0')}`;}return x;}

function certificateNo(){
  let n=db.prepare('SELECT COUNT(*) c FROM certificates').get().c+1;
  let x=`CERT-${new Date().getFullYear()}-${String(n).padStart(5,'0')}`;
  while(db.prepare('SELECT 1 FROM certificates WHERE certificate_no=?').get(x)){n++;x=`CERT-${new Date().getFullYear()}-${String(n).padStart(5,'0')}`;}
  return x;
}
function completionStats(studentId,programId){
  const total=db.prepare(`SELECT COUNT(*) c FROM modules m JOIN lessons l ON l.module_id=m.id WHERE m.program_id=? AND m.active=1 AND l.active=1`).get(programId).c;
  const done=db.prepare(`SELECT COUNT(*) c FROM lesson_progress lp JOIN lessons l ON l.id=lp.lesson_id JOIN modules m ON m.id=l.module_id WHERE lp.student_id=? AND m.program_id=? AND m.active=1 AND l.active=1 AND lp.completed=1`).get(studentId,programId).c;
  // Aucun contenu publié ne signifie PAS que l'étudiant a terminé la formation.
  // Il faut au moins une leçon active publiée et toutes ces leçons terminées.
  return {total,done,percent:total>0?Math.min(100,Math.round(done*100/total)):0};
}
function paymentStats(studentId,programId){
  const due=Number(db.prepare('SELECT price_htg FROM programs WHERE id=?').get(programId)?.price_htg||0);
  const paid=Number(db.prepare("SELECT COALESCE(SUM(amount_htg),0) paid FROM payments WHERE student_id=? AND program_id=? AND status='Confirmé' AND (payment_category IS NULL OR payment_category IN ('Mensualité','Trimestriel'))").get(studentId,programId)?.paid||0);
  // Une formation sans tarif défini (0 ou négatif) n'est jamais considérée payée automatiquement.
  return {due,paid,fullyPaid:due>0 && paid>=due};
}
function refreshStudentCourseAccess(studentId,programId){
  if(!studentId||!programId)return false;
  const enrollment=db.prepare('SELECT id,manual_authorized FROM enrollments WHERE student_id=? AND program_id=?').get(studentId,programId);
  if(!enrollment)return false;
  const {fullyPaid}=paymentStats(studentId,programId);
  const allowed=Number(enrollment?.manual_authorized)===1 || (Number(enrollment?.manual_authorized)===0 && fullyPaid);
  db.prepare('UPDATE enrollments SET status=?,access_enabled=? WHERE student_id=? AND program_id=?').run(allowed?'Actif':'En attente',allowed?1:0,studentId,programId);
  const active=Number(db.prepare("SELECT COUNT(*) c FROM enrollments WHERE student_id=? AND status='Actif' AND access_enabled=1").get(studentId).c||0);
  db.prepare('UPDATE students SET access_enabled=?,status=? WHERE id=?').run(active?1:0,active?'Actif':'En attente',studentId);
  return allowed;
}

function tryAutoIssueCertificate(studentId,programId){
  const existing=db.prepare('SELECT * FROM certificates WHERE student_id=? AND program_id=?').get(studentId,programId);
  if(existing)return existing;
  const result=db.prepare('SELECT * FROM final_results WHERE student_id=? AND program_id=?').get(studentId,programId);
  if(!result || result.status!=='Réussi' || Number(result.score)<Number(result.pass_mark))return null;
  const completion=completionStats(studentId,programId);
  const payment=paymentStats(studentId,programId);
  if(completion.percent<100 || !payment.fullyPaid)return null;
  const student=db.prepare('SELECT name,certificate_name FROM students WHERE id=?').get(studentId);
  const no=certificateNo();
  const r=db.prepare('INSERT INTO certificates(certificate_no,student_id,program_id,result_id) VALUES(?,?,?,?)').run(no,studentId,programId,result.id);
  return db.prepare('SELECT c.*,s.name student_name,p.name program_name,r.score,r.pass_mark FROM certificates c JOIN students s ON s.id=c.student_id JOIN programs p ON p.id=c.program_id LEFT JOIN final_results r ON r.id=c.result_id WHERE c.id=?').get(r.lastInsertRowid);
}
function autoCertificateForStudent(studentId,programId){if(!studentId||!programId)return null;return tryAutoIssueCertificate(studentId,programId);}

function escapeHtml(v){return String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
const CETEP_EMAIL=process.env.CETEP_NOTIFICATION_EMAIL||'cetepecoleprofessionnelle@gmail.com';
function mailConfigured(){return Boolean(process.env.SMTP_PASS && (process.env.SMTP_USER||CETEP_EMAIL));}
function mailTransport(){return nodemailer.createTransport({host:process.env.SMTP_HOST||'smtp.gmail.com',port:Number(process.env.SMTP_PORT||465),secure:String(process.env.SMTP_SECURE||'true')==='true',auth:{user:process.env.SMTP_USER||CETEP_EMAIL,pass:process.env.SMTP_PASS}});}
async function sendCETEPNotification(subject,html){
  if(!mailConfigured()) return {sent:false,configured:false};
  try{
    await mailTransport().sendMail({from:process.env.SMTP_FROM||process.env.SMTP_USER||CETEP_EMAIL,to:CETEP_EMAIL,subject,html});
    return {sent:true,configured:true};
  }catch(error){console.error('[CETEP EMAIL]',error.message);return {sent:false,configured:true,error:error.message};}
}
async function sendStudentConfirmation(student, programName){
  if(!student?.email || !mailConfigured()) return {sent:false,configured:mailConfigured(),reason:student?.email?'smtp_not_configured':'no_student_email'};
  const subject='CETEP — Confirmation de votre inscription';
  const html=`<div style=\"font-family:Arial,sans-serif;line-height:1.6\"><h2>Votre inscription au CETEP est confirmée</h2><p>Bonjour <b>${escapeHtml(student.name)}</b>,</p><p>Nous vous confirmons que votre inscription au <b>Centre d’Encadrement Technique et Professionnel (CETEP)</b> a été validée.</p><p><b>Code étudiant :</b> ${escapeHtml(student.student_no)}<br><b>Formation :</b> ${escapeHtml(programName||'')}</p><p>Conservez précieusement votre code étudiant. Il vous servira pour votre espace étudiant lorsque votre accès sera activé.</p><p><b>CETEP — Formation • Orientation • Insertion professionnelle</b><br>${escapeHtml(CETEP_EMAIL)}</p></div>`;
  try{
    await mailTransport().sendMail({from:process.env.SMTP_FROM||process.env.SMTP_USER||CETEP_EMAIL,to:student.email,subject,html});
    return {sent:true,configured:true,to:student.email};
  }catch(error){console.error('[CETEP STUDENT EMAIL]',error.message);return {sent:false,configured:true,to:student.email,error:error.message};}
}

app.get('/health',async(req,res)=>{
  const status={ok:true,service:'CETEP',version:APP_VERSION,storage:DATA_DIR,
    persistence:neonSql?'sqlite+neon-snapshot':'sqlite-local',neonConfigured:Boolean(neonSql)};
  if(neonSql){
    try{
      const rows=await neonSql`SELECT updated_at FROM cetep_persistent_snapshot WHERE snapshot_id=1`;
      status.neonReachable=true;
      status.snapshotUpdatedAt=rows.length?rows[0].updated_at:null;
      if(!rows.length){status.ok=false;status.error='Neon snapshot is missing';}
    }catch(error){
      status.ok=false;status.neonReachable=false;status.error='Neon persistence check failed';
      console.error('[CETEP HEALTH] Neon check failed:',error.message);
    }
  }else if(IS_PRODUCTION){status.ok=false;status.error='DATABASE_URL is not configured';}
  res.status(status.ok?200:503).json(status);
});
function sendPage(res,file){const pub=path.join(__dirname,'public',file);const root=path.join(__dirname,file);if(fs.existsSync(pub))return res.sendFile(pub);if(fs.existsSync(root))return res.sendFile(root);return res.status(404).send('Page introuvable: '+file);}
app.get('/api/version',(req,res)=>{const modelPath=path.join(__dirname,'public',CERTIFICATE_MODEL_FILE);res.json({version:APP_VERSION,certificate_model:CERTIFICATE_MODEL_FILE,certificate_model_version:APP_VERSION,certificate_model_exists:fs.existsSync(modelPath),homepage_promotions:true});});app.get('/certificat-modele-2026.png',(req,res)=>{const model=path.join(__dirname,'public',CERTIFICATE_MODEL_FILE);if(!fs.existsSync(model))return res.status(404).send('Modèle officiel CETEP introuvable dans public/.');res.set({'Content-Type':'image/png','Cache-Control':'no-store, no-cache, must-revalidate, max-age=0','X-CETEP-Certificate-Model':APP_VERSION});res.sendFile(model);});app.get('/',(req,res)=>{res.set('Cache-Control','no-store');sendPage(res,'index.html');});app.get('/informations',(req,res)=>sendPage(res,'informations.html'));app.get('/login',(req,res)=>sendPage(res,'login.html'));app.get('/admin',(req,res)=>sendPage(res,'admin.html'));app.get('/direction',(req,res)=>sendPage(res,'direction.html'));app.get('/secretariat',(req,res)=>sendPage(res,'secretary.html'));app.get('/secretary',(req,res)=>res.redirect('/secretariat'));app.get('/local',(req,res)=>sendPage(res,'local.html'));app.get('/administration',(req,res)=>res.redirect('/admin'));app.get('/teacher',(req,res)=>sendPage(res,'teacher.html'));app.get('/professeur',(req,res)=>res.redirect('/teacher'));app.get('/student',(req,res)=>sendPage(res,'student.html'));app.get('/etudiant',(req,res)=>res.redirect('/student'));app.get('/undefined',(req,res)=>res.redirect('/'));
function adminLogin(req,res){const email=String(req.body.email||'').trim().toLowerCase();const a=db.prepare('SELECT * FROM admins WHERE lower(trim(email))=?').get(email);if(!a||a.role!=='admin'||Number(a.active)!==1||!a.password_hash||!bcrypt.compareSync(String(req.body.password||''),a.password_hash))return res.status(401).json({error:'Identifiants invalides'});res.cookie('cetep_token',sign({id:a.id,email:a.email,role:'admin'}),{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:43200000});res.json({ok:true,redirect:'/admin'});}
function secretaryLogin(req,res){const a=db.prepare("SELECT * FROM admins WHERE email=? AND role='secretary' AND active=1").get((req.body.email||'').trim().toLowerCase());if(!a||!bcrypt.compareSync(req.body.password||'',a.password_hash))return res.status(401).json({error:'Identifiants secrétariat invalides'});res.cookie('cetep_token',sign({id:a.id,email:a.email,role:'secretary'}),{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:43200000});res.json({ok:true,redirect:'/secretariat'});}
app.post('/api/secretary/login',secretaryLogin);
app.post('/api/login',adminLogin);app.post('/api/login/admin',adminLogin);
function teacherLogin(req,res){const email=String(req.body.email||'').trim().toLowerCase();const t=db.prepare('SELECT * FROM teachers WHERE lower(trim(email))=?').get(email);if(!t||Number(t.active)!==1||!t.password_hash||!bcrypt.compareSync(String(req.body.password||''),t.password_hash))return res.status(401).json({error:'Identifiants professeur invalides'});res.cookie('cetep_token',sign({id:t.id,teacher_no:t.teacher_no,role:'teacher'}),{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:43200000});res.json({ok:true,redirect:'/teacher'});}
app.post('/api/teacher/login',teacherLogin);app.post('/api/login/teacher',teacherLogin);
function studentLogin(req,res){const s=db.prepare('SELECT * FROM students WHERE student_no=?').get((req.body.code||req.body.student_no||'').trim().toUpperCase());if(!s||Number(s.access_enabled)!==1||!s.password_hash||!db.prepare("SELECT 1 FROM enrollments WHERE student_id=? AND access_enabled=1 AND status='Actif' LIMIT 1").get(s.id)||!bcrypt.compareSync(req.body.password||'',s.password_hash))return res.status(401).json({error:'Code étudiant, mot de passe ou accès invalide'});res.cookie('cetep_token',sign({id:s.id,student_no:s.student_no,role:'student'}),{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:43200000});res.json({ok:true,redirect:'/student'});}
app.post('/api/student/login',studentLogin);app.post('/api/login/student',studentLogin);

// Direction accounts: created and managed only by the principal administrator.
app.post('/api/direction/login',(req,res)=>{
 const email=String(req.body.email||'').trim().toLowerCase(), password=String(req.body.password||'');
 const a=db.prepare("SELECT * FROM admins WHERE lower(email)=? AND role IN ('direction_general','direction_studies') AND active=1").get(email);
 if(!a||!bcrypt.compareSync(password,a.password_hash))return res.status(401).json({error:'Identifiants Direction invalides.'});
 const roleName=a.role;db.prepare('INSERT INTO direction_audit(actor_id,actor_email,actor_role,action,details) VALUES(?,?,?,?,?)').run(a.id,a.email,roleName,'LOGIN',JSON.stringify({}));
 res.cookie('cetep_token',sign({id:a.id,email:a.email,role:roleName}),{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:43200000});
 res.json({ok:true,redirect:'/direction'});
});
app.get('/api/admin/direction-accounts',auth,role('admin'),(req,res)=>res.json(db.prepare("SELECT id,email,role,active,created_at FROM admins WHERE role IN ('direction_general','direction_studies') ORDER BY role,id").all()));
app.post('/api/admin/direction-accounts',auth,role('admin'),(req,res)=>{
 const roleName=String(req.body.role||''), email=String(req.body.email||'').trim().toLowerCase(), password=String(req.body.password||'');
 if(!['direction_general','direction_studies'].includes(roleName))return res.status(400).json({error:'Rôle Direction invalide.'});
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:'Adresse email invalide.'});
 if(password.length<12)return res.status(400).json({error:'Le mot de passe doit contenir au moins 12 caractères.'});
 try{const r=db.prepare('INSERT INTO admins(email,password_hash,role,active) VALUES(?,?,?,1)').run(email,bcrypt.hashSync(password,12),roleName);
 db.prepare('INSERT INTO direction_audit(actor_id,actor_email,actor_role,action,details) VALUES(?,?,?,?,?)').run(req.user.id,req.user.email,'admin','CREATE_ACCOUNT',JSON.stringify({account_id:r.lastInsertRowid,email,role:roleName}));
 res.status(201).json({ok:true,id:r.lastInsertRowid,email,role:roleName});}catch(e){res.status(409).json({error:'Cet email est déjà utilisé.'});}
});
app.patch('/api/admin/direction-accounts/:id',auth,role('admin'),(req,res)=>{
 const id=Number(req.params.id), account=db.prepare("SELECT id,email,role,active FROM admins WHERE id=? AND role IN ('direction_general','direction_studies')").get(id);
 if(!account)return res.status(404).json({error:'Compte Direction introuvable.'});
 const active=req.body.active, password=req.body.password;
 if(active!==undefined && ![true,false,0,1].includes(active))return res.status(400).json({error:'Statut invalide.'});
 if(password!==undefined && (typeof password!=='string'||password.length<12))return res.status(400).json({error:'Le mot de passe doit contenir au moins 12 caractères.'});
 if(active!==undefined)db.prepare('UPDATE admins SET active=? WHERE id=?').run(active?1:0,id);
 if(password!==undefined)db.prepare('UPDATE admins SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password,12),id);
 db.prepare('INSERT INTO direction_audit(actor_id,actor_email,actor_role,action,details) VALUES(?,?,?,?,?)').run(req.user.id,req.user.email,'admin','UPDATE_ACCOUNT',JSON.stringify({account_id:id,active:active===undefined?null:!!active,password_reset:password!==undefined}));
 res.json({ok:true});
});
app.get('/api/direction/overview',auth,role('direction_general','direction_studies'),(req,res)=>{
 const common={students:db.prepare('SELECT COUNT(*) c FROM students').get().c,active_students:db.prepare("SELECT COUNT(DISTINCT student_id) c FROM enrollments WHERE status='Actif'").get().c,programs:db.prepare('SELECT COUNT(*) c FROM programs WHERE active=1').get().c};
 let data={role:req.user.role,common};
 if(req.user.role==='direction_general'){
  data.finance={confirmed_payments:db.prepare("SELECT COALESCE(SUM(amount_htg),0) total FROM payments WHERE status='Confirmé'").get().total,confirmed_donations:db.prepare("SELECT COALESCE(SUM(amount),0) total FROM donations WHERE status!='Refusé'").get().total,expenses:db.prepare("SELECT COALESCE(SUM(amount_htg),0) total FROM expenses WHERE status IS NULL OR status!='Annulé'").get().total};
  data.teachers=db.prepare('SELECT COUNT(*) c FROM teachers WHERE active=1').get().c;
 }else{
  data.academic={teachers:db.prepare('SELECT COUNT(*) c FROM teachers WHERE active=1').get().c,pending_enrollments:db.prepare("SELECT COUNT(*) c FROM enrollments WHERE status='En attente'").get().c,grade_records:db.prepare('SELECT COUNT(*) c FROM academic_grades').get().c,programs:db.prepare('SELECT id,name,duration,program_group FROM programs WHERE active=1 ORDER BY program_group,name').all()};
 }
 db.prepare('INSERT INTO direction_audit(actor_id,actor_email,actor_role,action,details) VALUES(?,?,?,?,?)').run(req.user.id,req.user.email,req.user.role,'VIEW_OVERVIEW','{}');
 res.json(data);
});
app.get('/api/direction/recommendations',auth,role('direction_general','direction_studies'),(req,res)=>res.json(db.prepare('SELECT id,subject,message,status,admin_note,created_at,reviewed_at FROM direction_recommendations WHERE director_id=? ORDER BY id DESC LIMIT 100').all(req.user.id)));
app.post('/api/direction/recommendations',auth,role('direction_general','direction_studies'),(req,res)=>{
 const subject=String(req.body.subject||'').trim().slice(0,160), message=String(req.body.message||'').trim().slice(0,5000);
 if(subject.length<3||message.length<10)return res.status(400).json({error:'Saisissez un sujet et un message (10 caractères minimum).'});
 const r=db.prepare('INSERT INTO direction_recommendations(director_id,director_email,director_role,subject,message) VALUES(?,?,?,?,?)').run(req.user.id,req.user.email,req.user.role,subject,message);
 db.prepare('INSERT INTO direction_audit(actor_id,actor_email,actor_role,action,details) VALUES(?,?,?,?,?)').run(req.user.id,req.user.email,req.user.role,'SUBMIT_RECOMMENDATION',JSON.stringify({recommendation_id:r.lastInsertRowid}));
 res.status(201).json({ok:true,id:r.lastInsertRowid});
});
app.get('/api/admin/direction-recommendations',auth,role('admin'),(req,res)=>res.json(db.prepare('SELECT * FROM direction_recommendations ORDER BY id DESC LIMIT 300').all()));
app.patch('/api/admin/direction-recommendations/:id',auth,role('admin'),(req,res)=>{
 const id=Number(req.params.id), status=String(req.body.status||'À examiner'), note=String(req.body.admin_note||'').slice(0,2000);
 if(!['À examiner','Acceptée','Refusée','Traitée'].includes(status))return res.status(400).json({error:'Statut invalide.'});
 const r=db.prepare('UPDATE direction_recommendations SET status=?,admin_note=?,reviewed_by=?,reviewed_by_email=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?').run(status,note,req.user.id,req.user.email,id);
 if(!r.changes)return res.status(404).json({error:'Recommandation introuvable.'});
 db.prepare('INSERT INTO direction_audit(actor_id,actor_email,actor_role,action,details) VALUES(?,?,?,?,?)').run(req.user.id,req.user.email,'admin','REVIEW_RECOMMENDATION',JSON.stringify({recommendation_id:id,status}));res.json({ok:true});
});
app.get('/api/admin/direction-audit',auth,role('admin'),(req,res)=>res.json(db.prepare('SELECT * FROM direction_audit ORDER BY id DESC LIMIT 300').all()));

// CETEP accounting: expenses are admin-managed, audited, and never hard-deleted.
const CETEP_EXPENSE_CATEGORIES=['Salè ak pèsonèl','Lwaye ak lokal','Kouran ak entènèt','Materyèl pedagojik','Ekipman ak mèb','Transpò ak deplasman','Aktivite ak gradyasyon','Piblisite ak kominikasyon','Bous ak sipò elèv','Antretyen ak reparasyon','Depans administratif','Lòt depans'];
function expenseAudit(req,action,id,details){
 db.prepare('INSERT INTO expense_audit(actor_id,actor_email,action,expense_id,details) VALUES(?,?,?,?,?)')
  .run(req.user?.id||null,req.user?.email||'admin',action,id||null,JSON.stringify(details||{}));
}
app.get('/api/admin/expenses',auth,role('admin'),(req,res)=>{
 const from=String(req.query.from||''),to=String(req.query.to||''),category=String(req.query.category||'');
 const clauses=[],params=[];
 if(from){clauses.push('expense_date>=?');params.push(from);}
 if(to){clauses.push('expense_date<=?');params.push(to);}
 if(category){clauses.push('category=?');params.push(category);}
 const where=clauses.length?' WHERE '+clauses.join(' AND '):'';
 const expenses=db.prepare('SELECT * FROM expenses'+where+' ORDER BY expense_date DESC,id DESC').all(...params);
 const active="(status IS NULL OR status!='Annulé')";
 const revenue=Number(db.prepare("SELECT COALESCE(SUM(amount_htg),0) total FROM payments WHERE status='Confirmé'").get().total||0)+Number(db.prepare("SELECT COALESCE(SUM(amount),0) total FROM donations WHERE status NOT IN ('Refusé','Annulé')").get().total||0);
 const totalExpenses=Number(db.prepare(`SELECT COALESCE(SUM(amount_htg),0) total FROM expenses WHERE ${active}`).get().total||0);
 const periodExpenses=Number(db.prepare(`SELECT COALESCE(SUM(amount_htg),0) total FROM expenses${where?where+' AND ': ' WHERE '} ${active}`).get(...params).total||0);
 const periodRevenue=Number(db.prepare("SELECT COALESCE(SUM(amount_htg),0) total FROM payments WHERE status='Confirmé' AND date(created_at) BETWEEN COALESCE(NULLIF(? ,''),date('now','-100 years')) AND COALESCE(NULLIF(? ,''),date('now','+100 years'))").get(from,to).total||0)
  +Number(db.prepare("SELECT COALESCE(SUM(amount),0) total FROM donations WHERE status NOT IN ('Refusé','Annulé') AND date(created_at) BETWEEN COALESCE(NULLIF(? ,''),date('now','-100 years')) AND COALESCE(NULLIF(? ,''),date('now','+100 years'))").get(from,to).total||0);
 const byCategory=db.prepare("SELECT category,COALESCE(SUM(amount_htg),0) total FROM expenses WHERE (status IS NULL OR status!='Annulé')"+(from?' AND expense_date>=?':'')+(to?' AND expense_date<=?':'')+(category?' AND category=?':'')+" GROUP BY category ORDER BY total DESC").all(...[...(from?[from]:[]),...(to?[to]:[]),...(category?[category]:[])]);
 const audit=db.prepare('SELECT * FROM expense_audit ORDER BY id DESC LIMIT 300').all();
 res.json({categories:CETEP_EXPENSE_CATEGORIES,expenses,byCategory,audit,summary:{revenue,expenses:totalExpenses,balance:revenue-totalExpenses,count:db.prepare(`SELECT COUNT(*) c FROM expenses WHERE ${active}`).get().c,period_revenue:periodRevenue,period_expenses:periodExpenses}});
});
app.post('/api/admin/expenses',auth,role('admin'),(req,res)=>{
 const b=req.body||{},expenseDate=String(b.expense_date||''),category=String(b.category||''),method=String(b.method||''),payee=String(b.payee||'').trim(),description=String(b.description||'').trim(),amount=Number(b.amount_htg);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)||!CETEP_EXPENSE_CATEGORIES.includes(category)||!Number.isFinite(amount)||amount<=0||!method||!payee||!description)
  return res.status(400).json({error:'Dat, kategori, montan, mòd, benefisyè ak deskripsyon obligatwa.'});
 const receipt=String(b.receipt||'');
 if(receipt && (!/^data:image\/(png|jpeg|webp);base64,/.test(receipt)||receipt.length>7*1024*1024))
  return res.status(400).json({error:'Resi a dwe yon imaj PNG/JPEG/WebP ki pa depase 5 Mo.'});
 const r=db.prepare("INSERT INTO expenses(expense_date,category,amount_htg,method,payee,reference,description,receipt,status,created_by,created_by_email) VALUES(?,?,?,?,?,?,?,?, 'Confirmé',?,?)")
  .run(expenseDate,category,amount,method,payee,String(b.reference||'').trim(),description,receipt||null,req.user.id,req.user.email);
 expenseAudit(req,'CREATE',r.lastInsertRowid,{expense_date:expenseDate,category,amount_htg:amount,payee});
 res.status(201).json({ok:true,id:r.lastInsertRowid});
});
app.put('/api/admin/expenses/:id',auth,role('admin'),(req,res)=>{
 const id=Number(req.params.id),b=req.body||{},old=db.prepare('SELECT * FROM expenses WHERE id=?').get(id);
 if(!old)return res.status(404).json({error:'Depans sa a pa egziste.'});
 if(old.status==='Annulé')return res.status(409).json({error:'Yon depans ki anile pa ka modifye.'});
 const amount=Number(b.amount_htg),description=String(b.description||'').trim(),payee=String(b.payee||'').trim();
 if(!Number.isFinite(amount)||amount<=0||!description||!payee)return res.status(400).json({error:'Montan, deskripsyon ak benefisyè obligatwa.'});
 db.prepare('UPDATE expenses SET amount_htg=?,description=?,payee=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(amount,description,payee,id);
 expenseAudit(req,'UPDATE',id,{before:{amount_htg:old.amount_htg,description:old.description,payee:old.payee},after:{amount_htg:amount,description,payee}});
 res.json({ok:true});
});
app.post('/api/admin/expenses/:id/void',auth,role('admin'),(req,res)=>{
 const id=Number(req.params.id),old=db.prepare('SELECT id,status FROM expenses WHERE id=?').get(id);
 if(!old)return res.status(404).json({error:'Depans sa a pa egziste.'});
 if(old.status==='Annulé')return res.json({ok:true,already_void:true});
 db.prepare("UPDATE expenses SET status='Annulé',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
 expenseAudit(req,'VOID',id,{previous_status:old.status});
 res.json({ok:true});
});


app.post('/api/logout',(req,res)=>{res.clearCookie('cetep_token');res.json({ok:true});});app.get('/api/session',auth,(req,res)=>res.json({user:req.user}));
// Supervised secretary accounts: only the principal administrator can create/manage them.
app.get('/api/admin/secretaries',auth,role('admin'),(req,res)=>res.json(db.prepare("SELECT id,email,active,created_at FROM admins WHERE role='secretary' ORDER BY id DESC").all()));
app.get('/api/admin/secretariat-audit',auth,role('admin'),(req,res)=>res.json(db.prepare('SELECT * FROM secretariat_audit ORDER BY id DESC LIMIT 200').all()));
app.post('/api/admin/secretaries',auth,role('admin'),(req,res)=>{const email=String(req.body.email||'').trim().toLowerCase(),password=String(req.body.password||'');if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:'Adresse email invalide.'});if(password.length<12)return res.status(400).json({error:'Le mot de passe doit contenir au moins 12 caractères.'});try{const r=db.prepare("INSERT INTO admins(email,password_hash,role,active) VALUES(?,?,'secretary',1)").run(email,bcrypt.hashSync(password,12));db.prepare("INSERT INTO secretariat_audit(actor_id,actor_email,action,entity_type,entity_id,details) VALUES(?,?,'CREATE_ACCOUNT','secretary',?,?)").run(req.user.id,req.user.email,r.lastInsertRowid,JSON.stringify({email}));res.status(201).json({ok:true,id:r.lastInsertRowid,email});}catch(e){res.status(409).json({error:'Cet email est déjà utilisé.'});}});
app.patch('/api/admin/secretaries/:id',auth,role('admin'),(req,res)=>{
  const id=Number(req.params.id);
  const account=db.prepare("SELECT id,email,active FROM admins WHERE id=? AND role='secretary'").get(id);
  if(!account)return res.status(404).json({error:'Compte secrétaire introuvable.'});

  const body=req.body||{};
  const hasEmail=Object.prototype.hasOwnProperty.call(body,'email');
  const hasActive=Object.prototype.hasOwnProperty.call(body,'active');
  const hasPassword=Object.prototype.hasOwnProperty.call(body,'password');
  const email=hasEmail?String(body.email||'').trim().toLowerCase():account.email;
  const password=hasPassword?String(body.password||''):'';
  const active=hasActive?(body.active===false||body.active===0?0:1):Number(account.active);

  if(hasEmail && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email))
    return res.status(400).json({error:'Adresse email invalide.'});
  if(hasPassword && password.length>0 && password.length<12)
    return res.status(400).json({error:'Le mot de passe doit contenir au moins 12 caractères.'});
  if(hasEmail && email!==account.email){
    const conflict=db.prepare("SELECT id FROM admins WHERE lower(email)=lower(?) AND id<>? LIMIT 1").get(email,id);
    if(conflict)return res.status(409).json({error:'Cet email est déjà utilisé par un autre compte.'});
  }

  try{
    const update=db.transaction(()=>{
      if(hasEmail)db.prepare('UPDATE admins SET email=? WHERE id=?').run(email,id);
      if(hasActive)db.prepare('UPDATE admins SET active=? WHERE id=?').run(active,id);
      if(hasPassword && password)db.prepare('UPDATE admins SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password,12),id);

      const actions=[];
      if(hasEmail && email!==account.email)actions.push('email_changed');
      if(hasActive && active!==Number(account.active))actions.push(active?'ACTIVATE_ACCOUNT':'DEACTIVATE_ACCOUNT');
      if(hasPassword && password)actions.push('password_changed');
      if(actions.length){
        db.prepare("INSERT INTO secretariat_audit(actor_id,actor_email,action,entity_type,entity_id,details) VALUES(?,?,?,'secretary',?,?)")
          .run(req.user.id,req.user.email,actions.join('+'),id,JSON.stringify({
            old_email:account.email,new_email:email,email_changed:hasEmail&&email!==account.email,
            active,password_changed:hasPassword&&!!password
          }));
      }
    });
    update();
    res.json({ok:true,id,email,active,email_changed:hasEmail&&email!==account.email});
  }catch(error){
    if(String(error.message).includes('UNIQUE constraint failed'))return res.status(409).json({error:'Cet email est déjà utilisé.'});
    console.error('[CETEP SECRETARY UPDATE]',error.message);
    res.status(500).json({error:'Impossible de modifier le compte secrétaire.'});
  }
});
// Communications: the administrator controls whether secretariat can send messages.
function maySendMessages(user){
 if(user?.role==='admin') return true;
 if(user?.role==='secretary') return Number(db.prepare("SELECT allowed FROM role_permissions WHERE role='secretary' AND permission='send_messages'").get()?.allowed||0)===1;
 return false;
}
function createStudentNotice(studentId,programId,title,message,type='message',dedupeKey=null){
 const q=db.prepare(`INSERT OR IGNORE INTO student_notifications(student_id,program_id,title,message,notification_type,dedupe_key) VALUES(?,?,?,?,?,?)`);
 return Number(q.run(Number(studentId),programId?Number(programId):null,String(title).slice(0,180),String(message).slice(0,5000),type,dedupeKey).changes||0);
}
function publishAnnouncement({title,message,audience='Tous',programId=null,studentId=null,actor,channel='in_app'}){
 const cleanTitle=String(title||'').trim(),cleanMessage=String(message||'').trim();
 if(!cleanTitle||!cleanMessage) throw new Error('Tit ak mesaj obligatwa.');
 if(cleanTitle.length>180||cleanMessage.length>5000) throw new Error('Tit oswa mesaj la twò long.');
 let students=[];
 if(studentId){students=db.prepare('SELECT id,email,name FROM students WHERE id=?').all(Number(studentId));audience='Etidyan';}
 else if(programId){students=db.prepare(`SELECT DISTINCT s.id,s.email,s.name FROM students s JOIN enrollments e ON e.student_id=s.id WHERE e.program_id=?`).all(Number(programId));audience='Formation';}
 else {students=db.prepare('SELECT id,email,name FROM students').all();audience='Tous';}
 if(!students.length) throw new Error('Pa gen elèv ki koresponn ak destinasyon sa a.');
 const r=db.prepare(`INSERT INTO announcements(title,message,audience,active,program_id,student_id,created_by,created_by_email,channel,sent_count) VALUES(?,?,?,1,?,?,?,?,?,?)`)
 .run(cleanTitle,cleanMessage,audience,programId,studentId,actor.id,actor.email,channel,students.length);
 const insert=db.transaction(()=>{for(const st of students) createStudentNotice(st.id,programId,cleanTitle,cleanMessage,'announcement',`announcement:${r.lastInsertRowid}:${st.id}`);});insert();
 db.prepare('INSERT INTO communication_audit(actor_id,actor_email,actor_role,action,audience,title,details) VALUES(?,?,?,?,?,?,?)')
 .run(actor.id,actor.email,actor.role,'SEND_ANNOUNCEMENT',audience,cleanTitle,JSON.stringify({announcement_id:Number(r.lastInsertRowid),recipients:students.length,program_id:programId,student_id:studentId}));
 return {id:Number(r.lastInsertRowid),recipients:students.length};
}
app.get('/api/admin/communications',auth,role('admin'),(req,res)=>{
 const announcements=db.prepare('SELECT a.*,p.name program_name,s.name student_name FROM announcements a LEFT JOIN programs p ON p.id=a.program_id LEFT JOIN students s ON s.id=a.student_id ORDER BY a.id DESC LIMIT 100').all();
 const permission=Number(db.prepare("SELECT allowed FROM role_permissions WHERE role='secretary' AND permission='send_messages'").get()?.allowed||0);
 const st=settings();res.json({announcements,permissions:{secretary_send_messages:permission===1},reminders:{enabled:st.payment_reminders_enabled==='1',due_day:Number(st.payment_reminder_due_day||5),email:st.payment_reminder_email==='1',message:st.payment_reminder_text||''},mail_configured:mailConfigured()});
});
app.put('/api/admin/communications/permissions',auth,role('admin'),(req,res)=>{
 const allowed=req.body?.secretary_send_messages===true||req.body?.secretary_send_messages===1;
 db.prepare(`INSERT INTO role_permissions(role,permission,allowed,updated_by,updated_by_email,updated_at) VALUES('secretary','send_messages',?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(role,permission) DO UPDATE SET allowed=excluded.allowed,updated_by=excluded.updated_by,updated_by_email=excluded.updated_by_email,updated_at=CURRENT_TIMESTAMP`).run(allowed?1:0,req.user.id,req.user.email);
 db.prepare('INSERT INTO communication_audit(actor_id,actor_email,actor_role,action,details) VALUES(?,?,?,?,?)').run(req.user.id,req.user.email,'admin','UPDATE_PERMISSION',JSON.stringify({role:'secretary',permission:'send_messages',allowed}));res.json({ok:true,allowed});
});
app.put('/api/admin/communications/reminders',auth,role('admin'),(req,res)=>{
 const b=req.body||{},enabled=b.enabled===true||b.enabled===1,due=Math.max(1,Math.min(28,Number(b.due_day||5))),email=b.email===true||b.email===1,message=String(b.message||'').trim();
 if(message.length>2000)return res.status(400).json({error:'Modèl rapèl la twò long.'});
 for(const [k,v] of Object.entries({payment_reminders_enabled:enabled?'1':'0',payment_reminder_due_day:String(due),payment_reminder_email:email?'1':'0',payment_reminder_text:message}))db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k,v);
 db.prepare('INSERT INTO communication_audit(actor_id,actor_email,actor_role,action,details) VALUES(?,?,?,?,?)').run(req.user.id,req.user.email,'admin','UPDATE_PAYMENT_REMINDERS',JSON.stringify({enabled,due_day:due,email}));res.json({ok:true,enabled,due_day:due,email});
});
app.post('/api/admin/announcements',auth,role('admin'),(req,res)=>{try{const b=req.body||{},out=publishAnnouncement({title:b.title,message:b.message,programId:b.program_id||null,studentId:b.student_id||null,actor:req.user});res.status(201).json({ok:true,...out});}catch(e){res.status(400).json({error:e.message});}});
app.post('/api/secretary/announcements',auth,role('secretary'),(req,res)=>{if(!maySendMessages(req.user))return res.status(403).json({error:'Administratè a poko ba ou pèmisyon pou voye mesaj.'});try{const b=req.body||{},out=publishAnnouncement({title:b.title,message:b.message,programId:b.program_id||null,studentId:b.student_id||null,actor:req.user});res.status(201).json({ok:true,...out});}catch(e){res.status(400).json({error:e.message});}});
app.get('/api/secretary/communications/status',auth,role('secretary'),(req,res)=>res.json({can_send:maySendMessages(req.user)}));
app.get('/api/student/notifications',auth,role('student'),(req,res)=>res.json(db.prepare('SELECT id,title,message,notification_type,read_at,created_at FROM student_notifications WHERE student_id=? ORDER BY id DESC LIMIT 100').all(req.user.id)));
app.post('/api/student/notifications/:id/read',auth,role('student'),(req,res)=>{const r=db.prepare('UPDATE student_notifications SET read_at=CURRENT_TIMESTAMP WHERE id=? AND student_id=?').run(Number(req.params.id),Number(req.user.id));if(!r.changes)return res.status(404).json({error:'Notifikasyon pa jwenn.'});res.json({ok:true});});

function runPaymentReminderJob(){
 const st=settings();if(st.payment_reminders_enabled!=='1')return {enabled:false,sent:0};
 const now=new Date(),dueDay=Math.max(1,Math.min(28,Number(st.payment_reminder_due_day||5)));if(now.getDate()<dueDay)return {enabled:true,sent:0,waiting:true};
 const period=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
 const quarterMonth=Math.floor(now.getMonth()/3)*3+1,quarterStart=`${now.getFullYear()}-${String(quarterMonth).padStart(2,'0')}-01`;
 const candidates=db.prepare(`SELECT s.id student_id,s.name,s.email,p.id program_id,p.name program_name,COALESCE(p.monthly_fee_htg,0) fee,
 CASE WHEN EXISTS(SELECT 1 FROM payments q WHERE q.student_id=s.id AND q.program_id=p.id AND q.status='Confirmé' AND q.payment_category='Trimestriel' AND date(q.created_at)>=date(?) AND date(q.created_at)<date(?, '+3 months')) THEN COALESCE(p.monthly_fee_htg,0) ELSE COALESCE((SELECT SUM(x.amount_htg) FROM payments x WHERE x.student_id=s.id AND x.program_id=p.id AND x.status='Confirmé' AND x.payment_category='Mensualité' AND COALESCE(x.billing_period,x.billing_month)=?),0) END paid
 FROM enrollments e JOIN students s ON s.id=e.student_id JOIN programs p ON p.id=e.program_id
 WHERE e.status='Actif' AND p.active=1 AND COALESCE(p.monthly_fee_htg,0)>0 AND COALESCE(p.fee_period,'Mensualité')='Mensualité'`).all(quarterStart,quarterStart,period);
 let sent=0;const tpl=String(st.payment_reminder_text||'Chè {name}, gen yon balans {balance} HTG pou {program} ({period}).');
 for(const x of candidates){const balance=Math.max(0,Number(x.fee)-Number(x.paid));if(balance<=0)continue;
 const key=`payment-reminder:${period}:${x.student_id}:${x.program_id}`;
 const msg=tpl.replaceAll('{name}',x.name||'Etidyan').replaceAll('{balance}',balance.toLocaleString('fr-FR')).replaceAll('{program}',x.program_name).replaceAll('{period}',period);
 const created=createStudentNotice(x.student_id,x.program_id,'Rapèl peman CETEP',msg,'payment_reminder',key);if(created){sent+=created;
 if(st.payment_reminder_email==='1'&&x.email&&mailConfigured())mailTransport().sendMail({from:process.env.SMTP_FROM||process.env.SMTP_USER||CETEP_EMAIL,to:x.email,subject:'CETEP — Rappel de paiement',html:`<div style="font-family:Arial,sans-serif;line-height:1.6"><p>${escapeHtml(msg)}</p><p>CETEP — Formation • Orientation • Insertion professionnelle</p></div>`}).catch(e=>console.error('[CETEP REMINDER EMAIL]',e.message));
 }}
 if(sent){db.prepare("INSERT INTO communication_audit(actor_id,actor_email,actor_role,action,audience,title,details) VALUES(NULL,'system','system','AUTO_PAYMENT_REMINDERS','Etudiants concernés','Rappels de paiement',?)").run(JSON.stringify({period,sent}));if(neonSql)flushNeonSnapshot().catch(e=>console.error('[CETEP REMINDER SNAPSHOT]',e.message));}
 return {enabled:true,period,sent};
}
setTimeout(()=>{try{console.log('[CETEP PAYMENT REMINDERS]',runPaymentReminderJob())}catch(e){console.error('[CETEP PAYMENT REMINDERS]',e.message)}},15000);
setInterval(()=>{try{runPaymentReminderJob()}catch(e){console.error('[CETEP PAYMENT REMINDERS]',e.message)}},24*60*60*1000);

app.get('/api/secretary/programs',auth,role('secretary'),(req,res)=>res.json(db.prepare('SELECT id,name,duration,price_htg,monthly_fee_htg FROM programs WHERE active=1 ORDER BY name').all()));
app.get('/api/secretary/students',auth,role('secretary'),(req,res)=>{const q=String(req.query.q||'').trim();const like='%'+q+'%';res.json(db.prepare(`SELECT id,student_no,name,phone FROM students WHERE (?='' OR name LIKE ? OR student_no LIKE ? OR nif LIKE ? OR cin LIKE ?) ORDER BY id DESC LIMIT 100`).all(q,like,like,like,like));});
app.post('/api/secretary/students',auth,role('secretary'),(req,res)=>{try{const b=req.body||{},nif=normalizeIdentity(b.nif),cin=normalizeIdentity(b.cin);if(!b.name||!b.phone||!b.program_id)return res.status(400).json({error:'Nom, téléphone et formation obligatoires.'});if(!nif&&!cin)return res.status(400).json({error:'NIF ou CIN obligatoire.'});if(nif&&db.prepare('SELECT id FROM students WHERE nif=?').get(nif))return res.status(409).json({error:'Ce NIF existe déjà. Contactez l’administrateur pour une correction.'});if(cin&&db.prepare('SELECT id FROM students WHERE cin=?').get(cin))return res.status(409).json({error:'Ce CIN existe déjà. Contactez l’administrateur pour une correction.'});const program=db.prepare('SELECT id FROM programs WHERE id=? AND active=1').get(Number(b.program_id));if(!program)return res.status(400).json({error:'Formation invalide.'});const no=nextNo('CETEP','students','student_no');const pw=generateTemporaryPassword();const tx=db.transaction(()=>{const r=db.prepare(`INSERT INTO students(student_no,name,birth_date,birth_place,phone,email,nif,cin,program_id,education,blood_group,responsible_person,marital_status,status,password_hash,access_enabled,created_by,created_by_email) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`).run(no,String(b.name).trim(),b.birth_date||null,b.birth_place||null,String(b.phone).trim(),b.email||null,nif||null,cin||null,Number(b.program_id),b.education||null,b.blood_group||null,b.responsible_person||null,b.marital_status||null,'En attente',bcrypt.hashSync(pw,12),req.user.id,req.user.email);db.prepare("INSERT OR IGNORE INTO enrollments(student_id,program_id,status,access_enabled,manual_authorized,start_date,end_date) VALUES(?,?,'En attente',0,0,?,?)").run(r.lastInsertRowid,Number(b.program_id),b.start_date||null,b.end_date||null);db.prepare("INSERT INTO secretariat_audit(actor_id,actor_email,action,entity_type,entity_id,details) VALUES(?,?,'CREATE_STUDENT','student',?,?)").run(req.user.id,req.user.email,r.lastInsertRowid,JSON.stringify({student_no:no,program_id:Number(b.program_id)}));return Number(r.lastInsertRowid);});const id=tx();res.status(201).json({ok:true,id,student_no:no,temporary_password:pw});}catch(e){res.status(400).json({error:e.message});}});
app.post('/api/secretary/payments',auth,role('secretary'),(req,res)=>{try{const b=req.body||{},sid=Number(b.student_id),amount=Number(b.amount_htg),category=String(b.payment_category||'').trim(),method=String(b.method||'').trim();const allowed=['Inscription','Badge','Mayo CETEP','Mensualité','Trimestriel','Matériel','Autre'];if(!sid||!db.prepare('SELECT id FROM students WHERE id=?').get(sid))return res.status(400).json({error:'Choisissez un étudiant valide.'});if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:'Le montant doit être supérieur à zéro.'});if(!allowed.includes(category))return res.status(400).json({error:'Catégorie de paiement invalide.'});if(!method)return res.status(400).json({error:'Méthode de paiement obligatoire.'});const student=db.prepare('SELECT program_id FROM students WHERE id=?').get(sid);const pid=Number(b.program_id||student.program_id||0)||null;if(pid&&!db.prepare('SELECT 1 FROM enrollments WHERE student_id=? AND program_id=?').get(sid,pid))return res.status(400).json({error:'Cette formation ne figure pas au dossier de l’étudiant.'});const period=String(b.billing_period||'').trim();if(['Mensualité','Trimestriel'].includes(category)&&!period)return res.status(400).json({error:'Indiquez le mois ou le trimestre concerné.'});const isCash=['Espèces','Cash','Manuel','Cash HTG'].includes(method);const status=isCash?'Confirmé':'En attente';const ref='SEC-'+new Date().toISOString().slice(0,10).replace(/-/g,'')+'-'+crypto.randomBytes(4).toString('hex').toUpperCase();const r=db.prepare(`INSERT INTO payments(student_id,program_id,amount_htg,method,status,reference,payment_category,billing_period,recorded_by,recorded_by_email,billing_month) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(sid,pid,amount,method,status,ref,category,period||null,req.user.id,req.user.email,/^\d{4}-(0[1-9]|1[0-2])$/.test(period)?period:null);db.prepare("INSERT INTO secretariat_audit(actor_id,actor_email,action,entity_type,entity_id,details) VALUES(?,?,'RECORD_PAYMENT','payment',?,?)").run(req.user.id,req.user.email,r.lastInsertRowid,JSON.stringify({student_id:sid,amount_htg:amount,category,method,status,reference:ref}));if(status==='Confirmé'&&pid&&['Mensualité','Trimestriel'].includes(category))refreshStudentCourseAccess(sid,pid);res.status(201).json({ok:true,id:r.lastInsertRowid,reference:ref,status,receipt:'/api/secretary/payments/'+r.lastInsertRowid+'/receipt'});}catch(e){res.status(400).json({error:e.message});}});
app.get('/api/secretary/payments',auth,role('secretary'),(req,res)=>res.json(db.prepare(`SELECT p.id,p.reference,p.amount_htg,p.method,p.status,p.payment_category,p.billing_period,p.created_at,s.name student_name,s.student_no FROM payments p LEFT JOIN students s ON s.id=p.student_id WHERE p.recorded_by=? ORDER BY p.id DESC LIMIT 200`).all(req.user.id)));
app.get('/api/secretary/payments/:id/receipt',auth,role('secretary','admin'),(req,res)=>{const p=db.prepare(`SELECT p.*,s.name student_name,s.student_no FROM payments p LEFT JOIN students s ON s.id=p.student_id WHERE p.id=?`).get(Number(req.params.id));if(!p)return res.status(404).send('Reçu introuvable');if(req.user.role==='secretary'&&Number(p.recorded_by)!==Number(req.user.id))return res.status(403).send('Accès interdit');const doc=new PDFDocument({size:'A5',margin:36,info:{Title:'Reçu CETEP '+p.reference,Author:'CETEP'}});res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`inline; filename="recu-${p.reference}.pdf"`);doc.pipe(res);doc.fontSize(18).text('CETEP',{align:'center'});doc.fontSize(10).text('Centre d’Encadrement Technique et Professionnel',{align:'center'});doc.moveDown().fontSize(16).text('REÇU DE PAIEMENT',{align:'center'});doc.moveDown().fontSize(11).text('N° : '+p.reference);doc.text('Date : '+p.created_at);doc.text('Étudiant : '+(p.student_name||'—')+' ('+(p.student_no||'—')+')');doc.text('Motif : '+(p.payment_category||'—'));doc.text('Période : '+(p.billing_period||'—'));doc.text('Montant : '+Number(p.amount_htg).toLocaleString('fr-FR')+' HTG');doc.text('Méthode : '+p.method);doc.text('Statut : '+p.status);doc.moveDown().text('Enregistré par : '+(p.recorded_by_email||'Secrétariat'));doc.moveDown(2).text('Merci de votre paiement.',{align:'center'});doc.end();});
app.get('/api/secretary/reports/daily',auth,role('secretary'),(req,res)=>res.json(db.prepare(`SELECT payment_category,status,COUNT(*) count,SUM(amount_htg) total FROM payments WHERE recorded_by=? AND date(created_at)=date('now') GROUP BY payment_category,status ORDER BY payment_category`).all(req.user.id)));

app.get('/api/public/settings',(req,res)=>res.json(settings()));
app.get('/api/public/student-lookup',(req,res)=>{res.set('Cache-Control','no-store');res.json({verified:false,message:'Pour protéger les données personnelles, la vérification de l’identité se fait lors de l’envoi du formulaire.'})});app.get('/api/public/programs',(req,res)=>res.json(db.prepare('SELECT * FROM programs WHERE active=1 ORDER BY id').all()));app.get('/api/public/support',(req,res)=>res.json(db.prepare('SELECT id,name,account_name,account_value,bank_name,bank_account,routing,instructions FROM support_methods WHERE active=1 ORDER BY sort_order,id').all()));app.get('/api/public/gallery',(req,res)=>res.json(db.prepare('SELECT id,title,description,image_url FROM gallery WHERE active=1 ORDER BY sort_order,id DESC').all()));
app.post('/api/admissions',async (req,res)=>{
 try{
  const b=req.body||{},nif=normalizeIdentity(b.nif),cin=normalizeIdentity(b.cin),programId=Number(b.program_id);
  if(!b.name||!b.phone||!programId)return res.status(400).json({error:'Nom, téléphone et formation obligatoires'});
  if(!nif&&!cin)return res.status(400).json({error:'NIF ou CIN obligatoire pour l’inscription.'});
  const program=db.prepare('SELECT * FROM programs WHERE id=? AND active=1').get(programId);if(!program)return res.status(400).json({error:'Formation introuvable'});
  const byNif=nif?db.prepare('SELECT * FROM students WHERE nif=? LIMIT 1').get(nif):null;
  const byCin=cin?db.prepare('SELECT * FROM students WHERE cin=? LIMIT 1').get(cin):null;
  if(byNif&&byCin&&byNif.id!==byCin.id)return res.status(409).json({error:'Le NIF et le CIN correspondent à deux dossiers différents. Contactez CETEP.'});
  const existing=byNif||byCin;
  if(existing&&((nif&&existing.nif&&existing.nif!==nif)||(cin&&existing.cin&&existing.cin!==cin)))return res.status(409).json({error:'Les informations d’identité ne correspondent pas au dossier. Vérifiez les données ou contactez CETEP.'});
  if(existing){
   const cleanText=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toUpperCase();
   const cleanPhone=v=>String(v||'').replace(/\D/g,'');
   const identityMatches=cleanText(b.name)===cleanText(existing.name) && cleanPhone(b.phone)===cleanPhone(existing.phone) && (!existing.birth_date || String(b.birth_date||'')===String(existing.birth_date));
   if(!identityMatches)return res.status(409).json({error:'Ce NIF/CIN est déjà associé à un dossier. Pour protéger les données de l’étudiant, le nom, le téléphone et la date de naissance doivent correspondre au dossier existant. En cas de difficulté, contactez CETEP.'});
  }
  if(existing&&db.prepare('SELECT 1 FROM enrollments WHERE student_id=? AND program_id=?').get(existing.id,programId))return res.status(409).json({error:'Vous êtes déjà inscrit à cette formation.'});
  const tx=db.transaction(()=>{
   let studentId,studentNo,isNew=!existing;
   if(existing){studentId=existing.id;studentNo=existing.student_no;
    db.prepare("UPDATE students SET nif=COALESCE(NULLIF(nif,''),?),cin=COALESCE(NULLIF(cin,''),?) WHERE id=?").run(nif||null,cin||null,studentId);
   }else{
    studentNo=nextNo('CETEP','students','student_no');
    const r=db.prepare('INSERT INTO students(student_no,name,birth_date,birth_place,phone,email,nif,cin,program_id,education,blood_group,responsible_person,marital_status,status,password_hash,access_enabled) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(studentNo,b.name,b.birth_date||null,b.birth_place||null,b.phone,b.email||null,nif||null,cin||null,programId,b.education||null,b.blood_group||null,b.responsible_person||null,b.marital_status||null,'En attente',bcrypt.hashSync(generateTemporaryPassword(),12),0);
    studentId=Number(r.lastInsertRowid);
   }
   db.prepare("INSERT INTO enrollments(student_id,program_id,status,access_enabled) VALUES(?,?,'En attente',0)").run(studentId,programId);
   let paymentId=null;
   if(b.payment_method&&Number(b.payment_amount)>0){const ref=b.payment_reference||('ENR-'+studentNo+'-'+programId+'-'+Date.now());const pr=db.prepare('INSERT INTO payments(student_id,program_id,amount_htg,method,status,reference,payment_message,payment_proof) VALUES(?,?,?,?,?,?,?,?)').run(studentId,programId,Number(b.payment_amount),String(b.payment_method),'En attente',ref,b.payment_message||null,b.payment_proof||null);paymentId=Number(pr.lastInsertRowid);}
   return {studentId,studentNo,paymentId,isNew};
  });
  const out=tx();const saved=db.prepare('SELECT * FROM students WHERE id=?').get(out.studentId);
  const emailNotification=await sendCETEPNotification('Demande d’inscription CETEP — '+out.studentNo,`<h2>Demande d’inscription CETEP</h2><p><b>Code étudiant :</b> ${escapeHtml(out.studentNo)}</p><p><b>Nom :</b> ${escapeHtml(saved.name)}</p><p><b>NIF :</b> ${escapeHtml(saved.nif||'Non fourni')}</p><p><b>CIN :</b> ${escapeHtml(saved.cin||'Non fourni')}</p><p><b>Formation :</b> ${escapeHtml(program.name)}</p><p><b>Statut :</b> En attente</p>`);
  res.status(201).json({ok:true,student_no:out.studentNo,existing_student:!out.isNew,payment_id:out.paymentId,payment_status:out.paymentId?'En attente':null,amount_due:Number(program.price_htg||0),email_notification:emailNotification,message:out.isNew?'Inscription enregistrée.':'Nouvelle demande ajoutée au dossier étudiant existant.'});
 }catch(e){if(String(e.message).includes('UNIQUE constraint failed: students.nif'))return res.status(409).json({error:'Ce NIF est déjà enregistré dans CETEP.'});if(String(e.message).includes('UNIQUE constraint failed: students.cin'))return res.status(409).json({error:'Ce CIN est déjà enregistré dans CETEP.'});res.status(400).json({error:e.message});}
});
app.post('/api/public/enrollment-payment',async (req,res)=>{try{
 const b=req.body||{};if(!b.student_no||!b.method||!Number.isFinite(Number(b.amount))||Number(b.amount)<=0)return res.status(400).json({error:'Numéro étudiant, méthode et montant positif obligatoires'});
 if(b.payment_proof&&String(b.payment_proof).length>7*1024*1024)return res.status(400).json({error:'La photo de confirmation est trop grande (maximum 5 Mo).'});
 const student=db.prepare('SELECT * FROM students WHERE student_no=?').get(String(b.student_no).trim().toUpperCase());if(!student)return res.status(404).json({error:'Inscription introuvable'});
 const programId=Number(b.program_id||student.program_id||0);const enrollment=db.prepare('SELECT e.*,p.name program_name FROM enrollments e JOIN programs p ON p.id=e.program_id WHERE e.student_id=? AND e.program_id=?').get(student.id,programId);if(!enrollment)return res.status(400).json({error:'Cette formation ne figure pas dans le dossier étudiant.'});
 const ref=b.reference||('ENR-'+student.student_no+'-'+programId+'-'+Date.now());const r=db.prepare('INSERT INTO payments(student_id,program_id,amount_htg,method,status,reference,payment_message,payment_proof) VALUES(?,?,?,?,?,?,?,?)').run(student.id,programId,Number(b.amount),String(b.method),'En attente',ref,b.payment_message||null,b.payment_proof||null);
 const emailNotification=await sendCETEPNotification('Nouveau paiement CETEP — '+ref,`<h2>Nouveau paiement</h2><p><b>Code étudiant :</b> ${escapeHtml(student.student_no)}</p><p><b>Nom :</b> ${escapeHtml(student.name)}</p><p><b>Formation :</b> ${escapeHtml(enrollment.program_name)}</p><p><b>Montant :</b> ${Number(b.amount).toLocaleString('fr-FR')} $ HT</p><p><b>Méthode :</b> ${escapeHtml(b.method)}</p><p><b>Référence :</b> ${escapeHtml(ref)}</p><p><b>Confirmation jointe :</b> ${b.payment_proof?'Oui':'Non'}</p>`);
 res.status(201).json({ok:true,payment_id:Number(r.lastInsertRowid),reference:ref,program_id:programId,email_notification:emailNotification,message:'Paiement envoyé. CETEP doit vérifier et confirmer le paiement.'});
 }catch(e){res.status(400).json({error:e.message});}});
app.post('/api/public/donation',async (req,res)=>{try{const b=req.body||{};if(!b.name||!b.method||!b.amount)return res.status(400).json({error:'Nom, méthode et montant obligatoires'});const r=db.prepare('INSERT INTO donations(name,email,amount,method,reference,message) VALUES(?,?,?,?,?,?)').run(b.name,b.email||'',Number(b.amount),b.method,b.reference||'',b.message||'');const emailNotification=await sendCETEPNotification('Nouveau soutien CETEP — '+r.lastInsertRowid,`<h2>Nouveau soutien reçu</h2><p><b>Nom :</b> ${escapeHtml(b.name)}</p><p><b>Email :</b> ${escapeHtml(b.email||'Non fourni')}</p><p><b>Montant :</b> ${Number(b.amount).toLocaleString('fr-FR')}</p><p><b>Méthode :</b> ${escapeHtml(b.method)}</p><p><b>Référence :</b> ${escapeHtml(b.reference||'Non fournie')}</p><p><b>Message :</b> ${escapeHtml(b.message||'')}</p><p><b>Date :</b> ${new Date().toLocaleString('fr-FR')}</p>`);res.status(201).json({ok:true,id:r.lastInsertRowid,email_notification:emailNotification,message:'Merci pour votre soutien. Votre contribution a été enregistrée et CETEP a reçu la notification.'});}catch(e){res.status(400).json({error:e.message});}});
app.get('/api/admin/stats',auth,role('admin'),(req,res)=>res.json({students:db.prepare('SELECT COUNT(*) c FROM students').get().c,activeStudents:db.prepare("SELECT COUNT(DISTINCT student_id) c FROM enrollments WHERE access_enabled=1 AND status='Actif'").get().c,teachers:db.prepare('SELECT COUNT(*) c FROM teachers').get().c,programs:db.prepare('SELECT COUNT(*) c FROM programs WHERE active=1').get().c,pending:db.prepare("SELECT COUNT(*) c FROM enrollments WHERE status='En attente'").get().c,revenue:db.prepare("SELECT COALESCE(SUM(amount_htg),0) s FROM payments WHERE status='Confirmé'").get().s,donations:db.prepare("SELECT COALESCE(SUM(amount),0) s FROM donations WHERE status!='Refusé'").get().s}));
app.get('/api/admin/certificate-program-texts',auth,role('admin'),(req,res)=>{
 const rows=db.prepare('SELECT id,name,duration,description FROM programs ORDER BY id').all();
 const saved=new Map(db.prepare('SELECT * FROM certificate_program_texts').all().map(x=>[Number(x.program_id),x]));
 const defaultsFor=name=>{const n=String(name||'').toLowerCase();
  if(n.includes('secourisme'))return {intro:'Cette formation lui a permis d’acquérir les connaissances et les compétences nécessaires pour intervenir efficacement en situation d’urgence et contribuer à la sécurité et au bien-être de la communauté.',extra:''};
  if(n.includes('électricité')||n.includes('electricite'))return {intro:'Cette formation lui a permis d’acquérir les compétences nécessaires à l’installation, au raccordement, à l’entretien et au dépannage des installations électriques des bâtiments, dans le respect des normes et des règles de sécurité.',extra:''};
  if(n.includes('plomberie'))return {intro:'Cette formation lui a permis de maîtriser l’installation, l’entretien et la réparation des réseaux d’alimentation en eau et d’évacuation, dans le respect des règles techniques et de sécurité.',extra:''};
  if(n.includes('aide-soignant')||n.includes('aide soignant'))return {intro:'Cette formation lui a permis d’acquérir les compétences nécessaires pour accompagner les patients dans les soins quotidiens, assurer leur confort et leur hygiène, et contribuer à leur bien-être dans le respect des règles professionnelles.',extra:''};
  if(n.includes('sérigraph')||n.includes('serigraph'))return {intro:'Cette formation lui a permis de maîtriser la préparation des supports, la création des visuels et les techniques d’impression en sérigraphie, ainsi que l’utilisation appropriée des outils et matériaux.',extra:''};
  if(n.includes('carrelage'))return {intro:'Cette formation lui a permis de maîtriser la préparation des surfaces, la découpe, la pose et la finition des carreaux, en appliquant les techniques professionnelles et les règles de sécurité.',extra:''};
  if(n.includes('informatique')||n.includes('bureautique'))return {intro:'Cette formation lui a permis de maîtriser les outils informatiques et les logiciels bureautiques pour produire des documents, traiter des données, réaliser des présentations et effectuer des tâches administratives.',extra:''};
  if(n.includes('vidéo')||n.includes('video')||n.includes('photograph'))return {intro:'Cette formation lui a permis d’acquérir les techniques de prise de vue, de cadrage, d’éclairage, de prise de son et de montage afin de réaliser des photos et des productions audiovisuelles de qualité.',extra:''};
  if(n.includes('ongler'))return {intro:'Cette formation lui a permis de maîtriser les techniques de soin, de préparation, d’embellissement et de décoration des ongles, en respectant les règles d’hygiène, de désinfection et de sécurité.',extra:''};
  if(n.includes('cosmét')||n.includes('cosmet')||n.includes('make-up')||n.includes('maquillage'))return {intro:'Cette formation lui a permis de maîtriser les techniques de soins esthétiques et de maquillage, le choix des produits et leur application adaptée, dans le respect de l’hygiène et des besoins de la clientèle.',extra:''};
  if(n.includes('dread')||n.includes('locks')||n.includes('coiff'))return {intro:'Cette formation lui a permis d’acquérir les techniques professionnelles de préparation, de création, d’entretien et de finition des coiffures, notamment les dreadlocks, en respectant l’hygiène et la santé capillaire.',extra:''};
  if(n.includes('formation continue'))return {intro:'Cette formation lui a permis de renforcer et d’actualiser ses connaissances et ses compétences professionnelles, et de les mettre en pratique conformément aux objectifs pédagogiques du CETEP.',extra:''};
  return {intro:`Cette formation lui a permis d’acquérir les connaissances théoriques et les compétences pratiques nécessaires dans le domaine de ${String(name||'la formation professionnelle')}, conformément aux objectifs pédagogiques du CETEP.`,extra:''};
 };;
 res.json(rows.map(p=>{const s=saved.get(Number(p.id));const d=defaultsFor(p.name);return {...p,certificate_intro:s?s.intro:d.intro,certificate_extra_text:s?s.extra_text:d.extra,customized:!!s};}));
});
app.put('/api/admin/certificate-program-texts/:id',auth,role('admin'),(req,res)=>{
 const id=Number(req.params.id);if(!db.prepare('SELECT 1 FROM programs WHERE id=?').get(id))return res.status(404).json({error:'Formation introuvable'});
 const intro=String(req.body?.certificate_intro||'').trim();const extra=String(req.body?.certificate_extra_text||'').trim();
 if(!intro)return res.status(400).json({error:'Le texte du certificat est obligatoire.'});
 db.prepare(`INSERT INTO certificate_program_texts(program_id,intro,extra_text,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(program_id) DO UPDATE SET intro=excluded.intro,extra_text=excluded.extra_text,updated_at=CURRENT_TIMESTAMP`).run(id,intro,extra);
 res.json({ok:true,message:'Texte du certificat enregistré pour cette formation.'});
});
app.get('/api/admin/settings',auth,role('admin'),(req,res)=>res.json(settings()));app.put('/api/admin/settings',auth,role('admin'),(req,res)=>{const q=db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');for(const k of Object.keys(defaults))if(req.body[k]!==undefined)q.run(k,String(req.body[k]));res.json({ok:true,settings:settings()});});app.post('/api/admin/logo/reset',auth,role('admin'),(req,res)=>{db.prepare("UPDATE settings SET value='' WHERE key='logo_url'").run();res.json({ok:true});});
// Document permissions: only an administrator can authorize or revoke student downloads.
const DOCUMENT_TYPES=['certificate','transcript','attestation'];
function documentPermission(studentId,programId,type){
  return db.prepare('SELECT authorized FROM student_document_permissions WHERE student_id=? AND program_id=? AND document_type=?').get(studentId,programId,type)?.authorized===1;
}
app.get('/api/admin/students/:id/document-permissions',auth,role('admin'),(req,res)=>{
 const sid=Number(req.params.id);
 const student=db.prepare('SELECT id,student_no,name FROM students WHERE id=?').get(sid);
 if(!student)return res.status(404).json({error:'Étudiant introuvable'});
 const rows=db.prepare(`SELECT e.program_id,p.name program_name,e.status,
   COALESCE(MAX(CASE WHEN d.document_type='certificate' THEN d.authorized END),0) certificate,
   COALESCE(MAX(CASE WHEN d.document_type='transcript' THEN d.authorized END),0) transcript,
   COALESCE(MAX(CASE WHEN d.document_type='attestation' THEN d.authorized END),0) attestation
   FROM enrollments e JOIN programs p ON p.id=e.program_id LEFT JOIN student_document_permissions d ON d.student_id=e.student_id AND d.program_id=e.program_id
   WHERE e.student_id=? GROUP BY e.program_id,p.name,e.status ORDER BY p.name`).all(sid);
 res.json({student,permissions:rows});
});
app.post('/api/admin/students/:studentId/document-permissions/:programId/:type',auth,role('admin'),(req,res)=>{
 const sid=Number(req.params.studentId),pid=Number(req.params.programId),type=String(req.params.type||''),authorized=req.body?.authorized===true;
 if(!DOCUMENT_TYPES.includes(type))return res.status(400).json({error:'Type de document invalide.'});
 if(!db.prepare('SELECT 1 FROM students WHERE id=?').get(sid)||!db.prepare('SELECT 1 FROM enrollments WHERE student_id=? AND program_id=?').get(sid,pid))return res.status(404).json({error:'Étudiant ou formation introuvable.'});
 db.prepare(`INSERT INTO student_document_permissions(student_id,program_id,document_type,authorized,updated_by,updated_by_email,updated_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(student_id,program_id,document_type) DO UPDATE SET authorized=excluded.authorized,updated_by=excluded.updated_by,updated_by_email=excluded.updated_by_email,updated_at=CURRENT_TIMESTAMP`).run(sid,pid,type,authorized?1:0,req.user.id,req.user.email);
 db.prepare('INSERT INTO student_document_audit(student_id,program_id,document_type,authorized,actor_id,actor_email) VALUES(?,?,?,?,?,?)').run(sid,pid,type,authorized?1:0,req.user.id,req.user.email);
 res.json({ok:true,student_id:sid,program_id:pid,document_type:type,authorized});
});

app.get('/api/admin/students',auth,role('admin'),(req,res)=>res.json(db.prepare('SELECT s.*,p.name program_name,e.start_date,e.end_date FROM students s LEFT JOIN programs p ON p.id=s.program_id LEFT JOIN enrollments e ON e.student_id=s.id AND e.program_id=s.program_id ORDER BY s.id DESC').all()));
app.post('/api/admin/students',auth,role('admin'),(req,res)=>{try{const b=req.body;const nif=normalizeIdentity(b.nif),cin=normalizeIdentity(b.cin);if(!b.name||!b.phone||!b.program_id)return res.status(400).json({error:'Nom, téléphone et formation obligatoires'});if(!nif&&!cin)return res.status(400).json({error:'NIF ou CIN obligatoire pour identifier l’étudiant.'});if(nif&&db.prepare('SELECT id FROM students WHERE nif=? LIMIT 1').get(nif))return res.status(409).json({error:'Ce NIF existe déjà.'});if(cin&&db.prepare('SELECT id FROM students WHERE cin=? LIMIT 1').get(cin))return res.status(409).json({error:'Ce CIN existe déjà.'});const suppliedPassword=String(b.password||'');if(suppliedPassword&&!passwordIsStrong(suppliedPassword))return res.status(400).json({error:'Le mot de passe doit contenir au moins 12 caractères.'});const temporaryPassword=suppliedPassword?'':generateTemporaryPassword();const pw=suppliedPassword||temporaryPassword;const no=String(b.student_no||'').trim().toUpperCase()||nextNo('CETEP','students','student_no');if(!/^[A-Z0-9][A-Z0-9._-]{2,39}$/.test(no))return res.status(400).json({error:'Code étudiant invalide : utilisez 3 à 40 caractères (lettres, chiffres, tiret, point ou underscore).'});if(db.prepare('SELECT 1 FROM students WHERE student_no=?').get(no))return res.status(409).json({error:'Ce code étudiant existe déjà.'});const r=db.prepare(`INSERT INTO students(student_no,name,birth_date,birth_place,phone,email,nif,cin,program_id,education,blood_group,responsible_person,marital_status,status,password_hash,access_enabled) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(no,b.name,b.birth_date||null,b.birth_place||null,b.phone,b.email||null,nif||null,cin||null,Number(b.program_id),b.education||null,b.blood_group||null,b.responsible_person||null,b.marital_status||null,b.status||'Actif',bcrypt.hashSync(pw,12),b.access_enabled===false?0:1);db.prepare('INSERT OR IGNORE INTO enrollments(student_id,program_id,status,access_enabled,manual_authorized,start_date,end_date) VALUES(?,?,?,?,?,?,?)').run(r.lastInsertRowid,Number(b.program_id),b.access_enabled===false?'En attente':'Actif',b.access_enabled===false?0:1,b.access_enabled===false?0:1,b.start_date||null,b.end_date||null);res.status(201).json({ok:true,id:r.lastInsertRowid,student_no:no,...(temporaryPassword?{temporary_password:temporaryPassword}:{})});}catch(e){if(String(e.message).includes('UNIQUE constraint failed: students.nif'))return res.status(409).json({error:'Ce NIF existe déjà.'});if(String(e.message).includes('UNIQUE constraint failed: students.cin'))return res.status(409).json({error:'Ce CIN existe déjà.'});res.status(400).json({error:e.message});}});
app.put('/api/admin/students/:id',auth,role('admin'),async (req,res)=>{try{const id=Number(req.params.id);const before=db.prepare('SELECT * FROM students WHERE id=?').get(id);if(!before)return res.status(404).json({error:'Étudiant introuvable'});const b=req.body||{};const code=String(b.student_no??before.student_no).trim().toUpperCase();if(!/^[A-Z0-9][A-Z0-9._-]{2,39}$/.test(code))return res.status(400).json({error:'Code étudiant invalide.'});if(db.prepare('SELECT 1 FROM students WHERE student_no=? AND id<>?').get(code,id))return res.status(409).json({error:'Ce code étudiant appartient déjà à un autre étudiant.'});const nif=normalizeIdentity(b.nif),cin=normalizeIdentity(b.cin);if(nif&&db.prepare('SELECT 1 FROM students WHERE nif=? AND id<>?').get(nif,id))return res.status(409).json({error:'Ce NIF est déjà enregistré.'});if(cin&&db.prepare('SELECT 1 FROM students WHERE cin=? AND id<>?').get(cin,id))return res.status(409).json({error:'Ce CIN est déjà enregistré.'});const tx=db.transaction(()=>{db.prepare(`UPDATE students SET student_no=?,name=?,birth_date=?,birth_place=?,phone=?,email=?,nif=?,cin=?,program_id=?,education=?,blood_group=?,responsible_person=?,marital_status=?,certificate_name=? WHERE id=?`).run(code,b.name??before.name,b.birth_date||null,b.birth_place||null,b.phone||null,b.email||null,nif||null,cin||null,Number(b.program_id||before.program_id)||null,b.education||null,b.blood_group||null,b.responsible_person||null,b.marital_status||null,b.certificate_name||null,id);const pid=Number(b.program_id||before.program_id||0);if(pid){db.prepare('INSERT OR IGNORE INTO enrollments(student_id,program_id,status,access_enabled,manual_authorized,start_date,end_date) VALUES(?,?,?,?,?,?,?)').run(id,pid,b.status||before.status||'Actif',Number(before.access_enabled||0),1,b.start_date||null,b.end_date||null);db.prepare('UPDATE enrollments SET start_date=?,end_date=? WHERE student_id=? AND program_id=?').run(b.start_date||null,b.end_date||null,id,pid);db.prepare('UPDATE students SET program_id=? WHERE id=?').run(pid,id);}});tx();res.json({ok:true,message:'Dossier étudiant mis à jour.'});}catch(e){if(String(e.message).includes('students.nif'))return res.status(409).json({error:'Ce NIF est déjà enregistré.'});if(String(e.message).includes('students.cin'))return res.status(409).json({error:'Ce CIN est déjà enregistré.'});res.status(400).json({error:e.message});}});
// Reset mot de passe étudiant: ne modifie ni statut, ni inscriptions, ni paiements.
app.post('/api/admin/students/:id/password-reset',auth,role('admin'),(req,res)=>{
 const id=Number(req.params.id),student=db.prepare('SELECT id,student_no FROM students WHERE id=?').get(id);
 if(!student)return res.status(404).json({error:'Étudiant introuvable.'});
 const temporaryPassword=generateTemporaryPassword();
 db.prepare('UPDATE students SET password_hash=? WHERE id=?').run(bcrypt.hashSync(temporaryPassword,12),id);
 res.json({ok:true,student_no:student.student_no,temporary_password:temporaryPassword,message:'Mot de passe réinitialisé pour cet étudiant uniquement.'});
});
app.post('/api/admin/students/:id/access',auth,role('admin'),async (req,res)=>{const s=db.prepare('SELECT * FROM students WHERE id=?').get(Number(req.params.id));if(!s)return res.status(404).json({error:'Étudiant introuvable'});const enabled=!!req.body.enabled;const suppliedPassword=String(req.body.password||'');if(enabled&&suppliedPassword&&!passwordIsStrong(suppliedPassword))return res.status(400).json({error:'Le mot de passe doit contenir au moins 12 caractères.'});if(enabled&&!db.prepare("SELECT 1 FROM enrollments WHERE student_id=? AND status='Actif' AND access_enabled=1 LIMIT 1").get(s.id))return res.status(409).json({error:'Autorisez d’abord au moins une formation dans « Gérer les formations ». L’accès global ne doit pas autoriser toutes les formations automatiquement.'});const temporaryPassword=enabled&&!suppliedPassword?generateTemporaryPassword():'';const newPassword=suppliedPassword||temporaryPassword;const hash=newPassword?bcrypt.hashSync(newPassword,12):s.password_hash;const tx=db.transaction(()=>{if(!enabled)db.prepare("UPDATE enrollments SET access_enabled=0,status='Suspendu' WHERE student_id=?").run(s.id);db.prepare('UPDATE students SET access_enabled=?,status=?,password_hash=? WHERE id=?').run(enabled?1:0,enabled?'Actif':'Suspendu',hash,s.id);});tx();res.json({ok:true,enabled,...(temporaryPassword?{temporary_password:temporaryPassword}:{})});});
app.get('/api/admin/students/:id/enrollments',auth,role('admin'),(req,res)=>res.json(db.prepare("SELECT e.*,p.name program_name,p.duration,p.price_htg,COALESCE((SELECT SUM(pay.amount_htg) FROM payments pay WHERE pay.student_id=e.student_id AND pay.program_id=e.program_id AND pay.status='Confirmé' AND (pay.payment_category IS NULL OR pay.payment_category IN ('Mensualité','Trimestriel'))),0) paid FROM enrollments e JOIN programs p ON p.id=e.program_id WHERE e.student_id=? ORDER BY e.enrolled_at DESC").all(Number(req.params.id))));
app.post('/api/admin/students/:id/enrollments',auth,role('admin'),(req,res)=>{const studentId=Number(req.params.id),programId=Number(req.body.program_id);if(!db.prepare('SELECT id FROM students WHERE id=?').get(studentId))return res.status(404).json({error:'Étudiant introuvable'});if(!db.prepare('SELECT id FROM programs WHERE id=?').get(programId))return res.status(400).json({error:'Formation introuvable'});try{db.prepare("INSERT INTO enrollments(student_id,program_id,status,access_enabled) VALUES(?,?,'En attente',0)").run(studentId,programId);res.status(201).json({ok:true,message:'Nouvelle inscription ajoutée en attente de validation.'});}catch(e){if(String(e.message).includes('UNIQUE constraint failed'))return res.status(409).json({error:'Cet étudiant est déjà inscrit à cette formation.'});res.status(400).json({error:e.message});}});
app.post('/api/admin/students/:id/enrollments/:programId/authorize',auth,role('admin'),(req,res)=>{const sid=Number(req.params.id),pid=Number(req.params.programId),enabled=!!req.body.enabled;const row=db.prepare('SELECT id FROM enrollments WHERE student_id=? AND program_id=?').get(sid,pid);if(!row)return res.status(404).json({error:'Inscription introuvable'});db.prepare('UPDATE enrollments SET status=?,access_enabled=?,manual_authorized=? WHERE student_id=? AND program_id=?').run(enabled?'Actif':'Suspendu',enabled?1:0,enabled?1:-1,sid,pid);const active=Number(db.prepare("SELECT COUNT(*) c FROM enrollments WHERE student_id=? AND status='Actif' AND access_enabled=1").get(sid).c||0);db.prepare('UPDATE students SET access_enabled=?,status=? WHERE id=?').run(active?1:0,active?'Actif':'En attente',sid);res.json({ok:true,enabled});});
app.get('/api/admin/teachers',auth,role('admin'),(req,res)=>res.json(db.prepare('SELECT id,teacher_no,name,email,phone,active FROM teachers ORDER BY id DESC').all()));app.put('/api/admin/teachers/:id',auth,role('admin'),(req,res)=>{try{const id=Number(req.params.id),b=req.body||{},name=String(b.name||'').trim(),email=String(b.email||'').trim().toLowerCase(),phone=String(b.phone||'').trim();if(!name||!email)return res.status(400).json({error:'Nom et email obligatoires.'});const current=db.prepare('SELECT id FROM teachers WHERE id=?').get(id);if(!current)return res.status(404).json({error:'Professeur introuvable.'});db.prepare('UPDATE teachers SET name=?,email=?,phone=?,active=? WHERE id=?').run(name,email,phone,Number(b.active)===1?1:0,id);res.json({ok:true});}catch(e){if(String(e.message||'').includes('UNIQUE'))return res.status(409).json({error:'Cette adresse email est déjà utilisée.'});res.status(400).json({error:'Impossible de modifier le professeur.'});}});app.post('/api/admin/teachers/:id/password-reset',auth,role('admin'),(req,res)=>{try{const id=Number(req.params.id);const teacher=db.prepare('SELECT id,teacher_no,name,email FROM teachers WHERE id=?').get(id);if(!teacher)return res.status(404).json({error:'Professeur introuvable.'});const temporaryPassword=generateTemporaryPassword();db.prepare('UPDATE teachers SET password_hash=? WHERE id=?').run(bcrypt.hashSync(temporaryPassword,12),id);res.json({ok:true,teacher_no:teacher.teacher_no,name:teacher.name,email:teacher.email,temporary_password:temporaryPassword});}catch(error){res.status(500).json({error:'Impossible de réinitialiser le mot de passe du professeur.'});}});app.post('/api/admin/teachers',auth,role('admin'),(req,res)=>{try{const b=req.body;if(!b.name||!b.email)return res.status(400).json({error:'Nom et email obligatoires'});const suppliedPassword=String(b.password||'');if(suppliedPassword&&!passwordIsStrong(suppliedPassword))return res.status(400).json({error:'Le mot de passe doit contenir au moins 12 caractères.'});const temporaryPassword=suppliedPassword?'':generateTemporaryPassword();const no=nextNo('PROF','teachers','teacher_no');const r=db.prepare('INSERT INTO teachers(teacher_no,name,email,phone,password_hash) VALUES(?,?,?,?,?)').run(no,b.name,String(b.email||'').trim().toLowerCase(),b.phone||'',bcrypt.hashSync(suppliedPassword||temporaryPassword,12));res.json({ok:true,id:r.lastInsertRowid,teacher_no:no,...(temporaryPassword?{temporary_password:temporaryPassword}:{})});}catch(e){res.status(400).json({error:e.message});}});app.post('/api/admin/teachers/:id/status',auth,role('admin'),(req,res)=>{db.prepare('UPDATE teachers SET active=? WHERE id=?').run(req.body.active?1:0,req.params.id);res.json({ok:true});});
app.get('/api/admin/programs',auth,role('admin'),(req,res)=>res.json(db.prepare("SELECT * FROM programs ORDER BY CASE WHEN program_group IS NULL OR trim(program_group)='' THEN name ELSE program_group END,name,id").all()));
app.post('/api/admin/programs',auth,role('admin'),(req,res)=>{const b=req.body||{},name=String(b.name||'').trim();if(!name)return res.status(400).json({error:'Le nom de la formation est obligatoire.'});const r=db.prepare('INSERT INTO programs(name,duration,description,price_htg,monthly_fee_htg,program_group,fee_period,active) VALUES(?,?,?,?,?,?,?,?)').run(name,b.duration||'',b.description||'',Math.max(0,Number(b.price_htg||0)),Math.max(0,Number(b.monthly_fee_htg||0)),String(b.program_group||'').trim()||null,['Mensualité','Trimestriel'].includes(b.fee_period)?b.fee_period:'Mensualité',b.active===false?0:1);res.json({ok:true,id:r.lastInsertRowid});});
app.put('/api/admin/programs/:id',auth,role('admin'),(req,res)=>{const b=req.body||{},name=String(b.name||'').trim();if(!name)return res.status(400).json({error:'Le nom de la formation est obligatoire.'});const result=db.prepare('UPDATE programs SET name=?,duration=?,description=?,price_htg=?,monthly_fee_htg=?,program_group=?,fee_period=?,active=? WHERE id=?').run(name,b.duration||'',b.description||'',Math.max(0,Number(b.price_htg||0)),Math.max(0,Number(b.monthly_fee_htg||0)),String(b.program_group||'').trim()||null,['Mensualité','Trimestriel'].includes(b.fee_period)?b.fee_period:'Mensualité',b.active===false?0:1,req.params.id);if(!result.changes)return res.status(404).json({error:'Formation introuvable.'});res.json({ok:true});});
app.delete('/api/admin/programs/:id',auth,role('admin'),(req,res)=>{const id=Number(req.params.id);const linked=db.prepare('SELECT (SELECT COUNT(*) FROM enrollments WHERE program_id=?) + (SELECT COUNT(*) FROM payments WHERE program_id=?) + (SELECT COUNT(*) FROM certificates WHERE program_id=?) AS n').get(id,id,id).n;if(linked>0)return res.status(409).json({error:'Cette formation possède déjà des dossiers ou paiements. Désactivez-la au lieu de la supprimer afin de préserver l’historique.'});db.prepare('DELETE FROM programs WHERE id=?').run(id);res.json({ok:true});});
// Teacher workspace APIs: teachers can only access programs explicitly assigned by administration.
app.get('/api/teacher/me',auth,role('teacher'),(req,res)=>{
  const t=db.prepare('SELECT id,teacher_no,name,email FROM teachers WHERE id=? AND active=1').get(Number(req.user.id));
  if(!t)return res.status(401).json({error:'Compte professeur inactif ou introuvable.'});
  res.json({id:t.id,teacher_no:t.teacher_no,name:t.name,email:t.email});
});
app.get('/api/teacher/programs',auth,role('teacher'),(req,res)=>{
  const t=db.prepare('SELECT id FROM teachers WHERE id=? AND active=1').get(Number(req.user.id));
  if(!t)return res.status(401).json({error:'Compte professeur inactif ou introuvable.'});
  res.json(db.prepare(`SELECT p.id,p.name,p.duration,p.description
    FROM program_teachers pt JOIN programs p ON p.id=pt.program_id
    WHERE pt.teacher_id=? AND p.active=1 ORDER BY p.name`).all(t.id));
});
app.get('/api/teacher/students',auth,role('teacher'),(req,res)=>{
  const t=db.prepare('SELECT id FROM teachers WHERE id=? AND active=1').get(Number(req.user.id));
  if(!t)return res.status(401).json({error:'Compte professeur inactif ou introuvable.'});
  res.json(db.prepare(`SELECT DISTINCT s.id,s.student_no,s.name,p.name program_name
    FROM program_teachers pt JOIN programs p ON p.id=pt.program_id
    JOIN enrollments e ON e.program_id=pt.program_id
    JOIN students s ON s.id=e.student_id
    WHERE pt.teacher_id=? AND p.active=1 AND e.status='Actif' AND e.access_enabled=1
    ORDER BY p.name,s.name`).all(t.id));
});
app.get('/api/teacher/modules',auth,role('teacher'),(req,res)=>{
  const t=db.prepare('SELECT id FROM teachers WHERE id=? AND active=1').get(Number(req.user.id));
  if(!t)return res.status(401).json({error:'Compte professeur inactif ou introuvable.'});
  res.json(db.prepare(`SELECT m.*,p.name program_name FROM modules m
    JOIN programs p ON p.id=m.program_id JOIN program_teachers pt ON pt.program_id=p.id
    WHERE pt.teacher_id=? AND p.active=1 AND m.active=1 ORDER BY p.name,m.order_no,m.id`).all(t.id));
});
app.post('/api/teacher/modules',auth,role('teacher'),(req,res)=>{
  const t=db.prepare('SELECT id FROM teachers WHERE id=? AND active=1').get(Number(req.user.id));
  if(!t)return res.status(401).json({error:'Compte professeur inactif ou introuvable.'});
  const b=req.body||{},programId=Number(b.program_id),title=String(b.title||'').trim();
  if(!programId||!title)return res.status(400).json({error:'Formation et titre du module obligatoires.'});
  const allowed=db.prepare(`SELECT p.id FROM programs p JOIN program_teachers pt ON pt.program_id=p.id
    WHERE p.id=? AND pt.teacher_id=? AND p.active=1`).get(programId,t.id);
  if(!allowed)return res.status(403).json({error:'Cette formation ne vous est pas affectée.'});
  const r=db.prepare('INSERT INTO modules(program_id,title,description,order_no) VALUES(?,?,?,?)')
    .run(programId,title,String(b.description||''),Math.max(1,Number(b.order_no||1)));
  res.status(201).json({ok:true,id:r.lastInsertRowid});
});
app.post('/api/teacher/lessons',auth,role('teacher'),(req,res)=>{
  const t=db.prepare('SELECT id FROM teachers WHERE id=? AND active=1').get(Number(req.user.id));
  if(!t)return res.status(401).json({error:'Compte professeur inactif ou introuvable.'});
  const b=req.body||{},moduleId=Number(b.module_id),title=String(b.title||'').trim();
  if(!moduleId||!title)return res.status(400).json({error:'Module et titre de la leçon obligatoires.'});
  const allowed=db.prepare(`SELECT m.id FROM modules m JOIN program_teachers pt ON pt.program_id=m.program_id
    JOIN programs p ON p.id=m.program_id WHERE m.id=? AND pt.teacher_id=? AND p.active=1 AND m.active=1`).get(moduleId,t.id);
  if(!allowed)return res.status(403).json({error:'Ce module ne fait pas partie de vos formations affectées.'});
  const type=['Texte','Vidéo','PDF','Classe en ligne'].includes(b.type)?b.type:'Texte';
  if(type==='Classe en ligne'&&!String(b.meeting_url||'').trim())return res.status(400).json({error:'Le lien de la classe en ligne est obligatoire.'});
  const r=db.prepare(`INSERT INTO lessons(module_id,title,type,content,video_url,file_url,meeting_url,scheduled_at,duration_minutes,order_no,created_by_role,created_by,teacher_editable)
    VALUES(?,?,?,?,?,?,?,?,?,?, 'teacher', ?,1)`).run(moduleId,title,type,String(b.content||''),String(b.video_url||''),String(b.file_url||''),String(b.meeting_url||''),b.scheduled_at||null,Math.max(1,Number(b.duration_minutes||60)),Math.max(1,Number(b.order_no||1)),t.id);
  res.status(201).json({ok:true,id:r.lastInsertRowid});
});
app.get('/api/teacher/lessons',auth,role('teacher'),(req,res)=>{
  const t=db.prepare('SELECT id FROM teachers WHERE id=? AND active=1').get(Number(req.user.id));
  if(!t)return res.status(401).json({error:'Compte professeur inactif ou introuvable.'});
  const moduleId=Number(req.query.module_id||0);
  if(!moduleId)return res.status(400).json({error:'Module obligatoire.'});
  const allowed=db.prepare(`SELECT m.id FROM modules m JOIN program_teachers pt ON pt.program_id=m.program_id
    JOIN programs p ON p.id=m.program_id WHERE m.id=? AND pt.teacher_id=? AND p.active=1 AND m.active=1`).get(moduleId,t.id);
  if(!allowed)return res.status(403).json({error:'Ce module ne fait pas partie de vos formations affectées.'});
  res.json(db.prepare(`SELECT id,module_id,title,type,content,video_url,file_url,order_no,created_by_role,teacher_editable
    FROM lessons WHERE module_id=? AND active=1 ORDER BY order_no,id`).all(moduleId));
});
app.put('/api/teacher/lessons/:id',auth,role('teacher'),(req,res)=>{
  const t=db.prepare('SELECT id FROM teachers WHERE id=? AND active=1').get(Number(req.user.id));
  if(!t)return res.status(401).json({error:'Compte professeur inactif ou introuvable.'});
  const id=Number(req.params.id),b=req.body||{},title=String(b.title||'').trim();
  const lesson=db.prepare(`SELECT l.id,l.module_id FROM lessons l JOIN modules m ON m.id=l.module_id
    JOIN program_teachers pt ON pt.program_id=m.program_id JOIN programs p ON p.id=m.program_id
    WHERE l.id=? AND l.active=1 AND m.active=1 AND p.active=1 AND pt.teacher_id=?
    AND l.teacher_editable=1 AND l.created_by_role='teacher' AND l.created_by=?`).get(id,t.id,t.id);
  if(!lesson)return res.status(403).json({error:'Cette leçon est protégée ou ne vous appartient pas. Seul l’administrateur peut la modifier.'});
  if(!title)return res.status(400).json({error:'Titre de la leçon obligatoire.'});
  const type=['Texte','Vidéo','PDF','Classe en ligne'].includes(b.type)?b.type:'Texte';
  db.prepare('UPDATE lessons SET title=?,type=?,content=?,video_url=?,file_url=?,order_no=? WHERE id=?').run(title,type,String(b.content||''),String(b.video_url||''),String(b.file_url||''),Math.max(1,Number(b.order_no||1)),id);
  res.json({ok:true});
});

app.get('/api/admin/modules',auth,role('admin'),(req,res)=>res.json(db.prepare('SELECT m.*,p.name program_name FROM modules m JOIN programs p ON p.id=m.program_id ORDER BY p.id,m.order_no,m.id').all()));
app.post('/api/admin/modules',auth,role('admin'),(req,res)=>{const b=req.body||{},programId=Number(b.program_id),title=String(b.title||'').trim();if(!programId||!title)return res.status(400).json({error:'Formation et titre obligatoires'});if(!db.prepare('SELECT 1 FROM programs WHERE id=?').get(programId))return res.status(400).json({error:'Formation introuvable'});const r=db.prepare('INSERT INTO modules(program_id,title,description,order_no) VALUES(?,?,?,?)').run(programId,title,String(b.description||''),Math.max(1,Number(b.order_no||1)));res.status(201).json({ok:true,id:r.lastInsertRowid});});
app.put('/api/admin/modules/:id',auth,role('admin'),(req,res)=>{const b=req.body||{},id=Number(req.params.id),title=String(b.title||'').trim();if(!title)return res.status(400).json({error:'Titre du module obligatoire'});const row=db.prepare('SELECT id FROM modules WHERE id=?').get(id);if(!row)return res.status(404).json({error:'Module introuvable'});db.prepare('UPDATE modules SET title=?,description=?,order_no=? WHERE id=?').run(title,String(b.description||''),Math.max(1,Number(b.order_no||1)),id);res.json({ok:true});});
app.delete('/api/admin/modules/:id',auth,role('admin'),(req,res)=>{const id=Number(req.params.id),row=db.prepare('SELECT id FROM modules WHERE id=?').get(id);if(!row)return res.status(404).json({error:'Module introuvable'});const lessons=db.prepare('SELECT COUNT(*) c FROM lessons WHERE module_id=?').get(id).c;if(lessons)return res.status(409).json({error:`Ce module contient ${lessons} leçon(s). Supprimez ou déplacez d’abord les leçons.`});db.prepare('DELETE FROM modules WHERE id=?').run(id);res.json({ok:true});});
app.get('/api/admin/lessons',auth,role('admin'),(req,res)=>res.json(db.prepare('SELECT l.*,m.title module_title,p.name program_name FROM lessons l JOIN modules m ON m.id=l.module_id JOIN programs p ON p.id=m.program_id ORDER BY p.id,m.order_no,l.order_no,l.id').all()));
app.post('/api/admin/lessons',auth,role('admin'),(req,res)=>{const b=req.body||{},moduleId=Number(b.module_id),title=String(b.title||'').trim();if(!moduleId||!title)return res.status(400).json({error:'Module et titre obligatoires'});if(!db.prepare('SELECT 1 FROM modules WHERE id=?').get(moduleId))return res.status(400).json({error:'Module introuvable'});const type=['Texte','Vidéo','PDF','Classe en ligne'].includes(b.type)?b.type:'Texte';if(type==='Classe en ligne'&&!String(b.meeting_url||'').trim())return res.status(400).json({error:'Le lien de la classe en ligne est obligatoire.'});const r=db.prepare('INSERT INTO lessons(module_id,title,type,content,video_url,file_url,meeting_url,scheduled_at,duration_minutes,order_no) VALUES(?,?,?,?,?,?,?,?,?,?)').run(moduleId,title,type,String(b.content||''),String(b.video_url||''),String(b.file_url||''),String(b.meeting_url||''),b.scheduled_at||null,Math.max(1,Number(b.duration_minutes||60)),Math.max(1,Number(b.order_no||1)));res.status(201).json({ok:true,id:r.lastInsertRowid});});
app.put('/api/admin/lessons/:id',auth,role('admin'),(req,res)=>{const b=req.body||{},id=Number(req.params.id),title=String(b.title||'').trim();if(!title)return res.status(400).json({error:'Titre de la leçon obligatoire'});const row=db.prepare('SELECT id FROM lessons WHERE id=?').get(id);if(!row)return res.status(404).json({error:'Leçon introuvable'});const type=['Texte','Vidéo','PDF','Classe en ligne'].includes(b.type)?b.type:'Texte';if(type==='Classe en ligne'&&!String(b.meeting_url||'').trim())return res.status(400).json({error:'Le lien de la classe en ligne est obligatoire.'});db.prepare('UPDATE lessons SET title=?,type=?,content=?,video_url=?,file_url=?,meeting_url=?,scheduled_at=?,duration_minutes=?,order_no=? WHERE id=?').run(title,type,String(b.content||''),String(b.video_url||''),String(b.file_url||''),String(b.meeting_url||''),b.scheduled_at||null,Math.max(1,Number(b.duration_minutes||60)),Math.max(1,Number(b.order_no||1)),id);res.json({ok:true});});
app.delete('/api/admin/lessons/:id',auth,role('admin'),(req,res)=>{const id=Number(req.params.id),row=db.prepare('SELECT id FROM lessons WHERE id=?').get(id);if(!row)return res.status(404).json({error:'Leçon introuvable'});db.prepare('DELETE FROM lessons WHERE id=?').run(id);res.json({ok:true});});
app.post('/api/admin/assign-teacher',auth,role('admin'),(req,res)=>{db.prepare('INSERT OR IGNORE INTO program_teachers(program_id,teacher_id) VALUES(?,?)').run(Number(req.body.program_id),Number(req.body.teacher_id));res.json({ok:true});});app.get('/api/admin/teacher-assignments',auth,role('admin'),(req,res)=>res.json(db.prepare('SELECT pt.*,t.name teacher_name,p.name program_name FROM program_teachers pt JOIN teachers t ON t.id=pt.teacher_id JOIN programs p ON p.id=pt.program_id').all()));
app.get('/api/admin/payments',auth,role('admin'),(req,res)=>res.json(db.prepare('SELECT p.*,s.name student_name,s.student_no,e.access_enabled program_access_enabled,pr.name program_name FROM payments p LEFT JOIN students s ON s.id=p.student_id LEFT JOIN programs pr ON pr.id=COALESCE(p.program_id,s.program_id) LEFT JOIN enrollments e ON e.student_id=p.student_id AND e.program_id=COALESCE(p.program_id,s.program_id) ORDER BY p.id DESC').all()));app.get('/api/admin/payments/:id/proof',auth,role('admin'),(req,res)=>{const p=db.prepare('SELECT payment_proof FROM payments WHERE id=?').get(Number(req.params.id));if(!p||!p.payment_proof)return res.status(404).send('Confirmation introuvable');const m=String(p.payment_proof).match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);if(!m)return res.status(415).send('Format de confirmation non pris en charge');res.setHeader('Content-Type',m[1]);res.setHeader('Cache-Control','private, max-age=60');res.send(Buffer.from(m[2],'base64'));});app.put('/api/admin/payments/:id/month',auth,role('admin'),(req,res)=>{const id=Number(req.params.id),month=String(req.body.billing_month||'').trim();if(month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return res.status(400).json({error:'Mois de paiement invalide.'});const row=db.prepare('SELECT id FROM payments WHERE id=?').get(id);if(!row)return res.status(404).json({error:'Paiement introuvable'});db.prepare('UPDATE payments SET billing_month=? WHERE id=?').run(month||null,id);res.json({ok:true,billing_month:month||null});});
app.post('/api/admin/payments/:id/status',auth,role('admin'),async (req,res)=>{const status=['En attente','Confirmé','Refusé'].includes(req.body.status)?req.body.status:'En attente';const pay=db.prepare('SELECT student_id,program_id FROM payments WHERE id=?').get(Number(req.params.id));if(!pay)return res.status(404).json({error:'Paiement introuvable'});db.prepare('UPDATE payments SET status=? WHERE id=?').run(status,req.params.id);let access=false,confirmation=null,certificate=null;if(pay.student_id&&pay.program_id){access=refreshStudentCourseAccess(pay.student_id,pay.program_id);if(status==='Confirmé'){certificate=autoCertificateForStudent(pay.student_id,pay.program_id);if(access){const student=db.prepare('SELECT s.*,p.name program_name FROM students s LEFT JOIN programs p ON p.id=? WHERE s.id=?').get(pay.program_id,pay.student_id);confirmation=await sendStudentConfirmation(student,student.program_name);}}}res.json({ok:true,status,program_id:pay.program_id,course_access:access,certificate,confirmation});});app.post('/api/admin/payments',auth,role('admin'),(req,res)=>{const b=req.body,ref=b.reference||`PAY-${Date.now()}`;if(!Number.isFinite(Number(b.amount_htg))||Number(b.amount_htg)<=0)return res.status(400).json({error:'Le montant doit être strictement positif.'});const studentId=b.student_id?Number(b.student_id):null;const programId=Number(b.program_id||(studentId?db.prepare('SELECT program_id FROM students WHERE id=?').get(studentId)?.program_id:0))||null;const status=b.status||'Confirmé';const billingMonth=String(b.billing_month||'').trim();if(billingMonth&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(billingMonth))return res.status(400).json({error:'Mois de paiement invalide.'});if(studentId&&programId&&!db.prepare('SELECT 1 FROM enrollments WHERE student_id=? AND program_id=?').get(studentId,programId))return res.status(400).json({error:'Ajoutez d’abord cette formation au dossier étudiant.'});const r=db.prepare('INSERT INTO payments(student_id,program_id,amount_htg,method,status,reference,billing_month) VALUES(?,?,?,?,?,?,?)').run(studentId,programId,Number(b.amount_htg||0),b.method||'Manuel',status,ref,billingMonth||null);const access=studentId&&programId&&status==='Confirmé'?refreshStudentCourseAccess(studentId,programId):false;const cert=studentId&&programId&&status!=='Refusé'?autoCertificateForStudent(studentId,programId):null;res.json({ok:true,id:r.lastInsertRowid,reference:ref,program_id:programId,course_access:access,certificate:cert});});
app.get('/api/admin/support',auth,role('admin'),(req,res)=>res.json(db.prepare('SELECT * FROM support_methods ORDER BY sort_order,id').all()));app.post('/api/admin/support',auth,role('admin'),(req,res)=>{const b=req.body;if(!b.name)return res.status(400).json({error:'Nom obligatoire'});const r=db.prepare('INSERT INTO support_methods(name,account_name,account_value,bank_name,bank_account,routing,instructions,active,sort_order) VALUES(?,?,?,?,?,?,?,?,?)').run(b.name,b.account_name||'',b.account_value||'',b.bank_name||'',b.bank_account||'',b.routing||'',b.instructions||'',b.active===false?0:1,Number(b.sort_order||99));res.json({ok:true,id:r.lastInsertRowid});});app.put('/api/admin/support/:id',auth,role('admin'),(req,res)=>{const b=req.body;db.prepare('UPDATE support_methods SET name=?,account_name=?,account_value=?,bank_name=?,bank_account=?,routing=?,instructions=?,active=?,sort_order=? WHERE id=?').run(b.name,b.account_name||'',b.account_value||'',b.bank_name||'',b.bank_account||'',b.routing||'',b.instructions||'',b.active===false?0:1,Number(b.sort_order||99),req.params.id);res.json({ok:true});});app.delete('/api/admin/support/:id',auth,role('admin'),(req,res)=>{db.prepare('DELETE FROM support_methods WHERE id=?').run(req.params.id);res.json({ok:true});});
app.get('/api/admin/donations',auth,role('admin'),(req,res)=>res.json(db.prepare('SELECT * FROM donations ORDER BY id DESC').all()));app.post('/api/admin/donations/:id/status',auth,role('admin'),(req,res)=>{db.prepare('UPDATE donations SET status=? WHERE id=?').run(req.body.status||'Confirmé',req.params.id);res.json({ok:true});});
app.get('/api/admin/gallery',auth,role('admin'),(req,res)=>res.json(db.prepare('SELECT * FROM gallery ORDER BY sort_order,id DESC').all()));app.post('/api/admin/gallery',auth,role('admin'),(req,res)=>{const b=req.body;if(!b.title||!b.image_url)return res.status(400).json({error:'Titre et photo obligatoires'});if(String(b.image_url).length>7000000)return res.status(400).json({error:'Photo trop grande. Maximum recommandé: 5 Mo.'});const r=db.prepare('INSERT INTO gallery(title,description,image_url,sort_order,active) VALUES(?,?,?,?,?)').run(b.title,b.description||'',b.image_url,Number(b.sort_order||99),b.active===false?0:1);res.json({ok:true,id:r.lastInsertRowid});});app.put('/api/admin/gallery/:id',auth,role('admin'),(req,res)=>{const b=req.body;db.prepare('UPDATE gallery SET title=?,description=?,image_url=?,sort_order=?,active=? WHERE id=?').run(b.title,b.description||'',b.image_url,b.sort_order||99,b.active===false?0:1,req.params.id);res.json({ok:true});});app.delete('/api/admin/gallery/:id',auth,role('admin'),(req,res)=>{db.prepare('DELETE FROM gallery WHERE id=?').run(req.params.id);res.json({ok:true});});
// CETEP Local ↔ Online snapshot: keeps a complete administrative copy on the local device.
app.get('/api/admin/local-snapshot',auth,role('admin'),(req,res)=>{
  const tables=['programs','students','teachers','program_teachers','enrollments','modules','lessons','lesson_progress','assignments','submissions','payments','support_methods','donations','settings','final_results','certificates','certificate_admin_audit','attendance','announcements','student_notifications','communication_audit','role_permissions','gallery'];
  const out={version:APP_VERSION,created_at:new Date().toISOString(),tables:{}};
  for(const t of tables) out.tables[t]=db.prepare(`SELECT * FROM ${t}`).all();
  res.json(out);
});
// CETEP Local ↔ Online synchronization: local mode never deletes online records.
app.post('/api/admin/local-sync',auth,role('admin'),(req,res)=>{
  try{
    const payload=req.body||{};
    const tx=db.transaction(()=>{
      const programMap=new Map(db.prepare('SELECT id,name FROM programs').all().map(x=>[x.name,x.id]));
      for(const x of (payload.programs||[])){
        if(!x.name) continue;
        if(!programMap.has(x.name)){
          const r=db.prepare('INSERT INTO programs(name,duration,description,price_htg,active) VALUES(?,?,?,?,?)').run(x.name,x.duration||'',x.description||'',Number(x.price_htg||0),x.active===false?0:1);
          programMap.set(x.name,Number(r.lastInsertRowid));
        }
      }
      const studentMap=new Map(db.prepare('SELECT id,student_no FROM students').all().map(x=>[x.student_no,x.id]));
      for(const x of (payload.students||[])){
        if(!x.student_no||!x.name) continue;
        const programId=x.program_name?programMap.get(x.program_name):Number(x.program_id||0)||null;
        if(!studentMap.has(x.student_no)){
          const r=db.prepare(`INSERT INTO students(student_no,name,birth_date,birth_place,phone,email,program_id,education,blood_group,responsible_person,marital_status,status,access_enabled) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(x.student_no,x.name,x.birth_date||'',x.birth_place||'',x.phone||'',x.email||'',programId,x.education||'',x.blood_group||'',x.responsible_person||'',x.marital_status||'',x.status||'En attente',x.status==='Actif'?1:0);
          studentMap.set(x.student_no,Number(r.lastInsertRowid));
        }
        const sid=studentMap.get(x.student_no);
        if(programId)db.prepare('INSERT OR IGNORE INTO enrollments(student_id,program_id,status,access_enabled) VALUES(?,?,?,?)').run(sid,programId,x.status==='Actif'?'Actif':'En attente',x.status==='Actif'?1:0);
      }
      for(const x of (payload.enrollments||[])){
        const sid=x.student_no?studentMap.get(x.student_no):Number(x.student_id||0);
        const pid=x.program_name?programMap.get(x.program_name):Number(x.program_id||0);
        if(!sid||!pid)continue;
        db.prepare('INSERT OR IGNORE INTO enrollments(student_id,program_id,status,access_enabled) VALUES(?,?,?,?)').run(sid,pid,x.status||'En attente',x.access_enabled?1:0);
      }
      for(const x of (payload.payments||[])){
        const sid=x.student_no?studentMap.get(x.student_no):Number(x.student_id||0);
        if(!sid||!Number(x.amount_htg)) continue;
        const pid=x.program_name?programMap.get(x.program_name):Number(x.program_id||db.prepare('SELECT program_id FROM students WHERE id=?').get(sid)?.program_id||0);
        if(!pid)continue;
        db.prepare('INSERT OR IGNORE INTO enrollments(student_id,program_id,status,access_enabled) VALUES(?,?,?,0)').run(sid,pid,'En attente');
        const ref=x.reference||`LOCAL-${x.local_id||Date.now()}-${Math.random().toString(36).slice(2,8)}`;
        db.prepare('INSERT OR IGNORE INTO payments(student_id,program_id,amount_htg,method,status,reference) VALUES(?,?,?,?,?,?)').run(sid,pid,Number(x.amount_htg),x.method||'Local','Confirmé',ref);
      }
      for(const x of (payload.attendance||[])){
        const sid=x.student_no?studentMap.get(x.student_no):Number(x.student_id||0), pid=x.program_name?programMap.get(x.program_name):Number(x.program_id||0);
        if(!sid||!pid||!x.class_date) continue;
        db.prepare(`INSERT INTO attendance(student_id,program_id,class_date,present,note) VALUES(?,?,?,?,?) ON CONFLICT(student_id,program_id,class_date) DO UPDATE SET present=excluded.present,note=excluded.note`).run(sid,pid,x.class_date,x.present?1:0,x.note||'');
      }
    });
    tx();
    res.json({ok:true,message:'Synchronisation terminée sans suppression de données.',synced:{programs:(payload.programs||[]).length,students:(payload.students||[]).length,payments:(payload.payments||[]).length,attendance:(payload.attendance||[]).length}});
  }catch(e){res.status(400).json({error:e.message});}
});

app.get('/api/admin/backup',auth,role('admin'),(req,res)=>{const tables=['admins','secretariat_audit','student_policy','student_policy_acceptances','certificate_admin_audit','communication_audit','role_permissions','student_notifications','programs','students','teachers','program_teachers','enrollments','modules','lessons','lesson_progress','assignments','submissions','payments','support_methods','donations','settings','final_results','certificates','attendance','announcements','gallery','academic_terms','academic_subjects','academic_grades'];const out={version:APP_VERSION,created_at:new Date().toISOString(),tables:{}};for(const t of tables)out.tables[t]=db.prepare(`SELECT * FROM ${t}`).all();res.setHeader('Content-Type','application/json');res.setHeader('Content-Disposition','attachment; filename="cetep-backup-v15.4.0.json"');res.send(JSON.stringify(out,null,2));});
app.post('/api/admin/restore',auth,role('admin'),(req,res)=>{try{const data=req.body;if(!data?.tables)throw new Error('Fichier de sauvegarde invalide');const tables=['programs','students','teachers','program_teachers','enrollments','modules','lessons','lesson_progress','assignments','submissions','payments','support_methods','donations','settings','final_results','certificates','attendance','announcements','gallery','academic_terms','academic_subjects','academic_grades'];const tx=db.transaction(()=>{db.pragma('foreign_keys=OFF');for(const t of tables)db.prepare(`DELETE FROM ${t}`).run();for(const t of tables){const rows=data.tables[t]||[];for(const row of rows){const cols=Object.keys(row);const sql=`INSERT INTO ${t}(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`;db.prepare(sql).run(...cols.map(c=>row[c]));}}db.pragma('foreign_keys=ON');});tx();db.prepare("UPDATE payments SET program_id=(SELECT program_id FROM students WHERE students.id=payments.student_id) WHERE program_id IS NULL").run();db.prepare("INSERT OR IGNORE INTO enrollments(student_id,program_id,status,access_enabled) SELECT id,program_id,CASE WHEN status='Actif' THEN 'Actif' ELSE COALESCE(status,'En attente') END,CASE WHEN access_enabled=1 THEN 1 ELSE 0 END FROM students WHERE program_id IS NOT NULL").run();res.json({ok:true,message:'Sauvegarde restaurée.'});}catch(e){res.status(400).json({error:e.message});}});

// Certificates & academic results
// Academic administration: flexible number of terms per program and academic year.
app.get('/api/admin/academic/program/:programId',auth,role('admin'),(req,res)=>{
 const pid=Number(req.params.programId),year=String(req.query.year||new Date().getFullYear()+'-'+(new Date().getFullYear()+1));
 if(!db.prepare('SELECT id FROM programs WHERE id=?').get(pid))return res.status(404).json({error:'Formation introuvable'});
 res.json({program:db.prepare('SELECT id,name,monthly_fee_htg,price_htg FROM programs WHERE id=?').get(pid),terms:db.prepare('SELECT * FROM academic_terms WHERE program_id=? AND academic_year=? ORDER BY term_no').all(pid,year),subjects:db.prepare('SELECT * FROM academic_subjects WHERE program_id=? ORDER BY subject_name').all(pid)});
});
app.post('/api/admin/academic/terms',auth,role('admin'),(req,res)=>{const b=req.body||{},pid=Number(b.program_id),year=String(b.academic_year||'').trim(),no=Number(b.term_no),name=String(b.term_name||'').trim();if(!pid||!/^\d{4}[-/ ]\d{4}$/.test(year)||!Number.isInteger(no)||no<1||no>12||!name)return res.status(400).json({error:'Formation, année académique, numéro et nom du trimestre sont obligatoires.'});try{const r=db.prepare('INSERT INTO academic_terms(program_id,academic_year,term_no,term_name,start_date,end_date) VALUES(?,?,?,?,?,?)').run(pid,year,no,name,b.start_date||null,b.end_date||null);res.status(201).json({ok:true,id:r.lastInsertRowid});}catch(e){if(String(e.message).includes('UNIQUE'))return res.status(409).json({error:'Ce numéro de trimestre existe déjà pour cette formation et cette année.'});res.status(400).json({error:e.message});}});
app.delete('/api/admin/academic/terms/:id',auth,role('admin'),(req,res)=>{const id=Number(req.params.id);if(db.prepare('SELECT 1 FROM academic_grades WHERE term_id=?').get(id))return res.status(409).json({error:'Ce trimestre contient déjà des notes. Il ne peut pas être supprimé.'});db.prepare('DELETE FROM academic_terms WHERE id=?').run(id);res.json({ok:true});});
app.post('/api/admin/academic/subjects',auth,role('admin'),(req,res)=>{const b=req.body||{},pid=Number(b.program_id),name=String(b.subject_name||'').trim(),coef=Number(b.coefficient||1);if(!pid||!name||!Number.isFinite(coef)||coef<=0)return res.status(400).json({error:'Formation, matière et coefficient positif obligatoires.'});try{const r=db.prepare('INSERT INTO academic_subjects(program_id,subject_name,subject_code,coefficient) VALUES(?,?,?,?)').run(pid,name,String(b.subject_code||''),coef);res.status(201).json({ok:true,id:r.lastInsertRowid});}catch(e){if(String(e.message).includes('UNIQUE'))return res.status(409).json({error:'Cette matière existe déjà pour cette formation.'});res.status(400).json({error:e.message});}});
app.put('/api/admin/academic/subjects/:id',auth,role('admin'),(req,res)=>{const b=req.body||{},name=String(b.subject_name||'').trim(),coef=Number(b.coefficient||1);if(!name||!Number.isFinite(coef)||coef<=0)return res.status(400).json({error:'Matière et coefficient positif obligatoires.'});db.prepare('UPDATE academic_subjects SET subject_name=?,subject_code=?,coefficient=?,active=? WHERE id=?').run(name,String(b.subject_code||''),coef,b.active===false?0:1,Number(req.params.id));res.json({ok:true});});
app.get('/api/admin/academic/grades',auth,role('admin'),(req,res)=>{const pid=Number(req.query.program_id),tid=Number(req.query.term_id),sid=Number(req.query.student_id||0);if(!pid||!tid)return res.status(400).json({error:'Formation et trimestre obligatoires.'});res.json(db.prepare(`SELECT g.*,s.student_no,s.name student_name,sub.subject_name,sub.subject_code,sub.coefficient,t.term_name,t.academic_year FROM academic_grades g JOIN students s ON s.id=g.student_id JOIN academic_subjects sub ON sub.id=g.subject_id JOIN academic_terms t ON t.id=g.term_id WHERE g.program_id=? AND g.term_id=? AND (?=0 OR g.student_id=?) ORDER BY s.name,sub.subject_name`).all(pid,tid,sid,sid));});
app.post('/api/admin/academic/grades',auth,role('admin'),(req,res)=>{const b=req.body||{},student=Number(b.student_id),pid=Number(b.program_id),sub=Number(b.subject_id),term=Number(b.term_id),intra=Number(b.intra_score),final=Number(b.final_score);if(!student||!pid||!sub||!term||![intra,final].every(Number.isFinite)||intra<0||intra>100||final<0||final>100)return res.status(400).json({error:'Vérifiez étudiant, formation, matière, trimestre et notes entre 0 et 100.'});if(!db.prepare('SELECT 1 FROM enrollments WHERE student_id=? AND program_id=?').get(student,pid)||!db.prepare('SELECT 1 FROM academic_subjects WHERE id=? AND program_id=?').get(sub,pid)||!db.prepare('SELECT 1 FROM academic_terms WHERE id=? AND program_id=?').get(term,pid))return res.status(400).json({error:'L’étudiant, la matière et le trimestre doivent appartenir à cette formation.'});const weighted=Number((intra*.30+final*.70).toFixed(2));db.prepare(`INSERT INTO academic_grades(student_id,program_id,subject_id,term_id,intra_score,final_score,weighted_score,observation) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(student_id,subject_id,term_id) DO UPDATE SET intra_score=excluded.intra_score,final_score=excluded.final_score,weighted_score=excluded.weighted_score,observation=excluded.observation,updated_at=CURRENT_TIMESTAMP`).run(student,pid,sub,term,intra,final,weighted,String(b.observation||''));const termRow=db.prepare('SELECT academic_year FROM academic_terms WHERE id=?').get(term);const termCount=db.prepare('SELECT COUNT(*) c FROM academic_terms WHERE program_id=? AND academic_year=?').get(pid,termRow.academic_year).c;const subjectCount=db.prepare('SELECT COUNT(*) c FROM academic_subjects WHERE program_id=? AND active=1').get(pid).c;const gradeCount=db.prepare(`SELECT COUNT(*) c FROM academic_grades g JOIN academic_terms t ON t.id=g.term_id WHERE g.student_id=? AND g.program_id=? AND t.academic_year=?`).get(student,pid,termRow.academic_year).c;let certificate=null,annualAverage=null;if(termCount>0&&subjectCount>0&&gradeCount>=termCount*subjectCount){const totals=db.prepare(`SELECT COALESCE(SUM(g.weighted_score*sub.coefficient),0) total,COALESCE(SUM(sub.coefficient),0) coeff FROM academic_grades g JOIN academic_subjects sub ON sub.id=g.subject_id JOIN academic_terms t ON t.id=g.term_id WHERE g.student_id=? AND g.program_id=? AND t.academic_year=?`).get(student,pid,termRow.academic_year);annualAverage=totals.coeff?Number((totals.total/totals.coeff).toFixed(2)):0;const status=annualAverage>=70?'Réussi':'Échoué';db.prepare(`INSERT INTO final_results(student_id,program_id,score,pass_mark,status,notes) VALUES(?,?,?,70,?,'Moyenne annuelle calculée à partir des notes par trimestre (30 % intra, 70 % final).') ON CONFLICT(student_id,program_id) DO UPDATE SET score=excluded.score,pass_mark=70,status=excluded.status,notes=excluded.notes,evaluated_at=CURRENT_TIMESTAMP`).run(student,pid,annualAverage,status);certificate=tryAutoIssueCertificate(student,pid);}res.json({ok:true,weighted_score:weighted,status:weighted>=70?'Réussi':'À reprendre',annual_average:annualAverage,certificate});});
app.get('/api/admin/academic/monthly/:studentId/:programId',auth,role('admin'),(req,res)=>{const sid=Number(req.params.studentId),pid=Number(req.params.programId),en=db.prepare('SELECT e.start_date,e.enrolled_at,p.monthly_fee_htg,p.name program_name,s.name student_name,s.student_no FROM enrollments e JOIN programs p ON p.id=e.program_id JOIN students s ON s.id=e.student_id WHERE e.student_id=? AND e.program_id=?').get(sid,pid);if(!en)return res.status(404).json({error:'Inscription introuvable'});const start=String(en.start_date||en.enrolled_at||new Date().toISOString()).slice(0,7),end=String(req.query.until||new Date().toISOString().slice(0,7));const fee=Number(en.monthly_fee_htg||0),rows=[];let [y,m]=start.split('-').map(Number),[ey,em]=end.split('-').map(Number),guard=0;while((y<ey||(y===ey&&m<=em))&&guard++<60){const month=`${y}-${String(m).padStart(2,'0')}`;const paid=Number(db.prepare("SELECT COALESCE(SUM(amount_htg),0) v FROM payments WHERE student_id=? AND program_id=? AND billing_month=? AND status='Confirmé'").get(sid,pid,month).v||0);rows.push({month,fee,paid,balance:Math.max(0,fee-paid),status:paid>=fee&&fee>0?'Peye':paid>0?'An pati':fee>0?'Anreta':'Frè pa fikse'});if(++m>12){m=1;y++}}res.json({student_name:en.student_name,student_no:en.student_no,program_name:en.program_name,monthly_fee_htg:fee,rows,total_due:rows.reduce((a,x)=>a+x.fee,0),total_paid:rows.reduce((a,x)=>a+x.paid,0),balance:rows.reduce((a,x)=>a+x.balance,0)});});
app.get('/api/admin/students/:id/dossier',auth,role('admin'),(req,res)=>{const sid=Number(req.params.id),student=db.prepare('SELECT * FROM students WHERE id=?').get(sid);if(!student)return res.status(404).json({error:'Étudiant introuvable'});const enrollments=db.prepare(`SELECT e.*,p.name program_name,p.price_htg,p.monthly_fee_htg,COALESCE((SELECT SUM(amount_htg) FROM payments WHERE student_id=e.student_id AND program_id=e.program_id AND status='Confirmé' AND (payment_category IS NULL OR payment_category IN ('Mensualité','Trimestriel'))),0) paid FROM enrollments e JOIN programs p ON p.id=e.program_id WHERE e.student_id=? ORDER BY e.enrolled_at`).all(sid);const payments=db.prepare(`SELECT pay.*,p.name program_name FROM payments pay LEFT JOIN programs p ON p.id=pay.program_id WHERE pay.student_id=? ORDER BY pay.created_at DESC`).all(sid);const grades=db.prepare(`SELECT g.*,p.name program_name,sub.subject_name,sub.coefficient,t.term_name,t.academic_year,t.term_no FROM academic_grades g JOIN programs p ON p.id=g.program_id JOIN academic_subjects sub ON sub.id=g.subject_id JOIN academic_terms t ON t.id=g.term_id WHERE g.student_id=? ORDER BY p.name,t.academic_year,t.term_no,sub.subject_name`).all(sid);res.json({student,enrollments,payments,grades});});
app.get('/api/admin/academic/transcript/:studentId/:programId',auth,role('admin'),(req,res)=>{const sid=Number(req.params.studentId),pid=Number(req.params.programId),year=String(req.query.year||'');const student=db.prepare('SELECT s.*,p.name program_name FROM students s JOIN enrollments e ON e.student_id=s.id AND e.program_id=? JOIN programs p ON p.id=e.program_id WHERE s.id=?').get(pid,sid);if(!student)return res.status(404).json({error:'Dossier étudiant introuvable.'});const terms=db.prepare(`SELECT * FROM academic_terms WHERE program_id=? AND (?='' OR academic_year=?) ORDER BY academic_year,term_no`).all(pid,year,year);const grades=db.prepare(`SELECT g.*,sub.subject_name,sub.coefficient,t.term_name,t.term_no,t.academic_year FROM academic_grades g JOIN academic_subjects sub ON sub.id=g.subject_id JOIN academic_terms t ON t.id=g.term_id WHERE g.student_id=? AND g.program_id=? AND (?='' OR t.academic_year=?) ORDER BY t.academic_year,t.term_no,sub.subject_name`).all(sid,pid,year,year);const grouped=terms.map(term=>{const list=grades.filter(g=>g.term_id===term.id);const total=list.reduce((a,g)=>a+g.weighted_score*g.coefficient,0),coef=list.reduce((a,g)=>a+g.coefficient,0);return {...term,grades:list,average:coef?Number((total/coef).toFixed(2)):null,status:coef?(total/coef>=70?'Réussi':'À reprendre'):'En attente'};});const total=grades.reduce((a,g)=>a+g.weighted_score*Number(g.coefficient||1),0),coefs=grades.reduce((a,g)=>a+Number(g.coefficient||1),0);res.json({student,terms:grouped,year_average:coefs?Number((total/coefs).toFixed(2)):null,year_status:coefs?(total/coefs>=70?'Réussi':'À reprendre'):'En attente'});});
app.get('/api/admin/academic/transcript/:studentId/:programId/pdf',auth,role('admin'),(req,res)=>{try{const sid=Number(req.params.studentId),pid=Number(req.params.programId),year=String(req.query.year||'');const student=db.prepare('SELECT s.*,p.name program_name FROM students s JOIN enrollments e ON e.student_id=s.id AND e.program_id=? JOIN programs p ON p.id=e.program_id WHERE s.id=?').get(pid,sid);if(!student)return res.status(404).send('Dossier étudiant introuvable');const terms=db.prepare("SELECT * FROM academic_terms WHERE program_id=? AND (?='' OR academic_year=?) ORDER BY academic_year,term_no").all(pid,year,year);const grades=db.prepare("SELECT g.*,sub.subject_name,sub.coefficient,t.term_name,t.term_no,t.academic_year FROM academic_grades g JOIN academic_subjects sub ON sub.id=g.subject_id JOIN academic_terms t ON t.id=g.term_id WHERE g.student_id=? AND g.program_id=? AND (?='' OR t.academic_year=?) ORDER BY t.academic_year,t.term_no,sub.subject_name").all(sid,pid,year,year);const grouped=terms.map(term=>{const list=grades.filter(g=>g.term_id===term.id),sum=list.reduce((a,g)=>a+g.weighted_score*Number(g.coefficient||1),0),coef=list.reduce((a,g)=>a+Number(g.coefficient||1),0);return {...term,grades:list,average:coef?Number((sum/coef).toFixed(2)):null,status:coef?(sum/coef>=70?'Réussi':'À reprendre'):'En attente'}});const sum=grades.reduce((a,g)=>a+g.weighted_score*Number(g.coefficient||1),0),coef=grades.reduce((a,g)=>a+Number(g.coefficient||1),0),average=coef?Number((sum/coef).toFixed(2)):null;const doc=new PDFDocument({size:'A4',margin:42,info:{Title:'Relevé de notes CETEP',Author:'CETEP'}});res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="releve-notes-${student.student_no}.pdf"`);doc.pipe(res);doc.fontSize(17).text('CENTRE D’ENCADREMENT TECHNIQUE ET PROFESSIONNEL',{align:'center'});doc.moveDown(.3).fontSize(15).text('RELEVÉ DE NOTES',{align:'center'});doc.moveDown().fontSize(10).text(`Étudiant : ${student.name} (${student.student_no})`);doc.text(`Formation : ${student.program_name}`);doc.text(`Année académique : ${year||'Toutes les années'}`);doc.moveDown();for(const term of grouped){if(doc.y>690)doc.addPage();doc.fontSize(12).text(`${term.term_name} — ${term.academic_year}`);doc.moveDown(.3);doc.fontSize(9).text('Matière | Intra /100 (30 %) | Final /100 (70 %) | Moyenne /100');doc.moveDown(.2);for(const g of term.grades){if(doc.y>735)doc.addPage();doc.text(`${g.subject_name} | ${Number(g.intra_score).toFixed(2)} | ${Number(g.final_score).toFixed(2)} | ${Number(g.weighted_score).toFixed(2)}`)}doc.moveDown(.3).fontSize(10).text(`Moyenne du trimestre : ${term.average??'—'} /100     Décision : ${term.status}`);doc.moveDown()}if(doc.y>680)doc.addPage();doc.fontSize(12).text(`MOYENNE GÉNÉRALE : ${average??'—'} /100`);doc.text(`DÉCISION : ${average===null?'En attente':average>=70?'Réussi':'À reprendre'}`);doc.moveDown(2).fontSize(9).text('Directeur Général : Agronome Livenson Fleuriot');doc.text('Directeur des Études : Wilio Joseph');doc.end()}catch(e){if(!res.headersSent)res.status(400).send(e.message)}});
app.get('/api/admin/certificates/search',auth,role('admin'),(req,res)=>{
  const q=String(req.query.q||'').trim();
  if(q.length<2)return res.status(400).json({error:'Saisissez au moins 2 caractères pour lancer la recherche.'});
  const like='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
  const rows=db.prepare(`SELECT s.id student_id,s.student_no,s.name student_name,e.program_id,p.name program_name,
      c.id certificate_id,c.certificate_no,c.status certificate_status,c.issued_at
    FROM enrollments e JOIN students s ON s.id=e.student_id JOIN programs p ON p.id=e.program_id
    LEFT JOIN certificates c ON c.student_id=s.id AND c.program_id=e.program_id
    WHERE s.name LIKE ? ESCAPE '\\' OR s.student_no LIKE ? ESCAPE '\\' OR c.certificate_no LIKE ? ESCAPE '\\'
    ORDER BY s.name,p.name LIMIT 100`).all(like,like,like);
  res.json(rows);
});
app.get('/api/admin/certificates',auth,role('admin'),(req,res)=>{
  const rows=db.prepare(`SELECT s.id student_id,s.student_no,s.name student_name,e.program_id,p.name program_name,
    COALESCE(fr.score,0) score,COALESCE(fr.pass_mark,70) pass_mark,COALESCE(fr.status,'En attente') result_status,
    c.id certificate_id,c.certificate_no,c.issued_at,
    (SELECT COALESCE(SUM(amount_htg),0) FROM payments WHERE student_id=s.id AND program_id=e.program_id AND status='Confirmé' AND (payment_category IS NULL OR payment_category IN ('Mensualité','Trimestriel'))) paid,
    p.price_htg due
    FROM enrollments e JOIN students s ON s.id=e.student_id JOIN programs p ON p.id=e.program_id
    LEFT JOIN final_results fr ON fr.student_id=s.id AND fr.program_id=e.program_id
    LEFT JOIN certificates c ON c.student_id=s.id AND c.program_id=e.program_id
    ORDER BY s.name,p.name`).all();
  res.json(rows.map(x=>({...x,completion:completionStats(x.student_id,x.program_id||0),payment:paymentStats(x.student_id,x.program_id||0)})));
});
app.post('/api/admin/results',auth,role('admin'),(req,res)=>{
  const studentId=Number(req.body.student_id), programId=Number(req.body.program_id);
  if(!studentId||!programId)return res.status(400).json({error:'Étudiant et formation obligatoires'});
  if(!db.prepare('SELECT 1 FROM enrollments WHERE student_id=? AND program_id=?').get(studentId,programId))return res.status(400).json({error:'Cette formation ne figure pas dans le dossier étudiant.'});
  const score=Number(req.body.score||0), passMark=70;
  const status=score>=passMark?'Réussi':'Échoué';
  db.prepare(`INSERT INTO final_results(student_id,program_id,score,pass_mark,status,notes)
    VALUES(?,?,?,?,?,?) ON CONFLICT(student_id,program_id) DO UPDATE SET score=excluded.score,pass_mark=excluded.pass_mark,status=excluded.status,notes=excluded.notes,evaluated_at=CURRENT_TIMESTAMP`)
    .run(studentId,programId,score,passMark,status,req.body.notes||'');
  const cert=tryAutoIssueCertificate(studentId,programId);
  res.json({ok:true,status,certificate:cert});
});
app.get('/api/admin/certificates/review/:studentId/:programId',auth,role('admin'),(req,res)=>{
  const sid=Number(req.params.studentId),pid=Number(req.params.programId);
  const student=db.prepare('SELECT id,student_no,name,email,phone FROM students WHERE id=?').get(sid);
  const enrollment=db.prepare('SELECT id,start_date,end_date,status FROM enrollments WHERE student_id=? AND program_id=?').get(sid,pid);
  const program=db.prepare('SELECT id,name,price_htg FROM programs WHERE id=?').get(pid);
  if(!student||!enrollment||!program)return res.status(404).json({error:'Dossier étudiant ou formation introuvable.'});
  const result=db.prepare('SELECT score,pass_mark,status,notes,evaluated_at FROM final_results WHERE student_id=? AND program_id=?').get(sid,pid)||null;
  const completion=completionStats(sid,pid),payment=paymentStats(sid,pid);
  const certificate=db.prepare('SELECT id,certificate_no,issued_at,status FROM certificates WHERE student_id=? AND program_id=?').get(sid,pid)||null;
  const conditions={passed:!!result&&result.status==='Réussi'&&Number(result.score)>=Number(result.pass_mark),lessons_complete:completion.percent>=100,payment_complete:payment.fullyPaid};
  res.json({student,enrollment,program,result,completion,payment,conditions,eligible:Object.values(conditions).every(Boolean),certificate});
});
app.post('/api/admin/certificates/review/:studentId/:programId/decision',auth,role('admin'),(req,res)=>{
  const sid=Number(req.params.studentId),pid=Number(req.params.programId),decision=String(req.body.decision||'').toLowerCase(),reason=String(req.body.reason||'').trim();
  if(!['approve','reject'].includes(decision))return res.status(400).json({error:'Choisissez une décision valide.'});
  const student=db.prepare('SELECT id FROM students WHERE id=?').get(sid);
  if(!student||!db.prepare('SELECT 1 FROM enrollments WHERE student_id=? AND program_id=?').get(sid,pid))return res.status(404).json({error:'Dossier étudiant ou formation introuvable.'});
  const result=db.prepare('SELECT * FROM final_results WHERE student_id=? AND program_id=?').get(sid,pid)||null;
  const completion=completionStats(sid,pid),payment=paymentStats(sid,pid);
  const conditions={passed:!!result&&result.status==='Réussi'&&Number(result.score)>=Number(result.pass_mark),lessons_complete:completion.percent>=100,payment_complete:payment.fullyPaid};
  const eligible=Object.values(conditions).every(Boolean);
  if(decision==='approve'&&!eligible&&!reason)return res.status(400).json({error:'Une justification est obligatoire pour délivrer un certificat par dérogation.'});
  if(decision==='reject'){
    db.prepare("INSERT INTO certificate_admin_audit(student_id,program_id,actor_id,actor_email,action,reason,conditions_json) VALUES(?,?,?,?,?,?,?)").run(sid,pid,req.user.id,req.user.email,'REJECTED',reason||'Certificat non délivré après vérification.',JSON.stringify({conditions,completion,payment,result}));
    return res.json({ok:true,decision:'rejected',message:'Décision enregistrée. Aucun certificat n’a été délivré.'});
  }
  const existing=db.prepare('SELECT * FROM certificates WHERE student_id=? AND program_id=?').get(sid,pid);
  if(existing)return res.status(409).json({error:'Un certificat existe déjà pour cette formation.',certificate:existing});
  const tx=db.transaction(()=>{
    const certNo=certificateNo();
    const inserted=db.prepare("INSERT INTO certificates(certificate_no,student_id,program_id,result_id,status) VALUES(?,?,?,?, 'Valide')").run(certNo,sid,pid,result?.id||null);
    const cert=db.prepare('SELECT c.*,s.name student_name,p.name program_name,r.score,r.pass_mark FROM certificates c JOIN students s ON s.id=c.student_id JOIN programs p ON p.id=c.program_id LEFT JOIN final_results r ON r.id=c.result_id WHERE c.id=?').get(inserted.lastInsertRowid);
    db.prepare("INSERT INTO certificate_admin_audit(student_id,program_id,certificate_id,actor_id,actor_email,action,reason,conditions_json) VALUES(?,?,?,?,?,?,?,?)").run(sid,pid,cert.id,req.user.id,req.user.email,eligible?'ADMIN_APPROVED':'ADMIN_OVERRIDE',reason||null,JSON.stringify({conditions,completion,payment,result}));
    return cert;
  });
  try{return res.status(201).json({ok:true,decision:'approved',certificate:tx(),override:!eligible});}catch(e){return res.status(409).json({error:e.message||'Impossible de délivrer le certificat.'});}
});
app.post('/api/admin/certificates/:studentId/issue',auth,role('admin'),(req,res)=>res.status(410).json({error:'Utilisez le bouton Vérifier / délivrer pour examiner le dossier et confirmer votre décision.'}));
app.get('/api/admin/certificates/:id/pdf',auth,role('admin'),(req,res)=>sendCertificatePdf(req,res,Number(req.params.id),true));
// Administration du règlement : les modifications restent limitées à cette section.
app.get('/api/admin/student-policy',auth,role('admin'),(req,res)=>{const p=db.prepare('SELECT * FROM student_policy WHERE id=1').get();const count=db.prepare('SELECT COUNT(*) c FROM student_policy_acceptances WHERE policy_version=?').get(p.version).c;res.json({...p,accepted_count:count});});
app.put('/api/admin/student-policy',auth,role('admin'),(req,res)=>{const title=String(req.body.title||'').trim(),content=String(req.body.content||'').trim();if(!title||!content)return res.status(400).json({error:'Le titre et le règlement sont obligatoires.'});if(content.length>30000)return res.status(400).json({error:'Le règlement est trop long (maximum 30 000 caractères).'});const current=db.prepare('SELECT version FROM student_policy WHERE id=1').get();const version=Number(current?.version||0)+1;db.prepare("INSERT INTO student_policy(id,title,content,version,updated_at,updated_by) VALUES(1,?,?,?,CURRENT_TIMESTAMP,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,content=excluded.content,version=excluded.version,updated_at=CURRENT_TIMESTAMP,updated_by=excluded.updated_by").run(title,content,version,req.user.email||'admin');res.json({ok:true,version});});
app.get('/api/student/policy',auth,role('student'),(req,res)=>{const p=db.prepare('SELECT title,content,version,updated_at FROM student_policy WHERE id=1').get();const accepted=!!db.prepare('SELECT 1 FROM student_policy_acceptances WHERE student_id=? AND policy_version=?').get(req.user.id,p.version);res.json({...p,accepted});});
app.post('/api/student/policy/accept',auth,role('student'),(req,res)=>{const p=db.prepare('SELECT version FROM student_policy WHERE id=1').get();if(!req.body||req.body.accepted!==true)return res.status(400).json({error:'Veuillez confirmer votre acceptation.'});db.prepare('INSERT OR IGNORE INTO student_policy_acceptances(student_id,policy_version,ip_address) VALUES(?,?,?)').run(req.user.id,p.version,req.ip||null);res.json({ok:true,version:p.version});});

app.get('/api/student/me',auth,role('student'),(req,res)=>{
 const sid=Number(req.user.id),student=db.prepare('SELECT id,student_no,name,email,phone FROM students WHERE id=?').get(sid);
 if(!student)return res.status(404).json({error:'Dossier étudiant introuvable.'});
 const enrollments=db.prepare(`SELECT e.*,p.name program_name,p.duration,p.price_htg,
  COALESCE((SELECT SUM(pay.amount_htg) FROM payments pay WHERE pay.student_id=e.student_id AND pay.program_id=e.program_id AND pay.status='Confirmé'),0) paid
  FROM enrollments e JOIN programs p ON p.id=e.program_id WHERE e.student_id=? ORDER BY e.enrolled_at`).all(sid);
 // Le contenu Anglais est désormais servi depuis la formation réellement choisie (4 niveaux A–D).
 res.json({...student,enrollments});
});
app.get('/api/student/content',auth,role('student'),(req,res)=>{
 const sid=Number(req.user.id),requestedPid=Number(req.query.program_id);
 if(!requestedPid)return res.status(403).json({error:'Formation non précisée.'});
 const enrollment=db.prepare("SELECT e.program_id,p.name FROM enrollments e JOIN programs p ON p.id=e.program_id WHERE e.student_id=? AND e.program_id=? AND e.status='Actif' AND e.access_enabled=1").get(sid,requestedPid);
 if(!enrollment)return res.status(403).json({error:'Accès non autorisé à cette formation.'});
 const contentPid=requestedPid;
 const rows=db.prepare(`SELECT m.id module_id,m.title module_title,l.id lesson_id,l.title lesson_title,l.type,l.content,l.video_url,l.file_url,l.meeting_url,l.scheduled_at,l.duration_minutes,COALESCE(lp.completed,0) completed FROM modules m JOIN lessons l ON l.module_id=m.id LEFT JOIN lesson_progress lp ON lp.lesson_id=l.id AND lp.student_id=? WHERE m.program_id=? AND m.active=1 AND l.active=1 ORDER BY m.order_no,l.order_no`).all(sid,contentPid);
 res.json(rows);
});
app.get('/api/student/documents',auth,role('student'),(req,res)=>{
 const sid=Number(req.user.id),pid=Number(req.query.program_id);
 if(!pid||!db.prepare('SELECT 1 FROM enrollments WHERE student_id=? AND program_id=?').get(sid,pid))return res.status(403).json({error:'Formation non autorisée.'});
 const cert=db.prepare("SELECT id,certificate_no,issued_at,status FROM certificates WHERE student_id=? AND program_id=?").get(sid,pid)||null;
 const grades=db.prepare('SELECT COUNT(*) c FROM academic_grades WHERE student_id=? AND program_id=?').get(sid,pid).c;
 const result=db.prepare("SELECT score,pass_mark,status FROM final_results WHERE student_id=? AND program_id=?").get(sid,pid)||null;
 const passed=!!result && result.status==='Réussi' && Number(result.score)>=Number(result.pass_mark);
 const perms=Object.fromEntries(DOCUMENT_TYPES.map(t=>[t,documentPermission(sid,pid,t)]));
 res.json({permissions:perms,available:{certificate:!!cert,transcript:Number(grades)>0,attestation:passed},certificate:cert});
});
app.get('/api/student/documents/preview/:type',auth,role('student'),(req,res)=>{
 const sid=Number(req.user.id),pid=Number(req.query.program_id),type=String(req.params.type||'');
 if(!DOCUMENT_TYPES.includes(type)||!pid||!db.prepare('SELECT 1 FROM enrollments WHERE student_id=? AND program_id=?').get(sid,pid))return res.status(404).json({error:'Document introuvable.'});
 const student=db.prepare('SELECT student_no,name FROM students WHERE id=?').get(sid),program=db.prepare('SELECT name,duration FROM programs WHERE id=?').get(pid);
 const cert=db.prepare('SELECT certificate_no,issued_at,status FROM certificates WHERE student_id=? AND program_id=?').get(sid,pid)||null;
 const gradeCount=db.prepare('SELECT COUNT(*) c FROM academic_grades WHERE student_id=? AND program_id=?').get(sid,pid).c;
 const result=db.prepare("SELECT score,pass_mark,status,evaluated_at FROM final_results WHERE student_id=? AND program_id=?").get(sid,pid)||null;
 if(type==='certificate'&&!cert)return res.status(404).json({error:'Certificat non délivré pour cette formation.'});
 if(type==='transcript'&&!gradeCount)return res.status(404).json({error:'Aucune note enregistrée pour cette formation.'});
 if(type==='attestation'&&(!result||result.status!=='Réussi'||Number(result.score)<Number(result.pass_mark)))return res.status(404).json({error:'L’attestation sera disponible après validation de la réussite académique.'});
 const transcript=type==='transcript'?db.prepare("SELECT g.intra_score,g.final_score,g.weighted_score,sub.subject_name,sub.coefficient,t.term_name,t.academic_year FROM academic_grades g JOIN academic_subjects sub ON sub.id=g.subject_id JOIN academic_terms t ON t.id=g.term_id WHERE g.student_id=? AND g.program_id=? ORDER BY t.academic_year,t.term_no,sub.subject_name").all(sid,pid):[];
 res.json({type,student,program,certificate:cert,result,grades:transcript,canDownload:documentPermission(sid,pid,type),message:documentPermission(sid,pid,type)?'Téléchargement autorisé par le CETEP.':'Document visible en consultation seulement. Le téléchargement attend l’autorisation de l’administration.'});
});
function requireDocumentPermission(req,res,type,pid){if(!documentPermission(Number(req.user.id),Number(pid),type)){res.status(403).json({error:'Téléchargement bloqué : l’administration du CETEP n’a pas encore autorisé ce document.'});return false;}return true;}

app.get('/api/student/certificate',auth,role('student'),(req,res)=>{const sid=Number(req.user.id),legacy=db.prepare('SELECT program_id FROM students WHERE id=?').get(sid);const pid=Number(req.query.program_id||legacy?.program_id||0);if(!pid||!db.prepare('SELECT 1 FROM enrollments WHERE student_id=? AND program_id=?').get(sid,pid))return res.status(404).json({eligible:false,message:'Cette formation ne figure pas dans votre dossier.'});if(!documentPermission(sid,pid,'certificate'))return res.json({eligible:false,authorized:false,message:'Le certificat est en attente de l’autorisation de l’administration.'});const cert=tryAutoIssueCertificate(sid,pid);if(!cert)return res.status(404).json({eligible:false,message:'Votre certificat sera disponible après réussite, 100% des leçons et paiement complet des frais.'});res.json({eligible:true,certificate:cert,download:'/api/student/certificate.pdf?program_id='+pid});});
app.get('/api/student/certificate.pdf',auth,role('student'),(req,res)=>{const sid=Number(req.user.id),legacy=db.prepare('SELECT program_id FROM students WHERE id=?').get(sid);const pid=Number(req.query.program_id||legacy?.program_id||0);if(!pid||!db.prepare('SELECT 1 FROM enrollments WHERE student_id=? AND program_id=?').get(sid,pid))return res.status(403).send('Formation non autorisée');if(!documentPermission(sid,pid,'certificate'))return res.status(403).send('Téléchargement bloqué : autorisation administrative requise.');const cert=tryAutoIssueCertificate(sid,pid);if(!cert)return res.status(404).send('Certificat non disponible');sendCertificatePdf(req,res,cert.id,false);});
app.get('/api/student/transcript.pdf',auth,role('student'),(req,res)=>{
 try{
  const sid=Number(req.user.id),pid=Number(req.query.program_id),year=String(req.query.year||'');
  if(!pid||!db.prepare('SELECT 1 FROM enrollments WHERE student_id=? AND program_id=?').get(sid,pid))return res.status(403).send('Formation non autorisée.');
  if(!documentPermission(sid,pid,'transcript'))return res.status(403).send('Téléchargement bloqué : autorisation administrative requise.');
  const student=db.prepare('SELECT * FROM students WHERE id=?').get(sid),program=db.prepare('SELECT name FROM programs WHERE id=?').get(pid);
  const terms=db.prepare("SELECT * FROM academic_terms WHERE program_id=? AND (?='' OR academic_year=?) ORDER BY academic_year,term_no").all(pid,year,year);
  const grades=db.prepare("SELECT g.*,sub.subject_name,sub.coefficient,t.term_name,t.term_no,t.academic_year FROM academic_grades g JOIN academic_subjects sub ON sub.id=g.subject_id JOIN academic_terms t ON t.id=g.term_id WHERE g.student_id=? AND g.program_id=? AND (?='' OR t.academic_year=?) ORDER BY t.academic_year,t.term_no,sub.subject_name").all(sid,pid,year,year);
  const doc=new PDFDocument({size:'A4',margin:42,info:{Title:'Relevé de notes CETEP',Author:'CETEP'}});
  res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="releve-notes-${student.student_no}.pdf"`);doc.pipe(res);
  doc.fillColor('#102b55').font('Helvetica-Bold').fontSize(17).text('CENTRE D’ENCADREMENT TECHNIQUE ET PROFESSIONNEL',{align:'center'});
  doc.moveDown(.3).fillColor('#b8860b').fontSize(16).text('RELEVÉ DE NOTES',{align:'center'});doc.moveDown();
  doc.fillColor('#17233f').font('Helvetica').fontSize(10).text(`Étudiant : ${student.name} (${student.student_no})`);doc.text(`Formation : ${program.name}`);doc.text(`Année académique : ${year||'Toutes les années'}`);doc.moveDown();
  let weightedTotal=0,totalCoef=0;
  for(const term of terms){if(doc.y>680)doc.addPage();doc.fillColor('#102b55').font('Helvetica-Bold').fontSize(12).text(`${term.term_name} — ${term.academic_year}`);doc.moveDown(.3);doc.fillColor('#222').font('Helvetica-Bold').fontSize(8.5).text('Matière                         Intra /100       Final /100       Moyenne /100');doc.moveDown(.2);const list=grades.filter(g=>g.term_id===term.id);let sum=0,coef=0;for(const g of list){const c=Number(g.coefficient||1);sum+=Number(g.weighted_score||0)*c;coef+=c;doc.font('Helvetica').fontSize(9).text(`${g.subject_name}     ${Number(g.intra_score).toFixed(2)}             ${Number(g.final_score).toFixed(2)}             ${Number(g.weighted_score).toFixed(2)}`);}weightedTotal+=sum;totalCoef+=coef;const avg=coef?sum/coef:null;doc.moveDown(.25).font('Helvetica-Bold').fontSize(9).text(`Moyenne : ${avg===null?'—':avg.toFixed(2)+' /100'}     Décision : ${avg===null?'En attente':avg>=70?'Réussi':'À reprendre'}`);doc.moveDown();}
  const average=totalCoef?weightedTotal/totalCoef:null;if(doc.y>680)doc.addPage();doc.fillColor('#102b55').font('Helvetica-Bold').fontSize(12).text(`MOYENNE GÉNÉRALE : ${average===null?'—':average.toFixed(2)+' /100'}`);doc.text(`DÉCISION : ${average===null?'En attente':average>=70?'Réussi':'À reprendre'}`);doc.moveDown(2).fontSize(9).fillColor('#222').text('Directeur Général : Agronome Livenson Fleuriot');doc.text('Directeur des Études : Wilio Joseph');doc.end();
 }catch(e){if(!res.headersSent)res.status(400).send(e.message);}
});
app.get('/api/student/attestation.pdf',auth,role('student'),(req,res)=>{
 try{
  const sid=Number(req.user.id),pid=Number(req.query.program_id);
  if(!pid||!db.prepare('SELECT 1 FROM enrollments WHERE student_id=? AND program_id=?').get(sid,pid))return res.status(403).send('Formation non autorisée.');
  if(!documentPermission(sid,pid,'attestation'))return res.status(403).send('Téléchargement bloqué : autorisation administrative requise.');
  const st=db.prepare('SELECT * FROM students WHERE id=?').get(sid),p=db.prepare('SELECT name,duration FROM programs WHERE id=?').get(pid),e=db.prepare('SELECT * FROM enrollments WHERE student_id=? AND program_id=?').get(sid,pid);
  const result=db.prepare("SELECT status,score,pass_mark FROM final_results WHERE student_id=? AND program_id=?").get(sid,pid);if(!result||result.status!=='Réussi'||Number(result.score)<Number(result.pass_mark))return res.status(403).send('Attestation non disponible : la réussite académique doit être validée.');
  const doc=new PDFDocument({size:'A4',margin:54,info:{Title:'Attestation CETEP',Author:'CETEP'}});res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="attestation-${st.student_no}.pdf"`);doc.pipe(res);
  doc.rect(24,24,547,794).lineWidth(3).strokeColor('#c99a22').stroke();doc.rect(32,32,531,778).lineWidth(1).strokeColor('#102b55').stroke();
  doc.fillColor('#102b55').font('Helvetica-Bold').fontSize(18).text('CENTRE D’ENCADREMENT TECHNIQUE ET PROFESSIONNEL',{align:'center'});doc.moveDown(.3).fontSize(11).text('CETEP',{align:'center'});doc.moveDown(1.6).fillColor('#b8860b').fontSize(25).text('ATTESTATION',{align:'center'});doc.moveDown(1.5).fillColor('#17233f').font('Helvetica').fontSize(12).text('Je soussigné, Livenson Fleuriot, Directeur Général du Centre d’Encadrement Technique et Professionnel, référencé : Reg-XV ; Folio : 217 ; No K-430,');doc.moveDown(.8).font('Helvetica-Bold').text('Atteste que :');doc.moveDown(.6).font('Helvetica').text(`${st.name}, demeurant et domicilié(e) à Carrefour, enregistré(e) au numéro : ${st.student_no},`);doc.moveDown(.7).text(`a suivi une formation théorique et pratique en ${p.name}, pour une durée totale de ${p.duration||'six (6) mois'}, et a satisfait aux exigences académiques requises.`);doc.moveDown(1.2).text('En foi de quoi, le présent document lui est délivré pour servir et valoir ce que de droit.');doc.moveDown(2).text(`Fait à Carrefour, le ${new Date().toLocaleDateString('fr-FR')}`,{align:'center'});doc.moveDown(4);doc.font('Helvetica-Bold').fontSize(10).text('Livenson Fleuriot                                             Wilio Joseph',{align:'center'});doc.font('Helvetica').text('Directeur Général                                              Directeur des Études',{align:'center'});doc.moveDown(2).fontSize(8).text('2, Impasse Primitive, Lamentin 54, Carrefour, Haïti (W.I).',{align:'center'});doc.text('Tél. : (509) 3736-5610 / 4189-9854 / 3632-9281 / 3706-1376 / 3198-6496 / 3753-6926',{align:'center'});doc.end();
 }catch(e){if(!res.headersSent)res.status(400).send(e.message);}
});

app.get('/api/certificates/verify/:number',(req,res)=>{
  const c=db.prepare(`SELECT c.certificate_no,c.issued_at,c.status,s.name student_name,p.name program_name,r.score
    FROM certificates c JOIN students s ON s.id=c.student_id JOIN programs p ON p.id=c.program_id
    LEFT JOIN final_results r ON r.id=c.result_id WHERE c.certificate_no=?`).get(req.params.number);
  if(!c)return res.status(404).json({valid:false,message:'Certificat introuvable'});
  res.json({valid:c.status==='Valide',...c});
});
app.get('/certificat/:number',(req,res)=>{
  const no=String(req.params.number).replace(/[^A-Za-z0-9_-]/g,'');
  const c=db.prepare(`SELECT c.certificate_no,c.issued_at,c.status,s.name student_name,p.name program_name,r.score
    FROM certificates c JOIN students s ON s.id=c.student_id JOIN programs p ON p.id=c.program_id
    LEFT JOIN final_results r ON r.id=c.result_id WHERE c.certificate_no=?`).get(no);
  if(!c)return res.status(404).send('<!doctype html><meta charset="utf-8"><title>CETEP — Vérification</title><h1>Certificat introuvable</h1>');
  res.send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CETEP — Vérification du certificat</title><body style="font-family:Arial,sans-serif;max-width:760px;margin:60px auto;padding:24px"><h1>CETEP</h1><h2>Vérification du certificat</h2><p><b>N° :</b> ${c.certificate_no}</p><p><b>Étudiant :</b> ${String(c.student_name).replace(/[<>&"]/g,'')}</p><p><b>Formation :</b> ${String(c.program_name).replace(/[<>&"]/g,'')}</p><p><b>Résultat :</b> ${Number(c.score||0).toFixed(1)}/100</p><p><b>Statut :</b> ${c.status==='Valide'?'CERTIFICAT VALIDE':'CERTIFICAT NON VALIDE'}</p><p><b>Délivré le :</b> ${new Date(c.issued_at).toLocaleDateString('fr-FR')}</p><a href="/api/certificates/verify/${encodeURIComponent(c.certificate_no)}">Voir les données de vérification</a></body>`);
});
async function sendCertificatePdf(req,res,certificateId,isAdmin){
  const c=db.prepare(`SELECT c.*,s.name student_name,COALESCE(s.certificate_name,s.name) certificate_name,
    p.name program_name,p.duration,e.enrolled_at,e.start_date,e.end_date,r.score,r.pass_mark,
    cpt.intro certificate_program_intro,cpt.extra_text certificate_program_extra_text,
    st.school_name,st.school_full_name,st.slogan,st.logo_url,st.certificate_city,
    st.certificate_extra_text,st.certificate_other_size,st.certificate_name_size,st.certificate_program_size,st.certificate_weekly_hours
    FROM certificates c JOIN students s ON s.id=c.student_id JOIN programs p ON p.id=c.program_id
    LEFT JOIN final_results r ON r.id=c.result_id
    LEFT JOIN enrollments e ON e.student_id=c.student_id AND e.program_id=c.program_id
    LEFT JOIN certificate_program_texts cpt ON cpt.program_id=c.program_id
    CROSS JOIN (SELECT MAX(CASE WHEN key='school_name' THEN value END) school_name,
      MAX(CASE WHEN key='school_full_name' THEN value END) school_full_name,
      MAX(CASE WHEN key='slogan' THEN value END) slogan,MAX(CASE WHEN key='logo_url' THEN value END) logo_url,
      MAX(CASE WHEN key='certificate_city' THEN value END) certificate_city,
      MAX(CASE WHEN key='certificate_extra_text' THEN value END) certificate_extra_text,
      MAX(CASE WHEN key='certificate_other_size' THEN value END) certificate_other_size,
      MAX(CASE WHEN key='certificate_name_size' THEN value END) certificate_name_size,
      MAX(CASE WHEN key='certificate_program_size' THEN value END) certificate_program_size,
      MAX(CASE WHEN key='certificate_weekly_hours' THEN value END) certificate_weekly_hours FROM settings) st
    WHERE c.id=?`).get(certificateId);
  if(!c)return res.status(404).send('Certificat introuvable');
  if(!isAdmin && c.student_id!==req.user.id)return res.status(403).send('Accès interdit');

  // Modèle officiel CETEP approuvé : décorations, signatures, logos et sceau conservés.
  // Le fond est au format 1400x1083; le PDF conserve exactement le même ratio.
  const W=842,H= W*1083/1400;
  // Vérifier le fichier AVANT d'ouvrir le flux PDF vers la réponse HTTP.
  // Sinon doc.end() puis res.send() provoque ERR_STREAM_WRITE_AFTER_END.
  const model=path.join(__dirname,'public',CERTIFICATE_MODEL_FILE);
  if(!fs.existsSync(model)){
    console.error('[CETEP] Modèle officiel introuvable:',model);
    return res.status(500).send('Modèle officiel CETEP introuvable dans public/.');
  }
  const doc=new PDFDocument({size:[W,H],margin:0});
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition',`attachment; filename="${c.certificate_no}-CETEP-2026.pdf"`);
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, private');
  res.setHeader('Pragma','no-cache');res.setHeader('Expires','0');
  res.setHeader('X-CETEP-Certificate-Model',APP_VERSION);
  doc.on('error',err=>{console.error('[CETEP] Erreur génération PDF:',err);if(!res.headersSent)res.status(500).end('Erreur génération certificat');else if(!res.destroyed)res.destroy(err);});
  doc.pipe(res);
  doc.image(model,0,0,{width:W,height:H});

  const safeSize=(v,d,min,max)=>Math.max(min,Math.min(max,Number(v)||d));
  const name=String(c.certificate_name||c.student_name||'').trim();
  const formation=String(c.program_name||'Formation professionnelle').trim();
  const lower=formation.toLowerCase();
  const defaultsForProgram=()=>{
    if(lower.includes('secourisme'))return 'Cette formation lui a permis d’acquérir les connaissances et les compétences nécessaires pour intervenir efficacement en situation d’urgence et contribuer à la sécurité et au bien-être de la communauté.';
    if(lower.includes('électricité')||lower.includes('electricite'))return 'Cette formation lui a permis d’acquérir les compétences nécessaires à l’installation, au raccordement, à l’entretien et au dépannage des installations électriques des bâtiments, dans le respect des normes et des règles de sécurité.';
    if(lower.includes('plomberie'))return 'Cette formation lui a permis de maîtriser l’installation, l’entretien et la réparation des réseaux d’alimentation en eau et d’évacuation, dans le respect des règles techniques et de sécurité.';
    if(lower.includes('aide-soignant')||lower.includes('aide soignant'))return 'Cette formation lui a permis d’acquérir les compétences nécessaires pour accompagner les patients dans les soins quotidiens, assurer leur confort et leur hygiène, et contribuer à leur bien-être dans le respect des règles professionnelles.';
    if(lower.includes('sérigraph')||lower.includes('serigraph'))return 'Cette formation lui a permis de maîtriser la préparation des supports, la création des visuels et les techniques d’impression en sérigraphie, ainsi que l’utilisation appropriée des outils et matériaux.';
    if(lower.includes('carrelage'))return 'Cette formation lui a permis de maîtriser la préparation des surfaces, la découpe, la pose et la finition des carreaux, en appliquant les techniques professionnelles et les règles de sécurité.';
    if(lower.includes('informatique')||lower.includes('bureautique'))return 'Cette formation lui a permis de maîtriser les outils informatiques et les logiciels bureautiques pour produire des documents, traiter des données, réaliser des présentations et effectuer des tâches administratives.';
    if(lower.includes('vidéo')||lower.includes('video')||lower.includes('photograph'))return 'Cette formation lui a permis d’acquérir les techniques de prise de vue, de cadrage, d’éclairage, de prise de son et de montage afin de réaliser des photos et des productions audiovisuelles de qualité.';
    if(lower.includes('ongler'))return 'Cette formation lui a permis de maîtriser les techniques de soin, de préparation, d’embellissement et de décoration des ongles, en respectant les règles d’hygiène, de désinfection et de sécurité.';
    if(lower.includes('cosmét')||lower.includes('cosmet')||lower.includes('make-up')||lower.includes('maquillage'))return 'Cette formation lui a permis de maîtriser les techniques de soins esthétiques et de maquillage, le choix des produits et leur application adaptée, dans le respect de l’hygiène et des besoins de la clientèle.';
    if(lower.includes('dread')||lower.includes('locks')||lower.includes('coiff'))return 'Cette formation lui a permis d’acquérir les techniques professionnelles de préparation, de création, d’entretien et de finition des coiffures, notamment les dreadlocks, en respectant l’hygiène et la santé capillaire.';
    if(lower.includes('formation continue'))return 'Cette formation lui a permis de renforcer et d’actualiser ses connaissances et ses compétences professionnelles, et de les mettre en pratique conformément aux objectifs pédagogiques du CETEP.';
    return `Cette formation lui a permis d’acquérir les connaissances théoriques et les compétences pratiques nécessaires dans le domaine de ${formation}, conformément aux objectifs pédagogiques du CETEP.`;
  };
  const intro=String(c.certificate_program_intro||defaultsForProgram()).trim();
  const extra=String(c.certificate_program_extra_text||c.certificate_extra_text||'').trim();
  const fmt=value=>{if(!value)return 'Non renseignée';const raw=String(value).slice(0,10);const m=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(m)return `${m[3]}/${m[2]}/${m[1]}`;const d=new Date(value);return Number.isNaN(d.getTime())?'Non renseignée':d.toLocaleDateString('fr-FR');};
  const parse=value=>{if(!value)return null;const raw=String(value).slice(0,10);const m=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(m)return new Date(Number(m[1]),Number(m[2])-1,Number(m[3]));const d=new Date(value);return Number.isNaN(d.getTime())?null:d;};
  const start=parse(c.start_date||c.enrolled_at);let finish=parse(c.end_date);
  if(!finish&&start){
    const durationText=String(c.duration||'').toLowerCase();
    const amount=durationText.match(/(\d+)/);
    if(amount){
      const n=Number(amount[1]);finish=new Date(start);
      if(/an|année|annee|year/.test(durationText))finish.setFullYear(finish.getFullYear()+n);
      else if(/semaine|week/.test(durationText))finish.setDate(finish.getDate()+7*n);
      else if(/jour|day/.test(durationText))finish.setDate(finish.getDate()+n);
      else if(/mois|month/.test(durationText))finish.setMonth(finish.getMonth()+n);
      else finish=null;
    }
  }
  const issued=fmt(c.issued_at);
  const city=String(c.certificate_city||'Carrefour');

  // Le fond v15.2 reprend le modèle CETEP vierge approuvé; les champs variables sont imprimés une seule fois.
  // Chaque champ ci-dessous est donc imprimé une seule fois.
  // Ajustement approuvé par la direction : nom et formation légèrement plus bas,
  // avec une typographie plus grande. Aucun autre élément du certificat n'est déplacé.
  const nameSize=Math.max(29,safeSize(c.certificate_name_size,29,14,30));
  const programSize=Math.max(25,safeSize(c.certificate_program_size,25,14,26));
  doc.fillColor('#101b45').font('Times-Bold').fontSize(nameSize)
    .text(name,221,316,{width:400,height:38,align:'center',lineBreak:false,ellipsis:true});

  // La phrase « a suivi avec succès la formation en » est déjà présente
  // dans le modèle approuvé d'origine. Ne pas la redessiner ici : cela
  // provoquerait un doublon. Seuls le nom et le nom de la formation varient.

  doc.fillColor('#101b45').font('Times-Bold').fontSize(programSize)
    .text(formation,221,379,{width:400,height:30,align:'center',lineBreak:false,ellipsis:true});

  const paragraphX=183, paragraphY=404, paragraphW=485, paragraphMaxH=45;
  const description=[intro,extra].filter(Boolean).join('\n');
  let descriptionFont=safeSize(c.certificate_other_size,10.2,8,11.5);
  doc.font('Times-Roman').fontSize(descriptionFont);
  let descriptionHeight=doc.heightOfString(description,{width:paragraphW,align:'center',lineGap:0.6});
  while(descriptionHeight>paragraphMaxH && descriptionFont>8){
    descriptionFont=Math.max(8,descriptionFont-0.25);
    doc.font('Times-Roman').fontSize(descriptionFont);
    descriptionHeight=doc.heightOfString(description,{width:paragraphW,align:'center',lineGap:0.6});
  }
  let descriptionToDraw=description;
  if(descriptionHeight>paragraphMaxH){
    let lo=0,hi=description.length;
    while(lo<hi){
      const mid=Math.ceil((lo+hi)/2);
      const candidate=description.slice(0,mid).trimEnd()+'…';
      if(doc.heightOfString(candidate,{width:paragraphW,align:'center',lineGap:0.6})<=paragraphMaxH)lo=mid;else hi=mid-1;
    }
    descriptionToDraw=description.slice(0,Math.max(1,lo)).trimEnd()+'…';
  }
  doc.fillColor('#101b45').font('Times-Roman').fontSize(descriptionFont)
    .text(descriptionToDraw,paragraphX,paragraphY,{width:paragraphW,height:paragraphMaxH,align:'center',lineGap:0.6,ellipsis:true});

  // Les libellés sont déjà imprimés sur le modèle; seules les valeurs sont ajoutées ici.
  // Valeurs des trois indicateurs : les libellés sont déjà imprimés dans le fond.
  // Les valeurs sont placées sur une ligne distincte SOUS les libellés (et non dessus).
  const weeklyHours=String(c.certificate_weekly_hours||'4 heures par semaine').trim();
  const duration=String(c.duration||'Durée à préciser').trim();
  const periodValue=(start&&finish)?`${fmt(start)} – ${fmt(finish)}`:(start?`${fmt(start)} – fin à confirmer`:'Dates à confirmer');
  const metricY=474;
  doc.fillColor('#101b45').font('Times-Bold').fontSize(9.8)
    .text(weeklyHours,178,metricY,{width:150,height:17,align:'center',lineBreak:false,ellipsis:true});
  doc.fillColor('#101b45').font('Times-Bold').fontSize(9.8)
    .text(duration,338,metricY,{width:130,height:17,align:'center',lineBreak:false,ellipsis:true});
  doc.fillColor('#101b45').font('Times-Bold').fontSize(8.8)
    .text(periodValue,490,metricY,{width:245,height:17,align:'center',lineBreak:false,ellipsis:true});
  doc.fillColor('#101b45').font('Times-Roman').fontSize(10.4)
    .text(`Fait à ${city}, le ${issued}`,315,492,{width:230,height:17,align:'center',lineBreak:false,ellipsis:true});

  // QR code individuel: il remplace le QR statique retiré du fond.
  const base=(process.env.PUBLIC_BASE_URL||`${req.protocol}://${req.get('host')}`).replace(/\/$/,'');
  const verifyUrl=`${base}/certificat/${encodeURIComponent(c.certificate_no)}`;
  const qr=await QRCode.toBuffer(verifyUrl,{type:'png',errorCorrectionLevel:'H',margin:1,width:240,color:{dark:'#000000',light:'#ffffff'}});
  doc.image(qr,713,42,{width:74,height:74});
  doc.fillColor('#111').font('Helvetica-Bold').fontSize(6.8)
    .text(String(c.certificate_no),710,118,{width:80,align:'center',lineBreak:false,ellipsis:true});
  doc.end();
}

app.post('/api/student/progress',auth,role('student'),(req,res)=>{const lessonId=Number(req.body.lesson_id);const lesson=db.prepare('SELECT m.program_id FROM lessons l JOIN modules m ON m.id=l.module_id WHERE l.id=? AND l.active=1 AND m.active=1').get(lessonId);if(!lesson)return res.status(404).json({error:'Leçon introuvable'});let progressAuthorized=!!db.prepare("SELECT 1 FROM enrollments WHERE student_id=? AND program_id=? AND status='Actif' AND access_enabled=1").get(req.user.id,lesson.program_id);if(!progressAuthorized){const course=db.prepare("SELECT id FROM programs WHERE id=? AND (lower(name) LIKE '%english%casas%' OR lower(name) LIKE '%english%casas%')").get(lesson.program_id);if(course)progressAuthorized=!!db.prepare("SELECT 1 FROM enrollments e JOIN programs p ON p.id=e.program_id WHERE e.student_id=? AND e.status='Actif' AND e.access_enabled=1 AND lower(p.name) LIKE '%anglais%'").get(req.user.id);}if(!progressAuthorized)return res.status(403).json({error:'Accès non autorisé à cette formation'});db.prepare('INSERT INTO lesson_progress(student_id,lesson_id,completed,completed_at) VALUES(?,?,1,CURRENT_TIMESTAMP) ON CONFLICT(student_id,lesson_id) DO UPDATE SET completed=1,completed_at=CURRENT_TIMESTAMP').run(req.user.id,lessonId);res.json({ok:true,certificate:autoCertificateForStudent(req.user.id,lesson.program_id)});});
app.use((req,res)=>{if(req.path.startsWith('/api/'))return res.status(404).json({error:'Route API introuvable',path:req.path});res.status(404).send('Page introuvable');});
app.use((err,req,res,next)=>{console.error('CETEP ERROR',err);if(res.headersSent)return next(err);res.status(500).json({error:'Erreur interne du serveur'});});
// SQLite remains the application query engine for compatibility, while Neon stores
// an atomic JSONB snapshot. This is a persistence bridge, not a native PostgreSQL migration.
function localTableNames(){
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name);
}
let neonWriteQueue=Promise.resolve();
async function saveNeonSnapshot(){
  const tables={};
  // SQLite calls are synchronous; this read loop cannot be interleaved by another JS request.
  for(const name of localTableNames()){
    const safe=name.replace(/"/g,'""');
    tables[name]=db.prepare(`SELECT * FROM "${safe}"`).all();
  }
  const snapshot={format:'cetep-snapshot-v1',version:APP_VERSION,created_at:new Date().toISOString(),tables};
  const packed={format:'cetep-snapshot-gzip-v1',version:APP_VERSION,created_at:snapshot.created_at,data:zlib.gzipSync(Buffer.from(JSON.stringify(snapshot))).toString('base64')};
  const serialized=JSON.stringify(packed);
  // Avoid accidental oversized HTTP requests; do not report a successful write if too large.
  const bytes=Buffer.byteLength(serialized,'utf8');
  if(bytes>8*1024*1024)throw new Error(`Snapshot compressé de ${bytes} octets; limite de sécurité 8 MiB dépassée.`);
  await neonSql`INSERT INTO cetep_persistent_snapshot (snapshot_id,payload,updated_at) VALUES (1,${serialized}::jsonb,NOW()) ON CONFLICT (snapshot_id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=NOW()`;
}
flushNeonSnapshot=async()=>{
  const job=neonWriteQueue.then(()=>saveNeonSnapshot());
  neonWriteQueue=job.catch(()=>{});
  return job;
};
async function restoreNeonSnapshot(snapshot){
  if(snapshot&&snapshot.format==='cetep-snapshot-gzip-v1'&&typeof snapshot.data==='string'){
    try{snapshot=JSON.parse(zlib.gunzipSync(Buffer.from(snapshot.data,'base64')).toString('utf8'));}
    catch{throw new Error('Snapshot Neon compressé illisible; données locales conservées.');}
  }
  if(!snapshot||snapshot.format!=='cetep-snapshot-v1'||!snapshot.tables||typeof snapshot.tables!=='object')throw new Error('Snapshot Neon invalide; données locales conservées.');
    const localNames = localTableNames();
  const known = new Set(localNames);

  // Migration additive: accepter les anciennes sauvegardes Neon
  // sans supprimer les données existantes.
  const backwardCompatibleTables = [
    'academic_terms',
    'academic_subjects',
    'academic_grades',
    'secretariat_audit',
    'certificate_program_texts',
    'student_document_permissions',
    'student_document_audit',
    'student_notifications',
    'communication_audit',
    'role_permissions',
    // Added in v15.5: older Neon snapshots predate the Direction module.
    // Preserve the locally initialized rows when these additive tables are absent.
    'direction_audit',
    'direction_recommendations',
    'expenses',
    'expense_audit',
    // Added in v15.5.3: preserve locally initialized student policy tables
    // when restoring an older Neon snapshot that predates the student rules.
    'student_policy',
    'student_policy_acceptances'
  ];

  for (const name of backwardCompatibleTables) {
    if (known.has(name) && !Array.isArray(snapshot.tables[name])) {
      const safe = name.replace(/"/g, '""');
      snapshot.tables[name] = db.prepare(`SELECT * FROM "${safe}"`).all();
      console.log(`[CETEP] Migration automatique : table ${name} absente du snapshot; ${snapshot.tables[name].length} ligne(s) locale(s) conservée(s).`);
    }
  }

  // Vérifier que les tables essentielles sont présentes.
  const isLegacy = snapshot.version === 'legacy-mirror';
    const missing=localNames.filter(name=>!Array.isArray(snapshot.tables[name]));
    const unknown=Object.keys(snapshot.tables).filter(name=>!known.has(name));
    if(missing.length)throw new Error(`Snapshot Neon incomplet: tables absentes (${missing.join(', ')}); données locales conservées.`);
    if(unknown.length)throw new Error(`Snapshot Neon contient des tables inconnues (${unknown.join(', ')}); mise à jour de schéma requise, données locales conservées.`);

  const tables=Object.entries(snapshot.tables).filter(([name,rows])=>known.has(name)&&Array.isArray(rows));
  const localBackup=path.join(DATA_DIR,'cetep-before-neon-restore.sqlite');
  // Preserve a local recovery copy before replacing anything with remote state.
  await db.backup(localBackup);
  const oldFk=db.pragma('foreign_keys',{simple:true});
  db.pragma('foreign_keys=OFF');
  try{
    const tx=db.transaction(()=>{
      for(const [name] of tables){const safe=name.replace(/"/g,'""');db.prepare(`DELETE FROM "${safe}"`).run();}
      for(const [name,rows] of tables){
        if(!rows.length)continue;
        const safe=name.replace(/"/g,'""');
        const cols=db.prepare(`PRAGMA table_info("${safe}")`).all().map(c=>c.name);
        for(const row of rows){
          const keys=Object.keys(row).filter(k=>cols.includes(k));
          if(!keys.length)continue;
          const quoted=keys.map(k=>'"'+k.replace(/"/g,'""')+'"').join(',');
          const marks=keys.map(()=>'?').join(',');
          db.prepare(`INSERT INTO "${safe}" (${quoted}) VALUES (${marks})`).run(...keys.map(k=>row[k]===undefined?null:row[k]));
        }
      }
      if(isLegacy){
        db.prepare("INSERT OR IGNORE INTO enrollments(student_id,program_id,status,access_enabled) SELECT id,program_id,CASE WHEN status='Actif' THEN 'Actif' ELSE COALESCE(status,'En attente') END,CASE WHEN access_enabled=1 THEN 1 ELSE 0 END FROM students WHERE program_id IS NOT NULL").run();
        db.prepare("UPDATE payments SET program_id=(SELECT program_id FROM students WHERE students.id=payments.student_id) WHERE program_id IS NULL").run();
      }
      // Validate inside the transaction so a bad snapshot rolls back completely.
      const violations=db.pragma('foreign_key_check');
      if(violations.length)throw new Error(`La restauration Neon présente ${violations.length} violation(s) de relations.`);
    });
    tx();
  }catch(error){
    console.error('[CETEP] Neon restore failed and rolled back; local pre-restore backup:',localBackup);
    throw error;
  }finally{db.pragma(`foreign_keys=${oldFk?'ON':'OFF'}`);}
  console.log('[CETEP] Snapshot Neon restauré. Copie locale pré-restauration:',localBackup);
  return tables.length;
}
function installNeonWriteTracking(){
  const originalPrepare=db.prepare.bind(db);
  db.prepare=function(sqlText){
    const statement=originalPrepare(sqlText);
    const text=String(sqlText);
    const match=text.match(/^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM)\s+["'`]?([A-Za-z_][A-Za-z0-9_]*)/i);
    if(!match)return statement;
    return new Proxy(statement,{get(target,property){
      if(property==='run')return(...args)=>{const result=target.run(...args);const context=writeContext.getStore();if(context)context.dirty=true;return result;};
      const value=Reflect.get(target,property,target);return typeof value==='function'?value.bind(target):value;
    }});
  };
}
async function startCETEP(){
  if(IS_PRODUCTION&&!neonSql)throw new Error('DATABASE_URL manquant: configurez la connexion Neon dans Render avant de démarrer CETEP en production.');
  if(neonSql){
    await neonSql`CREATE TABLE IF NOT EXISTS cetep_persistent_snapshot (snapshot_id INTEGER PRIMARY KEY,payload JSONB NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
    const remote=await neonSql`SELECT payload FROM cetep_persistent_snapshot WHERE snapshot_id=1`;
    if(remote.length){
      let snapshot=remote[0].payload;if(typeof snapshot==='string')snapshot=JSON.parse(snapshot);
      await restoreNeonSnapshot(snapshot);
    }else{
      // Backward-compatible migration from the previous per-table JSONB mirror, if present.
      await neonSql`CREATE TABLE IF NOT EXISTS cetep_persistent_tables (table_name TEXT PRIMARY KEY,rows JSONB NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
      const legacy=await neonSql`SELECT table_name,rows FROM cetep_persistent_tables`;
      if(legacy.length){
        const tables={};
        for(const item of legacy){let rows=item.rows;if(typeof rows==='string')rows=JSON.parse(rows);if(Array.isArray(rows))tables[item.table_name]=rows;}
        await restoreNeonSnapshot({format:'cetep-snapshot-v1',version:'legacy-mirror',tables});
        await saveNeonSnapshot();
        console.log('[CETEP] Ancien miroir Neon migré vers un snapshot atomique.');
      }else{
        // First start only: seed Neon from the existing local database, never overwrite a remote snapshot.
        await saveNeonSnapshot();
        console.log('[CETEP] Premiers enregistrements CETEP copiés dans Neon.');
      }
    }
    console.log('[CETEP] Persistance Neon restaurée; migrations applicatives en attente.');
  }else{
    console.warn('[CETEP] DATABASE_URL absent: mode local uniquement, non recommandé en production.');
  }
  // Ordre impératif: restaurer Neon, migrer le catalogue, sauvegarder, puis ouvrir HTTP.
  const catalogMigration=applyCatalogMigrations();
  const casasMigration=applyCasasCourseMigration();
  const anglaisVideoMigration=applyAnglaisVideoCourseMigration();
  const englishLevelAMigration=applyEnglishLevelAMigration();
  const english200Migration=applyEnglish200CourseMigration();
  if(neonSql && (catalogMigration.applied || casasMigration.applied || anglaisVideoMigration.applied || englishLevelAMigration.applied || english200Migration.applied)){
    await flushNeonSnapshot();
    console.log('[CETEP CATALOGUE] Nouvelle structure et tarifs sauvegardés dans Neon.');
  }
  if(neonSql){
    installNeonWriteTracking();
    console.log('[CETEP] Persistance Neon activée.');
  }
  // Critical order: restore Neon first, then apply admin bootstrap/reset, then persist it.
  const adminChanged=synchronizeAdminAccount();
  if(neonSql && adminChanged){
    await flushNeonSnapshot();
    console.log('[CETEP ADMIN] Admin account changes persisted to Neon snapshot.');
  }
  app.listen(PORT,'0.0.0.0',()=>console.log(`CETEP v${APP_VERSION} running on ${PORT}`));
}
startCETEP().catch(error=>{console.error('[CETEP STARTUP FAILED]',error);process.exit(1)});
