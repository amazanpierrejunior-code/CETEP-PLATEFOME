require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;

const DATA_DIR =
  process.env.DATA_DIR || path.join(__dirname, 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true, limit: '8mb' }));
app.use(cookieParser());

app.use(express.static(path.join(__dirname, 'public')));

const SECRET =
  process.env.JWT_SECRET || 'CHANGE_ME_IN_RENDER';

const db = new Database(
  path.join(DATA_DIR, 'cetep.sqlite')
);

db.pragma('journal_mode=WAL');
db.pragma('foreign_keys=ON');

/* =========================================================
   DATABASE
========================================================= */

db.exec(`
CREATE TABLE IF NOT EXISTS admins(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS programs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  duration TEXT,
  description TEXT,
  price_htg REAL DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS students(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_no TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  birth_date TEXT,
  birth_place TEXT,
  phone TEXT,
  email TEXT,
  program_id INTEGER,
  education TEXT,
  blood_group TEXT,
  responsible_person TEXT,
  marital_status TEXT,
  status TEXT DEFAULT 'En attente',
  password_hash TEXT,
  access_enabled INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(program_id)
    REFERENCES programs(id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS teachers(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_no TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS program_teachers(
  program_id INTEGER NOT NULL,
  teacher_id INTEGER NOT NULL,
  PRIMARY KEY(program_id, teacher_id),
  FOREIGN KEY(program_id)
    REFERENCES programs(id)
    ON DELETE CASCADE,
  FOREIGN KEY(teacher_id)
    REFERENCES teachers(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS enrollments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  program_id INTEGER NOT NULL,
  status TEXT DEFAULT 'Actif',
  enrolled_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(student_id, program_id),
  FOREIGN KEY(student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,
  FOREIGN KEY(program_id)
    REFERENCES programs(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS modules(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  order_no INTEGER DEFAULT 1,
  active INTEGER DEFAULT 1,
  FOREIGN KEY(program_id)
    REFERENCES programs(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS lessons(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  type TEXT DEFAULT 'Texte',
  content TEXT,
  video_url TEXT,
  file_url TEXT,
  order_no INTEGER DEFAULT 1,
  active INTEGER DEFAULT 1,
  FOREIGN KEY(module_id)
    REFERENCES modules(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS lesson_progress(
  student_id INTEGER NOT NULL,
  lesson_id INTEGER NOT NULL,
  completed INTEGER DEFAULT 0,
  completed_at TEXT,
  PRIMARY KEY(student_id, lesson_id),
  FOREIGN KEY(student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,
  FOREIGN KEY(lesson_id)
    REFERENCES lessons(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS assignments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  instructions TEXT,
  max_score REAL DEFAULT 100,
  due_date TEXT,
  active INTEGER DEFAULT 1,
  FOREIGN KEY(module_id)
    REFERENCES modules(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS submissions(
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
  FOREIGN KEY(assignment_id)
    REFERENCES assignments(id)
    ON DELETE CASCADE,
  FOREIGN KEY(student_id)
    REFERENCES students(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS documents(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id INTEGER,
  lesson_id INTEGER,
  title TEXT NOT NULL,
  description TEXT,
  file_url TEXT,
  file_type TEXT DEFAULT 'Document',
  order_no INTEGER DEFAULT 1,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(module_id)
    REFERENCES modules(id)
    ON DELETE CASCADE,
  FOREIGN KEY(lesson_id)
    REFERENCES lessons(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER,
  amount_htg REAL NOT NULL,
  method TEXT NOT NULL,
  status TEXT DEFAULT 'Confirmé',
  reference TEXT UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(student_id)
    REFERENCES students(id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS support_methods(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  account_name TEXT,
  account_value TEXT,
  bank_name TEXT,
  bank_account TEXT,
  routing TEXT,
  instructions TEXT,
  active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS donations(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  email TEXT,
  amount REAL,
  method TEXT,
  reference TEXT,
  message TEXT,
  status TEXT DEFAULT 'En attente',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
`);

/* =========================================================
   HELPERS
========================================================= */

function jsonError(res, status, message) {
  return res.status(status).json({
    error: message
  });
}

function makeToken(user) {
  return jwt.sign(user, SECRET, {
    expiresIn: '7d'
  });
}

function auth(req, res, next) {
  try {
    let token = req.cookies.cetep_token;

    const header = req.headers.authorization || '';

    if (!token && header.startsWith('Bearer ')) {
      token = header.substring(7);
    }

    if (!token) {
      return jsonError(res, 401, 'Non authentifié');
    }

    req.user = jwt.verify(token, SECRET);

    next();
  } catch (e) {
    return jsonError(res, 401, 'Session expirée ou invalide');
  }
}

function role(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return jsonError(res, 403, 'Accès refusé');
    }

    next();
  };
}

function clean(value) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
}

function numberOr(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/* =========================================================
   DEFAULT ADMIN
========================================================= */

const adminEmail =
  process.env.ADMIN_EMAIL || 'admin@cetep.ht';

const adminPassword =
  process.env.ADMIN_PASSWORD || 'CHANGEZ_MOI';

const adminExists = db
  .prepare('SELECT id FROM admins WHERE email=?')
  .get(adminEmail);

if (!adminExists) {
  const hash = bcrypt.hashSync(adminPassword, 10);

  db.prepare(`
    INSERT INTO admins(email,password_hash)
    VALUES(?,?)
  `).run(adminEmail, hash);

  console.log(
    `Admin CETEP créé: ${adminEmail}`
  );
}

/* =========================================================
   HEALTH
========================================================= */

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    app: 'CETEP',
    version: '11.0.0',
    status: 'running',
    time: new Date().toISOString()
  });
});

/* =========================================================
   PUBLIC PAGES
========================================================= */

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/teacher', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'teacher.html'));
});

app.get('/student', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'student.html'));
});

/* =========================================================
   AUTHENTICATION
========================================================= */

/* =========================================================
   AUTHENTICATION
========================================================= */

/*
  ADMINISTRATION
  Nou kenbe nouvo route la epi nou ajoute ansyen route la
  kòm alias pou evite "Route API introuvable".
*/

function loginAdmin(req, res) {

  const email = clean(req.body.email).toLowerCase();
  const password = clean(req.body.password);

  const admin = db
    .prepare('SELECT * FROM admins WHERE email=?')
    .get(email);

  if (
    !admin ||
    !bcrypt.compareSync(password, admin.password_hash)
  ) {
    return jsonError(
      res,
      401,
      'Email ou mot de passe incorrect'
    );
  }

  const token = makeToken({
    id: admin.id,
    role: 'admin',
    email: admin.email
  });

  res.cookie('cetep_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });

  return res.json({
    ok: true,
    role: 'admin',
    redirect: '/admin'
  });
}


/* Nouvo route */
app.post('/api/login/admin', loginAdmin);

/* Ansyen route - compatibility */
app.post('/api/login', loginAdmin);


/*
  PROFESSEUR
*/

function loginTeacher(req, res) {

  const email = clean(req.body.email).toLowerCase();
  const password = clean(req.body.password);

  const teacher = db
    .prepare('SELECT * FROM teachers WHERE email=?')
    .get(email);

  if (
    !teacher ||
    !teacher.active ||
    !bcrypt.compareSync(
      password,
      teacher.password_hash
    )
  ) {
    return jsonError(
      res,
      401,
      'Email ou mot de passe incorrect'
    );
  }

  const token = makeToken({
    id: teacher.id,
    role: 'teacher',
    email: teacher.email
  });

  res.cookie('cetep_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });

  return res.json({
    ok: true,
    role: 'teacher',
    redirect: '/teacher'
  });
}


/* Nouveau route */
app.post('/api/login/teacher', loginTeacher);

/* Ancien route - compatibility */
app.post('/api/teacher/login', loginTeacher);


/*
  ETUDIANT
*/

function loginStudent(req, res) {

  /*
    login.html utilise "code".
    Pour compatibilité, le serveur accepte également
    "student_no".
  */

  const studentNo = clean(
    req.body.code ||
    req.body.student_no
  ).toUpperCase();

  const password = clean(req.body.password);

  const student = db
    .prepare('SELECT * FROM students WHERE student_no=?')
    .get(studentNo);

  if (
    !student ||
    !student.access_enabled ||
    !student.password_hash ||
    !bcrypt.compareSync(
      password,
      student.password_hash
    )
  ) {
    return jsonError(
      res,
      401,
      'Code étudiant ou mot de passe incorrect'
    );
  }

  const token = makeToken({
    id: student.id,
    role: 'student',
    student_no: student.student_no
  });

  res.cookie('cetep_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });

  return res.json({
    ok: true,
    role: 'student',
    redirect: '/student'
  });
}


/* Nouveau route */
app.post('/api/login/student', loginStudent);

/* Ancien route - compatibility */
app.post('/api/student/login', loginStudent);


/*
  LOGOUT
*/

app.post('/api/logout', (req, res) => {

  res.clearCookie('cetep_token');

  res.json({
    ok: true
  });

});


/*
  SESSION
*/

app.get('/api/session', auth, (req, res) => {

  res.json({
    authenticated: true,
    user: req.user
  });

});
/* =========================================================
   PUBLIC SETTINGS / PROGRAMS
========================================================= */

app.get('/api/public/settings', (req, res) => {
  const rows = db
    .prepare('SELECT key,value FROM settings')
    .all();

  const settings = {};

  for (const row of rows) {
    settings[row.key] = row.value;
  }

  res.json(settings);
});

app.get('/api/public/programs', (req, res) => {
  res.json(
    db
      .prepare(`
        SELECT *
        FROM programs
        WHERE active=1
        ORDER BY id DESC
      `)
      .all()
  );
});

app.get('/api/public/support', (req, res) => {
  res.json(
    db
      .prepare(`
        SELECT *
        FROM support_methods
        WHERE active=1
        ORDER BY sort_order,id
      `)
      .all()
  );
});

/* =========================================================
   PUBLIC ADMISSION
========================================================= */

app.post('/api/admissions', (req, res) => {
  try {
    const b = req.body;

    const name = clean(b.name);

    if (!name) {
      return jsonError(
        res,
        400,
        'Le nom est obligatoire'
      );
    }

    const programId =
      b.program_id
        ? Number(b.program_id)
        : null;

    if (programId) {
      const program = db
        .prepare(
          'SELECT id FROM programs WHERE id=? AND active=1'
        )
        .get(programId);

      if (!program) {
        return jsonError(
          res,
          400,
          'Formation invalide'
        );
      }
    }

    const row = db
      .prepare(`
        SELECT COUNT(*) AS c
        FROM students
      `)
      .get();

    const studentNo =
      'CETEP-' +
      String(Number(row.c) + 1).padStart(5, '0');

    const result = db
      .prepare(`
        INSERT INTO students(
          student_no,
          name,
          birth_date,
          birth_place,
          phone,
          email,
          program_id,
          education,
          blood_group,
          responsible_person,
          marital_status,
          status
        )
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      `)
      .run(
        studentNo,
        name,
        clean(b.birth_date),
        clean(b.birth_place),
        clean(b.phone),
        clean(b.email),
        programId,
        clean(b.education),
        clean(b.blood_group),
        clean(b.responsible_person),
        clean(b.marital_status),
        'En attente'
      );

    if (programId) {
      db.prepare(`
        INSERT OR IGNORE INTO enrollments(
          student_id,
          program_id,
          status
        )
        VALUES(?,?,?)
      `).run(
        result.lastInsertRowid,
        programId,
        'Actif'
      );
    }

    res.json({
      ok: true,
      student_no: studentNo,
      message: 'Demande d’admission enregistrée'
    });
  } catch (e) {
    res.status(400).json({
      error: e.message
    });
  }
});

/* =========================================================
   PUBLIC DONATION
========================================================= */

app.post('/api/donations', (req, res) => {
  try {
    const b = req.body;

    db.prepare(`
      INSERT INTO donations(
        name,
        email,
        amount,
        method,
        reference,
        message
      )
      VALUES(?,?,?,?,?,?)
    `).run(
      clean(b.name),
      clean(b.email),
      numberOr(b.amount, 0),
      clean(b.method),
      clean(b.reference),
      clean(b.message)
    );

    res.json({
      ok: true,
      message: 'Soutien enregistré'
    });
  } catch (e) {
    res.status(400).json({
      error: e.message
    });
  }
});

/* =========================================================
   ADMIN DASHBOARD
========================================================= */

app.get(
  '/api/admin/stats',
  auth,
  role('admin'),
  (req, res) => {
    const students = db
      .prepare('SELECT COUNT(*) AS c FROM students')
      .get().c;

    const teachers = db
      .prepare('SELECT COUNT(*) AS c FROM teachers')
      .get().c;

    const programs = db
      .prepare('SELECT COUNT(*) AS c FROM programs')
      .get().c;

    const modules = db
      .prepare('SELECT COUNT(*) AS c FROM modules')
      .get().c;

    const lessons = db
      .prepare('SELECT COUNT(*) AS c FROM lessons')
      .get().c;

    const documents = db
      .prepare('SELECT COUNT(*) AS c FROM documents')
      .get().c;

    const payments = db
      .prepare(`
        SELECT COALESCE(SUM(amount_htg),0) AS total
        FROM payments
      `)
      .get().total;

    res.json({
      students,
      teachers,
      programs,
      modules,
      lessons,
      documents,
      payments
    });
  }
);

/* =========================================================
   ADMIN SETTINGS
========================================================= */

app.get(
  '/api/admin/settings',
  auth,
  role('admin'),
  (req, res) => {
    const rows = db
      .prepare('SELECT key,value FROM settings')
      .all();

    const settings = {};

    rows.forEach(row => {
      settings[row.key] = row.value;
    });

    res.json(settings);
  }
);

app.post(
  '/api/admin/settings',
  auth,
  role('admin'),
  (req, res) => {
    const settings = req.body || {};

    const stmt = db.prepare(`
      INSERT INTO settings(key,value)
      VALUES(?,?)
      ON CONFLICT(key)
      DO UPDATE SET value=excluded.value
    `);

    const tx = db.transaction(() => {
      for (const [key, value] of Object.entries(settings)) {
        stmt.run(
          String(key),
          String(value ?? '')
        );
      }
    });

    tx();

    res.json({ ok: true });
  }
);

/* =========================================================
   ADMIN STUDENTS
========================================================= */

app.get(
  '/api/admin/students',
  auth,
  role('admin'),
  (req, res) => {
    res.json(
      db.prepare(`
        SELECT
          s.*,
          p.name AS program_name
        FROM students s
        LEFT JOIN programs p
          ON p.id=s.program_id
        ORDER BY s.id DESC
      `).all()
    );
  }
);

app.post(
  '/api/admin/students',
  auth,
  role('admin'),
  (req, res) => {
    try {
      const b = req.body;

      const count = db
        .prepare(
          'SELECT COUNT(*) AS c FROM students'
        )
        .get().c;

      const studentNo =
        clean(b.student_no) ||
        'CETEP-' +
        String(Number(count) + 1).padStart(5, '0');

      const password =
        clean(b.password) || studentNo;

      const hash =
        bcrypt.hashSync(password, 10);

      const programId =
        b.program_id
          ? Number(b.program_id)
          : null;

      const result = db.prepare(`
        INSERT INTO students(
          student_no,
          name,
          birth_date,
          birth_place,
          phone,
          email,
          program_id,
          education,
          blood_group,
          responsible_person,
          marital_status,
          status,
          password_hash,
          access_enabled
        )
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        studentNo,
        clean(b.name),
        clean(b.birth_date),
        clean(b.birth_place),
        clean(b.phone),
        clean(b.email),
        programId,
        clean(b.education),
        clean(b.blood_group),
        clean(b.responsible_person),
        clean(b.marital_status),
        clean(b.status) || 'Actif',
        hash,
        b.access_enabled === undefined
          ? 1
          : Number(b.access_enabled)
      );

      if (programId) {
        db.prepare(`
          INSERT OR IGNORE INTO enrollments(
            student_id,
            program_id
          )
          VALUES(?,?)
        `).run(
          result.lastInsertRowid,
          programId
        );
      }

      res.json({
        ok: true,
        id: result.lastInsertRowid,
        student_no: studentNo,
        temporary_password: password
      });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

app.put(
  '/api/admin/students/:id',
  auth,
  role('admin'),
  (req, res) => {
    try {
      const id = Number(req.params.id);
      const b = req.body;

      const current = db
        .prepare(
          'SELECT * FROM students WHERE id=?'
        )
        .get(id);

      if (!current) {
        return jsonError(
          res,
          404,
          'Étudiant introuvable'
        );
      }

      let passwordHash =
        current.password_hash;

      if (clean(b.password)) {
        passwordHash =
          bcrypt.hashSync(
            clean(b.password),
            10
          );
      }

      const programId =
        b.program_id === '' ||
        b.program_id === null ||
        b.program_id === undefined
          ? null
          : Number(b.program_id);

      db.prepare(`
        UPDATE students
        SET
          student_no=?,
          name=?,
          birth_date=?,
          birth_place=?,
          phone=?,
          email=?,
          program_id=?,
          education=?,
          blood_group=?,
          responsible_person=?,
          marital_status=?,
          status=?,
          password_hash=?,
          access_enabled=?
        WHERE id=?
      `).run(
        clean(b.student_no) || current.student_no,
        clean(b.name) || current.name,
        clean(b.birth_date),
        clean(b.birth_place),
        clean(b.phone),
        clean(b.email),
        programId,
        clean(b.education),
        clean(b.blood_group),
        clean(b.responsible_person),
        clean(b.marital_status),
        clean(b.status) || current.status,
        passwordHash,
        b.access_enabled === undefined
          ? current.access_enabled
          : Number(b.access_enabled),
        id
      );

      if (programId) {
        db.prepare(`
          INSERT OR IGNORE INTO enrollments(
            student_id,
            program_id
          )
          VALUES(?,?)
        `).run(id, programId);
      }

      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

app.delete(
  '/api/admin/students/:id',
  auth,
  role('admin'),
  (req, res) => {
    db.prepare(
      'DELETE FROM students WHERE id=?'
    ).run(Number(req.params.id));

    res.json({ ok: true });
  }
);

app.post(
  '/api/admin/students/:id/access',
  auth,
  role('admin'),
  (req, res) => {
    const id = Number(req.params.id);

    const enabled =
      Number(req.body.enabled ?? 1);

    db.prepare(`
      UPDATE students
      SET access_enabled=?
      WHERE id=?
    `).run(enabled ? 1 : 0, id);

    res.json({ ok: true });
  }
);

/* =========================================================
   ADMIN TEACHERS
========================================================= */

app.get(
  '/api/admin/teachers',
  auth,
  role('admin'),
  (req, res) => {
    res.json(
      db.prepare(`
        SELECT
          id,
          teacher_no,
          name,
          email,
          phone,
          active,
          created_at
        FROM teachers
        ORDER BY id DESC
      `).all()
    );
  }
);

app.post(
  '/api/admin/teachers',
  auth,
  role('admin'),
  (req, res) => {
    try {
      const b = req.body;

      const teacherNo =
        clean(b.teacher_no) ||
        'PROF-' +
        Date.now().toString().slice(-6);

      const password =
        clean(b.password) ||
        teacherNo;

      const hash =
        bcrypt.hashSync(password, 10);

      const result = db.prepare(`
        INSERT INTO teachers(
          teacher_no,
          name,
          email,
          phone,
          password_hash,
          active
        )
        VALUES(?,?,?,?,?,?)
      `).run(
        teacherNo,
        clean(b.name),
        clean(b.email).toLowerCase(),
        clean(b.phone),
        hash,
        b.active === undefined
          ? 1
          : Number(b.active)
      );

      res.json({
        ok: true,
        id: result.lastInsertRowid,
        teacher_no: teacherNo,
        temporary_password: password
      });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

app.put(
  '/api/admin/teachers/:id',
  auth,
  role('admin'),
  (req, res) => {
    try {
      const id = Number(req.params.id);
      const b = req.body;

      const teacher = db
        .prepare(
          'SELECT * FROM teachers WHERE id=?'
        )
        .get(id);

      if (!teacher) {
        return jsonError(
          res,
          404,
          'Professeur introuvable'
        );
      }

      let hash =
        teacher.password_hash;

      if (clean(b.password)) {
        hash =
          bcrypt.hashSync(
            clean(b.password),
            10
          );
      }

      db.prepare(`
        UPDATE teachers
        SET
          teacher_no=?,
          name=?,
          email=?,
          phone=?,
          password_hash=?,
          active=?
        WHERE id=?
      `).run(
        clean(b.teacher_no) || teacher.teacher_no,
        clean(b.name) || teacher.name,
        clean(b.email).toLowerCase() || teacher.email,
        clean(b.phone),
        hash,
        b.active === undefined
          ? teacher.active
          : Number(b.active),
        id
      );

      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

app.post(
  '/api/admin/teachers/:id/status',
  auth,
  role('admin'),
  (req, res) => {
    db.prepare(`
      UPDATE teachers
      SET active=?
      WHERE id=?
    `).run(
      Number(req.body.active) ? 1 : 0,
      Number(req.params.id)
    );

    res.json({ ok: true });
  }
);

app.delete(
  '/api/admin/teachers/:id',
  auth,
  role('admin'),
  (req, res) => {
    db.prepare(
      'DELETE FROM teachers WHERE id=?'
    ).run(Number(req.params.id));

    res.json({ ok: true });
  }
);

/* =========================================================
   PROGRAM TEACHERS
========================================================= */

app.get(
  '/api/admin/program-teachers/:programId',
  auth,
  role('admin'),
  (req, res) => {
    const programId =
      Number(req.params.programId);

    res.json(
      db.prepare(`
        SELECT
          t.id,
          t.teacher_no,
          t.name,
          t.email,
          t.active
        FROM teachers t
        JOIN program_teachers pt
          ON pt.teacher_id=t.id
        WHERE pt.program_id=?
        ORDER BY t.name
      `).all(programId)
    );
  }
);

app.post(
  '/api/admin/program-teachers',
  auth,
  role('admin'),
  (req, res) => {
    const programId =
      Number(req.body.program_id);

    const teacherId =
      Number(req.body.teacher_id);

    db.prepare(`
      INSERT OR IGNORE INTO program_teachers(
        program_id,
        teacher_id
      )
      VALUES(?,?)
    `).run(programId, teacherId);

    res.json({ ok: true });
  }
);

app.delete(
  '/api/admin/program-teachers',
  auth,
  role('admin'),
  (req, res) => {
    db.prepare(`
      DELETE FROM program_teachers
      WHERE program_id=?
        AND teacher_id=?
    `).run(
      Number(req.body.program_id),
      Number(req.body.teacher_id)
    );

    res.json({ ok: true });
  }
);

/* =========================================================
   ADMIN PROGRAMS
========================================================= */

app.get(
  '/api/admin/programs',
  auth,
  role('admin'),
  (req, res) => {
    res.json(
      db.prepare(`
        SELECT *
        FROM programs
        ORDER BY id DESC
      `).all()
    );
  }
);

app.post(
  '/api/admin/programs',
  auth,
  role('admin'),
  (req, res) => {
    try {
      const b = req.body;

      if (!clean(b.name)) {
        return jsonError(
          res,
          400,
          'Le nom de la formation est obligatoire'
        );
      }

      const result = db.prepare(`
        INSERT INTO programs(
          name,
          duration,
          description,
          price_htg,
          active
        )
        VALUES(?,?,?,?,?)
      `).run(
        clean(b.name),
        clean(b.duration),
        clean(b.description),
        numberOr(b.price_htg, 0),
        b.active === undefined
          ? 1
          : Number(b.active)
      );

      res.json({
        ok: true,
        id: result.lastInsertRowid
      });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

app.put(
  '/api/admin/programs/:id',
  auth,
  role('admin'),
  (req, res) => {
    try {
      const id = Number(req.params.id);
      const b = req.body;

      const program = db
        .prepare(
          'SELECT * FROM programs WHERE id=?'
        )
        .get(id);

      if (!program) {
        return jsonError(
          res,
          404,
          'Formation introuvable'
        );
      }

      db.prepare(`
        UPDATE programs
        SET
          name=?,
          duration=?,
          description=?,
          price_htg=?,
          active=?
        WHERE id=?
      `).run(
        clean(b.name) || program.name,
        clean(b.duration),
        clean(b.description),
        numberOr(b.price_htg, program.price_htg),
        b.active === undefined
          ? program.active
          : Number(b.active),
        id
      );

      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

app.delete(
  '/api/admin/programs/:id',
  auth,
  role('admin'),
  (req, res) => {
    db.prepare(
      'DELETE FROM programs WHERE id=?'
    ).run(Number(req.params.id));

    res.json({ ok: true });
  }
);

app.post(
  '/api/admin/programs/:id/status',
  auth,
  role('admin'),
  (req, res) => {
    db.prepare(`
      UPDATE programs
      SET active=?
      WHERE id=?
    `).run(
      Number(req.body.active) ? 1 : 0,
      Number(req.params.id)
    );

    res.json({ ok: true });
  }
);

/* =========================================================
   ADMIN MODULES
========================================================= */

app.get(
  '/api/admin/modules',
  auth,
  role('admin'),
  (req, res) => {
    const programId =
      req.query.program_id
        ? Number(req.query.program_id)
        : null;

    if (programId) {
      return res.json(
        db.prepare(`
          SELECT
            m.*,
            p.name AS program_name
          FROM modules m
          JOIN programs p
            ON p.id=m.program_id
          WHERE m.program_id=?
          ORDER BY m.order_no,m.id
        `).all(programId)
      );
    }

    res.json(
      db.prepare(`
        SELECT
          m.*,
          p.name AS program_name
        FROM modules m
        JOIN programs p
          ON p.id=m.program_id
        ORDER BY p.name,m.order_no,m.id
      `).all()
    );
  }
);

app.post(
  '/api/admin/modules',
  auth,
  role('admin'),
  (req, res) => {
    try {
      const b = req.body;

      const programId =
        Number(b.program_id);

      const program = db
        .prepare(
          'SELECT id FROM programs WHERE id=?'
        )
        .get(programId);

      if (!program) {
        return jsonError(
          res,
          400,
          'Formation introuvable'
        );
      }

      if (!clean(b.title)) {
        return jsonError(
          res,
          400,
          'Le titre du module est obligatoire'
        );
      }

      const result = db.prepare(`
        INSERT INTO modules(
          program_id,
          title,
          description,
          order_no,
          active
        )
        VALUES(?,?,?,?,?)
      `).run(
        programId,
        clean(b.title),
        clean(b.description),
        numberOr(b.order_no, 1),
        b.active === undefined
          ? 1
          : Number(b.active)
      );

      res.json({
        ok: true,
        id: result.lastInsertRowid
      });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

app.put(
  '/api/admin/modules/:id',
  auth,
  role('admin'),
  (req, res) => {
    try {
      const id = Number(req.params.id);
      const b = req.body;

      const module = db
        .prepare(
          'SELECT * FROM modules WHERE id=?'
        )
        .get(id);

      if (!module) {
        return jsonError(
          res,
          404,
          'Module introuvable'
        );
      }

      const programId =
        b.program_id === undefined
          ? module.program_id
          : Number(b.program_id);

      db.prepare(`
        UPDATE modules
        SET
          program_id=?,
          title=?,
          description=?,
          order_no=?,
          active=?
        WHERE id=?
      `).run(
        programId,
        clean(b.title) || module.title,
        clean(b.description),
        numberOr(b.order_no, module.order_no),
        b.active === undefined
          ? module.active
          : Number(b.active),
        id
      );

      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

app.delete(
  '/api/admin/modules/:id',
  auth,
  role('admin'),
  (req, res) => {
    db.prepare(
      'DELETE FROM modules WHERE id=?'
    ).run(Number(req.params.id));

    res.json({ ok: true });
  }
);

app.post(
  '/api/admin/modules/:id/status',
  auth,
  role('admin'),
  (req, res) => {
    db.prepare(`
      UPDATE modules
      SET active=?
      WHERE id=?
    `).run(
      Number(req.body.active) ? 1 : 0,
      Number(req.params.id)
    );

    res.json({ ok: true });
  }
);

/* =========================================================
   ADMIN LESSONS
========================================================= */

app.get(
  '/api/admin/lessons',
  auth,
  role('admin'),
  (req, res) => {
    const moduleId =
      req.query.module_id
        ? Number(req.query.module_id)
        : null;

    if (moduleId) {
      return res.json(
        db.prepare(`
          SELECT
            l.*,
            m.title AS module_title,
            p.name AS program_name
          FROM lessons l
          JOIN modules m
            ON m.id=l.module_id
          JOIN programs p
            ON p.id=m.program_id
          WHERE l.module_id=?
          ORDER BY l.order_no,l.id
        `).all(moduleId)
      );
    }

    res.json(
      db.prepare(`
        SELECT
          l.*,
          m.title AS module_title,
          p.name AS program_name
        FROM lessons l
        JOIN modules m
          ON m.id=l.module_id
        JOIN programs p
          ON p.id=m.program_id
        ORDER BY p.name,m.order_no,l.order_no,l.id
      `).all()
    );
  }
);

app.post(
  '/api/admin/lessons',
  auth,
  role('admin'),
  (req, res) => {
    try {
      const b = req.body;

      const moduleId =
        Number(b.module_id);

      const module = db
        .prepare(
          'SELECT * FROM modules WHERE id=?'
        )
        .get(moduleId);

      if (!module) {
        return jsonError(
          res,
          400,
          'Module introuvable'
        );
      }

      if (!clean(b.title)) {
        return jsonError(
          res,
          400,
          'Le titre de la leçon est obligatoire'
        );
      }

      const result = db.prepare(`
        INSERT INTO lessons(
          module_id,
          title,
          type,
          content,
          video_url,
          file_url,
          order_no,
          active
        )
        VALUES(?,?,?,?,?,?,?,?)
      `).run(
        moduleId,
        clean(b.title),
        clean(b.type) || 'Texte',
        clean(b.content),
        clean(b.video_url),
        clean(b.file_url),
        numberOr(b.order_no, 1),
        b.active === undefined
          ? 1
          : Number(b.active)
      );

      res.json({
        ok: true,
        id: result.lastInsertRowid
      });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

app.put(
  '/api/admin/lessons/:id',
  auth,
  role('admin'),
  (req, res) => {
    try {
      const id = Number(req.params.id);
      const b = req.body;

      const lesson = db
        .prepare(
          'SELECT * FROM lessons WHERE id=?'
        )
        .get(id);

      if (!lesson) {
        return jsonError(
          res,
          404,
          'Leçon introuvable'
        );
      }

      const moduleId =
        b.module_id === undefined
          ? lesson.module_id
          : Number(b.module_id);

      const module = db
        .prepare(
          'SELECT id FROM modules WHERE id=?'
        )
        .get(moduleId);

      if (!module) {
        return jsonError(
          res,
          400,
          'Module introuvable'
        );
      }

      db.prepare(`
        UPDATE lessons
        SET
          module_id=?,
          title=?,
          type=?,
          content=?,
          video_url=?,
          file_url=?,
          order_no=?,
          active=?
        WHERE id=?
      `).run(
        moduleId,
        clean(b.title) || lesson.title,
        clean(b.type) || lesson.type,
        clean(b.content),
        clean(b.video_url),
        clean(b.file_url),
        numberOr(b.order_no, lesson.order_no),
        b.active === undefined
          ? lesson.active
          : Number(b.active),
        id
      );

      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

app.delete(
  '/api/admin/lessons/:id',
  auth,
  role('admin'),
  (req, res) => {
    db.prepare(
      'DELETE FROM lessons WHERE id=?'
    ).run(Number(req.params.id));

    res.json({ ok: true });
  }
);

app.post(
  '/api/admin/lessons/:id/status',
  auth,
  role('admin'),
  (req, res) => {
    db.prepare(`
      UPDATE lessons
      SET active=?
      WHERE id=?
    `).run(
      Number(req.body.active) ? 1 : 0,
      Number(req.params.id)
    );

    res.json({ ok: true });
  }
);

/* =========================================================
   ADMIN DOCUMENTS
========================================================= */

app.get(
  '/api/admin/documents',
  auth,
  role('admin'),
  (req, res) => {
    res.json(
      db.prepare(`
        SELECT
          d.*,
          m.title AS module_title,
          l.title AS lesson_title,
          p.name AS program_name
        FROM documents d
        LEFT JOIN modules m
          ON m.id=d.module_id
        LEFT JOIN lessons l
          ON l.id=d.lesson_id
        LEFT JOIN programs p
          ON p.id=m.program_id
        ORDER BY d.order_no,d.id
      `).all()
    );
  }
);

app.post(
  '/api/admin/documents',
  auth,
  role('admin'),
  (req, res) => {
    try {
      const b = req.body;

      const title = clean(b.title);

      if (!title) {
        return jsonError(
          res,
          400,
          'Titre du document obligatoire'
        );
      }

      const moduleId =
        b.module_id
          ? Number(b.module_id)
          : null;

      const lessonId =
        b.lesson_id
          ? Number(b.lesson_id)
          : null;

      if (!moduleId && !lessonId) {
        return jsonError(
          res,
          400,
          'Associez le document à un module ou à une leçon'
        );
      }

      let finalModuleId = moduleId;

      if (lessonId) {
        const lesson = db.prepare(`
          SELECT id,module_id
          FROM lessons
          WHERE id=?
        `).get(lessonId);

        if (!lesson) {
          return jsonError(
            res,
            400,
            'Leçon introuvable'
          );
        }

        if (
          moduleId &&
          Number(lesson.module_id) !== Number(moduleId)
        ) {
          return jsonError(
            res,
            400,
            'La leçon ne correspond pas au module'
          );
        }

        finalModuleId = lesson.module_id;
      }

      const module = db
        .prepare(
          'SELECT id FROM modules WHERE id=?'
        )
        .get(finalModuleId);

      if (!module) {
        return jsonError(
          res,
          400,
          'Module introuvable'
        );
      }

      const result = db.prepare(`
        INSERT INTO documents(
          module_id,
          lesson_id,
          title,
          description,
          file_url,
          file_type,
          order_no,
          active
        )
        VALUES(?,?,?,?,?,?,?,?)
      `).run(
        finalModuleId,
        lessonId,
        title,
        clean(b.description),
        clean(b.file_url),
        clean(b.file_type) || 'Document',
        numberOr(b.order_no, 1),
        b.active === undefined
          ? 1
          : Number(b.active)
      );

      res.json({
        ok: true,
        id: result.lastInsertRowid
      });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

app.put(
  '/api/admin/documents/:id',
  auth,
  role('admin'),
  (req, res) => {
    try {
      const id = Number(req.params.id);
      const b = req.body;

      const doc = db
        .prepare(
          'SELECT * FROM documents WHERE id=?'
        )
        .get(id);

      if (!doc) {
        return jsonError(
          res,
          404,
          'Document introuvable'
        );
      }

      let moduleId =
        b.module_id === undefined
          ? doc.module_id
          : (
              b.module_id
                ? Number(b.module_id)
                : null
            );

      let lessonId =
        b.lesson_id === undefined
          ? doc.lesson_id
          : (
              b.lesson_id
                ? Number(b.lesson_id)
                : null
            );

      if (lessonId) {
        const lesson = db.prepare(`
          SELECT id,module_id
          FROM lessons
          WHERE id=?
        `).get(lessonId);

        if (!lesson) {
          return jsonError(
            res,
            400,
            'Leçon introuvable'
          );
        }

        if (
          moduleId &&
          lesson.module_id !== moduleId
        ) {
          return jsonError(
            res,
            400,
            'La leçon ne correspond pas au module'
          );
        }

        moduleId = lesson.module_id;
      }

      if (!moduleId) {
        return jsonError(
          res,
          400,
          'Module obligatoire'
        );
      }

      db.prepare(`
        UPDATE documents
        SET
          module_id=?,
          lesson_id=?,
          title=?,
          description=?,
          file_url=?,
          file_type=?,
          order_no=?,
          active=?
        WHERE id=?
      `).run(
        moduleId,
        lessonId,
        clean(b.title) || doc.title,
        clean(b.description),
        clean(b.file_url),
        clean(b.file_type) || doc.file_type,
        numberOr(b.order_no, doc.order_no),
        b.active === undefined
          ? doc.active
          : Number(b.active),
        id
      );

      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

app.delete(
  '/api/admin/documents/:id',
  auth,
  role('admin'),
  (req, res) => {
    db.prepare(
      'DELETE FROM documents WHERE id=?'
    ).run(Number(req.params.id));

    res.json({ ok: true });
  }
);

app.post(
  '/api/admin/documents/:id/status',
  auth,
  role('admin'),
  (req, res) => {
    db.prepare(`
      UPDATE documents
      SET active=?
      WHERE id=?
    `).run(
      Number(req.body.active) ? 1 : 0,
      Number(req.params.id)
    );

    res.json({ ok: true });
  }
);

/* =========================================================
   ADMIN ASSIGNMENTS / EXERCISES
========================================================= */

app.get(
  '/api/admin/assignments',
  auth,
  role('admin'),
  (req, res) => {
    res.json(
      db.prepare(`
        SELECT
          a.*,
          m.title AS module_title,
          p.name AS program_name
        FROM assignments a
        JOIN modules m
          ON m.id=a.module_id
        JOIN programs p
          ON p.id=m.program_id
        ORDER BY a.id DESC
      `).all()
    );
  }
);

app.post(
  '/api/admin/assignments',
  auth,
  role('admin'),
  (req, res) => {
    try {
      const b = req.body;

      const moduleId =
        Number(b.module_id);

      const module = db
        .prepare(
          'SELECT id FROM modules WHERE id=?'
        )
        .get(moduleId);

      if (!module) {
        return jsonError(
          res,
          400,
          'Module introuvable'
        );
      }

      const result = db.prepare(`
        INSERT INTO assignments(
          module_id,
          title,
          instructions,
          max_score,
          due_date,
          active
        )
        VALUES(?,?,?,?,?,?)
      `).run(
        moduleId,
        clean(b.title),
        clean(b.instructions),
        numberOr(b.max_score, 100),
        clean(b.due_date),
        b.active === undefined
          ? 1
          : Number(b.active)
      );

      res.json({
        ok: true,
        id: result.lastInsertRowid
      });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

app.put(
  '/api/admin/assignments/:id',
  auth,
  role('admin'),
  (req, res) => {
    try {
      const id = Number(req.params.id);
      const b = req.body;

      const assignment = db
        .prepare(
          'SELECT * FROM assignments WHERE id=?'
        )
        .get(id);

      if (!assignment) {
        return jsonError(
          res,
          404,
          'Exercice introuvable'
        );
      }

      db.prepare(`
        UPDATE assignments
        SET
          module_id=?,
          title=?,
          instructions=?,
          max_score=?,
          due_date=?,
          active=?
        WHERE id=?
      `).run(
        b.module_id === undefined
          ? assignment.module_id
          : Number(b.module_id),
        clean(b.title) || assignment.title,
        clean(b.instructions),
        numberOr(
          b.max_score,
          assignment.max_score
        ),
        clean(b.due_date),
        b.active === undefined
          ? assignment.active
          : Number(b.active),
        id
      );

      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

app.delete(
  '/api/admin/assignments/:id',
  auth,
  role('admin'),
  (req, res) => {
    db.prepare(
      'DELETE FROM assignments WHERE id=?'
    ).run(Number(req.params.id));

    res.json({ ok: true });
  }
);

/* =========================================================
   ADMIN PAYMENTS
========================================================= */

app.get(
  '/api/admin/payments',
  auth,
  role('admin'),
  (req, res) => {
    res.json(
      db.prepare(`
        SELECT
          p.*,
          s.student_no,
          s.name AS student_name
        FROM payments p
        LEFT JOIN students s
          ON s.id=p.student_id
        ORDER BY p.id DESC
      `).all()
    );
  }
);

app.post(
  '/api/admin/payments',
  auth,
  role('admin'),
  (req, res) => {
    try {
      const b = req.body;

      const reference =
        clean(b.reference) ||
        'PAY-' + Date.now();

      const result = db.prepare(`
        INSERT INTO payments(
          student_id,
          amount_htg,
          method,
          status,
          reference
        )
        VALUES(?,?,?,?,?)
      `).run(
        b.student_id
          ? Number(b.student_id)
          : null,
        numberOr(b.amount_htg, 0),
        clean(b.method),
        clean(b.status) || 'Confirmé',
        reference
      );

      res.json({
        ok: true,
        id: result.lastInsertRowid
      });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

app.put(
  '/api/admin/payments/:id',
  auth,
  role('admin'),
  (req, res) => {
    try {
      const id = Number(req.params.id);
      const b = req.body;

      db.prepare(`
        UPDATE payments
        SET
          student_id=?,
          amount_htg=?,
          method=?,
          status=?,
          reference=?
        WHERE id=?
      `).run(
        b.student_id
          ? Number(b.student_id)
          : null,
        numberOr(b.amount_htg, 0),
        clean(b.method),
        clean(b.status) || 'Confirmé',
        clean(b.reference) || 'PAY-' + Date.now(),
        id
      );

      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

app.delete(
  '/api/admin/payments/:id',
  auth,
  role('admin'),
  (req, res) => {
    db.prepare(
      'DELETE FROM payments WHERE id=?'
    ).run(Number(req.params.id));

    res.json({ ok: true });
  }
);

/* =========================================================
   ADMIN SUPPORT METHODS
========================================================= */

app.get(
  '/api/admin/support',
  auth,
  role('admin'),
  (req, res) => {
    res.json(
      db.prepare(`
        SELECT *
        FROM support_methods
        ORDER BY sort_order,id
      `).all()
    );
  }
);

app.post(
  '/api/admin/support',
  auth,
  role('admin'),
  (req, res) => {
    const b = req.body;

    const result = db.prepare(`
      INSERT INTO support_methods(
        name,
        account_name,
        account_value,
        bank_name,
        bank_account,
        routing,
        instructions,
        active,
        sort_order
      )
      VALUES(?,?,?,?,?,?,?,?,?)
    `).run(
      clean(b.name),
      clean(b.account_name),
      clean(b.account_value),
      clean(b.bank_name),
      clean(b.bank_account),
      clean(b.routing),
      clean(b.instructions),
      b.active === undefined
        ? 1
        : Number(b.active),
      numberOr(b.sort_order, 1)
    );

    res.json({
      ok: true,
      id: result.lastInsertRowid
    });
  }
);

app.put(
  '/api/admin/support/:id',
  auth,
  role('admin'),
  (req, res) => {
    const b = req.body;

    db.prepare(`
      UPDATE support_methods
      SET
        name=?,
        account_name=?,
        account_value=?,
        bank_name=?,
        bank_account=?,
        routing=?,
        instructions=?,
        active=?,
        sort_order=?
      WHERE id=?
    `).run(
      clean(b.name),
      clean(b.account_name),
      clean(b.account_value),
      clean(b.bank_name),
      clean(b.bank_account),
      clean(b.routing),
      clean(b.instructions),
      b.active === undefined
        ? 1
        : Number(b.active),
      numberOr(b.sort_order, 1),
      Number(req.params.id)
    );

    res.json({ ok: true });
  }
);

app.delete(
  '/api/admin/support/:id',
  auth,
  role('admin'),
  (req, res) => {
    db.prepare(
      'DELETE FROM support_methods WHERE id=?'
    ).run(Number(req.params.id));

    res.json({ ok: true });
  }
);

/* =========================================================
   ADMIN DONATIONS
========================================================= */

app.get(
  '/api/admin/donations',
  auth,
  role('admin'),
  (req, res) => {
    res.json(
      db.prepare(`
        SELECT *
        FROM donations
        ORDER BY id DESC
      `).all()
    );
  }
);

app.put(
  '/api/admin/donations/:id',
  auth,
  role('admin'),
  (req, res) => {
    db.prepare(`
      UPDATE donations
      SET status=?
      WHERE id=?
    `).run(
      clean(req.body.status) || 'En attente',
      Number(req.params.id)
    );

    res.json({ ok: true });
  }
);

/* =========================================================
   TEACHER
========================================================= */

app.get(
  '/api/teacher/me',
  auth,
  role('teacher'),
  (req, res) => {
    const teacher = db.prepare(`
      SELECT
        id,
        teacher_no,
        name,
        email,
        phone,
        active
      FROM teachers
      WHERE id=?
    `).get(req.user.id);

    res.json(teacher || null);
  }
);

app.get(
  '/api/teacher/programs',
  auth,
  role('teacher'),
  (req, res) => {
    res.json(
      db.prepare(`
        SELECT p.*
        FROM programs p
        JOIN program_teachers pt
          ON pt.program_id=p.id
        WHERE pt.teacher_id=?
        ORDER BY p.name
      `).all(req.user.id)
    );
  }
);

app.get(
  '/api/teacher/modules',
  auth,
  role('teacher'),
  (req, res) => {
    res.json(
      db.prepare(`
        SELECT
          m.*,
          p.name AS program_name
        FROM modules m
        JOIN programs p
          ON p.id=m.program_id
        JOIN program_teachers pt
          ON pt.program_id=p.id
        WHERE pt.teacher_id=?
        ORDER BY p.name,m.order_no,m.id
      `).all(req.user.id)
    );
  }
);

app.post(
  '/api/teacher/modules',
  auth,
  role('teacher'),
  (req, res) => {
    try {
      const b = req.body;

      const programId =
        Number(b.program_id);

      const allowed = db.prepare(`
        SELECT 1
        FROM program_teachers
        WHERE program_id=?
          AND teacher_id=?
      `).get(
        programId,
        req.user.id
      );

      if (!allowed) {
        return jsonError(
          res,
          403,
          'Formation non autorisée'
        );
      }

      const result = db.prepare(`
        INSERT INTO modules(
          program_id,
          title,
          description,
          order_no,
          active
        )
        VALUES(?,?,?,?,?)
      `).run(
        programId,
        clean(b.title),
        clean(b.description),
        numberOr(b.order_no, 1),
        b.active === undefined
          ? 1
          : Number(b.active)
      );

      res.json({
        ok: true,
        id: result.lastInsertRowid
      });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

app.post(
  '/api/teacher/lessons',
  auth,
  role('teacher'),
  (req, res) => {
    try {
      const b = req.body;

      const moduleId =
        Number(b.module_id);

      const allowed = db.prepare(`
        SELECT 1
        FROM modules m
        JOIN program_teachers pt
          ON pt.program_id=m.program_id
        WHERE m.id=?
          AND pt.teacher_id=?
      `).get(
        moduleId,
        req.user.id
      );

      if (!allowed) {
        return jsonError(
          res,
          403,
          'Module non autorisé'
        );
      }

      const result = db.prepare(`
        INSERT INTO lessons(
          module_id,
          title,
          type,
          content,
          video_url,
          file_url,
          order_no,
          active
        )
        VALUES(?,?,?,?,?,?,?,?)
      `).run(
        moduleId,
        clean(b.title),
        clean(b.type) || 'Texte',
        clean(b.content),
        clean(b.video_url),
        clean(b.file_url),
        numberOr(b.order_no, 1),
        b.active === undefined
          ? 1
          : Number(b.active)
      );

      res.json({
        ok: true,
        id: result.lastInsertRowid
      });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

app.get(
  '/api/teacher/students',
  auth,
  role('teacher'),
  (req, res) => {
    res.json(
      db.prepare(`
        SELECT
          s.id,
          s.student_no,
          s.name,
          s.phone,
          s.email,
          s.status,
          p.name AS program_name
        FROM students s
        JOIN programs p
          ON p.id=s.program_id
        JOIN program_teachers pt
          ON pt.program_id=p.id
        WHERE pt.teacher_id=?
        ORDER BY s.name
      `).all(req.user.id)
    );
  }
);

/* =========================================================
   TEACHER ASSIGNMENTS
========================================================= */

app.get(
  '/api/teacher/assignments',
  auth,
  role('teacher'),
  (req, res) => {
    res.json(
      db.prepare(`
        SELECT
          a.*,
          m.title AS module_title,
          p.name AS program_name
        FROM assignments a
        JOIN modules m
          ON m.id=a.module_id
        JOIN programs p
          ON p.id=m.program_id
        JOIN program_teachers pt
          ON pt.program_id=p.id
        WHERE pt.teacher_id=?
        ORDER BY a.id DESC
      `).all(req.user.id)
    );
  }
);

app.post(
  '/api/teacher/assignments',
  auth,
  role('teacher'),
  (req, res) => {
    try {
      const b = req.body;

      const moduleId =
        Number(b.module_id);

      const allowed = db.prepare(`
        SELECT 1
        FROM modules m
        JOIN program_teachers pt
          ON pt.program_id=m.program_id
        WHERE m.id=?
          AND pt.teacher_id=?
      `).get(
        moduleId,
        req.user.id
      );

      if (!allowed) {
        return jsonError(
          res,
          403,
          'Module non autorisé'
        );
      }

      const result = db.prepare(`
        INSERT INTO assignments(
          module_id,
          title,
          instructions,
          max_score,
          due_date,
          active
        )
        VALUES(?,?,?,?,?,?)
      `).run(
        moduleId,
        clean(b.title),
        clean(b.instructions),
        numberOr(b.max_score, 100),
        clean(b.due_date),
        b.active === undefined
          ? 1
          : Number(b.active)
      );

      res.json({
        ok: true,
        id: result.lastInsertRowid
      });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

app.get(
  '/api/teacher/submissions',
  auth,
  role('teacher'),
  (req, res) => {
    res.json(
      db.prepare(`
        SELECT
          sub.*,
          a.title AS assignment_title,
          a.max_score,
          s.student_no,
          s.name AS student_name,
          m.title AS module_title
        FROM submissions sub
        JOIN assignments a
          ON a.id=sub.assignment_id
        JOIN modules m
          ON m.id=a.module_id
        JOIN students s
          ON s.id=sub.student_id
        JOIN program_teachers pt
          ON pt.program_id=m.program_id
        WHERE pt.teacher_id=?
        ORDER BY sub.submitted_at DESC
      `).all(req.user.id)
    );
  }
);

app.put(
  '/api/teacher/submissions/:id/grade',
  auth,
  role('teacher'),
  (req, res) => {
    try {
      const id = Number(req.params.id);

      const row = db.prepare(`
        SELECT
          sub.id,
          a.max_score,
          m.program_id
        FROM submissions sub
        JOIN assignments a
          ON a.id=sub.assignment_id
        JOIN modules m
          ON m.id=a.module_id
        JOIN program_teachers pt
          ON pt.program_id=m.program_id
        WHERE sub.id=?
          AND pt.teacher_id=?
      `).get(
        id,
        req.user.id
      );

      if (!row) {
        return jsonError(
          res,
          404,
          'Soumission introuvable'
        );
      }

      const score =
        req.body.score === null ||
        req.body.score === undefined ||
        req.body.score === ''
          ? null
          : Number(req.body.score);

      if (
        score !== null &&
        (
          !Number.isFinite(score) ||
          score < 0 ||
          score > Number(row.max_score)
        )
      ) {
        return jsonError(
          res,
          400,
          `La note doit être entre 0 et ${row.max_score}`
        );
      }

      db.prepare(`
        UPDATE submissions
        SET
          score=?,
          feedback=?,
          graded_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).run(
        score,
        clean(req.body.feedback),
        id
      );

      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

/* =========================================================
   STUDENT
========================================================= */

app.get(
  '/api/student/me',
  auth,
  role('student'),
  (req, res) => {
    const student = db.prepare(`
      SELECT
        s.id,
        s.student_no,
        s.name,
        s.birth_date,
        s.birth_place,
        s.phone,
        s.email,
        s.education,
        s.blood_group,
        s.responsible_person,
        s.marital_status,
        s.status,
        s.access_enabled,
        p.id AS program_id,
        p.name AS program_name,
        p.duration,
        p.description,
        p.price_htg
      FROM students s
      LEFT JOIN programs p
        ON p.id=s.program_id
      WHERE s.id=?
    `).get(req.user.id);

    res.json(student || null);
  }
);

/* =========================================================
   STUDENT CONTENT
========================================================= */

app.get(
  '/api/student/content',
  auth,
  role('student'),
  (req, res) => {
    const student = db
      .prepare(
        'SELECT program_id FROM students WHERE id=?'
      )
      .get(req.user.id);

    if (!student?.program_id) {
      return res.json([]);
    }

    res.json(
      db.prepare(`
        SELECT
          m.id AS module_id,
          m.title AS module_title,
          m.description AS module_description,
          m.order_no AS module_order,
          l.id AS lesson_id,
          l.title AS lesson_title,
          l.type,
          l.content,
          l.video_url,
          l.file_url,
          l.order_no AS lesson_order,
          COALESCE(lp.completed,0) AS completed
        FROM modules m
        JOIN lessons l
          ON l.module_id=m.id
        LEFT JOIN lesson_progress lp
          ON lp.lesson_id=l.id
          AND lp.student_id=?
        WHERE m.program_id=?
          AND m.active=1
          AND l.active=1
        ORDER BY
          m.order_no,
          l.order_no
      `).all(
        req.user.id,
        student.program_id
      )
    );
  }
);

/* =========================================================
   STUDENT PROGRESS
========================================================= */

app.post(
  '/api/student/progress',
  auth,
  role('student'),
  (req, res) => {
    const lessonId =
      Number(req.body.lesson_id);

    const allowed = db.prepare(`
      SELECT l.id
      FROM lessons l
      JOIN modules m
        ON m.id=l.module_id
      JOIN students s
        ON s.program_id=m.program_id
      WHERE l.id=?
        AND s.id=?
        AND m.active=1
        AND l.active=1
    `).get(
      lessonId,
      req.user.id
    );

    if (!allowed) {
      return jsonError(
        res,
        403,
        'Leçon non autorisée'
      );
    }

    db.prepare(`
      INSERT INTO lesson_progress(
        student_id,
        lesson_id,
        completed,
        completed_at
      )
      VALUES(?,?,1,CURRENT_TIMESTAMP)
      ON CONFLICT(student_id,lesson_id)
      DO UPDATE SET
        completed=1,
        completed_at=CURRENT_TIMESTAMP
    `).run(
      req.user.id,
      lessonId
    );

    res.json({
      ok: true
    });
  }
);

/* =========================================================
   STUDENT DOCUMENTS
========================================================= */

app.get(
  '/api/student/documents',
  auth,
  role('student'),
  (req, res) => {
    const student = db
      .prepare(
        'SELECT program_id FROM students WHERE id=?'
      )
      .get(req.user.id);

    if (!student?.program_id) {
      return res.json([]);
    }

    res.json(
      db.prepare(`
        SELECT
          d.*,
          m.title AS module_title,
          l.title AS lesson_title
        FROM documents d
        LEFT JOIN modules m
          ON m.id=d.module_id
        LEFT JOIN lessons l
          ON l.id=d.lesson_id
        WHERE d.active=1
          AND (
            (
              m.program_id=?
              AND m.active=1
            )
            OR
            (
              l.module_id IN (
                SELECT id
                FROM modules
                WHERE program_id=?
                  AND active=1
              )
              AND l.active=1
            )
          )
        ORDER BY
          d.order_no,
          d.id
      `).all(
        student.program_id,
        student.program_id
      )
    );
  }
);

/* =========================================================
   STUDENT ASSIGNMENTS
========================================================= */

app.get(
  '/api/student/assignments',
  auth,
  role('student'),
  (req, res) => {
    const student = db
      .prepare(`
        SELECT program_id
        FROM students
        WHERE id=?
      `)
      .get(req.user.id);

    if (!student?.program_id) {
      return res.json([]);
    }

    res.json(
      db.prepare(`
        SELECT
          a.*,
          m.title AS module_title,
          sub.id AS submission_id,
          sub.answer,
          sub.file_url AS submission_file,
          sub.score,
          sub.feedback,
          sub.submitted_at,
          sub.graded_at
        FROM assignments a
        JOIN modules m
          ON m.id=a.module_id
        LEFT JOIN submissions sub
          ON sub.assignment_id=a.id
          AND sub.student_id=?
        WHERE m.program_id=?
          AND m.active=1
          AND a.active=1
        ORDER BY
          a.due_date,
          a.id
      `).all(
        req.user.id,
        student.program_id
      )
    );
  }
);

app.post(
  '/api/student/assignments/:id/submit',
  auth,
  role('student'),
  (req, res) => {
    try {
      const assignmentId =
        Number(req.params.id);

      const assignment = db.prepare(`
        SELECT
          a.*,
          m.program_id
        FROM assignments a
        JOIN modules m
          ON m.id=a.module_id
        JOIN students s
          ON s.program_id=m.program_id
        WHERE a.id=?
          AND s.id=?
          AND a.active=1
          AND m.active=1
      `).get(
        assignmentId,
        req.user.id
      );

      if (!assignment) {
        return jsonError(
          res,
          403,
          'Exercice non autorisé'
        );
      }

      db.prepare(`
        INSERT INTO submissions(
          assignment_id,
          student_id,
          answer,
          file_url
        )
        VALUES(?,?,?,?)
        ON CONFLICT(
          assignment_id,
          student_id
        )
        DO UPDATE SET
          answer=excluded.answer,
          file_url=excluded.file_url,
          submitted_at=CURRENT_TIMESTAMP
      `).run(
        assignmentId,
        req.user.id,
        clean(req.body.answer),
        clean(req.body.file_url)
      );

      res.json({
        ok: true,
        message: 'Travail envoyé avec succès'
      });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

/* =========================================================
   ADMIN BACKUP
========================================================= */

app.get(
  '/api/admin/backup',
  auth,
  role('admin'),
  (req, res) => {
    const tables = [
      'admins',
      'programs',
      'students',
      'teachers',
      'program_teachers',
      'enrollments',
      'modules',
      'lessons',
      'lesson_progress',
      'assignments',
      'submissions',
      'documents',
      'payments',
      'support_methods',
      'donations',
      'settings'
    ];

    const out = {
      version: '11.0.0',
      created_at: new Date().toISOString(),
      tables: {}
    };

    for (const table of tables) {
      out.tables[table] =
        db.prepare(
          `SELECT * FROM ${table}`
        ).all();
    }

    res.setHeader(
      'Content-Type',
      'application/json'
    );

    res.setHeader(
      'Content-Disposition',
      'attachment; filename="cetep-backup-v11.json"'
    );

    res.send(
      JSON.stringify(out, null, 2)
    );
  }
);

/* =========================================================
   ADMIN RESTORE
========================================================= */

app.post(
  '/api/admin/restore',
  auth,
  role('admin'),
  (req, res) => {
    try {
      const data = req.body;

      if (!data?.tables) {
        throw new Error(
          'Fichier de sauvegarde invalide'
        );
      }

      const tables = [
        'programs',
        'students',
        'teachers',
        'program_teachers',
        'enrollments',
        'modules',
        'lessons',
        'lesson_progress',
        'assignments',
        'submissions',
        'documents',
        'payments',
        'support_methods',
        'donations',
        'settings'
      ];

      const tx = db.transaction(() => {
        db.pragma('foreign_keys=OFF');

        for (const table of tables) {
          db.prepare(
            `DELETE FROM ${table}`
          ).run();
        }

        for (const table of tables) {
          const rows =
            data.tables[table] || [];

          for (const row of rows) {
            const columns =
              Object.keys(row);

            if (!columns.length) {
              continue;
            }

            const sql =
              `INSERT INTO ${table}(` +
              columns.join(',') +
              `) VALUES(` +
              columns.map(() => '?').join(',') +
              `)`;

            db.prepare(sql).run(
              ...columns.map(
                column => row[column]
              )
            );
          }
        }

        db.pragma('foreign_keys=ON');
      });

      tx();

      res.json({
        ok: true,
        message:
          'Sauvegarde restaurée avec succès. Les comptes administrateurs actuels ont été conservés.'
      });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

/* =========================================================
   404 API
========================================================= */

app.use('/api', (req, res) => {
  res.status(404).json({
    error: 'Route API introuvable',
    path: req.originalUrl
  });
});

/* =========================================================
   FALLBACK
========================================================= */

app.use((req, res) => {
  const indexPath =
    path.join(
      __dirname,
      'public',
      'index.html'
    );

  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }

  res.status(404).send('CETEP - Not Found');
});

/* =========================================================
   START SERVER
========================================================= */

app.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `CETEP v11.0.0 running on ${PORT}`
    );
  }
);
