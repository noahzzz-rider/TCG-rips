const { auth, admin } = require('./auth');

function toCsv(rows) {
  if (!rows.length) return '';
  const ks = Object.keys(rows[0]);
  return [
    ks.join(','),
    ...rows.map(r => ks.map(k => {
      let v = r[k];
      if (v == null) v = '';
      return '"' + String(v).replace(/"/g, '""') + '"';
    }).join(','))
  ].join('\n');
}

const EXPORTABLE = ['users', 'balance_logs', 'pulls', 'shipments', 'login_logs', 'page_views'];

function exportRoute(app, db) {
  const mw = auth(db);

  app.get('/api/admin/export/:table', mw, admin, (req, res) => {
    const t = req.params.table;
    if (!EXPORTABLE.includes(t)) return res.status(400).json({ error: 'Invalid table' });
    const q = t === 'users'
      ? 'SELECT id, username, role, balance, free_credits, has_deposited, first_login_at, last_active_at, created_at FROM users'
      : 'SELECT * FROM ' + t;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${t}_${Date.now()}.csv`);
    res.send(toCsv(db.prepare(q).all()));
  });
}

module.exports = { exportRoute };
