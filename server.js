const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDB } = require('./server/db');
const { loadAllData } = require('./server/pull-engine');
const authRoutes = require('./server/routes-auth');
const userRoutes = require('./server/routes-user');
const adminRoutes = require('./server/routes-admin');
const { exportRoute } = require('./server/csv-export');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

async function start() {
  const db = await initDB();
  const cardData = loadAllData();

  authRoutes(app, db);
  userRoutes(app, db, cardData);
  adminRoutes(app, db, cardData);
  exportRoute(app, db);

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  app.listen(PORT, () => {
    console.log(`K2 Collection running on port ${PORT}`);
    cardData.logStatus();
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
