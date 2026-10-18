require('dotenv').config();
const crypto=require('crypto');const zlib=require('zlib');const express=require('express');const PDFDocument=require('pdfkit');const QRCode=require('qrcode');const cookieParser=require('cookie-parser');const bcrypt=require('bcryptjs');const jwt=require('jsonwebtoken');const Database=require('better-sqlite3');const path=require('path');const fs=require('fs');const nodemailer=require('nodemailer');
const app=express();const APP_VERSION='14.6.8-consolidated-staging';const PORT=process.env.PORT||10000;const DATA_DIR=process.env.DATA_DIR||path.join(__dirname,'data');fs.mkdirSync(DATA_DIR,{recursive:true});
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
CREATE TABLE IF NOT EXISTS programs(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,duration TEXT,description TEXT,price_htg REAL DEFAULT 0,active INTEGER DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS students(id INTEGER PRIMARY KEY AUTOINCREMENT,student_no TEXT UNIQUE NOT NULL,name TEXT NOT NULL,birth_date TEXT,birth_place TEXT,phone TEXT,email TEXT,program_id INTEGER,education TEXT,blood_group TEXT,responsible_person TEXT,marital_status TEXT,status TEXT DEFAULT 'En attente',password_hash TEXT,access_enabled INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(program_id) REFERENCES programs(id) ON DELETE SET NULL);
CREATE TABLE IF NOT EXISTS teachers(id INTEGER PRIMARY KEY AUTOINCREMENT,teacher_no TEXT UNIQUE NOT NULL,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,phone TEXT,password_hash TEXT NOT NULL,active INTEGER DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS program_teachers(program_id INTEGER NOT NULL,teacher_id INTEGER NOT NULL,PRIMARY KEY(program_id,teacher_id),FOREIGN KEY(program_id) REFERENCES programs(id) ON DELETE CASCADE,FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS enrollments(id INTEGER PRIMARY KEY AUTOINCREMENT,student_id INTEGER NOT NULL,program_id INTEGER NOT NULL,status TEXT DEFAULT 'Actif',enrolled_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(student_id,program_id),FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,FOREIGN KEY(program_id) REFERENCES programs(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS modules(id INTEGER PRIMARY KEY AUTOINCREMENT,program_id INTEGER NOT NULL,title TEXT NOT NULL,description TEXT,order_no INTEGER DEFAULT 1,active INTEGER DEFAULT 1,FOREIGN KEY(program_id) REFERENCES programs(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS lessons(id INTEGER PRIMARY KEY AUTOINCREMENT,module_id INTEGER NOT NULL,title TEXT NOT NULL,type TEXT DEFAULT 'Texte',content TEXT,video_url TEXT,file_url TEXT,order_no INTEGER DEFAULT 1,active INTEGER DEFAULT 1,FOREIGN KEY(module_id) REFERENCES modules(id) ON DELETE CASCADE);
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
CREATE TABLE IF NOT EXISTS gallery(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT NOT NULL,
  sort_order INTEGER DEFAULT 1,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);
// Safe schema upgrades for existing CETEP databases.
function ensureColumn(table,column,definition){
  const cols=db.prepare(`PRAGMA table_info(${table})`).all().map(x=>x.name);
  if(!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
ensureColumn('lessons','meeting_url','TEXT');
ensureColumn('lessons','scheduled_at','TEXT');
ensureColumn('lessons','duration_minutes','INTEGER DEFAULT 60');
ensureColumn('students','certificate_name','TEXT');
ensureColumn('students','nif','TEXT');
ensureColumn('students','cin','TEXT');
function normalizeIdentity(v){return String(v||'').trim().toUpperCase().replace(/[\s\-\.\/]/g,'');}
function generateTemporaryPassword(){return crypto.randomBytes(12).toString('base64url');}
function passwordIsStrong(v){return typeof v==='string' && v.length>=12;}
// NIF/CIN are unique identity keys for public admissions. Empty values are allowed only for legacy records.
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_students_nif_unique ON students(nif) WHERE nif IS NOT NULL AND trim(nif)<>''; CREATE UNIQUE INDEX IF NOT EXISTS idx_students_cin_unique ON students(cin) WHERE cin IS NOT NULL AND trim(cin)<>'';");
ensureColumn('payments','payment_message','TEXT');
ensureColumn('payments','payment_proof','TEXT');
ensureColumn('payments','program_id','INTEGER');
ensureColumn('enrollments','access_enabled','INTEGER DEFAULT 0');
ensureColumn('enrollments','manual_authorized','INTEGER DEFAULT 0');
// Preserve old single-program records when upgrading to multi-program enrollment.
db.prepare("INSERT OR IGNORE INTO enrollments(student_id,program_id,status,access_enabled) SELECT id,program_id,CASE WHEN status='Actif' THEN 'Actif' ELSE COALESCE(status,'En attente') END,CASE WHEN access_enabled=1 THEN 1 ELSE 0 END FROM students WHERE program_id IS NOT NULL").run();
db.prepare('UPDATE payments SET program_id=(SELECT program_id FROM students WHERE students.id=payments.student_id) WHERE program_id IS NULL').run();
db.prepare("UPDATE enrollments SET access_enabled=1 WHERE status='Actif' AND access_enabled=0").run();
// CETEP passing threshold: 70/100. Upgrade legacy results that still carry the old 60/100 default.
db.prepare("UPDATE final_results SET pass_mark=70, status=CASE WHEN score>=70 THEN 'Réussi' ELSE 'Échoué' END WHERE pass_mark=60").run();
const defaults={school_name:'CETEP',school_full_name:"Centre d'Encadrement Technique et Professionnel",slogan:'Formation • Orientation • Insertion professionnelle',address:'Lamentin 54, Ruelle Crispin #856',phone:'+509 3601 8696 / +509 3736 5610 / +1 561-674-2890',email:'cetepecoleprofessionnelle@gmail.com',primary_color:'#0d2b52',secondary_color:'#1677b8',accent_color:'#087443',logo_text:'CETEP',logo_url:'',typography_font_family:'Arial,Helvetica,sans-serif',typography_font_size:'16px',typography_bold:'0',typography_italic:'0',typography_line_height:'1.5'};
const set=db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)');for(const [k,v] of Object.entries(defaults))set.run(k,v);
// CETEP official contact defaults: fill blank values on existing installations without overwriting admin edits.
const currentSettings=Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(x=>[x.key,x.value]));
if(!String(currentSettings.phone||'').trim())db.prepare("UPDATE settings SET value=? WHERE key='phone'").run(defaults.phone);
if(!String(currentSettings.email||'').trim())db.prepare("UPDATE settings SET value=? WHERE key='email'").run(defaults.email);
// Admin bootstrap/recovery. Normal startup never overwrites an existing password.
// Set FORCE_ADMIN_RESET=true deliberately for one deployment to synchronize the
// admin matching ADMIN_EMAIL with ADMIN_PASSWORD. This does not delete any school data.
{
  const e=String(process.env.ADMIN_EMAIL||'').trim().toLowerCase();
  const p=String(process.env.ADMIN_PASSWORD||'');
  const reset=String(process.env.FORCE_ADMIN_RESET||'').trim().toLowerCase()==='true';
  const existing=e ? db.prepare('SELECT id FROM admins WHERE lower(email)=?').get(e) : null;
  if(reset){
    if(!e || !p || p.length<12) throw new Error('FORCE_ADMIN_RESET=true mande ADMIN_EMAIL ak ADMIN_PASSWORD ki gen omwen 12 karaktè.');
    const hash=bcrypt.hashSync(p,12);
    if(existing) db.prepare('UPDATE admins SET email=?,password_hash=? WHERE id=?').run(e,hash,existing.id);
    else db.prepare('INSERT INTO admins(email,password_hash) VALUES(?,?)').run(e,hash);
    console.warn('[CETEP ADMIN] Admin password reset applied for configured ADMIN_EMAIL. Set FORCE_ADMIN_RESET=false or remove it after successful recovery.');
  } else if(!db.prepare('SELECT 1 FROM admins LIMIT 1').get()){
    if(IS_PRODUCTION && (!e || !p || p.length<12)) throw new Error('Configuration CETEP invalide: ADMIN_EMAIL et ADMIN_PASSWORD (12 caractères minimum) sont requis pour créer le premier administrateur.');
    db.prepare('INSERT INTO admins(email,password_hash) VALUES(?,?)').run(e||'admin@cetep.local',bcrypt.hashSync(p||'local-only-password-change-me',12));
  }
}
// Catalogue de base CETEP : on conserve les formations existantes et on ajoute
// les formations officielles visibles sur le flyer. Cette logique n'écrase jamais
// une formation déjà enregistrée dans la base.
const basePrograms=[
  ['Secourisme de base','9 mois','Formation aux premiers secours et à la sécurité.'],
  ['Aide-soignant(e)','9 mois','Formation orientée vers les soins de base.'],
  ['Électricité bâtiment','6 mois','Installation et maintenance électrique.'],
  ['Plomberie','6 mois','Installation et entretien des réseaux de plomberie.'],
  ['Sérigraphie','3 mois','Techniques professionnelles de sérigraphie.'],
  ['Secourisme et Aide-soignant','9 mois','Parcours regroupant le secourisme et les soins de base, selon le catalogue promotionnel CETEP.'],
  ['Vidéographie et Photographie','4 mois','Formation pratique en vidéographie et photographie.'],
  ['Anglais, Espagnol','9 mois','Formation en langues anglaise et espagnole.'],
  ['Onglerie, Cosmétologie, Make-up','3 à 6 mois','Formation en beauté, onglerie, cosmétologie et maquillage.'],
  ['Décoration événementielle, Résine','3 à 6 mois','Formation en décoration événementielle et techniques de résine.'],
  ['Carrelage, Plomberie, Électricité','4 à 6 mois','Parcours pratique dans les métiers du bâtiment.'],
  ['Informatique bureautique','1 an','Formation en informatique et outils bureautiques.'],
  ['Dread Locks','2 mois','Formation pratique en dread locks et coiffure spécialisée.']
];
const insertProgram=db.prepare('INSERT INTO programs(name,duration,description,price_htg) VALUES(?,?,?,?)');
for(const [name,duration,description] of basePrograms){
  if(!db.prepare('SELECT 1 FROM programs WHERE name=? LIMIT 1').get(name)){
    insertProgram.run(name,duration,description,0);
  }
}
// Migration unique: l'ancienne version indiquait 6 mois pour l'informatique bureautique.
// On corrige une seule fois les anciennes installations, puis l'administrateur reste libre
// de modifier cette durée depuis le bouton Modifier dans Formations.
if(!db.prepare("SELECT 1 FROM settings WHERE key='informatique_duration_v1_migrated'").get()){
  db.prepare("UPDATE programs SET duration='1 an' WHERE name='Informatique bureautique' AND (duration IS NULL OR TRIM(duration)='' OR duration='6 mois')").run();
  db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('informatique_duration_v1_migrated','1')").run();
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
function sign(p){return jwt.sign(p,SECRET,{expiresIn:'12h'});}function auth(req,res,next){try{const t=req.cookies.cetep_token;if(!t)throw 0;req.user=jwt.verify(t,SECRET);next();}catch{res.status(401).json({error:'Non autorisé'});}}
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
  return {total,done,percent:total?Math.round(done*100/total):100};
}
function paymentStats(studentId,programId){
  const due=Number(db.prepare('SELECT COALESCE(price_htg,0) price_htg FROM programs WHERE id=?').get(programId)?.price_htg||0);
  const paid=Number(db.prepare("SELECT COALESCE(SUM(amount_htg),0) paid FROM payments WHERE student_id=? AND program_id=? AND status='Confirmé'").get(studentId,programId)?.paid||0);
  return {due,paid,fullyPaid:due<=0||paid>=due};
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
app.get('/api/version',(req,res)=>res.json({version:APP_VERSION,certificate_model:'certificat-cetep-2026-clean-template.png',certificate_model_version:'14.4.9-exact-template',homepage_promotions:true}));app.get('/certificat-modele-2026.png',(req,res)=>{const model=path.join(__dirname,'public','certificat-cetep-2026-clean-template.png');if(!fs.existsSync(model))return res.status(404).send('Modèle officiel introuvable');res.set({'Content-Type':'image/png','Cache-Control':'no-store, no-cache, must-revalidate, max-age=0','X-CETEP-Certificate-Model':'14.4.8-official-exact-template'});res.sendFile(model);});app.get('/',(req,res)=>{res.set('Cache-Control','no-store');sendPage(res,'index.html');});app.get('/informations',(req,res)=>sendPage(res,'informations.html'));app.get('/login',(req,res)=>sendPage(res,'login.html'));app.get('/admin',(req,res)=>sendPage(res,'admin.html'));app.get('/local',(req,res)=>sendPage(res,'local.html'));app.get('/administration',(req,res)=>res.redirect('/admin'));app.get('/teacher',(req,res)=>sendPage(res,'teacher.html'));app.get('/professeur',(req,res)=>res.redirect('/teacher'));app.get('/student',(req,res)=>sendPage(res,'student.html'));app.get('/etudiant',(req,res)=>res.redirect('/student'));app.get('/undefined',(req,res)=>res.redirect('/'));
function adminLogin(req,res){const a=db.prepare('SELECT * FROM admins WHERE email=?').get((req.body.email||'').trim().toLowerCase());if(!a||!bcrypt.compareSync(req.body.password||'',a.password_hash))return res.status(401).json({error:'Identifiants invalides'});res.cookie('cetep_token',sign({id:a.id,email:a.email,role:'admin'}),{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:43200000});res.json({ok:true,redirect:'/admin'});}
app.post('/api/login',adminLogin);app.post('/api/login/admin',adminLogin);
function teacherLogin(req,res){const t=db.prepare('SELECT * FROM teachers WHERE email=?').get((req.body.email||'').trim().toLowerCase());if(!t||!t.active||!bcrypt.compareSync(req.body.password||'',t.password_hash))return res.status(401).json({error:'Identifiants professeur invalides'});res.cookie('cetep_token',sign({id:t.id,teacher_no:t.teacher_no,role:'teacher'}),{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:43200000});res.json({ok:true,redirect:'/teacher'});}
app.post('/api/teacher/login',teacherLogin);app.post('/api/login/teacher',teacherLogin);
function studentLogin(req,res){const s=db.prepare('SELECT * FROM students WHERE student_no=?').get((req.body.code||req.body.student_no||'').trim().toUpperCase());if(!s||Number(s.access_enabled)!==1||!s.password_hash||!db.prepare("SELECT 1 FROM enrollments WHERE student_id=? AND access_enabled=1 AND status='Actif' LIMIT 1").get(s.id)||!bcrypt.compareSync(req.body.password||'',s.password_hash))return res.status(401).json({error:'Code étudiant, mot de passe ou accès invalide'});res.cookie('cetep_token',sign({id:s.id,student_no:s.student_no,role:'student'}),{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:43200000});res.json({ok:true,redirect:'/student'});}
app.post('/api/student/login',studentLogin);app.post('/api/login/student',studentLogin);
app.post('/api/logout',(req,res)=>{res.clearCookie('cetep_token');res.json({ok:true});});app.get('/api/session',auth,(req,res)=>res.json({user:req.user}));
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
app.get('/api/admin/settings',auth,role('admin'),(req,res)=>res.json(settings()));app.put('/api/admin/settings',auth,role('admin'),(req,res)=>{const q=db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');for(const k of Object.keys(defaults))if(req.body[k]!==undefined)q.run(k,String(req.body[k]));res.json({ok:true,settings:settings()});});app.post('/api/admin/logo/reset',auth,role('admin'),(req,res)=>{db.prepare("UPDATE settings SET value='' WHERE key='logo_url'").run();res.json({ok:true});});
app.get('/api/admin/students',auth,role('admin'),(req,res)=>res.json(db.prepare('SELECT s.*,p.name program_name FROM students s LEFT JOIN programs p ON p.id=s.program_id ORDER BY s.id DESC').all()));
app.post('/api/admin/students',auth,role('admin'),(req,res)=>{try{const b=req.body;const nif=normalizeIdentity(b.nif),cin=normalizeIdentity(b.cin);if(!b.name||!b.phone||!b.program_id)return res.status(400).json({error:'Nom, téléphone et formation obligatoires'});if(!nif&&!cin)return res.status(400).json({error:'NIF ou CIN obligatoire pour identifier l’étudiant.'});if(nif&&db.prepare('SELECT id FROM students WHERE nif=? LIMIT 1').get(nif))return res.status(409).json({error:'Ce NIF existe déjà.'});if(cin&&db.prepare('SELECT id FROM students WHERE cin=? LIMIT 1').get(cin))return res.status(409).json({error:'Ce CIN existe déjà.'});const suppliedPassword=String(b.password||'');if(suppliedPassword&&!passwordIsStrong(suppliedPassword))return res.status(400).json({error:'Le mot de passe doit contenir au moins 12 caractères.'});const temporaryPassword=suppliedPassword?'':generateTemporaryPassword();const pw=suppliedPassword||temporaryPassword;const no=nextNo('CETEP','students','student_no');const r=db.prepare(`INSERT INTO students(student_no,name,birth_date,birth_place,phone,email,nif,cin,program_id,education,blood_group,responsible_person,marital_status,status,password_hash,access_enabled) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(no,b.name,b.birth_date||null,b.birth_place||null,b.phone,b.email||null,nif||null,cin||null,Number(b.program_id),b.education||null,b.blood_group||null,b.responsible_person||null,b.marital_status||null,b.status||'Actif',bcrypt.hashSync(pw,12),b.access_enabled===false?0:1);db.prepare('INSERT OR IGNORE INTO enrollments(student_id,program_id,status,access_enabled,manual_authorized) VALUES(?,?,?,?,?)').run(r.lastInsertRowid,Number(b.program_id),b.access_enabled===false?'En attente':'Actif',b.access_enabled===false?0:1,b.access_enabled===false?0:1);res.status(201).json({ok:true,id:r.lastInsertRowid,student_no:no,...(temporaryPassword?{temporary_password:temporaryPassword}:{})});}catch(e){if(String(e.message).includes('UNIQUE constraint failed: students.nif'))return res.status(409).json({error:'Ce NIF existe déjà.'});if(String(e.message).includes('UNIQUE constraint failed: students.cin'))return res.status(409).json({error:'Ce CIN existe déjà.'});res.status(400).json({error:e.message});}});
app.put('/api/admin/students/:id',auth,role('admin'),async (req,res)=>{const id=Number(req.params.id);const before=db.prepare('SELECT s.*,p.name program_name FROM students s LEFT JOIN programs p ON p.id=s.program_id WHERE s.id=?').get(id);if(!before)return res.status(404).json({error:'Étudiant introuvable'});const b=req.body;db.prepare(`UPDATE students SET name=?,birth_date=?,birth_place=?,phone=?,email=?,education=?,blood_group=?,responsible_person=?,marital_status=? WHERE id=?`).run(b.name??before.name,b.birth_date||null,b.birth_place||null,b.phone||null,b.email||null,b.education||null,b.blood_group||null,b.responsible_person||null,b.marital_status||null,id);res.json({ok:true,message:'Profil étudiant mis à jour. Les formations se gèrent séparément.'});});
app.post('/api/admin/students/:id/access',auth,role('admin'),async (req,res)=>{const s=db.prepare('SELECT * FROM students WHERE id=?').get(Number(req.params.id));if(!s)return res.status(404).json({error:'Étudiant introuvable'});const enabled=!!req.body.enabled;const suppliedPassword=String(req.body.password||'');if(enabled&&suppliedPassword&&!passwordIsStrong(suppliedPassword))return res.status(400).json({error:'Le mot de passe doit contenir au moins 12 caractères.'});if(enabled&&!db.prepare("SELECT 1 FROM enrollments WHERE student_id=? AND status='Actif' AND access_enabled=1 LIMIT 1").get(s.id))return res.status(409).json({error:'Autorisez d’abord au moins une formation dans « Gérer les formations ». L’accès global ne doit pas autoriser toutes les formations automatiquement.'});const temporaryPassword=enabled&&!suppliedPassword?generateTemporaryPassword():'';const newPassword=suppliedPassword||temporaryPassword;const hash=newPassword?bcrypt.hashSync(newPassword,12):s.password_hash;const tx=db.transaction(()=>{if(!enabled)db.prepare("UPDATE enrollments SET access_enabled=0,status='Suspendu' WHERE student_id=?").run(s.id);db.prepare('UPDATE students SET access_enabled=?,status=?,password_hash=? WHERE id=?').run(enabled?1:0,enabled?'Actif':'Suspendu',hash,s.id);});tx();res.json({ok:true,enabled,...(temporaryPassword?{temporary_password:temporaryPassword}:{})});});
app.get('/api/admin/students/:id/enrollments',auth,role('admin'),(req,res)=>res.json(db.prepare("SELECT e.*,p.name program_name,p.duration,p.price_htg,COALESCE((SELECT SUM(pay.amount_htg) FROM payments pay WHERE pay.student_id=e.student_id AND pay.program_id=e.program_id AND pay.status='Confirmé'),0) paid FROM enrollments e JOIN programs p ON p.id=e.program_id WHERE e.student_id=? ORDER BY e.enrolled_at DESC").all(Number(req.params.id))));
app.post('/api/admin/students/:id/enrollments',auth,role('admin'),(req,res)=>{const studentId=Number(req.params.id),programId=Number(req.body.program_id);if(!db.prepare('SELECT id FROM students WHERE id=?').get(studentId))return res.status(404).json({error:'Étudiant introuvable'});if(!db.prepare('SELECT id FROM programs WHERE id=?').get(programId))return res.status(400).json({error:'Formation introuvable'});try{db.prepare("INSERT INTO enrollments(student_id,program_id,status,access_enabled) VALUES(?,?,'En attente',0)").run(studentId,programId);res.status(201).json({ok:true,message:'Nouvelle inscription ajoutée en attente de validation.'});}catch(e){if(String(e.message).includes('UNIQUE constraint failed'))return res.status(409).json({error:'Cet étudiant est déjà inscrit à cette formation.'});res.status(400).json({error:e.message});}});
app.post('/api/admin/students/:id/enrollments/:programId/authorize',auth,role('admin'),(req,res)=>{const sid=Number(req.params.id),pid=Number(req.params.programId),enabled=!!req.body.enabled;const row=db.prepare('SELECT id FROM enrollments WHERE student_id=? AND program_id=?').get(sid,pid);if(!row)return res.status(404).json({error:'Inscription introuvable'});db.prepare('UPDATE enrollments SET status=?,access_enabled=?,manual_authorized=? WHERE student_id=? AND program_id=?').run(enabled?'Actif':'Suspendu',enabled?1:0,enabled?1:-1,sid,pid);const active=Number(db.prepare("SELECT COUNT(*) c FROM enrollments WHERE student_id=? AND status='Actif' AND access_enabled=1").get(sid).c||0);db.prepare('UPDATE students SET access_enabled=?,status=? WHERE id=?').run(active?1:0,active?'Actif':'En attente',sid);res.json({ok:true,enabled});});
app.get('/api/admin/teachers',auth,role('admin'),(req,res)=>res.json(db.prepare('SELECT id,teacher_no,name,email,phone,active FROM teachers ORDER BY id DESC').all()));app.post('/api/admin/teachers',auth,role('admin'),(req,res)=>{try{const b=req.body;if(!b.name||!b.email)return res.status(400).json({error:'Nom et email obligatoires'});const suppliedPassword=String(b.password||'');if(suppliedPassword&&!passwordIsStrong(suppliedPassword))return res.status(400).json({error:'Le mot de passe doit contenir au moins 12 caractères.'});const temporaryPassword=suppliedPassword?'':generateTemporaryPassword();const no=nextNo('PROF','teachers','teacher_no');const r=db.prepare('INSERT INTO teachers(teacher_no,name,email,phone,password_hash) VALUES(?,?,?,?,?)').run(no,b.name,b.email.toLowerCase(),b.phone||'',bcrypt.hashSync(suppliedPassword||temporaryPassword,12));res.json({ok:true,id:r.lastInsertRowid,teacher_no:no,...(temporaryPassword?{temporary_password:temporaryPassword}:{})});}catch(e){res.status(400).json({error:e.message});}});app.post('/api/admin/teachers/:id/status',auth,role('admin'),(req,res)=>{db.prepare('UPDATE teachers SET active=? WHERE id=?').run(req.body.active?1:0,req.params.id);res.json({ok:true});});
app.get('/api/admin/programs',auth,role('admin'),(req,res)=>res.json(db.prepare('SELECT * FROM programs ORDER BY id').all()));app.post('/api/admin/programs',auth,role('admin'),(req,res)=>{const b=req.body;const r=db.prepare('INSERT INTO programs(name,duration,description,price_htg,active) VALUES(?,?,?,?,?)').run(b.name,b.duration||'',b.description||'',Number(b.price_htg||0),b.active===false?0:1);res.json({ok:true,id:r.lastInsertRowid});});app.put('/api/admin/programs/:id',auth,role('admin'),(req,res)=>{const b=req.body;db.prepare('UPDATE programs SET name=?,duration=?,description=?,price_htg=?,active=? WHERE id=?').run(b.name,b.duration||'',b.description||'',Number(b.price_htg||0),b.active===false?0:1,req.params.id);res.json({ok:true});});app.delete('/api/admin/programs/:id',auth,role('admin'),(req,res)=>{db.prepare('DELETE FROM programs WHERE id=?').run(req.params.id);res.json({ok:true});});
app.get('/api/admin/modules',auth,role('admin'),(req,res)=>res.json(db.prepare('SELECT m.*,p.name program_name FROM modules m JOIN programs p ON p.id=m.program_id ORDER BY p.id,m.order_no,m.id').all()));app.post('/api/admin/modules',auth,role('admin'),(req,res)=>{const b=req.body;if(!b.program_id||!b.title)return res.status(400).json({error:'Formation et titre obligatoires'});const r=db.prepare('INSERT INTO modules(program_id,title,description,order_no) VALUES(?,?,?,?)').run(Number(b.program_id),b.title,b.description||'',Number(b.order_no||1));res.json({ok:true,id:r.lastInsertRowid});});app.get('/api/admin/lessons',auth,role('admin'),(req,res)=>res.json(db.prepare('SELECT l.*,m.title module_title,p.name program_name FROM lessons l JOIN modules m ON m.id=l.module_id JOIN programs p ON p.id=m.program_id ORDER BY p.id,m.order_no,l.order_no,l.id').all()));app.post('/api/admin/lessons',auth,role('admin'),(req,res)=>{const b=req.body;if(!b.module_id||!b.title)return res.status(400).json({error:'Module et titre obligatoires'});const r=db.prepare('INSERT INTO lessons(module_id,title,type,content,video_url,file_url,meeting_url,scheduled_at,duration_minutes,order_no) VALUES(?,?,?,?,?,?,?,?,?,?)').run(Number(b.module_id),b.title,b.type||'Texte',b.content||'',b.video_url||'',b.file_url||'',b.meeting_url||'',b.scheduled_at||null,Number(b.duration_minutes||60),Number(b.order_no||1));res.json({ok:true,id:r.lastInsertRowid});});
app.post('/api/admin/assign-teacher',auth,role('admin'),(req,res)=>{db.prepare('INSERT OR IGNORE INTO program_teachers(program_id,teacher_id) VALUES(?,?)').run(Number(req.body.program_id),Number(req.body.teacher_id));res.json({ok:true});});app.get('/api/admin/teacher-assignments',auth,role('admin'),(req,res)=>res.json(db.prepare('SELECT pt.*,t.name teacher_name,p.name program_name FROM program_teachers pt JOIN teachers t ON t.id=pt.teacher_id JOIN programs p ON p.id=pt.program_id').all()));
app.get('/api/admin/payments',auth,role('admin'),(req,res)=>res.json(db.prepare('SELECT p.*,s.name student_name,s.student_no,e.access_enabled program_access_enabled,pr.name program_name FROM payments p LEFT JOIN students s ON s.id=p.student_id LEFT JOIN programs pr ON pr.id=COALESCE(p.program_id,s.program_id) LEFT JOIN enrollments e ON e.student_id=p.student_id AND e.program_id=COALESCE(p.program_id,s.program_id) ORDER BY p.id DESC').all()));app.get('/api/admin/payments/:id/proof',auth,role('admin'),(req,res)=>{const p=db.prepare('SELECT payment_proof FROM payments WHERE id=?').get(Number(req.params.id));if(!p||!p.payment_proof)return res.status(404).send('Confirmation introuvable');const m=String(p.payment_proof).match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);if(!m)return res.status(415).send('Format de confirmation non pris en charge');res.setHeader('Content-Type',m[1]);res.setHeader('Cache-Control','private, max-age=60');res.send(Buffer.from(m[2],'base64'));});app.post('/api/admin/payments/:id/status',auth,role('admin'),async (req,res)=>{const status=['En attente','Confirmé','Refusé'].includes(req.body.status)?req.body.status:'En attente';const pay=db.prepare('SELECT student_id,program_id FROM payments WHERE id=?').get(Number(req.params.id));if(!pay)return res.status(404).json({error:'Paiement introuvable'});db.prepare('UPDATE payments SET status=? WHERE id=?').run(status,req.params.id);let access=false,confirmation=null,certificate=null;if(pay.student_id&&pay.program_id){access=refreshStudentCourseAccess(pay.student_id,pay.program_id);if(status==='Confirmé'){certificate=autoCertificateForStudent(pay.student_id,pay.program_id);if(access){const student=db.prepare('SELECT s.*,p.name program_name FROM students s LEFT JOIN programs p ON p.id=? WHERE s.id=?').get(pay.program_id,pay.student_id);confirmation=await sendStudentConfirmation(student,student.program_name);}}}res.json({ok:true,status,program_id:pay.program_id,course_access:access,certificate,confirmation});});app.post('/api/admin/payments',auth,role('admin'),(req,res)=>{const b=req.body,ref=b.reference||`PAY-${Date.now()}`;if(!Number.isFinite(Number(b.amount_htg))||Number(b.amount_htg)<=0)return res.status(400).json({error:'Le montant doit être strictement positif.'});const studentId=b.student_id?Number(b.student_id):null;const programId=Number(b.program_id||(studentId?db.prepare('SELECT program_id FROM students WHERE id=?').get(studentId)?.program_id:0))||null;const status=b.status||'Confirmé';if(studentId&&programId&&!db.prepare('SELECT 1 FROM enrollments WHERE student_id=? AND program_id=?').get(studentId,programId))return res.status(400).json({error:'Ajoutez d’abord cette formation au dossier étudiant.'});const r=db.prepare('INSERT INTO payments(student_id,program_id,amount_htg,method,status,reference) VALUES(?,?,?,?,?,?)').run(studentId,programId,Number(b.amount_htg||0),b.method||'Manuel',status,ref);const access=studentId&&programId&&status==='Confirmé'?refreshStudentCourseAccess(studentId,programId):false;const cert=studentId&&programId&&status!=='Refusé'?autoCertificateForStudent(studentId,programId):null;res.json({ok:true,id:r.lastInsertRowid,reference:ref,program_id:programId,course_access:access,certificate:cert});});
app.get('/api/admin/support',auth,role('admin'),(req,res)=>res.json(db.prepare('SELECT * FROM support_methods ORDER BY sort_order,id').all()));app.post('/api/admin/support',auth,role('admin'),(req,res)=>{const b=req.body;if(!b.name)return res.status(400).json({error:'Nom obligatoire'});const r=db.prepare('INSERT INTO support_methods(name,account_name,account_value,bank_name,bank_account,routing,instructions,active,sort_order) VALUES(?,?,?,?,?,?,?,?,?)').run(b.name,b.account_name||'',b.account_value||'',b.bank_name||'',b.bank_account||'',b.routing||'',b.instructions||'',b.active===false?0:1,Number(b.sort_order||99));res.json({ok:true,id:r.lastInsertRowid});});app.put('/api/admin/support/:id',auth,role('admin'),(req,res)=>{const b=req.body;db.prepare('UPDATE support_methods SET name=?,account_name=?,account_value=?,bank_name=?,bank_account=?,routing=?,instructions=?,active=?,sort_order=? WHERE id=?').run(b.name,b.account_name||'',b.account_value||'',b.bank_name||'',b.bank_account||'',b.routing||'',b.instructions||'',b.active===false?0:1,Number(b.sort_order||99),req.params.id);res.json({ok:true});});app.delete('/api/admin/support/:id',auth,role('admin'),(req,res)=>{db.prepare('DELETE FROM support_methods WHERE id=?').run(req.params.id);res.json({ok:true});});
app.get('/api/admin/donations',auth,role('admin'),(req,res)=>res.json(db.prepare('SELECT * FROM donations ORDER BY id DESC').all()));app.post('/api/admin/donations/:id/status',auth,role('admin'),(req,res)=>{db.prepare('UPDATE donations SET status=? WHERE id=?').run(req.body.status||'Confirmé',req.params.id);res.json({ok:true});});
app.get('/api/admin/gallery',auth,role('admin'),(req,res)=>res.json(db.prepare('SELECT * FROM gallery ORDER BY sort_order,id DESC').all()));app.post('/api/admin/gallery',auth,role('admin'),(req,res)=>{const b=req.body;if(!b.title||!b.image_url)return res.status(400).json({error:'Titre et photo obligatoires'});if(String(b.image_url).length>7000000)return res.status(400).json({error:'Photo trop grande. Maximum recommandé: 5 Mo.'});const r=db.prepare('INSERT INTO gallery(title,description,image_url,sort_order,active) VALUES(?,?,?,?,?)').run(b.title,b.description||'',b.image_url,Number(b.sort_order||99),b.active===false?0:1);res.json({ok:true,id:r.lastInsertRowid});});app.put('/api/admin/gallery/:id',auth,role('admin'),(req,res)=>{const b=req.body;db.prepare('UPDATE gallery SET title=?,description=?,image_url=?,sort_order=?,active=? WHERE id=?').run(b.title,b.description||'',b.image_url,b.sort_order||99,b.active===false?0:1,req.params.id);res.json({ok:true});});app.delete('/api/admin/gallery/:id',auth,role('admin'),(req,res)=>{db.prepare('DELETE FROM gallery WHERE id=?').run(req.params.id);res.json({ok:true});});
// CETEP Local ↔ Online snapshot: keeps a complete administrative copy on the local device.
app.get('/api/admin/local-snapshot',auth,role('admin'),(req,res)=>{
  const tables=['programs','students','teachers','program_teachers','enrollments','modules','lessons','lesson_progress','assignments','submissions','payments','support_methods','donations','settings','final_results','certificates','attendance','announcements','gallery'];
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

app.get('/api/admin/backup',auth,role('admin'),(req,res)=>{const tables=['admins','programs','students','teachers','program_teachers','enrollments','modules','lessons','lesson_progress','assignments','submissions','payments','support_methods','donations','settings','final_results','certificates','attendance','announcements','gallery'];const out={version:APP_VERSION,created_at:new Date().toISOString(),tables:{}};for(const t of tables)out.tables[t]=db.prepare(`SELECT * FROM ${t}`).all();res.setHeader('Content-Type','application/json');res.setHeader('Content-Disposition','attachment; filename="cetep-backup-v14.6.8.json"');res.send(JSON.stringify(out,null,2));});
app.post('/api/admin/restore',auth,role('admin'),(req,res)=>{try{const data=req.body;if(!data?.tables)throw new Error('Fichier de sauvegarde invalide');const tables=['programs','students','teachers','program_teachers','enrollments','modules','lessons','lesson_progress','assignments','submissions','payments','support_methods','donations','settings','final_results','certificates','attendance','announcements','gallery'];const tx=db.transaction(()=>{db.pragma('foreign_keys=OFF');for(const t of tables)db.prepare(`DELETE FROM ${t}`).run();for(const t of tables){const rows=data.tables[t]||[];for(const row of rows){const cols=Object.keys(row);const sql=`INSERT INTO ${t}(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`;db.prepare(sql).run(...cols.map(c=>row[c]));}}db.pragma('foreign_keys=ON');});tx();db.prepare("UPDATE payments SET program_id=(SELECT program_id FROM students WHERE students.id=payments.student_id) WHERE program_id IS NULL").run();db.prepare("INSERT OR IGNORE INTO enrollments(student_id,program_id,status,access_enabled) SELECT id,program_id,CASE WHEN status='Actif' THEN 'Actif' ELSE COALESCE(status,'En attente') END,CASE WHEN access_enabled=1 THEN 1 ELSE 0 END FROM students WHERE program_id IS NOT NULL").run();res.json({ok:true,message:'Sauvegarde restaurée.'});}catch(e){res.status(400).json({error:e.message});}});

// Certificates & academic results
app.get('/api/admin/certificates',auth,role('admin'),(req,res)=>{
  const rows=db.prepare(`SELECT s.id student_id,s.student_no,s.name student_name,e.program_id,p.name program_name,
    COALESCE(fr.score,0) score,COALESCE(fr.pass_mark,70) pass_mark,COALESCE(fr.status,'En attente') result_status,
    c.id certificate_id,c.certificate_no,c.issued_at,
    (SELECT COALESCE(SUM(amount_htg),0) FROM payments WHERE student_id=s.id AND program_id=e.program_id AND status='Confirmé') paid,
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
app.post('/api/admin/certificates/:studentId/issue',auth,role('admin'),(req,res)=>{const sid=Number(req.params.studentId),s=db.prepare('SELECT id,program_id FROM students WHERE id=?').get(sid);if(!s)return res.status(404).json({error:'Étudiant introuvable'});const pid=Number(req.body.program_id||s.program_id||0);if(!pid||!db.prepare('SELECT 1 FROM enrollments WHERE student_id=? AND program_id=?').get(sid,pid))return res.status(400).json({error:'Choisissez une formation inscrite au dossier étudiant.'});const cert=tryAutoIssueCertificate(sid,pid);if(!cert)return res.status(409).json({error:'Le certificat n’est pas encore éligible: réussite, 100% des leçons et frais confirmés sont requis.'});res.json({ok:true,certificate:cert});});
app.get('/api/admin/certificates/:id/pdf',auth,role('admin'),(req,res)=>sendCertificatePdf(req,res,Number(req.params.id),true));
app.get('/api/student/certificate',auth,role('student'),(req,res)=>{const sid=Number(req.user.id),legacy=db.prepare('SELECT program_id FROM students WHERE id=?').get(sid);const pid=Number(req.query.program_id||legacy?.program_id||0);if(!pid||!db.prepare('SELECT 1 FROM enrollments WHERE student_id=? AND program_id=?').get(sid,pid))return res.status(404).json({eligible:false,message:'Cette formation ne figure pas dans votre dossier.'});const cert=tryAutoIssueCertificate(sid,pid);if(!cert)return res.status(404).json({eligible:false,message:'Votre certificat sera disponible après réussite, 100% des leçons et paiement complet des frais.'});res.json({eligible:true,certificate:cert,download:'/api/student/certificate.pdf?program_id='+pid});});
app.get('/api/student/certificate.pdf',auth,role('student'),(req,res)=>{const sid=Number(req.user.id),legacy=db.prepare('SELECT program_id FROM students WHERE id=?').get(sid);const pid=Number(req.query.program_id||legacy?.program_id||0);if(!pid||!db.prepare('SELECT 1 FROM enrollments WHERE student_id=? AND program_id=?').get(sid,pid))return res.status(403).send('Formation non autorisée');const cert=tryAutoIssueCertificate(sid,pid);if(!cert)return res.status(404).send('Certificat non disponible');sendCertificatePdf(req,res,cert.id,false);});
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
  const c=db.prepare(`SELECT c.*,s.name student_name,COALESCE(s.certificate_name,s.name) certificate_name,p.name program_name,
    p.duration,e.enrolled_at,r.score,r.pass_mark,st.school_name,st.school_full_name,st.slogan,st.logo_url
    FROM certificates c JOIN students s ON s.id=c.student_id JOIN programs p ON p.id=c.program_id
    LEFT JOIN final_results r ON r.id=c.result_id LEFT JOIN enrollments e ON e.student_id=c.student_id AND e.program_id=c.program_id
    CROSS JOIN (SELECT MAX(CASE WHEN key='school_name' THEN value END) school_name,MAX(CASE WHEN key='school_full_name' THEN value END) school_full_name,MAX(CASE WHEN key='slogan' THEN value END) slogan,MAX(CASE WHEN key='logo_url' THEN value END) logo_url FROM settings) st WHERE c.id=?`).get(certificateId);
  if(!c)return res.status(404).send('Certificat introuvable');
  if(!isAdmin && c.student_id!==req.user.id)return res.status(403).send('Accès interdit');

  // Modèle officiel CETEP fourni par la direction — utilisé comme fond exact du certificat.
  const W=842,H=605;

const doc=new PDFDocument({size:[W,H],margin:0});

res.setHeader('Content-Type','application/pdf');
res.setHeader('Content-Disposition',`attachment; filename="${c.certificate_no}-CETEP-2026.pdf"`);

doc.pipe(res);

res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, private');
res.setHeader('Pragma','no-cache');
res.setHeader('Expires','0');
res.setHeader('X-CETEP-Certificate-Model','14.4.12');

const model=path.join(__dirname,'public','certificat-cetep-2026-clean-template.png');

if(fs.existsSync(model)){
  doc.image(model,0,0,{width:W,height:H});
}

/* =========================================================
   SIGNATURES OFFICIELLES CETEP
   ========================================================= */

const sigDG=path.join(__dirname,'public','signature-dg-livenson-fleuriot.png');
const sigWJ=path.join(__dirname,'public','signature-wilio-joseph.png');

/* Signature DG — ligne gauche */
if(fs.existsSync(sigDG)){
 doc.image(sigDG,175,490,{
    width:135,
    height:60,
    fit:[135,60],
    align:'center',
    valign:'center'
  });
}
doc.fillColor('#111')
  .font('Helvetica-Bold')
  .fontSize(11)
  .text('Agronome Livenson Fleuriot',145,552,{
    width:195,
    align:'center',
    lineBreak:false
  });

doc.fillColor('#333')
  .font('Helvetica')
  .fontSize(9)
  .text('Directeur Général',145,568,{
    width:195,
    align:'center',
    lineBreak:false
  });
/* Directeur des Études — nom et titre uniquement */
doc.fillColor('#111')
  .font('Helvetica-Bold')
  .fontSize(12)
  .text('Wilio Joseph',490,490,{
    width:145,
    align:'center',
    lineBreak:false
  });

doc.fillColor('#333')
  .font('Helvetica')
  .fontSize(9)
  .text('Directeur des Études',490,507,{
    width:145,
    align:'center',
    lineBreak:false
  });

/* =========================================================
   INFORMATIONS DYNAMIQUES
   ========================================================= */

const name=(c.certificate_name||c.student_name||'').trim();
const formation=(c.program_name||'Formation professionnelle').trim();

const fin=c.issued_at
  ? new Date(c.issued_at).toLocaleDateString('fr-FR')
  : '—';

/* Nom de l'étudiant — centré sur la première ligne */
doc.fillColor('#1b1f3a')
   .font('Helvetica-Bold')
   .fontSize(17)
   .text(name,145,321,{
      width:560,
      align:'center',
      lineBreak:false
   });

/* Formation — centrée sur la deuxième ligne */
doc.fillColor('#1b1f3a')
   .font('Times-Roman')
  .fontSize(18)
   .text(formation,145,380,{
      width:560,
      align:'center',
      lineBreak:false
   });

/* Date */
doc.fillColor('#111')
   .font('Times-Roman')
   .fontSize(12)
   .text(fin,410,448,{
      width:170,
      align:'center',
      lineBreak:false
   });

/* =========================================================
   QR CODE — EN HAUT À DROITE
   ========================================================= */

const verifyUrl=
  `${process.env.PUBLIC_BASE_URL||''}/certificat/${encodeURIComponent(c.certificate_no)}`;

const qrData=await QRCode.toDataURL(
  verifyUrl,
  {
    margin:0,
    width:120,
    color:{
      dark:'#111111',
      light:'#ffffff'
    }
  }
);

const qrBuf=Buffer.from(
  qrData.split(',')[1],
  'base64'
);

/* QR ne couvre ni le sceau ni les signatures */
doc.image(qrBuf,715,28,{
  width:72,
  height:72
});

/* Numéro du certificat sous le QR */
doc.fillColor('#1b1f3a')
   .font('Helvetica-Bold')
   .fontSize(8)
   .text(`N° ${c.certificate_no}`,690,103,{
      width:120,
      align:'center',
      lineBreak:false
   });

doc.end();
}

// Teacher portal
app.get('/api/teacher/me',auth,role('teacher'),(req,res)=>res.json(db.prepare('SELECT id,teacher_no,name,email,phone FROM teachers WHERE id=?').get(req.user.id)));
app.get('/api/teacher/programs',auth,role('teacher'),(req,res)=>res.json(db.prepare('SELECT p.* FROM programs p JOIN program_teachers pt ON pt.program_id=p.id WHERE pt.teacher_id=? ORDER BY p.name').all(req.user.id)));
app.get('/api/teacher/modules',auth,role('teacher'),(req,res)=>res.json(db.prepare(`SELECT m.*,p.name program_name FROM modules m JOIN programs p ON p.id=m.program_id JOIN program_teachers pt ON pt.program_id=p.id WHERE pt.teacher_id=? ORDER BY p.name,m.order_no,m.id`).all(req.user.id)));
app.post('/api/teacher/modules',auth,role('teacher'),(req,res)=>{const b=req.body;const ok=db.prepare('SELECT 1 FROM program_teachers WHERE program_id=? AND teacher_id=?').get(Number(b.program_id),req.user.id);if(!ok)return res.status(403).json({error:'Formation non affectée'});const r=db.prepare('INSERT INTO modules(program_id,title,description,order_no) VALUES(?,?,?,?)').run(Number(b.program_id),b.title,b.description||'',Number(b.order_no||1));res.json({ok:true,id:r.lastInsertRowid});});
app.post('/api/teacher/lessons',auth,role('teacher'),(req,res)=>{const b=req.body;const ok=db.prepare('SELECT 1 FROM modules m JOIN program_teachers pt ON pt.program_id=m.program_id WHERE m.id=? AND pt.teacher_id=?').get(Number(b.module_id),req.user.id);if(!ok)return res.status(403).json({error:'Module non autorisé'});const r=db.prepare('INSERT INTO lessons(module_id,title,type,content,video_url,file_url,meeting_url,scheduled_at,duration_minutes,order_no) VALUES(?,?,?,?,?,?,?,?,?,?)').run(Number(b.module_id),b.title,b.type||'Texte',b.content||'',b.video_url||'',b.file_url||'',b.meeting_url||'',b.scheduled_at||null,Number(b.duration_minutes||60),Number(b.order_no||1));res.json({ok:true,id:r.lastInsertRowid});});
app.get('/api/teacher/students',auth,role('teacher'),(req,res)=>res.json(db.prepare(`SELECT DISTINCT s.id,s.student_no,s.name,s.email,s.phone,p.name program_name FROM students s JOIN enrollments e ON e.student_id=s.id JOIN program_teachers pt ON pt.teacher_id=? JOIN programs p ON p.id=pt.program_id AND p.id=e.program_id ORDER BY s.name`).all(req.user.id)));
// Student portal
app.get('/api/student/enrollments',auth,role('student'),(req,res)=>res.json(db.prepare("SELECT e.program_id,e.status,e.access_enabled,e.enrolled_at,p.name program_name,p.duration,p.price_htg,COALESCE((SELECT SUM(pay.amount_htg) FROM payments pay WHERE pay.student_id=e.student_id AND pay.program_id=e.program_id AND pay.status='Confirmé'),0) paid FROM enrollments e JOIN programs p ON p.id=e.program_id WHERE e.student_id=? ORDER BY e.enrolled_at DESC").all(req.user.id)));
app.get('/api/student/me',auth,role('student'),(req,res)=>{const s=db.prepare('SELECT s.id,s.student_no,s.name,s.email,s.phone,s.status,p.name program_name FROM students s LEFT JOIN programs p ON p.id=s.program_id WHERE s.id=?').get(req.user.id);const enrollments=db.prepare(`SELECT e.program_id,e.status,e.access_enabled,p.name program_name,p.duration,p.price_htg,COALESCE((SELECT SUM(pay.amount_htg) FROM payments pay WHERE pay.student_id=e.student_id AND pay.program_id=e.program_id AND pay.status='Confirmé'),0) paid FROM enrollments e JOIN programs p ON p.id=e.program_id WHERE e.student_id=? ORDER BY e.enrolled_at DESC`).all(req.user.id);res.json({...s,enrollments});});
app.get('/api/student/content',auth,role('student'),(req,res)=>{const programId=Number(req.query.program_id||0);const enrollment=programId?db.prepare("SELECT program_id FROM enrollments WHERE student_id=? AND program_id=? AND status='Actif' AND access_enabled=1").get(req.user.id,programId):db.prepare("SELECT program_id FROM enrollments WHERE student_id=? AND status='Actif' AND access_enabled=1 ORDER BY enrolled_at DESC LIMIT 1").get(req.user.id);const pid=programId||(enrollment?.program_id);if(!pid||!enrollment)return res.status(403).json({error:'Aucune formation active autorisée'});const rows=db.prepare('SELECT m.id module_id,m.title module_title,m.description,l.id lesson_id,l.title lesson_title,l.type,l.content,l.video_url,l.file_url,l.meeting_url,l.scheduled_at,l.duration_minutes,l.order_no,COALESCE(lp.completed,0) completed FROM modules m JOIN lessons l ON l.module_id=m.id LEFT JOIN lesson_progress lp ON lp.lesson_id=l.id AND lp.student_id=? WHERE m.program_id=? AND m.active=1 AND l.active=1 ORDER BY m.order_no,l.order_no').all(req.user.id,pid);res.json(rows);});
app.post('/api/student/progress',auth,role('student'),(req,res)=>{const lessonId=Number(req.body.lesson_id);const lesson=db.prepare('SELECT m.program_id FROM lessons l JOIN modules m ON m.id=l.module_id WHERE l.id=? AND l.active=1 AND m.active=1').get(lessonId);if(!lesson)return res.status(404).json({error:'Leçon introuvable'});if(!db.prepare("SELECT 1 FROM enrollments WHERE student_id=? AND program_id=? AND status='Actif' AND access_enabled=1").get(req.user.id,lesson.program_id))return res.status(403).json({error:'Accès non autorisé à cette formation'});db.prepare('INSERT INTO lesson_progress(student_id,lesson_id,completed,completed_at) VALUES(?,?,1,CURRENT_TIMESTAMP) ON CONFLICT(student_id,lesson_id) DO UPDATE SET completed=1,completed_at=CURRENT_TIMESTAMP').run(req.user.id,lessonId);res.json({ok:true,certificate:autoCertificateForStudent(req.user.id,lesson.program_id)});});
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
  const localNames=localTableNames();
  const known=new Set(localNames);
  const isLegacy=snapshot.version==='legacy-mirror';
  const required=isLegacy?['admins','programs','students','payments']:['admins','programs','students','enrollments','payments'];
  if(!required.every(name=>Array.isArray(snapshot.tables[name])))throw new Error('Snapshot Neon incomplet; données locales conservées.');
  // Older table-by-table mirrors predate multi-enrollment support. Rebuild this
  // table from the legacy students.program_id column after restoring the core rows.
  if(isLegacy&&!Array.isArray(snapshot.tables.enrollments))snapshot.tables.enrollments=[];
  // Atomic snapshots must represent every table known by this application. A legacy
  // per-table mirror may omit tables introduced later; those local tables are retained.
  if(!isLegacy){
    const missing=localNames.filter(name=>!Array.isArray(snapshot.tables[name]));
    const unknown=Object.keys(snapshot.tables).filter(name=>!known.has(name));
    if(missing.length)throw new Error(`Snapshot Neon incomplet: tables absentes (${missing.join(', ')}); données locales conservées.`);
    if(unknown.length)throw new Error(`Snapshot Neon contient des tables inconnues (${unknown.join(', ')}); mise à jour de schéma requise, données locales conservées.`);
  }
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
    installNeonWriteTracking();
    console.log('[CETEP] Persistance Neon activée.');
  }else{
    console.warn('[CETEP] DATABASE_URL absent: mode local uniquement, non recommandé en production.');
  }
  app.listen(PORT,'0.0.0.0',()=>console.log(`CETEP v${APP_VERSION} running on ${PORT}`));
}
startCETEP().catch(error=>{console.error('[CETEP STARTUP FAILED]',error);process.exit(1)});
