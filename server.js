require('dotenv').config();
const express=require('express');
const cookieParser=require('cookie-parser');
const bcrypt=require('bcryptjs');
const jwt=require('jsonwebtoken');
const Database=require('better-sqlite3');
const path=require('path');

const app=express();
const PORT=process.env.PORT||3000;
app.use(express.json());
app.use(cookieParser());
const SECRET=process.env.JWT_SECRET||'CHANGE_ME_IN_PRODUCTION';

const db=new Database(path.join(__dirname,'cetep.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS admins(id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS programs(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,duration TEXT,description TEXT,price_htg REAL DEFAULT 0,active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS students(id INTEGER PRIMARY KEY AUTOINCREMENT,student_no TEXT UNIQUE NOT NULL,name TEXT NOT NULL,birth_date TEXT,phone TEXT,email TEXT,program_id INTEGER,education TEXT,status TEXT DEFAULT 'En attente',created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(program_id) REFERENCES programs(id));
CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY AUTOINCREMENT,student_id INTEGER,amount_htg REAL NOT NULL,method TEXT NOT NULL,status TEXT DEFAULT 'En attente',reference TEXT UNIQUE,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(student_id) REFERENCES students(id));
CREATE TABLE IF NOT EXISTS buttons(id INTEGER PRIMARY KEY AUTOINCREMENT,label TEXT NOT NULL,url TEXT NOT NULL,description TEXT,active INTEGER DEFAULT 1);
`);
const adminEmail = process.env.ADMIN_EMAIL || 'admin@cetep.ht';
const adminPassword = process.env.ADMIN_PASSWORD || 'CHANGEZ_MOI';

const existingAdmin = db.prepare('SELECT id FROM admins ORDER BY id LIMIT 1').get();
if (existingAdmin) {
  db.prepare(`
    UPDATE admins
    SET email=?, password_hash=?
    WHERE id=?
  `).run(
    adminEmail,
    bcrypt.hashSync(adminPassword, 12),
    existingAdmin.id
  );
} else {
  db.prepare(`
    INSERT INTO admins(email,password_hash)
    VALUES(?,?)
  `).run(
    adminEmail,
    bcrypt.hashSync(adminPassword, 12)
  );
}
}
if(db.prepare('SELECT COUNT(*) c FROM programs').get().c===0){
 const ins=db.prepare('INSERT INTO programs(name,duration,description,price_htg) VALUES(?,?,?,?)');
 ins.run('Secourisme de base','9 mois','Formation aux premiers secours et à la sécurité.',0);
 ins.run('Aide-soignant(e)','6 mois','Formation orientée vers l’accompagnement, l’hygiène et les soins de base.',0);
 ins.run('Programmes métiers','Variable','Parcours pratiques selon les besoins de la communauté.',0);
 ins.run('Formation continue','Flexible','Modules courts de perfectionnement.',0);
}
if(db.prepare('SELECT COUNT(*) c FROM buttons').get().c===0){
 const ins=db.prepare('INSERT INTO buttons(label,url,description) VALUES(?,?,?)');
 ins.run('Inscription en ligne','#admission','Déposer une demande d’admission');
 ins.run('Paiement en ligne','#paiement','Payer les frais de formation');
 ins.run('BATON W','#baton','Découvrir le programme solidaire');
}
app.use(express.static(__dirname));
function auth(req,res,next){
 try{const token=req.cookies.cetep_token;if(!token)return res.status(401).json({error:'Non autorisé'});req.user=jwt.verify(token,SECRET);next();}
 catch(e){return res.status(401).json({error:'Session expirée'});}
}
function nextStudentNo(){const n=db.prepare('SELECT COUNT(*) c FROM students').get().c+1;return `CETEP-${new Date().getFullYear()}-${String(n).padStart(4,'0')}`;}
app.post('/api/login',(req,res)=>{const {email,password}=req.body||{};const a=db.prepare('SELECT * FROM admins WHERE email=?').get(email||'');if(!a||!bcrypt.compareSync(password||'',a.password_hash))return res.status(401).json({error:'Identifiants invalides'});const token=jwt.sign({id:a.id,email:a.email},SECRET,{expiresIn:'8h'});res.cookie('cetep_token',token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:8*60*60*1000});res.json({ok:true});});
app.post('/api/logout',(req,res)=>{res.clearCookie('cetep_token');res.json({ok:true});});
app.get('/health',(req,res)=>res.json({ok:true,service:'CETEP'}));
app.get('/api/public/programs',(req,res)=>res.json(db.prepare('SELECT * FROM programs WHERE active=1 ORDER BY id').all()));
app.get('/api/public/buttons',(req,res)=>res.json(db.prepare('SELECT id,label,url,description FROM buttons WHERE active=1 ORDER BY id').all()));
app.post('/api/admissions',(req,res)=>{try{const b=req.body||{};const p=db.prepare('SELECT id FROM programs WHERE name=? AND active=1').get(b.program);const no=nextStudentNo();db.prepare('INSERT INTO students(student_no,name,birth_date,phone,email,program_id,education) VALUES(?,?,?,?,?,?,?)').run(no,b.name,b.birth_date||null,b.phone,b.email||null,p?.id||null,b.education||null);res.status(201).json({ok:true,student_no:no,message:'Demande enregistrée.'});}catch(e){res.status(400).json({error:e.message});}});
app.get('/api/admin/stats',auth,(req,res)=>{res.json({students:db.prepare('SELECT COUNT(*) c FROM students').get().c,programs:db.prepare('SELECT COUNT(*) c FROM programs WHERE active=1').get().c,pending:db.prepare("SELECT COUNT(*) c FROM students WHERE status='En attente'").get().c,revenue:db.prepare("SELECT COALESCE(SUM(amount_htg),0) s FROM payments WHERE status='Confirmé'").get().s});});
app.get('/api/admin/students',auth,(req,res)=>res.json(db.prepare('SELECT s.*,p.name program_name FROM students s LEFT JOIN programs p ON p.id=s.program_id ORDER BY s.id DESC').all()));
app.post('/api/admin/programs',auth,(req,res)=>{const b=req.body||{};const r=db.prepare('INSERT INTO programs(name,duration,description,price_htg) VALUES(?,?,?,?)').run(b.name,b.duration||'',b.description||'',Number(b.price_htg||0));res.json({id:r.lastInsertRowid});});
app.put('/api/admin/programs/:id',auth,(req,res)=>{const b=req.body||{};db.prepare('UPDATE programs SET name=?,duration=?,description=?,price_htg=?,active=? WHERE id=?').run(b.name,b.duration||'',b.description||'',Number(b.price_htg||0),b.active===false?0:1,req.params.id);res.json({ok:true});});
app.get('/api/admin/programs',auth,(req,res)=>res.json(db.prepare('SELECT * FROM programs ORDER BY id').all()));
app.post('/api/admin/payments',auth,(req,res)=>{const b=req.body||{};const ref=b.reference||`MAN-${Date.now()}`;const r=db.prepare('INSERT INTO payments(student_id,amount_htg,method,status,reference) VALUES(?,?,?,?,?)').run(Number(b.student_id),Number(b.amount_htg),b.method||'Manuel',b.status||'Confirmé',ref);res.json({id:r.lastInsertRowid,reference:ref});});
app.get('/api/admin/payments',auth,(req,res)=>res.json(db.prepare('SELECT p.*,s.student_no,s.name student_name FROM payments p LEFT JOIN students s ON s.id=p.student_id ORDER BY p.id DESC').all()));
app.get('/api/admin/buttons',auth,(req,res)=>res.json(db.prepare('SELECT * FROM buttons ORDER BY id').all()));
app.post('/api/admin/buttons',auth,(req,res)=>{const b=req.body||{};const r=db.prepare('INSERT INTO buttons(label,url,description) VALUES(?,?,?)').run(b.label,b.url,b.description||'');res.json({id:r.lastInsertRowid});});
app.put('/api/admin/buttons/:id',auth,(req,res)=>{const b=req.body||{};db.prepare('UPDATE buttons SET label=?,url=?,description=?,active=? WHERE id=?').run(b.label,b.url,b.description||'',b.active===false?0:1,req.params.id);res.json({ok:true});});
app.delete('/api/admin/buttons/:id',auth,(req,res)=>{db.prepare('DELETE FROM buttons WHERE id=?').run(req.params.id);res.json({ok:true});});
app.get('/api/admin/me',auth,(req,res)=>res.json({email:req.user.email}));
app.get('/admin',(req,res)=>res.sendFile(path.join(__dirname,'admin.html')));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.listen(PORT,()=>console.log(`CETEP V4: http://localhost:${PORT}`));
