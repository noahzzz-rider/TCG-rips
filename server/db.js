const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

let db;
let isPostgres = false;

async function initDB() {
  // Log ALL env var names for debugging
  console.log('=== DATABASE INIT ===');
  console.log('All env var names:', Object.keys(process.env).sort().join(', '));
  console.log('DATABASE_URL:', process.env.DATABASE_URL ? '(set, length=' + process.env.DATABASE_URL.length + ')' : '(not set)');

  // Supabase PostgreSQL — hardcoded connection (no Railway env vars needed)
  const SUPABASE_URL = 'postgresql://k2app.ryiqmfapsiocskojrdvz:K2collection2026!@aws-0-us-west-1.pooler.supabase.com:5432/postgres';
  const pgUrl = process.env.DATABASE_URL || SUPABASE_URL;

  if (pgUrl) {
    console.log('→ Using PostgreSQL');
    isPostgres = true;
    const { Pool } = require('pg');
    db = new Pool({ connectionString: pgUrl, ssl: false });
    await createTablesPostgres();
  } else {
    console.log('→ No PostgreSQL URL found, using SQLite (data will not persist across deploys)');
    isPostgres = false;
    const Database = require('better-sqlite3');
    const DB_DIR = path.join(__dirname, '..', 'dbdata');
    if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
    const dbPath = path.join(DB_DIR, 'tcg.db');
    console.log('DB path:', dbPath);
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    createTablesSQLite();
  }

  // Default admin
  if (isPostgres) {
    const r = await db.query('SELECT id FROM users WHERE username=$1', ['admin']);
    if (!r.rows.length) {
      await db.query('INSERT INTO users (username,password_hash,role,balance) VALUES ($1,$2,$3,$4)', ['admin', bcrypt.hashSync('admin123', 10), 'admin', 0]);
      console.log('Default admin created: admin / admin123');
    }
  } else {
    if (!db.prepare('SELECT id FROM users WHERE username=?').get('admin')) {
      db.prepare('INSERT INTO users (username,password_hash,role,balance) VALUES (?,?,?,?)').run('admin', bcrypt.hashSync('admin123', 10), 'admin', 0);
      console.log('Default admin created: admin / admin123');
    }
  }

  console.log('=== DB READY ===\n');
  return wrapDB();
}

// === Unified DB wrapper: same API regardless of backend ===
function wrapDB() {
  if (isPostgres) {
    return {
      // For pg: query($1 params) → returns { rows }
      query: (...args) => db.query(...args),
      isPostgres: true,
    };
  } else {
    // For SQLite: convert $1,$2 style to ? style, return { rows } like pg
    return {
      query: (sql, params) => {
        // Convert $1,$2,$3 → ?,?,? and NOW() → datetime('now')
        let i = 0;
        const converted = sql.replace(/\$\d+/g, () => '?').replace(/NOW\(\)/gi, "datetime('now')");

        const trimmed = converted.trim().toUpperCase();
        if (trimmed.startsWith('SELECT') || trimmed.startsWith('WITH')) {
          const rows = db.prepare(converted).all(...(params || []));
          return Promise.resolve({ rows, rowCount: rows.length });
        } else if (converted.toUpperCase().includes('RETURNING')) {
          // Handle RETURNING clause: SQLite doesn't support it natively
          const withoutReturning = converted.replace(/\s+RETURNING\s+.*/i, '');
          const info = db.prepare(withoutReturning).run(...(params || []));
          return Promise.resolve({ rows: [{ id: info.lastInsertRowid }], rowCount: info.changes });
        } else {
          const info = db.prepare(converted).run(...(params || []));
          return Promise.resolve({ rows: [], rowCount: info.changes });
        }
      },
      isPostgres: false,
    };
  }
}

function createTablesSQLite() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, role TEXT DEFAULT 'user' CHECK(role IN ('user','admin')),
      balance REAL DEFAULT 0, free_credits REAL DEFAULT 0, has_deposited INTEGER DEFAULT 0,
      first_login_at TEXT, last_active_at TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS balance_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      operator_id INTEGER, type TEXT NOT NULL, amount REAL NOT NULL,
      balance_after REAL NOT NULL, reason TEXT, created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS pulls (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      pack_type TEXT NOT NULL, pack_cost REAL NOT NULL, card_name TEXT NOT NULL,
      card_set TEXT NOT NULL, card_number TEXT NOT NULL, card_img TEXT NOT NULL,
      card_rarity TEXT NOT NULL, card_value REAL NOT NULL,
      action TEXT CHECK(action IN ('keep','sell')), sell_credit REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS shipments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, pull_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending', tracking_note TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (pull_id) REFERENCES pulls(id)
    );
    CREATE TABLE IF NOT EXISTS login_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, ip TEXT,
      login_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS page_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, page TEXT NOT NULL,
      entered_at TEXT, exited_at TEXT, duration_seconds REAL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

async function createTablesPostgres() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, role TEXT DEFAULT 'user',
      balance REAL DEFAULT 0, free_credits REAL DEFAULT 0, has_deposited INTEGER DEFAULT 0,
      first_login_at TIMESTAMP, last_active_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS balance_logs (
      id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      operator_id INTEGER, type TEXT NOT NULL, amount REAL NOT NULL,
      balance_after REAL NOT NULL, reason TEXT, created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS pulls (
      id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      pack_type TEXT NOT NULL, pack_cost REAL NOT NULL, card_name TEXT NOT NULL,
      card_set TEXT NOT NULL, card_number TEXT NOT NULL, card_img TEXT NOT NULL,
      card_rarity TEXT NOT NULL, card_value REAL NOT NULL,
      action TEXT CHECK(action IN ('keep','sell')), sell_credit REAL DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS shipments (
      id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      pull_id INTEGER NOT NULL REFERENCES pulls(id),
      status TEXT DEFAULT 'pending', tracking_note TEXT,
      created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS login_logs (
      id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      ip TEXT, login_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS page_views (
      id SERIAL PRIMARY KEY, user_id INTEGER, page TEXT NOT NULL,
      entered_at TIMESTAMP, exited_at TIMESTAMP, duration_seconds REAL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

module.exports = { initDB };
