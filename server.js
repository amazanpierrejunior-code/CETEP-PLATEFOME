require('dotenv').config();
const express=require('express');const PDFDocument=require('pdfkit');const cookieParser=require('cookie-parser');const bcrypt=require('bcryptjs');const jwt=require('jsonwebtoken');const Database=require('better-sqlite3');const path=require('path');const fs=require('fs');
const app=express();const PORT=process.env.PORT||10000;const DATA_DIR=process.env.DATA_DIR||path.join(__dirname,'data');fs.mkdirSync(DATA_DIR,{recursive:true});
app.use(express.json({limit:'20mb'}));app.use(express.urlencoded({extended:true,limit:'20mb'}));app.use(cookieParser());app.use(express.static(path.join(__dirname,'public')));
const SECRET=process.env.JWT_SECRET||'CHANGE_ME_IN_RENDER';const db=new Database(path.join(DATA_DIR,'cetep.sqlite'));db.pragma('journal_mode=WAL');db.pragma('foreign_keys=ON');
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
  pass_mark REAL NOT NULL DEFAULT 60,
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
ensureColumn('payments','payment_message','TEXT');
ensureColumn('payments','payment_proof','TEXT');
const defaults={school_name:'CETEP',school_full_name:"Centre d'Encadrement Technique et Professionnel",slogan:'Formation • Orientation • Insertion professionnelle',address:'Lamentin 54, Ruelle Crispin #856',phone:'+509 3601 8696 / +509 3736 5610 / +1 561-674-2890',email:'cetepecoleprofessionnelle@gmail.com',primary_color:'#0d2b52',secondary_color:'#1677b8',accent_color:'#087443',logo_text:'CETEP',logo_url:'',typography_font_family:'Arial,Helvetica,sans-serif',typography_font_size:'16px',typography_bold:'0',typography_italic:'0',typography_line_height:'1.5'};
const set=db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)');for(const [k,v] of Object.entries(defaults))set.run(k,v);
// CETEP official contact defaults: fill blank values on existing installations without overwriting admin edits.
const currentSettings=Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(x=>[x.key,x.value]));
if(!String(currentSettings.phone||'').trim())db.prepare("UPDATE settings SET value=? WHERE key='phone'").run(defaults.phone);
if(!String(currentSettings.email||'').trim())db.prepare("UPDATE settings SET value=? WHERE key='email'").run(defaults.email);
if(!db.prepare('SELECT 1 FROM admins LIMIT 1').get()){const e=process.env.ADMIN_EMAIL||'admin@cetep.ht',p=process.env.ADMIN_PASSWORD||'CHANGEZ_MOI';db.prepare('INSERT INTO admins(email,password_hash) VALUES(?,?)').run(e,bcrypt.hashSync(p,12));}
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
  ['📚 Nouvelle session chaque mois','Sérigraphie, secourisme, langues, beauté, bâtiment, informatique et autres formations professionnelles.','/promotions/promo-2.jpg',2]
];
const insertGallery=db.prepare('INSERT INTO gallery(title,description,image_url,sort_order,active) VALUES(?,?,?,?,1)');
for(const [title,description,image_url,sort_order] of defaultPromotions){
  if(!db.prepare('SELECT 1 FROM gallery WHERE title=? LIMIT 1').get(title)) insertGallery.run(title,description,image_url,sort_order);
}
if(db.prepare('SELECT COUNT(*) c FROM support_methods').get().c===0){const q=db.prepare('INSERT INTO support_methods(name,account_name,account_value,instructions,sort_order) VALUES(?,?,?,?,?)');q.run('MonCash','','','Contactez CETEP pour les instructions.',1);q.run('Natcash','','','Contactez CETEP pour les instructions.',2);q.run('Zelle','','','Contactez CETEP pour les instructions.',3);q.run('Cash App','','','Contactez CETEP pour les instructions.',4);q.run('Compte bancaire','','','Compte bancaire / RIB à renseigner',5);}
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
  const due=db.prepare('SELECT COALESCE(price_htg,0) price_htg FROM programs WHERE id=?').get(programId)?.price_htg||0;
  const paid=db.prepare("SELECT COALESCE(SUM(amount_htg),0) paid FROM payments WHERE student_id=? AND status='Confirmé'").get(studentId).paid;
  return {due,paid,fullyPaid:paid>=due};
}
function refreshStudentCourseAccess(studentId){
  const s=db.prepare('SELECT id,program_id FROM students WHERE id=?').get(studentId);
  if(!s||!s.program_id)return false;
  const p=db.prepare('SELECT COALESCE(price_htg,0) price_htg FROM programs WHERE id=?').get(s.program_id);
  const due=Number(p?.price_htg||0);
  const paid=Number(db.prepare("SELECT COALESCE(SUM(amount_htg),0) paid FROM payments WHERE student_id=? AND status='Confirmé'").get(studentId).paid||0);
  const full=paid>=due && due>0;
  if(full){
    db.prepare("UPDATE students SET access_enabled=1,status='Actif' WHERE id=?").run(studentId);
    db.prepare("UPDATE enrollments SET status='Actif' WHERE student_id=? AND program_id=?").run(studentId,s.program_id);
  }
  return full;
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
function autoCertificateForStudent(studentId){
  const s=db.prepare('SELECT id,program_id FROM students WHERE id=?').get(studentId);
  if(s?.program_id) return tryAutoIssueCertificate(s.id,s.program_id);
  return null;
}

app.get('/health',(req,res)=>res.json({ok:true,service:'CETEP',version:'12.0.0',storage:DATA_DIR}));
function sendPage(res,file){const pub=path.join(__dirname,'public',file);const root=path.join(__dirname,file);if(fs.existsSync(pub))return res.sendFile(pub);if(fs.existsSync(root))return res.sendFile(root);return res.status(404).send('Page introuvable: '+file);}
app.get('/',(req,res)=>sendPage(res,'index.html'));app.get('/informations',(req,res)=>sendPage(res,'informations.html'));app.get('/login',(req,res)=>sendPage(res,'login.html'));app.get('/admin',(req,res)=>sendPage(res,'admin.html'));app.get('/local',(req,res)=>sendPage(res,'local.html'));app.get('/administration',(req,res)=>res.redirect('/admin'));app.get('/teacher',(req,res)=>sendPage(res,'teacher.html'));app.get('/professeur',(req,res)=>res.redirect('/teacher'));app.get('/student',(req,res)=>sendPage(res,'student.html'));app.get('/etudiant',(req,res)=>res.redirect('/student'));app.get('/undefined',(req,res)=>res.redirect('/'));
function adminLogin(req,res){const a=db.prepare('SELECT * FROM admins WHERE email=?').get((req.body.email||'').trim().toLowerCase());if(!a||!bcrypt.compareSync(req.body.password||'',a.password_hash))return res.status(401).json({error:'Identifiants invalides'});res.cookie('cetep_token',sign({id:a.id,email:a.email,role:'admin'}),{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:43200000});res.json({ok:true,redirect:'/admin'});}
app.post('/api/login',adminLogin);app.post('/api/login/admin',adminLogin);
function teacherLogin(req,res){const t=db.prepare('SELECT * FROM teachers WHERE email=?').get((req.body.email||'').trim().toLowerCase());if(!t||!t.active||!bcrypt.compareSync(req.body.password||'',t.password_hash))return res.status(401).json({error:'Identifiants professeur invalides'});res.cookie('cetep_token',sign({id:t.id,teacher_no:t.teacher_no,role:'teacher'}),{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:43200000});res.json({ok:true,redirect:'/teacher'});}
app.post('/api/teacher/login',teacherLogin);app.post('/api/login/teacher',teacherLogin);
function studentLogin(req,res){const s=db.prepare('SELECT * FROM students WHERE student_no=?').get((req.body.code||req.body.student_no||'').trim().toUpperCase());if(!s||!s.password_hash||!s.access_enabled||!bcrypt.compareSync(req.body.password||'',s.password_hash))return res.status(401).json({error:'Code étudiant, mot de passe ou accès invalide'});res.cookie('cetep_token',sign({id:s.id,student_no:s.student_no,role:'student'}),{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:43200000});res.json({ok:true,redirect:'/student'});}
app.post('/api/student/login',studentLogin);app.post('/api/login/student',studentLogin);
app.post('/api/logout',(req,res)=>{res.clearCookie('cetep_token');res.json({ok:true});});app.get('/api/session',auth,(req,res)=>res.json({user:req.user}));
app.get('/api/public/settings',(req,res)=>res.json(settings()));app.get('/api/public/programs',(req,res)=>res.json(db.prepare('SELECT * FROM programs WHERE active=1 ORDER BY id').all()));app.get('/api/public/support',(req,res)=>res.json(db.prepare('SELECT id,name,account_name,account_value,bank_name,bank_account,routing,instructions FROM support_methods WHERE active=1 ORDER BY sort_order,id').all()));app.get('/api/public/gallery',(req,res)=>res.json(db.prepare('SELECT id,title,description,image_url FROM gallery WHERE active=1 ORDER BY sort_order,id DESC').all()));
app.post('/api/admissions',(req,res)=>{try{const b=req.body||{};if(!b.name||!b.phone||!b.program_id)return res.status(400).json({error:'Nom, téléphone et formation obligatoires'});const program=db.prepare('SELECT * FROM programs WHERE id=? AND active=1').get(Number(b.program_id));if(!program)return res.status(400).json({error:'Formation introuvable'});const no=nextNo('CETEP','students','student_no');const tx=db.transaction(()=>{const r=db.prepare('INSERT INTO students(student_no,name,birth_date,birth_place,phone,email,program_id,education,status,password_hash,access_enabled) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(no,b.name,b.birth_date||null,b.birth_place||null,b.phone,b.email||null,Number(b.program_id),b.education||null,'En attente',bcrypt.hashSync(no,12),0);db.prepare('INSERT OR IGNORE INTO enrollments(student_id,program_id,status) VALUES(?,?,?)').run(r.lastInsertRowid,Number(b.program_id),'En attente');let paymentId=null;if(b.payment_method&&Number(b.payment_amount)>0){const ref=b.payment_reference||('ENR-'+no+'-'+Date.now());const pr=db.prepare('INSERT INTO payments(student_id,amount_htg,method,status,reference,payment_message,payment_proof) VALUES(?,?,?,?,?,?,?)').run(r.lastInsertRowid,Number(b.payment_amount),String(b.payment_method),'En attente',ref,b.payment_message||null,b.payment_proof||null);paymentId=Number(pr.lastInsertRowid);}return {studentId:Number(r.lastInsertRowid),paymentId};});const out=tx();res.status(201).json({ok:true,student_no:no,payment_id:out.paymentId,temporary_password:no,payment_status:out.paymentId?'En attente':null,amount_due:Number(program.price_htg||0),message:out.paymentId?'Inscription enregistrée. Votre paiement est en attente de vérification par CETEP.':'Inscription enregistrée. Vous pouvez maintenant effectuer le paiement en ligne.'});}catch(e){res.status(400).json({error:e.message});}});
app.post('/api/public/enrollment-payment',(req,res)=>{try{const b=req.body||{};if(!b.student_no||!b.method||!Number(b.amount))return res.status(400).json({error:'Numéro étudiant, méthode et montant obligatoires'});if(b.payment_proof&&String(b.payment_proof).length>7*1024*1024)return res.status(400).json({error:'La photo de confirmation est trop grande (maximum 5 Mo).'});const student=db.prepare('SELECT s.*,p.price_htg FROM students s LEFT JOIN programs p ON p.id=s.program_id WHERE s.student_no=?').get(String(b.student_no));if(!student)return res.status(404).json({error:'Inscription introuvable'});const ref=b.reference||('ENR-'+student.student_no+'-'+Date.now());const r=db.prepare('INSERT INTO payments(student_id,amount_htg,method,status,reference,payment_message,payment_proof) VALUES(?,?,?,?,?,?,?)').run(student.id,Number(b.amount),String(b.method),'En attente',ref,b.payment_message||null,b.payment_proof||null);res.status(201).json({ok:true,payment_id:Number(r.lastInsertRowid),reference:ref,message:'Paiement envoyé avec votre confirmation. CETEP doit vérifier et confirmer le paiement.'});}catch(e){res.status(400).json({error:e.message});}});
app.post('/api/public/donation',(req,res)=>{const b=req.body||{};if(!b.name||!b.method||!b.amount)return res.status(400).json({error:'Nom, méthode et montant obligatoires'});const r=db.prepare('INSERT INTO donations(name,email,amount,method,reference,message) VALUES(?,?,?,?,?,?)').run(b.name,b.email||'',Number(b.amount),b.method,b.reference||'',b.message||'');res.status(201).json({ok:true,id:r.lastInsertRowid,message:'Merci pour votre soutien. Votre contribution a été enregistrée.'});});
app.get('/api/admin/stats',auth,role('admin'),(req,res)=>res.json({students:db.prepare('SELECT COUNT(*) c FROM students').get().c,activeStudents:db.prepare("SELECT COUNT(*) c FROM students WHERE access_enabled=1").get().c,teachers:db.prepare('SELECT COUNT(*) c FROM teachers').get().c,programs:db.prepare('SELECT COUNT(*) c FROM programs WHERE active=1').get().c,pending:db.prepare("SELECT COUNT(*) c FROM students WHERE status='En attente'").get().c,revenue:db.prepare("SELECT COALESCE(SUM(amount_htg),0) s FROM payments WHERE status='Confirmé'").get().s,donations:db.prepare("SELECT COALESCE(SUM(amount),0) s FROM donations WHERE status!='Refusé'").get().s}));
app.get('/api/admin/settings',auth,role('admin'),(req,res)=>res.json(settings()));app.put('/api/admin/settings',auth,role('admin'),(req,res)=>{const q=db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');for(const k of Object.keys(defaults))if(req.body[k]!==undefined)q.run(k,String(req.body[k]));res.json({ok:true,settings:settings()});});app.post('/api/admin/logo/reset',auth,role('admin'),(req,res)=>{db.prepare("UPDATE settings SET value='' WHERE key='logo_url'").run();res.json({ok:true});});
app.get('/api/admin/students',auth,role('admin'),(req,res)=>res.json(db.prepare('SELECT s.*,p.name program_name FROM students s LEFT JOIN programs p ON p.id=s.program_id ORDER BY s.id DESC').all()));
app.post('/api/admin/students',auth,role('admin'),(req,res)=>{try{const b=req.body;if(!b.name||!b.phone||!b.program_id)return res.status(400).json({error:'Nom, téléphone et formation obligatoires'});const no=nextNo('CETEP','students','student_no');const pw=String(b.password||'123456');const r=db.prepare(`INSERT INTO students(student_no,name,birth_date,birth_place,phone,email,program_id,education,blood_group,responsible_person,marital_status,status,password_hash,access_enabled) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(no,b.name,b.birth_date||null,b.birth_place||null,b.phone,b.email||null,Number(b.program_id),b.education||null,b.blood_group||null,b.responsible_person||null,b.marital_status||null,b.status||'Actif',bcrypt.hashSync(pw,12),b.access_enabled===false?0:1);db.prepare('INSERT OR IGNORE INTO enrollments(student_id,program_id,status) VALUES(?,?,?)').run(r.lastInsertRowid,Number(b.program_id),b.access_enabled===false?'En attente':'Actif');res.status(201).json({ok:true,id:r.lastInsertRowid,student_no:no});}catch(e){res.status(400).json({error:e.message});}});
app.put('/api/admin/students/:id',auth,role('admin'),(req,res)=>{const b=req.body;db.prepare(`UPDATE students SET name=?,birth_date=?,birth_place=?,phone=?,email=?,program_id=?,education=?,blood_group=?,responsible_person=?,marital_status=?,status=? WHERE id=?`).run(b.name,b.birth_date||null,b.birth_place||null,b.phone,b.email||null,b.program_id?Number(b.program_id):null,b.education||null,b.blood_group||null,b.responsible_person||null,b.marital_status||null,b.status||'En attente',req.params.id);res.json({ok:true});});
app.post('/api/admin/students/:id/access',auth,role('admin'),(req,res)=>{const s=db.prepare('SELECT * FROM students WHERE id=?').get(req.params.id);if(!s)return res.status(404).json({error:'Étudiant introuvable'});const hash=req.body.password?bcrypt.hashSync(req.body.password,12):s.password_hash;db.prepare('UPDATE students SET access_enabled=?,status=?,password_hash=? WHERE id=?').run(req.body.enabled?1:0,req.body.enabled?'Actif':'Suspendu',hash,s.id);res.json({ok:true});});
app.get('/api/admin/teachers',auth,role('admin'),(req,res)=>res.json(db.prepare('SELECT id,teacher_no,name,email,phone,active FROM teachers ORDER BY id DESC').all()));app.post('/api/admin/teachers',auth,role('admin'),(req,res)=>{try{const b=req.body;if(!b.name||!b.email)return res.status(400).json({error:'Nom et email obligatoires'});const no=nextNo('PROF','teachers','teacher_no');const r=db.prepare('INSERT INTO teachers(teacher_no,name,email,phone,password_hash) VALUES(?,?,?,?,?)').run(no,b.name,b.email.toLowerCase(),b.phone||'',bcrypt.hashSync(b.password||'123456',12));res.json({ok:true,id:r.lastInsertRowid,teacher_no:no});}catch(e){res.status(400).json({error:e.message});}});app.post('/api/admin/teachers/:id/status',auth,role('admin'),(req,res)=>{db.prepare('UPDATE teachers SET active=? WHERE id=?').run(req.body.active?1:0,req.params.id);res.json({ok:true});});
app.get('/api/admin/programs',auth,role('admin'),(req,res)=>res.json(db.prepare('SELECT * FROM programs ORDER BY id').all()));app.post('/api/admin/programs',auth,role('admin'),(req,res)=>{const b=req.body;const r=db.prepare('INSERT INTO programs(name,duration,description,price_htg,active) VALUES(?,?,?,?,?)').run(b.name,b.duration||'',b.description||'',Number(b.price_htg||0),b.active===false?0:1);res.json({ok:true,id:r.lastInsertRowid});});app.put('/api/admin/programs/:id',auth,role('admin'),(req,res)=>{const b=req.body;db.prepare('UPDATE programs SET name=?,duration=?,description=?,price_htg=?,active=? WHERE id=?').run(b.name,b.duration||'',b.description||'',Number(b.price_htg||0),b.active===false?0:1,req.params.id);res.json({ok:true});});app.delete('/api/admin/programs/:id',auth,role('admin'),(req,res)=>{db.prepare('DELETE FROM programs WHERE id=?').run(req.params.id);res.json({ok:true});});
app.get('/api/admin/modules',auth,role('admin'),(req,res)=>res.json(db.prepare('SELECT m.*,p.name program_name FROM modules m JOIN programs p ON p.id=m.program_id ORDER BY p.id,m.order_no,m.id').all()));app.post('/api/admin/modules',auth,role('admin'),(req,res)=>{const b=req.body;if(!b.program_id||!b.title)return res.status(400).json({error:'Formation et titre obligatoires'});const r=db.prepare('INSERT INTO modules(program_id,title,description,order_no) VALUES(?,?,?,?)').run(Number(b.program_id),b.title,b.description||'',Number(b.order_no||1));res.json({ok:true,id:r.lastInsertRowid});});app.get('/api/admin/lessons',auth,role('admin'),(req,res)=>res.json(db.prepare('SELECT l.*,m.title module_title,p.name program_name FROM lessons l JOIN modules m ON m.id=l.module_id JOIN programs p ON p.id=m.program_id ORDER BY p.id,m.order_no,l.order_no,l.id').all()));app.post('/api/admin/lessons',auth,role('admin'),(req,res)=>{const b=req.body;if(!b.module_id||!b.title)return res.status(400).json({error:'Module et titre obligatoires'});const r=db.prepare('INSERT INTO lessons(module_id,title,type,content,video_url,file_url,meeting_url,scheduled_at,duration_minutes,order_no) VALUES(?,?,?,?,?,?,?,?,?,?)').run(Number(b.module_id),b.title,b.type||'Texte',b.content||'',b.video_url||'',b.file_url||'',b.meeting_url||'',b.scheduled_at||null,Number(b.duration_minutes||60),Number(b.order_no||1));res.json({ok:true,id:r.lastInsertRowid});});
app.post('/api/admin/assign-teacher',auth,role('admin'),(req,res)=>{db.prepare('INSERT OR IGNORE INTO program_teachers(program_id,teacher_id) VALUES(?,?)').run(Number(req.body.program_id),Number(req.body.teacher_id));res.json({ok:true});});app.get('/api/admin/teacher-assignments',auth,role('admin'),(req,res)=>res.json(db.prepare('SELECT pt.*,t.name teacher_name,p.name program_name FROM program_teachers pt JOIN teachers t ON t.id=pt.teacher_id JOIN programs p ON p.id=pt.program_id').all()));
app.get('/api/admin/payments',auth,role('admin'),(req,res)=>res.json(db.prepare('SELECT p.*,s.name student_name,s.student_no,s.access_enabled,pr.name program_name FROM payments p LEFT JOIN students s ON s.id=p.student_id LEFT JOIN programs pr ON pr.id=s.program_id ORDER BY p.id DESC').all()));app.post('/api/admin/payments/:id/status',auth,role('admin'),(req,res)=>{const status=['En attente','Confirmé','Refusé'].includes(req.body.status)?req.body.status:'En attente';const pay=db.prepare('SELECT student_id FROM payments WHERE id=?').get(req.params.id);if(!pay)return res.status(404).json({error:'Paiement introuvable'});db.prepare('UPDATE payments SET status=? WHERE id=?').run(status,req.params.id);let access=false;if(status==='Confirmé'&&pay.student_id)access=refreshStudentCourseAccess(pay.student_id);if(status==='Refusé'&&pay.student_id){db.prepare("UPDATE students SET access_enabled=0,status='En attente' WHERE id=?").run(pay.student_id);db.prepare("UPDATE enrollments SET status='En attente' WHERE student_id=?").run(pay.student_id);}res.json({ok:true,status,course_access:access});});app.post('/api/admin/payments',auth,role('admin'),(req,res)=>{const b=req.body,ref=b.reference||`PAY-${Date.now()}`;const studentId=b.student_id?Number(b.student_id):null;const status=b.status||'Confirmé';const r=db.prepare('INSERT INTO payments(student_id,amount_htg,method,status,reference) VALUES(?,?,?,?,?)').run(studentId,Number(b.amount_htg||0),b.method||'Manuel',status,ref);const access=studentId&&status==='Confirmé'?refreshStudentCourseAccess(studentId):false;const cert=studentId&&status!=='Refusé'?autoCertificateForStudent(studentId):null;res.json({ok:true,id:r.lastInsertRowid,reference:ref,course_access:access,certificate:cert});});
app.get('/api/admin/support',auth,role('admin'),(req,res)=>res.json(db.prepare('SELECT * FROM support_methods ORDER BY sort_order,id').all()));app.post('/api/admin/support',auth,role('admin'),(req,res)=>{const b=req.body;if(!b.name)return res.status(400).json({error:'Nom obligatoire'});const r=db.prepare('INSERT INTO support_methods(name,account_name,account_value,bank_name,bank_account,routing,instructions,active,sort_order) VALUES(?,?,?,?,?,?,?,?,?)').run(b.name,b.account_name||'',b.account_value||'',b.bank_name||'',b.bank_account||'',b.routing||'',b.instructions||'',b.active===false?0:1,Number(b.sort_order||99));res.json({ok:true,id:r.lastInsertRowid});});app.put('/api/admin/support/:id',auth,role('admin'),(req,res)=>{const b=req.body;db.prepare('UPDATE support_methods SET name=?,account_name=?,account_value=?,bank_name=?,bank_account=?,routing=?,instructions=?,active=?,sort_order=? WHERE id=?').run(b.name,b.account_name||'',b.account_value||'',b.bank_name||'',b.bank_account||'',b.routing||'',b.instructions||'',b.active===false?0:1,Number(b.sort_order||99),req.params.id);res.json({ok:true});});app.delete('/api/admin/support/:id',auth,role('admin'),(req,res)=>{db.prepare('DELETE FROM support_methods WHERE id=?').run(req.params.id);res.json({ok:true});});
app.get('/api/admin/donations',auth,role('admin'),(req,res)=>res.json(db.prepare('SELECT * FROM donations ORDER BY id DESC').all()));app.post('/api/admin/donations/:id/status',auth,role('admin'),(req,res)=>{db.prepare('UPDATE donations SET status=? WHERE id=?').run(req.body.status||'Confirmé',req.params.id);res.json({ok:true});});
app.get('/api/admin/gallery',auth,role('admin'),(req,res)=>res.json(db.prepare('SELECT * FROM gallery ORDER BY sort_order,id DESC').all()));app.post('/api/admin/gallery',auth,role('admin'),(req,res)=>{const b=req.body;if(!b.title||!b.image_url)return res.status(400).json({error:'Titre et photo obligatoires'});if(String(b.image_url).length>7000000)return res.status(400).json({error:'Photo trop grande. Maximum recommandé: 5 Mo.'});const r=db.prepare('INSERT INTO gallery(title,description,image_url,sort_order,active) VALUES(?,?,?,?,?)').run(b.title,b.description||'',b.image_url,Number(b.sort_order||99),b.active===false?0:1);res.json({ok:true,id:r.lastInsertRowid});});app.put('/api/admin/gallery/:id',auth,role('admin'),(req,res)=>{const b=req.body;db.prepare('UPDATE gallery SET title=?,description=?,image_url=?,sort_order=?,active=? WHERE id=?').run(b.title,b.description||'',b.image_url,b.sort_order||99,b.active===false?0:1,req.params.id);res.json({ok:true});});app.delete('/api/admin/gallery/:id',auth,role('admin'),(req,res)=>{db.prepare('DELETE FROM gallery WHERE id=?').run(req.params.id);res.json({ok:true});});
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
          const r=db.prepare(`INSERT INTO students(student_no,name,birth_date,birth_place,phone,email,program_id,education,blood_group,responsible_person,marital_status,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(x.student_no,x.name,x.birth_date||'',x.birth_place||'',x.phone||'',x.email||'',programId,x.education||'',x.blood_group||'',x.responsible_person||'',x.marital_status||'',x.status||'En attente');
          studentMap.set(x.student_no,Number(r.lastInsertRowid));
        }
      }
      for(const x of (payload.payments||[])){
        const sid=x.student_no?studentMap.get(x.student_no):Number(x.student_id||0);
        if(!sid||!Number(x.amount_htg)) continue;
        const ref=x.reference||`LOCAL-${x.local_id||Date.now()}-${Math.random().toString(36).slice(2,8)}`;
        db.prepare('INSERT OR IGNORE INTO payments(student_id,amount_htg,method,status,reference) VALUES(?,?,?,?,?)').run(sid,Number(x.amount_htg),x.method||'Local','Confirmé',ref);
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

app.get('/api/admin/backup',auth,role('admin'),(req,res)=>{const tables=['admins','programs','students','teachers','program_teachers','enrollments','modules','lessons','lesson_progress','assignments','submissions','payments','support_methods','donations','settings','final_results','certificates','attendance','announcements','gallery'];const out={version:'12.5.1',created_at:new Date().toISOString(),tables:{}};for(const t of tables)out.tables[t]=db.prepare(`SELECT * FROM ${t}`).all();res.setHeader('Content-Type','application/json');res.setHeader('Content-Disposition','attachment; filename="cetep-backup-v12.5.json"');res.send(JSON.stringify(out,null,2));});
app.post('/api/admin/restore',auth,role('admin'),(req,res)=>{try{const data=req.body;if(!data?.tables)throw new Error('Fichier de sauvegarde invalide');const tables=['programs','students','teachers','program_teachers','enrollments','modules','lessons','lesson_progress','assignments','submissions','payments','support_methods','donations','settings','final_results','certificates','attendance','announcements','gallery'];const tx=db.transaction(()=>{db.pragma('foreign_keys=OFF');for(const t of tables)db.prepare(`DELETE FROM ${t}`).run();for(const t of tables){const rows=data.tables[t]||[];for(const row of rows){const cols=Object.keys(row);const sql=`INSERT INTO ${t}(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`;db.prepare(sql).run(...cols.map(c=>row[c]));}}db.pragma('foreign_keys=ON');});tx();res.json({ok:true,message:'Sauvegarde restaurée.'});}catch(e){res.status(400).json({error:e.message});}});

// Certificates & academic results
app.get('/api/admin/certificates',auth,role('admin'),(req,res)=>{
  const rows=db.prepare(`SELECT s.id student_id,s.student_no,s.name student_name,p.id program_id,p.name program_name,
    COALESCE(fr.score,0) score,COALESCE(fr.pass_mark,60) pass_mark,COALESCE(fr.status,'En attente') result_status,
    c.id certificate_id,c.certificate_no,c.issued_at,
    (SELECT COALESCE(SUM(amount_htg),0) FROM payments WHERE student_id=s.id AND status='Confirmé') paid,
    p.price_htg due
    FROM students s LEFT JOIN programs p ON p.id=s.program_id
    LEFT JOIN final_results fr ON fr.student_id=s.id AND fr.program_id=s.program_id
    LEFT JOIN certificates c ON c.student_id=s.id AND c.program_id=s.program_id
    ORDER BY s.name`).all();
  res.json(rows.map(x=>({...x,completion:completionStats(x.student_id,x.program_id||0),payment:paymentStats(x.student_id,x.program_id||0)})));
});
app.post('/api/admin/results',auth,role('admin'),(req,res)=>{
  const studentId=Number(req.body.student_id), programId=Number(req.body.program_id);
  if(!studentId||!programId)return res.status(400).json({error:'Étudiant et formation obligatoires'});
  const score=Number(req.body.score||0), passMark=Number(req.body.pass_mark||60);
  const status=score>=passMark?'Réussi':'Échoué';
  db.prepare(`INSERT INTO final_results(student_id,program_id,score,pass_mark,status,notes)
    VALUES(?,?,?,?,?,?) ON CONFLICT(student_id,program_id) DO UPDATE SET score=excluded.score,pass_mark=excluded.pass_mark,status=excluded.status,notes=excluded.notes,evaluated_at=CURRENT_TIMESTAMP`)
    .run(studentId,programId,score,passMark,status,req.body.notes||'');
  const cert=tryAutoIssueCertificate(studentId,programId);
  res.json({ok:true,status,certificate:cert});
});
app.post('/api/admin/certificates/:studentId/issue',auth,role('admin'),(req,res)=>{
  const s=db.prepare('SELECT id,program_id FROM students WHERE id=?').get(req.params.studentId);
  if(!s?.program_id)return res.status(400).json({error:'Étudiant sans formation'});
  const cert=tryAutoIssueCertificate(s.id,s.program_id);
  if(!cert)return res.status(409).json({error:'Le certificat n’est pas encore éligible: réussite, 100% des leçons et frais confirmés sont requis.'});
  res.json({ok:true,certificate:cert});
});
app.get('/api/admin/certificates/:id/pdf',auth,role('admin'),(req,res)=>sendCertificatePdf(req,res,Number(req.params.id),true));
app.get('/api/student/certificate',auth,role('student'),(req,res)=>{
  const s=db.prepare('SELECT id,program_id FROM students WHERE id=?').get(req.user.id);
  const cert=s?.program_id?tryAutoIssueCertificate(s.id,s.program_id):null;
  if(!cert)return res.status(404).json({eligible:false,message:'Votre certificat sera disponible après réussite, 100% des leçons et paiement complet des frais.'});
  res.json({eligible:true,certificate:cert,download:'/api/student/certificate.pdf'});
});
app.get('/api/student/certificate.pdf',auth,role('student'),(req,res)=>{
  const s=db.prepare('SELECT id,program_id FROM students WHERE id=?').get(req.user.id);
  const cert=s?.program_id?tryAutoIssueCertificate(s.id,s.program_id):null;
  if(!cert)return res.status(404).send('Certificat non disponible');
  sendCertificatePdf(req,res,cert.id,false);
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
function sendCertificatePdf(req,res,certificateId,isAdmin){
  const c=db.prepare(`SELECT c.*,s.name student_name,COALESCE(s.certificate_name,s.name) certificate_name,p.name program_name,
    p.duration,e.enrolled_at,r.score,r.pass_mark,st.school_name,st.school_full_name,st.slogan,st.logo_url
    FROM certificates c JOIN students s ON s.id=c.student_id JOIN programs p ON p.id=c.program_id
    LEFT JOIN final_results r ON r.id=c.result_id LEFT JOIN enrollments e ON e.student_id=c.student_id AND e.program_id=c.program_id
    CROSS JOIN (SELECT MAX(CASE WHEN key='school_name' THEN value END) school_name,MAX(CASE WHEN key='school_full_name' THEN value END) school_full_name,MAX(CASE WHEN key='slogan' THEN value END) slogan,MAX(CASE WHEN key='logo_url' THEN value END) logo_url FROM settings) st WHERE c.id=?`).get(certificateId);
  if(!c)return res.status(404).send('Certificat introuvable');
  if(!isAdmin && c.student_id!==req.user.id)return res.status(403).send('Accès interdit');
  const doc=new PDFDocument({size:[842,595],margin:0});
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition',`attachment; filename="${c.certificate_no}.pdf"`);
  doc.pipe(res);
  const model=path.join(__dirname,'public','certificat-model.png');
  if(fs.existsSync(model)) doc.image(model,0,0,{width:842,height:595});
  // White-out only the variable fields from the supplied CETEP template, then write them automatically.
  doc.save();
  doc.rect(180,252,480,40).fill('#ffffff'); // student name
  doc.rect(332,319,194,35).fill('#ffffff'); // formation
  doc.rect(526,319,214,35).fill('#ffffff'); // dates
  doc.rect(382,359,135,25).fill('#ffffff'); // issue date
  doc.restore();
  doc.fillColor('#111').font('Helvetica-Bold').fontSize(25).text(c.certificate_name,180,255,{width:480,align:'center'});
  doc.font('Helvetica-Bold').fontSize(16).text(`« ${c.program_name} »`,332,325,{width:194,align:'center'});
  doc.font('Helvetica').fontSize(9).text(`${c.enrolled_at ? new Date(c.enrolled_at).toLocaleDateString('fr-FR') : '—'} à ${c.issued_at ? new Date(c.issued_at).toLocaleDateString('fr-FR') : '—'}`,526,327,{width:214,align:'center'});
  doc.font('Helvetica-Bold').fontSize(10).text(new Date(c.issued_at).toLocaleDateString('fr-FR'),382,363,{width:135,align:'center'});
  doc.fontSize(9).text(`N° ${c.certificate_no}`,650,540,{width:145,align:'right'});
  doc.end();
}
// Teacher portal
app.get('/api/teacher/me',auth,role('teacher'),(req,res)=>res.json(db.prepare('SELECT id,teacher_no,name,email,phone FROM teachers WHERE id=?').get(req.user.id)));
app.get('/api/teacher/programs',auth,role('teacher'),(req,res)=>res.json(db.prepare('SELECT p.* FROM programs p JOIN program_teachers pt ON pt.program_id=p.id WHERE pt.teacher_id=? ORDER BY p.name').all(req.user.id)));
app.get('/api/teacher/modules',auth,role('teacher'),(req,res)=>res.json(db.prepare(`SELECT m.*,p.name program_name FROM modules m JOIN programs p ON p.id=m.program_id JOIN program_teachers pt ON pt.program_id=p.id WHERE pt.teacher_id=? ORDER BY p.name,m.order_no,m.id`).all(req.user.id)));
app.post('/api/teacher/modules',auth,role('teacher'),(req,res)=>{const b=req.body;const ok=db.prepare('SELECT 1 FROM program_teachers WHERE program_id=? AND teacher_id=?').get(Number(b.program_id),req.user.id);if(!ok)return res.status(403).json({error:'Formation non affectée'});const r=db.prepare('INSERT INTO modules(program_id,title,description,order_no) VALUES(?,?,?,?)').run(Number(b.program_id),b.title,b.description||'',Number(b.order_no||1));res.json({ok:true,id:r.lastInsertRowid});});
app.post('/api/teacher/lessons',auth,role('teacher'),(req,res)=>{const b=req.body;const ok=db.prepare('SELECT 1 FROM modules m JOIN program_teachers pt ON pt.program_id=m.program_id WHERE m.id=? AND pt.teacher_id=?').get(Number(b.module_id),req.user.id);if(!ok)return res.status(403).json({error:'Module non autorisé'});const r=db.prepare('INSERT INTO lessons(module_id,title,type,content,video_url,file_url,meeting_url,scheduled_at,duration_minutes,order_no) VALUES(?,?,?,?,?,?,?,?,?,?)').run(Number(b.module_id),b.title,b.type||'Texte',b.content||'',b.video_url||'',b.file_url||'',b.meeting_url||'',b.scheduled_at||null,Number(b.duration_minutes||60),Number(b.order_no||1));res.json({ok:true,id:r.lastInsertRowid});});
app.get('/api/teacher/students',auth,role('teacher'),(req,res)=>res.json(db.prepare(`SELECT DISTINCT s.id,s.student_no,s.name,s.email,s.phone,p.name program_name FROM students s JOIN program_teachers pt ON pt.teacher_id=? JOIN programs p ON p.id=pt.program_id AND p.id=s.program_id ORDER BY s.name`).all(req.user.id)));
// Student portal
app.get('/api/student/me',auth,role('student'),(req,res)=>res.json(db.prepare('SELECT s.id,s.student_no,s.name,s.email,s.phone,s.status,p.name program_name FROM students s LEFT JOIN programs p ON p.id=s.program_id WHERE s.id=?').get(req.user.id)));
app.get('/api/student/content',auth,role('student'),(req,res)=>{const s=db.prepare('SELECT * FROM students WHERE id=?').get(req.user.id);const rows=db.prepare(`SELECT m.id module_id,m.title module_title,m.description,l.id lesson_id,l.title lesson_title,l.type,l.content,l.video_url,l.file_url,l.order_no,COALESCE(lp.completed,0) completed FROM modules m JOIN lessons l ON l.module_id=m.id LEFT JOIN lesson_progress lp ON lp.lesson_id=l.id AND lp.student_id=? WHERE m.program_id=? AND m.active=1 AND l.active=1 ORDER BY m.order_no,l.order_no`).all(s.id,s.program_id);res.json(rows);});app.post('/api/student/progress',auth,role('student'),(req,res)=>{db.prepare(`INSERT INTO lesson_progress(student_id,lesson_id,completed,completed_at) VALUES(?,?,1,CURRENT_TIMESTAMP) ON CONFLICT(student_id,lesson_id) DO UPDATE SET completed=1,completed_at=CURRENT_TIMESTAMP`).run(req.user.id,Number(req.body.lesson_id));res.json({ok:true});});
app.use((req,res)=>{if(req.path.startsWith('/api/'))return res.status(404).json({error:'Route API introuvable',path:req.path});res.status(404).send('Page introuvable');});
app.use((err,req,res,next)=>{console.error('CETEP ERROR',err);if(res.headersSent)return next(err);res.status(500).json({error:'Erreur interne du serveur'});});
app.listen(PORT,'0.0.0.0',()=>console.log(`CETEP v11.9.0 running on ${PORT}`));
