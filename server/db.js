const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

let pool;

async function initDB() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ DATABASE_URL not set! Add a PostgreSQL service in Railway.');
    console.error('   Right-click canvas → New → Database → Add PostgreSQL');
    process.exit(1);
  }

  pool = new Pool({
    connectionString: dbUrl,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  console.log('=== DATABASE CONFIG ===');
  console.log('Using PostgreSQL (no Volume needed)');
  console.log('=======================');

  // Create tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user' CHECK(role IN ('user','admin')),
      balance REAL DEFAULT 0,
      free_credits REAL DEFAULT 0,
      has_deposited INTEGER DEFAULT 0,
      first_login_at TIMESTAMP,
      last_active_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS balance_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      operator_id INTEGER,
      type TEXT NOT NULL CHECK(type IN ('topup','deduct','refund','initial','referral','airdrop','withdrawal','sell','purchase','free_credit')),
      amount REAL NOT NULL,
      balance_after REAL NOT NULL,
      reason TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS pulls (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
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
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS shipments (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      pull_id INTEGER NOT NULL REFERENCES pulls(id),
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','shipped','delivered')),
      tracking_note TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS login_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      ip TEXT,
      login_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS page_views (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      page TEXT NOT NULL,
      entered_at TIMESTAMP,
      exited_at TIMESTAMP,
      duration_seconds REAL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Default admin
  const adminCheck = await pool.query('SELECT id FROM users WHERE username = $1', ['admin']);
  if (adminCheck.rows.length === 0) {
    await pool.query(
      'INSERT INTO users (username, password_hash, role, balance) VALUES ($1, $2, $3, $4)',
      ['admin', bcrypt.hashSync('admin123', 10), 'admin', 0]
    );
    console.log('Default admin created: admin / admin123');
  }

  return pool;
}

function getPool() { return pool; }

module.exports = { initDB, getPool };
