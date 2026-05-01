const { auth, admin, signToken, bcrypt } = require('./auth');

module.exports = function (app, db) {
  const mw = auth(db);

  app.post('/api/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) return res.status(400).json({ error: 'Credentials required' });
      const { rows } = await db.query('SELECT * FROM users WHERE username=$1', [username]);
      const u = rows[0];
      if (!u || !bcrypt.compareSync(password, u.password_hash))
        return res.status(401).json({ error: 'Invalid credentials' });
      if (!u.first_login_at) await db.query('UPDATE users SET first_login_at=NOW() WHERE id=$1', [u.id]);
      await db.query('UPDATE users SET last_active_at=NOW() WHERE id=$1', [u.id]);
      await db.query('INSERT INTO login_logs (user_id, ip) VALUES ($1, $2)', [u.id, req.headers['x-forwarded-for'] || req.socket.remoteAddress || '']);
      res.json({
        token: signToken(u),
        user: { id: u.id, username: u.username, role: u.role, balance: +u.balance, free_credits: +(u.free_credits||0), has_deposited: u.has_deposited||0 },
      });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/register', async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
      if (username.length < 3 || username.length > 20) return res.status(400).json({ error: 'Username must be 3-20 characters' });
      if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
      const dup = await db.query('SELECT id FROM users WHERE username=$1', [username]);
      if (dup.rows.length) return res.status(400).json({ error: 'Username already taken' });

      const FREE = 10;
      const r = await db.query(
        'INSERT INTO users (username, password_hash, balance, free_credits) VALUES ($1,$2,$3,$4) RETURNING *',
        [username, bcrypt.hashSync(password, 10), FREE, FREE]
      );
      const u = r.rows[0];
      await db.query('INSERT INTO balance_logs (user_id,type,amount,balance_after,reason) VALUES ($1,$2,$3,$4,$5)',
        [u.id, 'free_credit', FREE, FREE, 'Welcome bonus - $10 free credits']);
      res.json({
        token: signToken(u),
        user: { id: u.id, username: u.username, role: u.role, balance: +u.balance, free_credits: +u.free_credits, has_deposited: 0 },
      });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
  });

  app.get('/api/me', mw, async (req, res) => {
    try {
      const { rows } = await db.query('SELECT id,username,role,balance,free_credits,has_deposited FROM users WHERE id=$1', [req.user.id]);
      const u = rows[0];
      if (!u) return res.status(404).json({ error: 'Not found' });
      u.balance = +u.balance; u.free_credits = +(u.free_credits||0);
      const vc = await db.query("SELECT COUNT(*) as c FROM pulls WHERE user_id=$1 AND action='keep'", [req.user.id]);
      u.vaultCount = +vc.rows[0].c;
      u.canWithdraw = u.has_deposited && u.balance >= 20;
      u.withdrawalGap = Math.max(0, 20 - u.balance);
      res.json(u);
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
  });
};
