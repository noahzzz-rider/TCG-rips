const { auth, admin, bcrypt } = require('./auth');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

module.exports = function (app, db, cardData) {
  const mw = auth(db);

  // ── Create user ──
  app.post('/api/admin/create-user', mw, admin, (req, res) => {
    const { username, password, balance } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Credentials required' });
    if (db.prepare('SELECT id FROM users WHERE username=?').get(username))
      return res.status(400).json({ error: 'Username exists' });
    const initBal = balance || 20;
    const r = db.prepare('INSERT INTO users (username, password_hash, balance) VALUES (?, ?, ?)')
      .run(username, bcrypt.hashSync(password, 10), initBal);
    db.prepare('INSERT INTO balance_logs (user_id, operator_id, type, amount, balance_after, reason) VALUES (?, ?, ?, ?, ?, ?)')
      .run(r.lastInsertRowid, req.user.id, 'initial', initBal, initBal, 'New user welcome bonus');
    res.json({ id: r.lastInsertRowid, username, balance: initBal });
  });

  // ── List users ──
  app.get('/api/admin/users', mw, admin, (req, res) => {
    res.json(
      db.prepare(`
        SELECT u.id, u.username, u.role, u.balance, u.free_credits, u.has_deposited,
          u.first_login_at, u.last_active_at, u.created_at,
          (SELECT COUNT(*) FROM pulls WHERE user_id=u.id) as total_pulls,
          (SELECT COALESCE(SUM(amount),0) FROM balance_logs WHERE user_id=u.id AND type='topup') as total_topup
        FROM users u ORDER BY u.created_at DESC
      `).all()
    );
  });

  // ── Balance adjustment ──
  app.post('/api/admin/balance', mw, admin, (req, res) => {
    const { userId, type, amount, reason } = req.body;
    if (!userId || !type || !amount) return res.status(400).json({ error: 'Missing fields' });
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
    if (!u) return res.status(404).json({ error: 'Not found' });
    const isD = ['deduct', 'refund', 'withdrawal'].includes(type);
    const d = isD ? -Math.abs(parseFloat(amount)) : Math.abs(parseFloat(amount));
    const nb = +(u.balance + d).toFixed(2);
    if (nb < 0) return res.status(400).json({ error: 'Balance would go negative' });
    db.prepare('UPDATE users SET balance=? WHERE id=?').run(nb, userId);
    if (type === 'topup') {
      db.prepare('UPDATE users SET has_deposited=1 WHERE id=?').run(userId);
    }
    db.prepare('INSERT INTO balance_logs (user_id, operator_id, type, amount, balance_after, reason) VALUES (?, ?, ?, ?, ?, ?)')
      .run(userId, req.user.id, type, d, nb, reason || '');
    res.json({ balance: nb });
  });

  // ── Pull history ──
  app.get('/api/admin/pulls', mw, admin, (req, res) => {
    const { userId } = req.query;
    res.json(
      userId
        ? db.prepare('SELECT p.*, u.username FROM pulls p JOIN users u ON u.id=p.user_id WHERE p.user_id=? ORDER BY p.created_at DESC LIMIT 500').all(userId)
        : db.prepare('SELECT p.*, u.username FROM pulls p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 500').all()
    );
  });

  // ── Vault management ──
  app.get('/api/admin/vault', mw, admin, (req, res) => {
    res.json(
      db.prepare(`
        SELECT p.*, u.username, s.status as ship_status, s.tracking_note, s.id as shipment_id
        FROM pulls p JOIN users u ON u.id=p.user_id LEFT JOIN shipments s ON s.pull_id=p.id
        WHERE p.action='keep' ORDER BY p.created_at DESC
      `).all()
    );
  });

  app.post('/api/admin/shipment/:id/status', mw, admin, (req, res) => {
    const { status, tracking_note } = req.body;
    if (!['pending', 'shipped', 'delivered'].includes(status))
      return res.status(400).json({ error: 'Invalid status' });
    db.prepare("UPDATE shipments SET status=?, tracking_note=?, updated_at=datetime('now') WHERE id=?")
      .run(status, tracking_note || '', req.params.id);
    res.json({ ok: true });
  });

  // ── Balance logs ──
  app.get('/api/admin/balance-logs', mw, admin, (req, res) => {
    const { userId } = req.query;
    res.json(
      userId
        ? db.prepare('SELECT bl.*, u.username FROM balance_logs bl JOIN users u ON u.id=bl.user_id WHERE bl.user_id=? ORDER BY bl.created_at DESC LIMIT 500').all(userId)
        : db.prepare('SELECT bl.*, u.username FROM balance_logs bl JOIN users u ON u.id=bl.user_id ORDER BY bl.created_at DESC LIMIT 500').all()
    );
  });

  // ── Reload card data ──
  app.post('/api/admin/reload-cards', mw, admin, (req, res) => {
    const ok = cardData.reload();
    if (ok) {
      const POOLS = cardData.getPools();
      const counts = {};
      for (const [k, v] of Object.entries(POOLS)) counts[k] = v.length;
      res.json({ ok: true, pools: counts });
    } else {
      res.status(500).json({ error: 'Failed to reload' });
    }
  });

  // ── Card pool stats ──
  app.get('/api/admin/card-stats', mw, admin, (req, res) => {
    const PACKS = cardData.getPacks();
    const POOLS = cardData.getPools();
    const stats = {};
    for (const [key, pack] of Object.entries(PACKS)) {
      const cards = cardData.getCardsForPack(key);
      const packStats = {};
      for (const [tierName, tier] of Object.entries(pack.tiers)) {
        const pool = cardData.filterByRange(cards, tier.min, tier.max);
        packStats[tierName] = { count: pool.length, range: `$${tier.min}-$${tier.max}`, odds: tier.odds };
      }
      stats[key] = packStats;
    }
    const poolCounts = {};
    for (const [k, v] of Object.entries(POOLS)) poolCounts[k] = v.length;
    stats.poolCounts = poolCounts;
    res.json(stats);
  });

  // ── Bulk update cards ──
  app.put('/api/admin/cards', mw, admin, (req, res) => {
    const { cards, target } = req.body;
    if (!Array.isArray(cards)) return res.status(400).json({ error: 'cards must be an array' });
    try {
      const fileMap = {
        general: 'cards-general.json', sv151: 'cards-sv151.json',
        me02: 'cards-me02.json', op14: 'cards-op14.json', eb03: 'cards-eb03.json',
      };
      const file = fileMap[target] || 'cards-general.json';
      fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(cards, null, 2));
      cardData.reload();
      res.json({ ok: true, count: cards.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Batch price update ──
  app.patch('/api/admin/cards/price', mw, admin, (req, res) => {
    const { updates, target } = req.body;
    if (!Array.isArray(updates)) return res.status(400).json({ error: 'updates must be an array' });
    const POOLS = cardData.getPools();
    const cards = POOLS[target || 'general'] || POOLS.general;
    let updated = 0;
    for (const { img, value } of updates) {
      const card = cards.find(c => c.img === img);
      if (card) { card.value = value; updated++; }
    }
    const fileMap = {
      general: 'cards-general.json', sv151: 'cards-sv151.json',
      me02: 'cards-me02.json', op14: 'cards-op14.json', eb03: 'cards-eb03.json',
    };
    const file = fileMap[target || 'general'] || 'cards-general.json';
    fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(cards, null, 2));
    res.json({ ok: true, updated });
  });
};
