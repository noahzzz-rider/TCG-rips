const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const JWT_SECRET = process.env.JWT_SECRET || 'tcg-rips-secret-key-change-me';

function auth(db) {
  return (req, res, next) => {
    const h = req.headers.authorization;
    if (!h) return res.status(401).json({ error: 'No token' });
    try {
      req.user = jwt.verify(h.replace('Bearer ', ''), JWT_SECRET);
      db.prepare("UPDATE users SET last_active_at=datetime('now') WHERE id=?").run(req.user.id);
      next();
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }
  };
}

function admin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

module.exports = { auth, admin, signToken, bcrypt };
