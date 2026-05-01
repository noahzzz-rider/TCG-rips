const { auth, admin, signToken, bcrypt } = require('./auth');

module.exports = function (app, db) {
  const mw = auth(db);

  app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Credentials required' });
    const u = db.prepare('SELECT * FROM users WHERE username=?').get(username);
    if (!u || !bcrypt.compareSync(password, u.password_hash))
      return res.status(401).json({ error: 'Invalid credentials' });
    if (!u.first_login_at) db.prepare("UPDATE users SET first_login_at=datetime('now') WHERE id=?").run(u.id);
    db.prepare("UPDATE users SET last_active_at=datetime('now') WHERE id=?").run(u.id);
    db.prepare('INSERT INTO login_logs (user_id,ip) VALUES (?,?)').run(
      u.id, req.headers['x-forwarded-for'] || req.socket.remoteAddress || ''
    );
    res.json({
      token: signToken(u),
      user: { id: u.id, username: u.username, role: u.role, balance: u.balance, free_credits: u.free_credits || 0, has_deposited: u.has_deposited || 0 },
    });
  });

  app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    if (username.length < 3 || username.length > 20) return res.status(400).json({ error: 'Username must be 3-20 characters' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (db.prepare('SELECT id FROM users WHERE username=?').get(username))
      return res.status(400).json({ error: 'Username already taken' });

    const FREE_CREDITS = 10;
    const r = db.prepare('INSERT INTO users (username, password_hash, balance, free_credits) VALUES (?, ?, ?, ?)')
      .run(username, bcrypt.hashSync(password, 10), FREE_CREDITS, FREE_CREDITS);
    db.prepare('INSERT INTO balance_logs (user_id, type, amount, balance_after, reason) VALUES (?, ?, ?, ?, ?)')
      .run(r.lastInsertRowid, 'free_credit', FREE_CREDITS, FREE_CREDITS, 'Welcome bonus - $10 free credits');

    const u = db.prepare('SELECT * FROM users WHERE id=?').get(r.lastInsertRowid);
    res.json({
      token: signToken(u),
      user: { id: u.id, username: u.username, role: u.role, balance: u.balance, free_credits: u.free_credits, has_deposited: 0 },
    });
  });

  app.get('/api/me', mw, (req, res) => {
    const u = db.prepare('SELECT id, username, role, balance, free_credits, has_deposited FROM users WHERE id=?').get(req.user.id);
    if (!u) return res.status(404).json({ error: 'Not found' });
    u.vaultCount = db.prepare("SELECT COUNT(*) as c FROM pulls WHERE user_id=? AND action='keep'").get(req.user.id).c;
    // Withdrawal info
    u.canWithdraw = u.has_deposited && u.balance >= 20;
    u.withdrawalGap = Math.max(0, 20 - u.balance);
    res.json(u);
  });
};
