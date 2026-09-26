require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================
   MIDDLEWARE
========================= */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const SECRET =
  process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION';

/* =========================
   DATABASE
========================= */

const db = new Database(
  path.join(__dirname, 'cetep.sqlite')
);

db.pragma('journal_mode = WAL');

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
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS students(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_no TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  birth_date TEXT,
  phone TEXT,
  email TEXT,
  program_id INTEGER,
  education TEXT,
  status TEXT DEFAULT 'En attente',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(program_id) REFERENCES programs(id)
);

CREATE TABLE IF NOT EXISTS payments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER,
  amount_htg REAL NOT NULL,
  method TEXT NOT NULL,
  status TEXT DEFAULT 'En attente',
  reference TEXT UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(student_id) REFERENCES students(id)
);

CREATE TABLE IF NOT EXISTS buttons(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT,
  active INTEGER DEFAULT 1
);
`);

/* =========================
   ADMIN ACCOUNT
========================= */

const adminEmail =
  process.env.ADMIN_EMAIL || 'admin@cetep.ht';

const adminPassword =
  process.env.ADMIN_PASSWORD || 'CHANGEZ_MOI';

const existingAdmin = db
  .prepare('SELECT id FROM admins ORDER BY id LIMIT 1')
  .get();

if (existingAdmin) {
  db.prepare(`
    UPDATE admins
    SET email = ?, password_hash = ?
    WHERE id = ?
  `).run(
    adminEmail,
    bcrypt.hashSync(adminPassword, 12),
    existingAdmin.id
  );
} else {
  db.prepare(`
    INSERT INTO admins(email, password_hash)
    VALUES(?, ?)
  `).run(
    adminEmail,
    bcrypt.hashSync(adminPassword, 12)
  );
}

/* =========================
   DEFAULT PROGRAMS
   YO SÈLMAN AJOUTE YO
   SI DATABASE LA VID
========================= */

if (
  db.prepare(
    'SELECT COUNT(*) c FROM programs'
  ).get().c === 0
) {
  const ins = db.prepare(`
    INSERT INTO programs
    (name, duration, description, price_htg)
    VALUES (?, ?, ?, ?)
  `);

  ins.run(
    'Secourisme de base',
    '9 mois',
    'Formation aux premiers secours et à la sécurité.',
    0
  );

  ins.run(
    'Aide-soignant(e)',
    '6 mois',
    'Formation orientée vers l’accompagnement, l’hygiène et les soins de base.',
    0
  );

  ins.run(
    'Programmes métiers',
    'Variable',
    'Parcours pratiques selon les besoins de la communauté.',
    0
  );

  ins.run(
    'Formation continue',
    'Flexible',
    'Modules courts de perfectionnement.',
    0
  );
}

/* =========================
   DEFAULT BUTTONS
========================= */

if (
  db.prepare(
    'SELECT COUNT(*) c FROM buttons'
  ).get().c === 0
) {
  const ins = db.prepare(`
    INSERT INTO buttons
    (label, url, description)
    VALUES (?, ?, ?)
  `);

  ins.run(
    'Inscription en ligne',
    '#admission',
    'Déposer une demande d’admission'
  );

  ins.run(
    'Paiement en ligne',
    '#paiement',
    'Payer les frais de formation'
  );

  ins.run(
    'BATON W',
    '#baton',
    'Découvrir le programme solidaire'
  );
}

/* =========================
   STATIC FILES
========================= */

app.use(express.static(__dirname));

/* =========================
   AUTHENTICATION
========================= */

function auth(req, res, next) {
  try {
    const token = req.cookies.cetep_token;

    if (!token) {
      return res.status(401).json({
        error: 'Non autorisé'
      });
    }

    req.user = jwt.verify(token, SECRET);

    next();
  } catch (e) {
    return res.status(401).json({
      error: 'Session expirée'
    });
  }
}

/* =========================
   STUDENT NUMBER
========================= */

function nextStudentNo() {
  const count = db
    .prepare('SELECT COUNT(*) c FROM students')
    .get().c;

  return `CETEP-${new Date().getFullYear()}-${String(
    count + 1
  ).padStart(4, '0')}`;
}

/* =========================
   LOGIN
========================= */

app.post('/api/login', (req, res) => {
  try {
    const { email, password } = req.body || {};

    const admin = db
      .prepare(
        'SELECT * FROM admins WHERE email = ?'
      )
      .get(email || '');

    if (
      !admin ||
      !bcrypt.compareSync(
        password || '',
        admin.password_hash
      )
    ) {
      return res.status(401).json({
        error: 'Identifiants invalides'
      });
    }

    const token = jwt.sign(
      {
        id: admin.id,
        email: admin.email
      },
      SECRET,
      {
        expiresIn: '8h'
      }
    );

    res.cookie(
      'cetep_token',
      token,
      {
        httpOnly: true,
        sameSite: 'lax',
        secure:
          process.env.NODE_ENV === 'production',
        maxAge: 8 * 60 * 60 * 1000
      }
    );

    res.json({
      ok: true
    });
  } catch (e) {
    res.status(500).json({
      error: e.message
    });
  }
});

/* =========================
   LOGOUT
========================= */

app.post('/api/logout', (req, res) => {
  res.clearCookie('cetep_token');

  res.json({
    ok: true
  });
});

/* =========================
   HEALTH CHECK
========================= */

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'CETEP'
  });
});

/* =========================
   PUBLIC PROGRAMS
========================= */

app.get('/api/public/programs', (req, res) => {
  res.json(
    db
      .prepare(`
        SELECT *
        FROM programs
        WHERE active = 1
        ORDER BY id
      `)
      .all()
  );
});

/* =========================
   PUBLIC BUTTONS
========================= */

app.get('/api/public/buttons', (req, res) => {
  res.json(
    db
      .prepare(`
        SELECT id, label, url, description
        FROM buttons
        WHERE active = 1
        ORDER BY id
      `)
      .all()
  );
});

/* =========================
   ONLINE ADMISSION
========================= */

app.post('/api/admissions', (req, res) => {
  try {
    const b = req.body || {};

    const program = db
      .prepare(`
        SELECT id
        FROM programs
        WHERE name = ?
        AND active = 1
      `)
      .get(b.program);

    const studentNo = nextStudentNo();

    db.prepare(`
      INSERT INTO students(
        student_no,
        name,
        birth_date,
        phone,
        email,
        program_id,
        education
      )
      VALUES(?, ?, ?, ?, ?, ?, ?)
    `).run(
      studentNo,
      b.name,
      b.birth_date || null,
      b.phone,
      b.email || null,
      program ? program.id : null,
      b.education || null
    );

    res.status(201).json({
      ok: true,
      student_no: studentNo,
      message: 'Demande enregistrée.'
    });
  } catch (e) {
    res.status(400).json({
      error: e.message
    });
  }
});

/* =========================
   ADMIN STATS
========================= */

app.get('/api/admin/stats', auth, (req, res) => {
  res.json({
    students: db
      .prepare(
        'SELECT COUNT(*) c FROM students'
      )
      .get().c,

    programs: db
      .prepare(`
        SELECT COUNT(*) c
        FROM programs
        WHERE active = 1
      `)
      .get().c,

    pending: db
      .prepare(`
        SELECT COUNT(*) c
        FROM students
        WHERE status = 'En attente'
      `)
      .get().c,

    revenue: db
      .prepare(`
        SELECT COALESCE(
          SUM(amount_htg), 0
        ) s
        FROM payments
        WHERE status = 'Confirmé'
      `)
      .get().s
  });
});

/* =========================
   ADMIN STUDENTS
========================= */

app.get(
  '/api/admin/students',
  auth,
  (req, res) => {
    res.json(
      db
        .prepare(`
          SELECT
            s.*,
            p.name program_name
          FROM students s
          LEFT JOIN programs p
            ON p.id = s.program_id
          ORDER BY s.id DESC
        `)
        .all()
    );
  }
);

/* =========================
   ADD PROGRAM / COURSE
   TU PEUX AJOUTER N'IMPÒT KI KOU
========================= */

app.post(
  '/api/admin/programs',
  auth,
  (req, res) => {
    try {
      const b = req.body || {};

      if (!b.name || !b.name.trim()) {
        return res.status(400).json({
          error: 'Le nom du programme est obligatoire.'
        });
      }

      const result = db.prepare(`
        INSERT INTO programs(
          name,
          duration,
          description,
          price_htg,
          active
        )
        VALUES(?, ?, ?, ?, ?)
      `).run(
        b.name.trim(),
        b.duration || '',
        b.description || '',
        Number(b.price_htg || 0),
        b.active === false ? 0 : 1
      );

      res.json({
        ok: true,
        id: result.lastInsertRowid,
        message: 'Programme ajouté avec succès.'
      });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

/* =========================
   UPDATE PROGRAM / COURSE
========================= */

app.put(
  '/api/admin/programs/:id',
  auth,
  (req, res) => {
    try {
      const b = req.body || {};

      if (!b.name || !b.name.trim()) {
        return res.status(400).json({
          error: 'Le nom du programme est obligatoire.'
        });
      }

      db.prepare(`
        UPDATE programs
        SET
          name = ?,
          duration = ?,
          description = ?,
          price_htg = ?,
          active = ?
        WHERE id = ?
      `).run(
        b.name.trim(),
        b.duration || '',
        b.description || '',
        Number(b.price_htg || 0),
        b.active === false ? 0 : 1,
        req.params.id
      );

      res.json({
        ok: true,
        message: 'Programme modifié avec succès.'
      });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

/* =========================
   DELETE PROGRAM
========================= */

app.delete(
  '/api/admin/programs/:id',
  auth,
  (req, res) => {
    try {
      db.prepare(
        'DELETE FROM programs WHERE id = ?'
      ).run(req.params.id);

      res.json({
        ok: true,
        message: 'Programme supprimé.'
      });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

/* =========================
   ALL PROGRAMS FOR ADMIN
========================= */

app.get(
  '/api/admin/programs',
  auth,
  (req, res) => {
    res.json(
      db
        .prepare(`
          SELECT *
          FROM programs
          ORDER BY id
        `)
        .all()
    );
  }
);

/* =========================
   ADD PAYMENT
========================= */

app.post(
  '/api/admin/payments',
  auth,
  (req, res) => {
    try {
      const b = req.body || {};

      const reference =
        b.reference ||
        `MAN-${Date.now()}`;

      const result = db.prepare(`
        INSERT INTO payments(
          student_id,
          amount_htg,
          method,
          status,
          reference
        )
        VALUES(?, ?, ?, ?, ?)
      `).run(
        Number(b.student_id),
        Number(b.amount_htg),
        b.method || 'Manuel',
        b.status || 'Confirmé',
        reference
      );

      res.json({
        ok: true,
        id: result.lastInsertRowid,
        reference
      });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

/* =========================
   GET PAYMENTS
========================= */

app.get(
  '/api/admin/payments',
  auth,
  (req, res) => {
    res.json(
      db
        .prepare(`
          SELECT
            p.*,
            s.student_no,
            s.name student_name
          FROM payments p
          LEFT JOIN students s
            ON s.id = p.student_id
          ORDER BY p.id DESC
        `)
        .all()
    );
  }
);

/* =========================
   ADMIN BUTTONS
========================= */

app.get(
  '/api/admin/buttons',
  auth,
  (req, res) => {
    res.json(
      db
        .prepare(`
          SELECT *
          FROM buttons
          ORDER BY id
        `)
        .all()
    );
  }
);

/* =========================
   ADD BUTTON
========================= */

app.post(
  '/api/admin/buttons',
  auth,
  (req, res) => {
    try {
      const b = req.body || {};

      if (!b.label || !b.url) {
        return res.status(400).json({
          error: 'Le nom et le lien sont obligatoires.'
        });
      }

      const result = db.prepare(`
        INSERT INTO buttons(
          label,
          url,
          description,
          active
        )
        VALUES(?, ?, ?, ?)
      `).run(
        b.label,
        b.url,
        b.description || '',
        b.active === false ? 0 : 1
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

/* =========================
   UPDATE BUTTON
========================= */

app.put(
  '/api/admin/buttons/:id',
  auth,
  (req, res) => {
    try {
      const b = req.body || {};

      db.prepare(`
        UPDATE buttons
        SET
          label = ?,
          url = ?,
          description = ?,
          active = ?
        WHERE id = ?
      `).run(
        b.label,
        b.url,
        b.description || '',
        b.active === false ? 0 : 1,
        req.params.id
      );

      res.json({
        ok: true
      });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

/* =========================
   DELETE BUTTON
========================= */

app.delete(
  '/api/admin/buttons/:id',
  auth,
  (req, res) => {
    try {
      db.prepare(
        'DELETE FROM buttons WHERE id = ?'
      ).run(req.params.id);

      res.json({
        ok: true
      });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

/* =========================
   CURRENT ADMIN
========================= */

app.get(
  '/api/admin/me',
  auth,
  (req, res) => {
    res.json({
      email: req.user.email
    });
  }
);

/* =========================
   PAGES
========================= */

app.get('/admin', (req, res) => {
  res.sendFile(
    path.join(__dirname, 'admin.html')
  );
});

app.get('/', (req, res) => {
  res.sendFile(
    path.join(__dirname, 'index.html')
  );
});

/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {
  console.log(
    `CETEP V4: http://localhost:${PORT}`
  );
});
