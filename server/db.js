const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

function initDB() {
  // Railway Volume: use /data if mounted, otherwise local fallback
  const VOLUME_PATH = '/data';
  const volumeExists = fs.existsSync(VOLUME_PATH);
  const DB_DIR = volumeExists ? VOLUME_PATH : path.join(__dirname, '..', 'dbdata');

  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

  console.log('=== DATABASE CONFIG ===');
  console.log('Volume /data exists:', volumeExists);
  console.log('RAILWAY_VOLUME_MOUNT_PATH env:', process.env.RAILWAY_VOLUME_MOUNT_PATH || '(not set)');
  console.log('DB location:', path.join(DB_DIR, 'tcg.db'));

  // List files in /data to debug persistence
  if (volumeExists) {
    try {
      console.log('/data contents:', fs.readdirSync(VOLUME_PATH));
    } catch (e) {
      console.log('/data read error:', e.message);
    }
  }
  console.log('=======================');

  const db = new Database(path.join(DB_DIR, 'tcg.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user' CHECK(role IN ('user','admin')),
      balance REAL DEFAULT 0,
      free_credits REAL DEFAULT 0,
      has_deposited INTEGER DEFAULT 0,
      first_login_at TEXT,
      last_active_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS balance_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      operator_id INTEGER,
      type TEXT NOT NULL CHECK(type IN ('topup','deduct','refund','initial','referral','airdrop','withdrawal','sell','purchase','free_credit')),
      amount REAL NOT NULL,
      balance_after REAL NOT NULL,
      reason TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS pulls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      pack_type TEXT NOT NULL,
      pack_cost REAL NOT NULL,
      card_name TEXT NOT NULL,
      card_set TEXT NOT NULL,
      card_number TEXT NOT NULL,
      card_img TEXT NOT NULL,
      card_rarity TEXT NOT NULL,
      card_value REAL NOT NULL,
      action TEXT CHECK(action IN ('keep','sell')),
      sell_credit REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS shipments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      pull_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','shipped','delivered')),
      tracking_note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (pull_id) REFERENCES pulls(id)
    );

    CREATE TABLE IF NOT EXISTS login_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      ip TEXT,
      login_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS page_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      page TEXT NOT NULL,
      entered_at TEXT,
      exited_at TEXT,
      duration_seconds REAL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Add new columns to existing tables if migrating
  try { db.exec('ALTER TABLE users ADD COLUMN free_credits REAL DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE users ADD COLUMN has_deposited INTEGER DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE pulls ADD COLUMN sell_credit REAL DEFAULT 0'); } catch {}
  // Rename recycle_credit to sell_credit if old column exists
  try {
    const cols = db.prepare("PRAGMA table_info(pulls)").all();
    if (cols.find(c => c.name === 'recycle_credit') && !cols.find(c => c.name === 'sell_credit')) {
      db.exec('ALTER TABLE pulls RENAME COLUMN recycle_credit TO sell_credit');
    }
  } catch {}

  // Default admin
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminExists) {
    db.prepare('INSERT INTO users (username, password_hash, role, balance) VALUES (?, ?, ?, ?)')
      .run('admin', bcrypt.hashSync('admin123', 10), 'admin', 0);
    console.log('Default admin created: admin / admin123');
  }

  return db;
}

module.exports = { initDB };
