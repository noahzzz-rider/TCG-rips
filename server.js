const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'tcg-rips-secret-key-change-me';

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ===========================================================================
// Load card data from JSON files — edit these files to update pools
// ===========================================================================
const DATA_DIR = path.join(__dirname, 'data');
let CARDS = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'cards.json'), 'utf8'));
let SV151 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'sv151.json'), 'utf8'));
let PACKS = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'packs.json'), 'utf8'));

function reloadData() {
  try {
    CARDS = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'cards.json'), 'utf8'));
    SV151 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'sv151.json'), 'utf8'));
    PACKS = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'packs.json'), 'utf8'));
    console.log(`Reloaded: ${CARDS.length} general cards, ${SV151.length} SV-151 cards, ${Object.keys(PACKS).length} packs`);
    return true;
  } catch (e) { console.error('Reload failed:', e.message); return false; }
}

// ===========================================================================
// Database
// ===========================================================================
const DB_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
const db = new Database(path.join(DB_DIR, 'tcg.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL, role TEXT DEFAULT 'user' CHECK(role IN ('user','admin')),
    balance REAL DEFAULT 0, first_login_at TEXT, last_active_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS balance_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, operator_id INTEGER,
    type TEXT NOT NULL CHECK(type IN ('topup','deduct','refund','initial','referral','airdrop','withdrawal','recycle','purchase')),
    amount REAL NOT NULL, balance_after REAL NOT NULL, reason TEXT,
    created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS pulls (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, pack_type TEXT NOT NULL,
    pack_cost REAL NOT NULL, card_name TEXT NOT NULL, card_set TEXT NOT NULL,
    card_number TEXT NOT NULL, card_img TEXT NOT NULL, card_rarity TEXT NOT NULL,
    card_value REAL NOT NULL, action TEXT CHECK(action IN ('keep','recycle')),
    recycle_credit REAL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS shipments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, pull_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','shipped','delivered')),
    tracking_note TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
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

const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!adminExists) {
  db.prepare('INSERT INTO users (username, password_hash, role, balance) VALUES (?, ?, ?, ?)').run('admin', bcrypt.hashSync('admin123', 10), 'admin', 0);
  console.log('Default admin: admin / admin123');
}

// ===========================================================================
// Card Selection Engine
// ===========================================================================
function getCardsForPack(packType) {
  return PACKS[packType]?.exclusive ? SV151 : CARDS;
}

function filterByRange(cards, min, max) {
  return cards.filter(c => c.value >= min && c.value < max);
}

function pickCard(cards, exponent = 1.0) {
  if (!cards.length) return null;
  const sorted = [...cards].sort((a, b) => a.value - b.value);
  const n = sorted.length;
  const weights = sorted.map((_, i) => Math.pow(n - i, exponent));
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < n; i++) { r -= weights[i]; if (r <= 0) return { ...sorted[i] }; }
  return { ...sorted[0] };
}

function rollTier(packType) {
  const tiers = PACKS[packType].tiers;
  const r = Math.random(); let c = 0;
  for (const [name, tier] of Object.entries(tiers)) {
    c += tier.odds;
    if (r <= c) return { name, ...tier };
  }
  const entries = Object.entries(tiers);
  const last = entries[entries.length - 1];
  return { name: last[0], ...last[1] };
}

function pullCard(packType) {
  const pack = PACKS[packType];
  const allCards = getCardsForPack(packType);
  const tier = rollTier(packType);
  const bias = pack.bias_exponent || 1.0;
  let pool = filterByRange(allCards, tier.min, tier.max);

  // Fallback: if no cards in this range, widen to nearest populated range
  if (!pool.length) {
    pool = filterByRange(allCards, tier.min * 0.5, tier.max * 2);
    if (!pool.length) pool = allCards;
  }

  const card = pickCard(pool, bias);
  return {
    ...card,
    rarity: tier.name,
    imgUrl: `https://images.pokemontcg.io/${card.img}.png`
  };
}

// ===========================================================================
// Auth
// ===========================================================================
function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(h.replace('Bearer ', ''), JWT_SECRET);
    db.prepare("UPDATE users SET last_active_at=datetime('now') WHERE id=?").run(req.user.id);
    next();
  } catch { return res.status(401).json({ error: 'Invalid token' }); }
}
function admin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ===========================================================================
// Auth Routes
// ===========================================================================
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Credentials required' });
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!u || !bcrypt.compareSync(password, u.password_hash)) return res.status(401).json({ error: 'Invalid credentials' });
  if (!u.first_login_at) db.prepare("UPDATE users SET first_login_at=datetime('now') WHERE id=?").run(u.id);
  db.prepare("UPDATE users SET last_active_at=datetime('now') WHERE id=?").run(u.id);
  db.prepare('INSERT INTO login_logs (user_id,ip) VALUES (?,?)').run(u.id, req.headers['x-forwarded-for'] || req.socket.remoteAddress || '');
  res.json({ token: jwt.sign({ id: u.id, username: u.username, role: u.role }, JWT_SECRET, { expiresIn: '7d' }), user: { id: u.id, username: u.username, role: u.role, balance: u.balance } });
});

app.get('/api/me', auth, (req, res) => {
  const u = db.prepare('SELECT id,username,role,balance FROM users WHERE id=?').get(req.user.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  u.vaultCount = db.prepare("SELECT COUNT(*) as c FROM pulls WHERE user_id=? AND action='keep'").get(req.user.id).c;
  res.json(u);
});

// ===========================================================================
// Pull Routes
// ===========================================================================
app.post('/api/pull', auth, (req, res) => {
  const pack = PACKS[req.body.packType];
  if (!pack) return res.status(400).json({ error: 'Invalid pack' });
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (u.balance < pack.cost) return res.status(400).json({ error: 'Insufficient balance' });
  const nb = +(u.balance - pack.cost).toFixed(2);
  db.prepare('UPDATE users SET balance=? WHERE id=?').run(nb, u.id);
  db.prepare('INSERT INTO balance_logs (user_id,type,amount,balance_after,reason) VALUES (?,?,?,?,?)').run(u.id, 'purchase', -pack.cost, nb, 'Opened ' + pack.name);
  const card = pullCard(req.body.packType);
  const r = db.prepare('INSERT INTO pulls (user_id,pack_type,pack_cost,card_name,card_set,card_number,card_img,card_rarity,card_value) VALUES (?,?,?,?,?,?,?,?,?)').run(u.id, req.body.packType, pack.cost, card.name, card.set, card.number, card.imgUrl, card.rarity, card.value);
  res.json({ pullId: r.lastInsertRowid, card, balance: nb, recycleValue: +(card.value * 0.965).toFixed(2) });
});

app.post('/api/pull/batch', auth, (req, res) => {
  const pack = PACKS[req.body.packType];
  if (!pack) return res.status(400).json({ error: 'Invalid pack' });
  const tc = pack.cost * 5;
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (u.balance < tc) return res.status(400).json({ error: 'Insufficient balance' });
  const nb = +(u.balance - tc).toFixed(2);
  db.prepare('UPDATE users SET balance=? WHERE id=?').run(nb, u.id);
  db.prepare('INSERT INTO balance_logs (user_id,type,amount,balance_after,reason) VALUES (?,?,?,?,?)').run(u.id, 'purchase', -tc, nb, 'Opened 5x ' + pack.name);
  const cards = [];
  for (let i = 0; i < 5; i++) cards.push(pullCard(req.body.packType));
  // Pity: if all same lowest tier, upgrade last card
  const tierNames = Object.keys(pack.tiers);
  const lowestTier = tierNames[0];
  if (cards.every(c => c.rarity === lowestTier) && tierNames.length > 1) {
    const nextTier = pack.tiers[tierNames[1]];
    const pool = filterByRange(getCardsForPack(req.body.packType), nextTier.min, nextTier.max);
    if (pool.length) {
      const up = pickCard(pool, pack.bias_exponent || 1.0);
      cards[4] = { ...up, rarity: tierNames[1], imgUrl: `https://images.pokemontcg.io/${up.img}.png` };
    }
  }
  const pulls = [];
  const ins = db.prepare('INSERT INTO pulls (user_id,pack_type,pack_cost,card_name,card_set,card_number,card_img,card_rarity,card_value) VALUES (?,?,?,?,?,?,?,?,?)');
  for (const c of cards) {
    const r = ins.run(u.id, req.body.packType, pack.cost, c.name, c.set, c.number, c.imgUrl, c.rarity, c.value);
    pulls.push({ pullId: r.lastInsertRowid, card: c, recycleValue: +(c.value * 0.965).toFixed(2) });
  }
  res.json({ pulls, balance: nb });
});

app.post('/api/pull/:id/action', auth, (req, res) => {
  const { action } = req.body;
  if (!['keep', 'recycle'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
  const p = db.prepare('SELECT * FROM pulls WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (p.action) return res.status(400).json({ error: 'Already actioned' });
  if (action === 'keep') {
    db.prepare('UPDATE pulls SET action=? WHERE id=?').run('keep', p.id);
    db.prepare('INSERT INTO shipments (user_id,pull_id) VALUES (?,?)').run(req.user.id, p.id);
    res.json({ action: 'keep', balance: db.prepare('SELECT balance FROM users WHERE id=?').get(req.user.id).balance });
  } else {
    const rc = +(p.card_value * 0.965).toFixed(2);
    const bal = db.prepare('SELECT balance FROM users WHERE id=?').get(req.user.id).balance;
    const nb = +(bal + rc).toFixed(2);
    db.prepare('UPDATE pulls SET action=?,recycle_credit=? WHERE id=?').run('recycle', rc, p.id);
    db.prepare('UPDATE users SET balance=? WHERE id=?').run(nb, req.user.id);
    db.prepare('INSERT INTO balance_logs (user_id,type,amount,balance_after,reason) VALUES (?,?,?,?,?)').run(req.user.id, 'recycle', rc, nb, 'Recycled ' + p.card_name);
    res.json({ action: 'recycle', recycleCredit: rc, balance: nb });
  }
});

// ===========================================================================
// Vault, History, Page Views
// ===========================================================================
app.get('/api/vault', auth, (req, res) => {
  res.json(db.prepare("SELECT p.*,s.status as ship_status,s.tracking_note FROM pulls p LEFT JOIN shipments s ON s.pull_id=p.id WHERE p.user_id=? AND p.action='keep' ORDER BY p.created_at DESC").all(req.user.id));
});
app.get('/api/pulls', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM pulls WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(req.user.id));
});
app.post('/api/page-view', auth, (req, res) => {
  const { page, entered_at, exited_at, duration_seconds } = req.body;
  db.prepare('INSERT INTO page_views (user_id,page,entered_at,exited_at,duration_seconds) VALUES (?,?,?,?,?)').run(req.user.id, page, entered_at, exited_at, duration_seconds);
  res.json({ ok: true });
});

// ===========================================================================
// Odds — sends pack definitions + card counts per tier
// ===========================================================================
app.get('/api/odds', auth, (req, res) => {
  const result = {};
  for (const [key, pack] of Object.entries(PACKS)) {
    const cards = pack.exclusive ? SV151 : CARDS;
    const tierInfo = {};
    for (const [tierName, tier] of Object.entries(pack.tiers)) {
      const pool = filterByRange(cards, tier.min, tier.max);
      tierInfo[tierName] = {
        min: tier.min, max: tier.max, odds: tier.odds, cardCount: pool.length,
        minValue: pool.length ? Math.min(...pool.map(c => c.value)) : tier.min,
        maxValue: pool.length ? Math.max(...pool.map(c => c.value)) : tier.max,
      };
    }
    result[key] = { name: pack.name, cost: pack.cost, description: pack.description, ev_label: pack.ev_label, tiers: tierInfo };
  }
  res.json({ packs: result, recycleRate: 0.965, totalCards: CARDS.length, sv151Cards: SV151.length });
});

// ===========================================================================
// Admin Routes
// ===========================================================================
app.post('/api/admin/create-user', auth, admin, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Credentials required' });
  if (db.prepare('SELECT id FROM users WHERE username=?').get(username)) return res.status(400).json({ error: 'Username exists' });
  const r = db.prepare('INSERT INTO users (username,password_hash,balance) VALUES (?,?,?)').run(username, bcrypt.hashSync(password, 10), 20);
  db.prepare('INSERT INTO balance_logs (user_id,operator_id,type,amount,balance_after,reason) VALUES (?,?,?,?,?,?)').run(r.lastInsertRowid, req.user.id, 'initial', 20, 20, 'New user welcome bonus');
  res.json({ id: r.lastInsertRowid, username, balance: 20 });
});

app.get('/api/admin/users', auth, admin, (req, res) => {
  res.json(db.prepare("SELECT u.id,u.username,u.role,u.balance,u.first_login_at,u.last_active_at,u.created_at,(SELECT COUNT(*) FROM pulls WHERE user_id=u.id) as total_pulls,(SELECT COALESCE(SUM(amount),0) FROM balance_logs WHERE user_id=u.id AND type='topup') as total_topup FROM users u ORDER BY u.created_at DESC").all());
});

app.post('/api/admin/balance', auth, admin, (req, res) => {
  const { userId, type, amount, reason } = req.body;
  if (!userId || !type || !amount) return res.status(400).json({ error: 'Missing fields' });
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const isD = ['deduct', 'refund', 'withdrawal'].includes(type);
  const d = isD ? -Math.abs(parseFloat(amount)) : Math.abs(parseFloat(amount));
  const nb = +(u.balance + d).toFixed(2);
  if (nb < 0) return res.status(400).json({ error: 'Balance would go negative' });
  db.prepare('UPDATE users SET balance=? WHERE id=?').run(nb, userId);
  db.prepare('INSERT INTO balance_logs (user_id,operator_id,type,amount,balance_after,reason) VALUES (?,?,?,?,?,?)').run(userId, req.user.id, type, d, nb, reason || '');
  res.json({ balance: nb });
});

app.get('/api/admin/pulls', auth, admin, (req, res) => {
  const { userId } = req.query;
  res.json(userId
    ? db.prepare('SELECT p.*,u.username FROM pulls p JOIN users u ON u.id=p.user_id WHERE p.user_id=? ORDER BY p.created_at DESC LIMIT 500').all(userId)
    : db.prepare('SELECT p.*,u.username FROM pulls p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 500').all());
});

app.get('/api/admin/vault', auth, admin, (req, res) => {
  res.json(db.prepare("SELECT p.*,u.username,s.status as ship_status,s.tracking_note,s.id as shipment_id FROM pulls p JOIN users u ON u.id=p.user_id LEFT JOIN shipments s ON s.pull_id=p.id WHERE p.action='keep' ORDER BY p.created_at DESC").all());
});

app.post('/api/admin/shipment/:id/status', auth, admin, (req, res) => {
  const { status, tracking_note } = req.body;
  if (!['pending', 'shipped', 'delivered'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare("UPDATE shipments SET status=?,tracking_note=?,updated_at=datetime('now') WHERE id=?").run(status, tracking_note || '', req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/balance-logs', auth, admin, (req, res) => {
  const { userId } = req.query;
  res.json(userId
    ? db.prepare('SELECT bl.*,u.username FROM balance_logs bl JOIN users u ON u.id=bl.user_id WHERE bl.user_id=? ORDER BY bl.created_at DESC LIMIT 500').all(userId)
    : db.prepare('SELECT bl.*,u.username FROM balance_logs bl JOIN users u ON u.id=bl.user_id ORDER BY bl.created_at DESC LIMIT 500').all());
});

// ===========================================================================
// Admin: Card Data API — for future TCGPlayer API integration
// ===========================================================================

// Reload card data from disk (after manual JSON edits)
app.post('/api/admin/reload-cards', auth, admin, (req, res) => {
  const ok = reloadData();
  if (ok) res.json({ ok: true, cards: CARDS.length, sv151: SV151.length });
  else res.status(500).json({ error: 'Failed to reload' });
});

// Get card pool stats
app.get('/api/admin/card-stats', auth, admin, (req, res) => {
  const stats = { general: {}, sv151: {} };
  for (const [key, pack] of Object.entries(PACKS)) {
    const cards = pack.exclusive ? SV151 : CARDS;
    const packStats = {};
    for (const [tierName, tier] of Object.entries(pack.tiers)) {
      const pool = filterByRange(cards, tier.min, tier.max);
      packStats[tierName] = { count: pool.length, range: `$${tier.min}-$${tier.max}`, odds: tier.odds };
    }
    stats[key] = packStats;
  }
  stats.totalGeneral = CARDS.length;
  stats.totalSV151 = SV151.length;
  res.json(stats);
});

// Bulk update cards via API (for future TCGPlayer integration)
app.put('/api/admin/cards', auth, admin, (req, res) => {
  const { cards, target } = req.body; // target: 'general' or 'sv151'
  if (!Array.isArray(cards)) return res.status(400).json({ error: 'cards must be an array' });
  try {
    const file = target === 'sv151' ? 'sv151.json' : 'cards.json';
    fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(cards, null, 2));
    reloadData();
    res.json({ ok: true, count: cards.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update single card price (for API price sync)
app.patch('/api/admin/cards/price', auth, admin, (req, res) => {
  const { updates, target } = req.body; // updates: [{img: "sv3pt5/1", value: 0.30}, ...]
  if (!Array.isArray(updates)) return res.status(400).json({ error: 'updates must be an array' });
  const cards = target === 'sv151' ? SV151 : CARDS;
  let updated = 0;
  for (const { img, value } of updates) {
    const card = cards.find(c => c.img === img);
    if (card) { card.value = value; updated++; }
  }
  // Save to disk
  const file = target === 'sv151' ? 'sv151.json' : 'cards.json';
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(cards, null, 2));
  res.json({ ok: true, updated });
});

// ===========================================================================
// CSV Export
// ===========================================================================
function toCsv(rows) {
  if (!rows.length) return '';
  const ks = Object.keys(rows[0]);
  return [ks.join(','), ...rows.map(r => ks.map(k => { let v = r[k]; if (v == null) v = ''; return '"' + String(v).replace(/"/g, '""') + '"'; }).join(','))].join('\n');
}
const EX = ['users', 'balance_logs', 'pulls', 'shipments', 'login_logs', 'page_views'];
app.get('/api/admin/export/:table', auth, admin, (req, res) => {
  const t = req.params.table;
  if (!EX.includes(t)) return res.status(400).json({ error: 'Invalid table' });
  const q = t === 'users' ? 'SELECT id,username,role,balance,first_login_at,last_active_at,created_at FROM users' : 'SELECT * FROM ' + t;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=' + t + '_' + Date.now() + '.csv');
  res.send(toCsv(db.prepare(q).all()));
});

// ===========================================================================
// SPA fallback
// ===========================================================================
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

// ===========================================================================
// Start
// ===========================================================================
app.listen(PORT, () => {
  console.log(`General card pool: ${CARDS.length} cards`);
  console.log(`SV-151 pool: ${SV151.length} cards`);
  console.log(`Packs: ${Object.keys(PACKS).map(k => PACKS[k].name).join(', ')}`);
  // Verify each pack has cards in every tier
  for (const [key, pack] of Object.entries(PACKS)) {
    const cards = pack.exclusive ? SV151 : CARDS;
    for (const [tierName, tier] of Object.entries(pack.tiers)) {
      const count = filterByRange(cards, tier.min, tier.max).length;
      if (count === 0) console.warn(`  WARNING: ${pack.name} tier "${tierName}" ($${tier.min}-$${tier.max}) has 0 cards!`);
      else console.log(`  ${pack.name} / ${tierName}: ${count} cards ($${tier.min}-$${tier.max})`);
    }
  }
  console.log(`TCG Rips running on port ${PORT}`);
});
