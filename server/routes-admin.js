const { auth, admin, bcrypt } = require('./auth');
const fs = require('fs');
const path = require('path');
const DATA_DIR = path.join(__dirname, '..', 'data');

module.exports = function (app, db, cardData) {
  const mw = auth(db);

  app.post('/api/admin/create-user', mw, admin, async (req, res) => {
    try {
      const { username, password, balance } = req.body;
      if (!username || !password) return res.status(400).json({ error: 'Credentials required' });
      const dup = await db.query('SELECT id FROM users WHERE username=$1', [username]);
      if (dup.rows.length) return res.status(400).json({ error: 'Username exists' });
      const initBal = balance || 20;
      const r = await db.query('INSERT INTO users (username,password_hash,balance) VALUES ($1,$2,$3) RETURNING id', [username, bcrypt.hashSync(password, 10), initBal]);
      await db.query('INSERT INTO balance_logs (user_id,operator_id,type,amount,balance_after,reason) VALUES ($1,$2,$3,$4,$5,$6)', [r.rows[0].id, req.user.id, 'initial', initBal, initBal, 'New user welcome bonus']);
      res.json({ id: r.rows[0].id, username, balance: initBal });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
  });

  app.get('/api/admin/users', mw, admin, async (req, res) => {
    try {
      const { rows } = await db.query(`
        SELECT u.id, u.username, u.role, u.balance, u.free_credits, u.has_deposited,
          u.first_login_at, u.last_active_at, u.created_at,
          (SELECT COUNT(*) FROM pulls WHERE user_id=u.id) as total_pulls,
          (SELECT COALESCE(SUM(amount),0) FROM balance_logs WHERE user_id=u.id AND type='topup') as total_topup
        FROM users u ORDER BY u.created_at DESC
      `);
      res.json(rows.map(r => ({ ...r, balance: +r.balance, free_credits: +(r.free_credits||0), total_pulls: +r.total_pulls, total_topup: +r.total_topup })));
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/admin/balance', mw, admin, async (req, res) => {
    try {
      const { userId, type, amount, reason } = req.body;
      if (!userId || !type || !amount) return res.status(400).json({ error: 'Missing fields' });
      const { rows } = await db.query('SELECT * FROM users WHERE id=$1', [userId]);
      const u = rows[0];
      if (!u) return res.status(404).json({ error: 'Not found' });
      const isD = ['deduct', 'refund', 'withdrawal'].includes(type);
      const d = isD ? -Math.abs(parseFloat(amount)) : Math.abs(parseFloat(amount));
      const nb = +(+u.balance + d).toFixed(2);
      if (nb < 0) return res.status(400).json({ error: 'Balance would go negative' });
      await db.query('UPDATE users SET balance=$1 WHERE id=$2', [nb, userId]);
      if (type === 'topup') await db.query('UPDATE users SET has_deposited=1 WHERE id=$1', [userId]);
      await db.query('INSERT INTO balance_logs (user_id,operator_id,type,amount,balance_after,reason) VALUES ($1,$2,$3,$4,$5,$6)', [userId, req.user.id, type, d, nb, reason || '']);
      res.json({ balance: nb });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
  });

  app.get('/api/admin/pulls', mw, admin, async (req, res) => {
    try {
      const { userId } = req.query;
      const q = userId
        ? await db.query('SELECT p.*,u.username FROM pulls p JOIN users u ON u.id=p.user_id WHERE p.user_id=$1 ORDER BY p.created_at DESC LIMIT 500', [userId])
        : await db.query('SELECT p.*,u.username FROM pulls p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 500');
      res.json(q.rows.map(r => ({ ...r, card_value: +r.card_value, pack_cost: +r.pack_cost, sell_credit: +r.sell_credit })));
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
  });

  app.get('/api/admin/vault', mw, admin, async (req, res) => {
    try {
      const { rows } = await db.query("SELECT p.*,u.username,s.status as ship_status,s.tracking_note,s.id as shipment_id FROM pulls p JOIN users u ON u.id=p.user_id LEFT JOIN shipments s ON s.pull_id=p.id WHERE p.action='keep' ORDER BY p.created_at DESC");
      res.json(rows.map(r => ({ ...r, card_value: +r.card_value, pack_cost: +r.pack_cost })));
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/admin/shipment/:id/status', mw, admin, async (req, res) => {
    try {
      const { status, tracking_note } = req.body;
      if (!['pending', 'shipped', 'delivered'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
      await db.query('UPDATE shipments SET status=$1,tracking_note=$2,updated_at=NOW() WHERE id=$3', [status, tracking_note || '', req.params.id]);
      res.json({ ok: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
  });

  app.get('/api/admin/balance-logs', mw, admin, async (req, res) => {
    try {
      const { userId } = req.query;
      const q = userId
        ? await db.query('SELECT bl.*,u.username FROM balance_logs bl JOIN users u ON u.id=bl.user_id WHERE bl.user_id=$1 ORDER BY bl.created_at DESC LIMIT 500', [userId])
        : await db.query('SELECT bl.*,u.username FROM balance_logs bl JOIN users u ON u.id=bl.user_id ORDER BY bl.created_at DESC LIMIT 500');
      res.json(q.rows.map(r => ({ ...r, amount: +r.amount, balance_after: +r.balance_after })));
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/admin/reload-cards', mw, admin, (req, res) => {
    const ok = cardData.reload();
    if (ok) {
      const POOLS = cardData.getPools();
      const counts = {};
      for (const [k, v] of Object.entries(POOLS)) counts[k] = v.length;
      res.json({ ok: true, pools: counts });
    } else res.status(500).json({ error: 'Failed' });
  });

  app.get('/api/admin/card-stats', mw, admin, (req, res) => {
    const PACKS = cardData.getPacks();
    const stats = {};
    for (const [key, pack] of Object.entries(PACKS)) {
      const cards = cardData.getCardsForPack(key);
      const ps = {};
      for (const [tn, t] of Object.entries(pack.tiers)) {
        const pool = cardData.filterByRange(cards, t.min, t.max);
        ps[tn] = { count: pool.length, range: `$${t.min}-$${t.max}`, odds: t.odds };
      }
      stats[key] = ps;
    }
    res.json(stats);
  });
};
