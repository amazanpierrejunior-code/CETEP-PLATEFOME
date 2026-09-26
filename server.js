require("dotenv").config();

const express = require("express");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 10000;
const DATA_DIR = process.env.DATA_DIR || __dirname;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const SECRET = process.env.JWT_SECRET || "CHANGE_ME_IN_PRODUCTION";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@cetep.ht";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "CHANGEZ_MOI";

const db = new Database(path.join(DATA_DIR, "cetep.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  duration TEXT,
  description TEXT,
  price_htg REAL DEFAULT 0,
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_no TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  birth_date TEXT,
  phone TEXT,
  email TEXT,
  program_id INTEGER,
  education TEXT,
  status TEXT DEFAULT 'En attente',
  password_hash TEXT,
  access_enabled INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(program_id) REFERENCES programs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_no TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS program_teachers (
  program_id INTEGER NOT NULL,
  teacher_id INTEGER NOT NULL,
  PRIMARY KEY(program_id, teacher_id),
  FOREIGN KEY(program_id) REFERENCES programs(id) ON DELETE CASCADE,
  FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  program_id INTEGER NOT NULL,
  status TEXT DEFAULT 'Actif',
  enrolled_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(student_id, program_id),
  FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY(program_id) REFERENCES programs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS modules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  order_no INTEGER DEFAULT 1,
  active INTEGER DEFAULT 1,
  FOREIGN KEY(program_id) REFERENCES programs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  type TEXT DEFAULT 'Texte',
  content TEXT,
  video_url TEXT,
  file_url TEXT,
  order_no INTEGER DEFAULT 1,
  active INTEGER DEFAULT 1,
  FOREIGN KEY(module_id) REFERENCES modules(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS lesson_progress (
  student_id INTEGER NOT NULL,
  lesson_id INTEGER NOT NULL,
  completed INTEGER DEFAULT 0,
  completed_at TEXT,
  PRIMARY KEY(student_id, lesson_id),
  FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY(lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  instructions TEXT,
  max_score REAL DEFAULT 100,
  due_date TEXT,
  active INTEGER DEFAULT 1,
  FOREIGN KEY(module_id) REFERENCES modules(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  answer TEXT,
  file_url TEXT,
  score REAL,
  feedback TEXT,
  submitted_at TEXT DEFAULT CURRENT_TIMESTAMP,
  graded_at TEXT,
  UNIQUE(assignment_id, student_id),
  FOREIGN KEY(assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
  FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER,
  amount_htg REAL NOT NULL,
  method TEXT NOT NULL,
  status TEXT DEFAULT 'En attente',
  reference TEXT UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS buttons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT,
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
`);

function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
}

if (!hasColumn("admins", "role")) db.exec("ALTER TABLE admins ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'");
if (!hasColumn("students", "password_hash")) db.exec("ALTER TABLE students ADD COLUMN password_hash TEXT");
if (!hasColumn("students", "access_enabled")) db.exec("ALTER TABLE students ADD COLUMN access_enabled INTEGER DEFAULT 0");
if (!hasColumn("students", "birth_place")) db.exec("ALTER TABLE students ADD COLUMN birth_place TEXT");
if (!hasColumn("students", "blood_group")) db.exec("ALTER TABLE students ADD COLUMN blood_group TEXT");
if (!hasColumn("students", "responsible_person")) db.exec("ALTER TABLE students ADD COLUMN responsible_person TEXT");
if (!hasColumn("students", "marital_status")) db.exec("ALTER TABLE students ADD COLUMN marital_status TEXT");

const defaults = {
  school_name: "CETEP",
  school_full_name: "Centre d'Encadrement Technique et Professionnel",
  slogan: "Formation • Orientation • Insertion professionnelle",
  primary_color: "#0d2b52",
  secondary_color: "#1677b8",
  accent_color: "#087443",
  logo_text: "CETEP",
  logo_url: ""
};
for (const [key,value] of Object.entries(defaults)) {
  db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)").run(key,value);
}

const admin = db.prepare("SELECT id FROM admins ORDER BY id LIMIT 1").get();
const adminHash = bcrypt.hashSync(ADMIN_PASSWORD, 12);
if (admin) {
  db.prepare("UPDATE admins SET email=?, password_hash=?, role='admin' WHERE id=?").run(ADMIN_EMAIL, adminHash, admin.id);
} else {
  db.prepare("INSERT INTO admins(email,password_hash,role) VALUES(?,?,?)").run(ADMIN_EMAIL, adminHash, "admin");
}

if (db.prepare("SELECT COUNT(*) c FROM programs").get().c === 0) {
  const add = db.prepare("INSERT INTO programs(name,duration,description,price_htg) VALUES(?,?,?,?)");
  add.run("Secourisme de base", "9 mois", "Formation aux premiers secours et à la sécurité.", 0);
  add.run("Aide-soignant(e)", "6 mois", "Formation orientée vers l'accompagnement, l'hygiène et les soins de base.", 0);
  add.run("Programmes métiers", "Variable", "Parcours pratiques selon les besoins de la communauté.", 0);
  add.run("Formation continue", "Flexible", "Modules courts de perfectionnement.", 0);
}

if (db.prepare("SELECT COUNT(*) c FROM buttons").get().c === 0) {
  const add = db.prepare("INSERT INTO buttons(label,url,description) VALUES(?,?,?)");
  add.run("Inscription en ligne", "#admission", "Déposer une demande d'admission");
  add.run("Paiement en ligne", "#paiement", "Payer les frais de formation");
  add.run("BATON W", "#baton", "Découvrir le programme solidaire");
}

function sign(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: "8h" });
}

function auth(req, res, next) {
  try {
    const token = req.cookies.cetep_token;
    if (!token) return res.status(401).json({ error: "Non autorisé" });
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Session expirée" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Accès interdit" });
    }
    next();
  };
}

function nextTeacherNo() {
  const year = new Date().getFullYear();
  const count = db.prepare("SELECT COUNT(*) c FROM teachers").get().c;
  return `PROF-${year}-${String(count + 1).padStart(4, "0")}`;
}

function nextStudentNo() {
  const year = new Date().getFullYear();
  let n = db.prepare("SELECT COUNT(*) c FROM students").get().c + 1;
  let no = `CETEP-${year}-${String(n).padStart(4, "0")}`;
  while (db.prepare("SELECT 1 FROM students WHERE student_no=?").get(no)) { n += 1; no = `CETEP-${year}-${String(n).padStart(4, "0")}`; }
  return no;
}

function getSettings() {
  return Object.fromEntries(db.prepare("SELECT key,value FROM settings").all().map(x => [x.key,x.value]));
}

function studentAccess(req, res, next) {
  if (req.user.role !== "student") return res.status(403).json({ error: "Accès étudiant requis" });
  const s = db.prepare("SELECT * FROM students WHERE id=?").get(req.user.id);
  if (!s || !s.access_enabled || !["Actif", "Diplômé"].includes(s.status)) {
    return res.status(403).json({ error: "Accès étudiant fermé ou suspendu" });
  }
  req.student = s;
  next();
}

app.use(express.static(__dirname));

app.get("/health", (req, res) => res.json({ ok: true, service: "CETEP V7 FINAL" }));

app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};
  const a = db.prepare("SELECT * FROM admins WHERE email=?").get(email || "");
  if (!a || !bcrypt.compareSync(password || "", a.password_hash)) {
    return res.status(401).json({ error: "Identifiants invalides" });
  }
  res.cookie("cetep_token", sign({ id: a.id, email: a.email, role: "admin" }), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 8 * 60 * 60 * 1000
  });
  res.json({ ok: true, role: "admin", redirect: "/admin" });
});

app.post("/api/student/login", (req, res) => {
  const { code, password } = req.body || {};
  const s = db.prepare("SELECT * FROM students WHERE student_no=?").get((code || "").trim().toUpperCase());
  if (!s || !s.password_hash || !s.access_enabled || !["Actif", "Diplômé"].includes(s.status) ||
      !bcrypt.compareSync(password || "", s.password_hash)) {
    return res.status(401).json({ error: "Code étudiant, mot de passe ou accès invalide." });
  }
  res.cookie("cetep_token", sign({ id: s.id, role: "student", student_no: s.student_no }), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 8 * 60 * 60 * 1000
  });
  res.json({ ok: true, role: "student", redirect: "/student" });
});

app.post("/api/teacher/login", (req, res) => {
  const { email, password } = req.body || {};
  const t = db.prepare("SELECT * FROM teachers WHERE email=?").get((email || "").trim().toLowerCase());
  if (!t || !t.active || !bcrypt.compareSync(password || "", t.password_hash)) {
    return res.status(401).json({ error: "Identifiants professeur invalides." });
  }
  res.cookie("cetep_token", sign({ id: t.id, role: "teacher", teacher_no: t.teacher_no }), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 8 * 60 * 60 * 1000
  });
  res.json({ ok: true, role: "teacher", redirect: "/teacher" });
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("cetep_token");
  res.json({ ok: true });
});

app.get("/api/session", auth, (req, res) => res.json({ user: req.user }));

app.get("/api/public/programs", (req, res) => {
  res.json(db.prepare("SELECT * FROM programs WHERE active=1 ORDER BY id").all());
});

app.get("/api/public/buttons", (req, res) => {
  res.json(db.prepare("SELECT id,label,url,description FROM buttons WHERE active=1 ORDER BY id").all());
});

app.post("/api/admissions", (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name || !b.phone) return res.status(400).json({ error: "Nom et téléphone obligatoires." });
    const p = db.prepare("SELECT id FROM programs WHERE name=? AND active=1").get(b.program);
    const no = nextStudentNo();
    db.prepare(`INSERT INTO students(student_no,name,birth_date,phone,email,program_id,education,status,access_enabled)
      VALUES(?,?,?,?,?,?,?,?,0)`).run(no,b.name,b.birth_date||null,b.phone,b.email||null,p?.id||null,b.education||null,"En attente");
    res.status(201).json({ ok:true, student_no:no, message:"Demande enregistrée. L'administration activera votre espace." });
  } catch(e) { res.status(400).json({ error:e.message }); }
});

app.get("/api/admin/settings", auth, requireRole("admin"), (req,res) => res.json(getSettings()));

app.put("/api/admin/settings", auth, requireRole("admin"), (req,res) => {
  const allowed = ["school_name","school_full_name","slogan","primary_color","secondary_color","accent_color","logo_text","logo_url"];
  const stmt = db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  const tx = db.transaction(() => { for (const key of allowed) if (req.body && req.body[key] !== undefined) stmt.run(key,String(req.body[key])); });
  tx();
  res.json({ok:true,settings:getSettings()});
});

app.get("/api/public/settings", (req,res) => res.json(getSettings()));

app.get("/api/admin/stats", auth, requireRole("admin"), (req,res) => {
  res.json({
    students: db.prepare("SELECT COUNT(*) c FROM students").get().c,
    activeStudents: db.prepare("SELECT COUNT(*) c FROM students WHERE access_enabled=1").get().c,
    teachers: db.prepare("SELECT COUNT(*) c FROM teachers").get().c,
    programs: db.prepare("SELECT COUNT(*) c FROM programs WHERE active=1").get().c,
    pending: db.prepare("SELECT COUNT(*) c FROM students WHERE status='En attente'").get().c,
    revenue: db.prepare("SELECT COALESCE(SUM(amount_htg),0) s FROM payments WHERE status='Confirmé'").get().s
  });
});

app.get("/api/admin/students", auth, requireRole("admin"), (req,res) => {
  res.json(db.prepare(`SELECT s.*, p.name program_name FROM students s LEFT JOIN programs p ON p.id=s.program_id ORDER BY s.id DESC`).all());
});

app.post("/api/admin/students", auth, requireRole("admin"), (req,res) => {
  try {
    const b=req.body||{};
    if(!b.name || !b.phone || !b.program_id) return res.status(400).json({error:"Nom, téléphone et formation sont obligatoires."});
    const p=db.prepare("SELECT id FROM programs WHERE id=? AND active=1").get(Number(b.program_id));
    if(!p) return res.status(400).json({error:"Formation invalide."});
    const no=nextStudentNo();
    const password=String(b.password||"123456");
    if(password.length<6) return res.status(400).json({error:"Mot de passe: 6 caractères minimum."});
    const hash=bcrypt.hashSync(password,12);
    const r=db.prepare(`INSERT INTO students(student_no,name,birth_date,birth_place,phone,email,program_id,education,blood_group,responsible_person,marital_status,status,password_hash,access_enabled) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(no,b.name,b.birth_date||null,b.birth_place||null,b.phone,b.email||null,Number(b.program_id),b.education||null,b.blood_group||null,b.responsible_person||null,b.marital_status||null,b.status||"Actif",hash,b.access_enabled===false?0:1);
    db.prepare("INSERT OR IGNORE INTO enrollments(student_id,program_id,status) VALUES(?,?,?)").run(r.lastInsertRowid,Number(b.program_id),b.access_enabled===false?"En attente":"Actif");
    res.status(201).json({ok:true,id:r.lastInsertRowid,student_no:no});
  } catch(e){ res.status(400).json({error:e.message}); }
});

app.post("/api/admin/students/:id/access", auth, requireRole("admin"), (req,res) => {
  const { enabled, status, password } = req.body || {};
  const s = db.prepare("SELECT * FROM students WHERE id=?").get(req.params.id);
  if (!s) return res.status(404).json({error:"Élève introuvable"});
  const newStatus = status || (enabled ? "Actif" : "Suspendu");
  let hash = s.password_hash;
  if (password) hash = bcrypt.hashSync(password,12);
  db.prepare("UPDATE students SET access_enabled=?, status=?, password_hash=? WHERE id=?")
    .run(enabled ? 1 : 0, newStatus, hash, s.id);
  res.json({ok:true, message: enabled ? "Accès activé." : "Accès fermé."});
});

app.put("/api/admin/students/:id", auth, requireRole("admin"), (req,res) => {
  try {
    const b=req.body||{};
    const old=db.prepare("SELECT * FROM students WHERE id=?").get(req.params.id);
    if(!old) return res.status(404).json({error:"Étudiant introuvable"});
    db.prepare(`UPDATE students SET name=?,birth_date=?,birth_place=?,phone=?,email=?,program_id=?,education=?,blood_group=?,responsible_person=?,marital_status=?,status=? WHERE id=?`)
      .run(b.name||old.name,b.birth_date||null,b.birth_place||null,b.phone||null,b.email||null,b.program_id?Number(b.program_id):null,b.education||null,b.blood_group||null,b.responsible_person||null,b.marital_status||null,b.status||old.status,req.params.id);
    if(b.program_id) db.prepare("INSERT OR IGNORE INTO enrollments(student_id,program_id,status) VALUES(?,?,?)").run(req.params.id,Number(b.program_id),b.status==='Suspendu'?"Suspendu":"Actif");
    res.json({ok:true});
  } catch(e){res.status(400).json({error:e.message});}
});

app.post("/api/admin/students/:id/reset-password", auth, requireRole("admin"), (req,res) => {
  const password = req.body?.password;
  if (!password || String(password).length < 6) return res.status(400).json({error:"Mot de passe de 6 caractères minimum."});
  db.prepare("UPDATE students SET password_hash=? WHERE id=?").run(bcrypt.hashSync(password,12), req.params.id);
  res.json({ok:true});
});

app.post("/api/admin/teachers", auth, requireRole("admin"), (req,res) => {
  try {
    const b=req.body||{};
    if(!b.name||!b.email||!b.password) return res.status(400).json({error:"Nom, email et mot de passe obligatoires."});
    const no=nextTeacherNo();
    const r=db.prepare("INSERT INTO teachers(teacher_no,name,email,phone,password_hash,active) VALUES(?,?,?,?,?,1)")
      .run(no,b.name,b.email.toLowerCase(),b.phone||null,bcrypt.hashSync(b.password,12));
    res.json({ok:true,id:r.lastInsertRowid,teacher_no:no});
  } catch(e){res.status(400).json({error:e.message});}
});

app.get("/api/admin/teachers", auth, requireRole("admin"), (req,res) => {
  res.json(db.prepare("SELECT id,teacher_no,name,email,phone,active,created_at FROM teachers ORDER BY id DESC").all());
});

app.post("/api/admin/teachers/:id/status", auth, requireRole("admin"), (req,res) => {
  db.prepare("UPDATE teachers SET active=? WHERE id=?").run(req.body?.active?1:0,req.params.id);
  res.json({ok:true});
});

app.get("/api/admin/programs", auth, requireRole("admin"), (req,res) => {
  res.json(db.prepare("SELECT * FROM programs ORDER BY id").all());
});

app.post("/api/admin/programs", auth, requireRole("admin"), (req,res) => {
  const b=req.body||{};
  if(!b.name) return res.status(400).json({error:"Nom obligatoire"});
  const r=db.prepare("INSERT INTO programs(name,duration,description,price_htg,active) VALUES(?,?,?,?,?)")
    .run(b.name,b.duration||"",b.description||"",Number(b.price_htg||0),b.active===false?0:1);
  res.json({ok:true,id:r.lastInsertRowid});
});

app.put("/api/admin/programs/:id", auth, requireRole("admin"), (req,res) => {
  const b=req.body||{};
  db.prepare("UPDATE programs SET name=?,duration=?,description=?,price_htg=?,active=? WHERE id=?")
    .run(b.name,b.duration||"",b.description||"",Number(b.price_htg||0),b.active===false?0:1,req.params.id);
  res.json({ok:true});
});

app.delete("/api/admin/programs/:id", auth, requireRole("admin"), (req,res) => {
  db.prepare("DELETE FROM programs WHERE id=?").run(req.params.id);
  res.json({ok:true});
});

app.get("/api/admin/modules", auth, requireRole("admin"), (req,res) => {
  res.json(db.prepare(`SELECT m.*,p.name program_name FROM modules m JOIN programs p ON p.id=m.program_id ORDER BY p.id,m.order_no,m.id`).all());
});

app.post("/api/admin/modules", auth, requireRole("admin"), (req,res) => {
  const b=req.body||{};
  if(!b.program_id||!b.title) return res.status(400).json({error:"Formation et titre obligatoires."});
  const r=db.prepare("INSERT INTO modules(program_id,title,description,order_no,active) VALUES(?,?,?,?,1)")
    .run(b.program_id,b.title,b.description||"",Number(b.order_no||1));
  res.json({ok:true,id:r.lastInsertRowid});
});

app.post("/api/admin/lessons", auth, requireRole("admin"), (req,res) => {
  const b=req.body||{};
  if(!b.module_id||!b.title) return res.status(400).json({error:"Module et titre obligatoires."});
  const r=db.prepare(`INSERT INTO lessons(module_id,title,type,content,video_url,file_url,order_no,active)
    VALUES(?,?,?,?,?,?,?,1)`).run(b.module_id,b.title,b.type||"Texte",b.content||"",b.video_url||"",b.file_url||"",Number(b.order_no||1));
  res.json({ok:true,id:r.lastInsertRowid});
});

app.get("/api/admin/lessons", auth, requireRole("admin"), (req,res) => {
  res.json(db.prepare(`SELECT l.*,m.title module_title,p.name program_name
    FROM lessons l JOIN modules m ON m.id=l.module_id JOIN programs p ON p.id=m.program_id
    ORDER BY p.id,m.order_no,l.order_no,l.id`).all());
});

app.get("/api/admin/enrollments", auth, requireRole("admin"), (req,res) => {
  res.json(db.prepare(`SELECT e.id,e.student_id,e.program_id,e.status,s.student_no,s.name student_name,p.name program_name FROM enrollments e JOIN students s ON s.id=e.student_id JOIN programs p ON p.id=e.program_id ORDER BY e.id DESC`).all());
});

app.get("/api/admin/teacher-assignments", auth, requireRole("admin"), (req,res) => {
  res.json(db.prepare(`SELECT pt.program_id,pt.teacher_id,t.teacher_no,t.name teacher_name,p.name program_name FROM program_teachers pt JOIN teachers t ON t.id=pt.teacher_id JOIN programs p ON p.id=pt.program_id ORDER BY p.name,t.name`).all());
});

app.delete("/api/admin/teacher-assign", auth, requireRole("admin"), (req,res) => {
  db.prepare("DELETE FROM program_teachers WHERE program_id=? AND teacher_id=?").run(req.body.program_id,req.body.teacher_id);
  res.json({ok:true});
});

app.post("/api/admin/assign-teacher", auth, requireRole("admin"), (req,res) => {
  try {
    db.prepare("INSERT OR IGNORE INTO program_teachers(program_id,teacher_id) VALUES(?,?)").run(req.body.program_id,req.body.teacher_id);
    res.json({ok:true});
  } catch(e){res.status(400).json({error:e.message});}
});

app.post("/api/admin/enroll", auth, requireRole("admin"), (req,res) => {
  try {
    const s=db.prepare("SELECT id FROM students WHERE id=?").get(req.body.student_id);
    const p=db.prepare("SELECT id FROM programs WHERE id=?").get(req.body.program_id);
    if(!s||!p) return res.status(404).json({error:"Élève ou formation introuvable"});
    db.prepare("INSERT OR IGNORE INTO enrollments(student_id,program_id,status) VALUES(?,?,?)").run(s.id,p.id,"Actif");
    db.prepare("UPDATE students SET program_id=? WHERE id=?").run(p.id,s.id);
    res.json({ok:true});
  } catch(e){res.status(400).json({error:e.message});}
});

app.post("/api/admin/assignments", auth, requireRole("admin"), (req,res) => {
  const b=req.body||{};
  if(!b.module_id||!b.title) return res.status(400).json({error:"Module et titre obligatoires."});
  const r=db.prepare(`INSERT INTO assignments(module_id,title,instructions,max_score,due_date,active)
    VALUES(?,?,?,?,?,1)`).run(b.module_id,b.title,b.instructions||"",Number(b.max_score||100),b.due_date||null);
  res.json({ok:true,id:r.lastInsertRowid});
});

app.post("/api/admin/payments", auth, requireRole("admin"), (req,res) => {
  try {
    const b=req.body||{};
    const ref=b.reference||`MAN-${Date.now()}`;
    const r=db.prepare("INSERT INTO payments(student_id,amount_htg,method,status,reference) VALUES(?,?,?,?,?)")
      .run(Number(b.student_id),Number(b.amount_htg),b.method||"Manuel",b.status||"Confirmé",ref);
    res.json({ok:true,id:r.lastInsertRowid,reference:ref});
  } catch(e){res.status(400).json({error:e.message});}
});

app.get("/api/admin/payments", auth, requireRole("admin"), (req,res) => {
  res.json(db.prepare(`SELECT p.*,s.student_no,s.name student_name FROM payments p LEFT JOIN students s ON s.id=p.student_id ORDER BY p.id DESC`).all());
});

app.get("/api/teacher/me", auth, requireRole("teacher"), (req,res) => {
  res.json(db.prepare("SELECT id,teacher_no,name,email,phone FROM teachers WHERE id=?").get(req.user.id));
});

app.get("/api/teacher/programs", auth, requireRole("teacher"), (req,res) => {
  res.json(db.prepare(`SELECT p.* FROM programs p JOIN program_teachers pt ON pt.program_id=p.id WHERE pt.teacher_id=? ORDER BY p.id`).all(req.user.id));
});

app.get("/api/teacher/students", auth, requireRole("teacher"), (req,res) => {
  res.json(db.prepare(`SELECT DISTINCT s.id,s.student_no,s.name,s.email,s.phone,s.status,p.name program_name
    FROM students s JOIN enrollments e ON e.student_id=s.id
    JOIN program_teachers pt ON pt.program_id=e.program_id
    JOIN programs p ON p.id=e.program_id
    WHERE pt.teacher_id=? ORDER BY s.name`).all(req.user.id));
});

app.get("/api/teacher/progress/:studentId", auth, requireRole("teacher"), (req,res) => {
  const allowed=db.prepare(`SELECT 1 FROM enrollments e JOIN program_teachers pt ON pt.program_id=e.program_id
    WHERE e.student_id=? AND pt.teacher_id=? LIMIT 1`).get(req.params.studentId,req.user.id);
  if(!allowed) return res.status(403).json({error:"Cet élève ne fait pas partie de vos formations."});
  const rows=db.prepare(`SELECT l.id,l.title,m.title module_title,
    COALESCE(lp.completed,0) completed
    FROM lessons l JOIN modules m ON m.id=l.module_id
    JOIN enrollments e ON e.program_id=m.program_id AND e.student_id=?
    LEFT JOIN lesson_progress lp ON lp.lesson_id=l.id AND lp.student_id=?
    ORDER BY m.order_no,l.order_no`).all(req.params.studentId,req.params.studentId);
  const pct=rows.length?Math.round(rows.filter(x=>x.completed).length*100/rows.length):0;
  res.json({progress:pct,lessons:rows});
});

app.post("/api/teacher/grade", auth, requireRole("teacher"), (req,res) => {
  const b=req.body||{};
  const allowed=db.prepare(`SELECT 1 FROM submissions sub
    JOIN assignments a ON a.id=sub.assignment_id
    JOIN modules m ON m.id=a.module_id
    JOIN program_teachers pt ON pt.program_id=m.program_id
    WHERE sub.id=? AND pt.teacher_id=?`).get(b.submission_id,req.user.id);
  if(!allowed) return res.status(403).json({error:"Accès interdit"});
  db.prepare("UPDATE submissions SET score=?,feedback=?,graded_at=CURRENT_TIMESTAMP WHERE id=?")
    .run(Number(b.score),b.feedback||"",b.submission_id);
  res.json({ok:true});
});

app.get("/api/student/me", auth, studentAccess, (req,res) => {
  const s=req.student;
  const p=s.program_id?db.prepare("SELECT * FROM programs WHERE id=?").get(s.program_id):null;
  res.json({id:s.id,student_no:s.student_no,name:s.name,email:s.email,phone:s.phone,status:s.status,program:p});
});

app.get("/api/student/courses", auth, studentAccess, (req,res) => {
  const rows=db.prepare(`SELECT p.id,p.name,p.duration,p.description,e.status enrollment_status
    FROM enrollments e JOIN programs p ON p.id=e.program_id
    WHERE e.student_id=? ORDER BY p.id`).all(req.student.id);
  const result=rows.map(p=>{
    const total=db.prepare(`SELECT COUNT(*) c FROM lessons l JOIN modules m ON m.id=l.module_id WHERE m.program_id=? AND l.active=1`).get(p.id).c;
    const done=db.prepare(`SELECT COUNT(*) c FROM lesson_progress lp JOIN lessons l ON l.id=lp.lesson_id JOIN modules m ON m.id=l.module_id WHERE lp.student_id=? AND m.program_id=? AND lp.completed=1`).get(req.student.id,p.id).c;
    return {...p,progress:total?Math.round(done*100/total):0};
  });
  res.json(result);
});

app.get("/api/student/course/:id", auth, studentAccess, (req,res) => {
  const allowed=db.prepare("SELECT * FROM enrollments WHERE student_id=? AND program_id=? AND status='Actif'").get(req.student.id,req.params.id);
  if(!allowed) return res.status(403).json({error:"Formation non accessible."});
  const modules=db.prepare("SELECT * FROM modules WHERE program_id=? AND active=1 ORDER BY order_no,id").all(req.params.id);
  const data=modules.map(m=>({
    ...m,
    lessons:db.prepare(`SELECT l.id,l.title,l.type,l.content,l.video_url,l.file_url,l.order_no,
      COALESCE(lp.completed,0) completed FROM lessons l
      LEFT JOIN lesson_progress lp ON lp.lesson_id=l.id AND lp.student_id=?
      WHERE l.module_id=? AND l.active=1 ORDER BY l.order_no,l.id`).all(req.student.id,m.id),
    assignments:db.prepare("SELECT * FROM assignments WHERE module_id=? AND active=1 ORDER BY id").all(m.id)
  }));
  res.json({program:db.prepare("SELECT * FROM programs WHERE id=?").get(req.params.id),modules:data});
});

app.post("/api/student/lesson/:id/complete", auth, studentAccess, (req,res) => {
  const lesson=db.prepare(`SELECT l.id,m.program_id FROM lessons l JOIN modules m ON m.id=l.module_id WHERE l.id=?`).get(req.params.id);
  if(!lesson) return res.status(404).json({error:"Leçon introuvable"});
  const allowed=db.prepare("SELECT 1 FROM enrollments WHERE student_id=? AND program_id=? AND status='Actif'").get(req.student.id,lesson.program_id);
  if(!allowed) return res.status(403).json({error:"Accès interdit"});
  db.prepare(`INSERT INTO lesson_progress(student_id,lesson_id,completed,completed_at)
    VALUES(?,?,1,CURRENT_TIMESTAMP)
    ON CONFLICT(student_id,lesson_id) DO UPDATE SET completed=1,completed_at=CURRENT_TIMESTAMP`)
    .run(req.student.id,lesson.id);
  res.json({ok:true});
});

app.get("/api/student/assignments", auth, studentAccess, (req,res) => {
  res.json(db.prepare(`SELECT a.id,a.title,a.instructions,a.max_score,a.due_date,m.title module_title,
    sub.id submission_id,sub.answer,sub.file_url,sub.score,sub.feedback
    FROM assignments a JOIN modules m ON m.id=a.module_id
    JOIN enrollments e ON e.program_id=m.program_id AND e.student_id=?
    LEFT JOIN submissions sub ON sub.assignment_id=a.id AND sub.student_id=?
    WHERE a.active=1 ORDER BY a.id DESC`).all(req.student.id,req.student.id));
});

app.post("/api/student/assignments/:id/submit", auth, studentAccess, (req,res) => {
  const a=db.prepare(`SELECT a.id,m.program_id FROM assignments a JOIN modules m ON m.id=a.module_id WHERE a.id=?`).get(req.params.id);
  if(!a) return res.status(404).json({error:"Devoir introuvable"});
  const allowed=db.prepare("SELECT 1 FROM enrollments WHERE student_id=? AND program_id=? AND status='Actif'").get(req.student.id,a.program_id);
  if(!allowed) return res.status(403).json({error:"Accès interdit"});
  db.prepare(`INSERT INTO submissions(assignment_id,student_id,answer,file_url)
    VALUES(?,?,?,?)
    ON CONFLICT(assignment_id,student_id) DO UPDATE SET answer=excluded.answer,file_url=excluded.file_url,submitted_at=CURRENT_TIMESTAMP`)
    .run(a.id,req.student.id,req.body?.answer||"",req.body?.file_url||"");
  res.json({ok:true});
});

app.get("/admin", (req,res)=>res.sendFile(path.join(__dirname,"admin.html")));
app.get("/student", (req,res)=>res.sendFile(path.join(__dirname,"student.html")));
app.get("/teacher", (req,res)=>res.sendFile(path.join(__dirname,"teacher.html")));
app.get("/login", (req,res)=>res.sendFile(path.join(__dirname,"login.html")));
app.get("/", (req,res)=>res.sendFile(path.join(__dirname,"index.html")));

app.listen(PORT,()=>console.log(`CETEP V7 FINAL: http://localhost:${PORT}`));
