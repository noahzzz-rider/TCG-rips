const { auth } = require('./auth');

module.exports = function (app, db, cardData) {
  const mw = auth(db);
  const BUYBACK_RATE = cardData.BUYBACK_RATE;

  // ── Pack info + odds ──
  app.get('/api/odds', mw, (req, res) => {
    const PACKS = cardData.getPacks();
    const result = {};
    for (const [key, pack] of Object.entries(PACKS)) {
      const cards = cardData.getCardsForPack(key);
      const tierInfo = {};
      for (const [tierName, tier] of Object.entries(pack.tiers)) {
        const pool = cardData.filterByRange(cards, tier.min, tier.max);
        tierInfo[tierName] = {
          min: tier.min, max: tier.max, odds: tier.odds, cardCount: pool.length,
          minValue: pool.length ? Math.min(...pool.map(c => c.value)) : tier.min,
          maxValue: pool.length ? Math.max(...pool.map(c => c.value)) : tier.max,
        };
      }
      result[key] = {
        name: pack.name, cost: pack.cost, description: pack.description,
        ev_label: pack.ev_label, volatility: pack.volatility || 'Normal',
        category: pack.category || 'regular', tiers: tierInfo,
      };
    }
    const POOLS = cardData.getPools();
    const poolCounts = {};
    for (const [k, v] of Object.entries(POOLS)) poolCounts[k] = v.length;
    res.json({ packs: result, buybackRate: BUYBACK_RATE, poolCounts });
  });

  // ── Single pull ──
  app.post('/api/pull', mw, (req, res) => {
    const PACKS = cardData.getPacks();
    const pack = PACKS[req.body.packType];
    if (!pack) return res.status(400).json({ error: 'Invalid pack' });

    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);

    // Free credits restriction: only $1/$5 packs
    const freeOnly = u.free_credits > 0 && !u.has_deposited;
    if (freeOnly && pack.cost > 5) {
      return res.status(400).json({ error: 'Free credits can only be used on $1 and $5 packs. Deposit to unlock all packs.' });
    }

    if (u.balance < pack.cost) return res.status(400).json({ error: 'Insufficient balance' });

    const nb = +(u.balance - pack.cost).toFixed(2);
    // Track free credits consumption
    let newFree = u.free_credits || 0;
    if (newFree > 0) {
      newFree = Math.max(0, +(newFree - pack.cost).toFixed(2));
    }
    db.prepare('UPDATE users SET balance=?, free_credits=? WHERE id=?').run(nb, newFree, u.id);
    db.prepare('INSERT INTO balance_logs (user_id,type,amount,balance_after,reason) VALUES (?,?,?,?,?)')
      .run(u.id, 'purchase', -pack.cost, nb, 'Opened ' + pack.name);

    const card = cardData.pullCard(req.body.packType);
    const r = db.prepare('INSERT INTO pulls (user_id,pack_type,pack_cost,card_name,card_set,card_number,card_img,card_rarity,card_value) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(u.id, req.body.packType, pack.cost, card.name, card.set, card.number, card.imgUrl, card.rarity, card.value);

    res.json({
      pullId: r.lastInsertRowid, card, balance: nb,
      sellValue: +(card.value * BUYBACK_RATE).toFixed(2),
      free_credits: newFree,
    });
  });

  // ── Batch pull (5x) ──
  app.post('/api/pull/batch', mw, (req, res) => {
    const PACKS = cardData.getPacks();
    const pack = PACKS[req.body.packType];
    if (!pack) return res.status(400).json({ error: 'Invalid pack' });
    const tc = pack.cost * 5;

    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);

    const freeOnly = u.free_credits > 0 && !u.has_deposited;
    if (freeOnly && pack.cost > 5) {
      return res.status(400).json({ error: 'Free credits can only be used on $1 and $5 packs.' });
    }

    if (u.balance < tc) return res.status(400).json({ error: 'Insufficient balance' });

    const nb = +(u.balance - tc).toFixed(2);
    let newFree = u.free_credits || 0;
    if (newFree > 0) {
      newFree = Math.max(0, +(newFree - tc).toFixed(2));
    }
    db.prepare('UPDATE users SET balance=?, free_credits=? WHERE id=?').run(nb, newFree, u.id);
    db.prepare('INSERT INTO balance_logs (user_id,type,amount,balance_after,reason) VALUES (?,?,?,?,?)')
      .run(u.id, 'purchase', -tc, nb, 'Opened 5x ' + pack.name);

    const cards = [];
    for (let i = 0; i < 5; i++) cards.push(cardData.pullCard(req.body.packType));

    // Pity: if all same lowest tier, upgrade last card
    const tierNames = Object.keys(pack.tiers);
    const lowestTier = tierNames[0];
    if (cards.every(c => c.rarity === lowestTier) && tierNames.length > 1) {
      const nextTier = pack.tiers[tierNames[1]];
      const pool = cardData.filterByRange(cardData.getCardsForPack(req.body.packType), nextTier.min, nextTier.max);
      if (pool.length) {
        const up = pool[Math.floor(Math.random() * pool.length)];
        const imgUrl = up.img && up.img.startsWith('http') ? up.img : `https://images.pokemontcg.io/${up.img}.png`;
        cards[4] = { ...up, rarity: tierNames[1], imgUrl };
      }
    }

    const pulls = [];
    const ins = db.prepare('INSERT INTO pulls (user_id,pack_type,pack_cost,card_name,card_set,card_number,card_img,card_rarity,card_value) VALUES (?,?,?,?,?,?,?,?,?)');
    for (const c of cards) {
      const r = ins.run(u.id, req.body.packType, pack.cost, c.name, c.set, c.number, c.imgUrl, c.rarity, c.value);
      pulls.push({ pullId: r.lastInsertRowid, card: c, sellValue: +(c.value * BUYBACK_RATE).toFixed(2) });
    }

    res.json({ pulls, balance: nb, free_credits: newFree });
  });

  // ── Card action: keep or sell ──
  app.post('/api/pull/:id/action', mw, (req, res) => {
    const { action } = req.body;
    if (!['keep', 'sell'].includes(action)) return res.status(400).json({ error: 'Invalid action. Use "keep" or "sell".' });

    const p = db.prepare('SELECT * FROM pulls WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    if (p.action) return res.status(400).json({ error: 'Already actioned' });

    if (action === 'keep') {
      db.prepare('UPDATE pulls SET action=? WHERE id=?').run('keep', p.id);
      db.prepare('INSERT INTO shipments (user_id, pull_id) VALUES (?, ?)').run(req.user.id, p.id);
      res.json({ action: 'keep', balance: db.prepare('SELECT balance FROM users WHERE id=?').get(req.user.id).balance });
    } else {
      const sc = +(p.card_value * BUYBACK_RATE).toFixed(2);
      const bal = db.prepare('SELECT balance FROM users WHERE id=?').get(req.user.id).balance;
      const nb = +(bal + sc).toFixed(2);
      db.prepare('UPDATE pulls SET action=?, sell_credit=? WHERE id=?').run('sell', sc, p.id);
      db.prepare('UPDATE users SET balance=? WHERE id=?').run(nb, req.user.id);
      db.prepare('INSERT INTO balance_logs (user_id,type,amount,balance_after,reason) VALUES (?,?,?,?,?)')
        .run(req.user.id, 'sell', sc, nb, 'Sold ' + p.card_name);
      res.json({ action: 'sell', sellCredit: sc, balance: nb });
    }
  });

  // ── Vault / Collection ──
  app.get('/api/vault', mw, (req, res) => {
    res.json(
      db.prepare("SELECT p.*, s.status as ship_status, s.tracking_note FROM pulls p LEFT JOIN shipments s ON s.pull_id=p.id WHERE p.user_id=? AND p.action='keep' ORDER BY p.created_at DESC")
        .all(req.user.id)
    );
  });

  // ── Pull history ──
  app.get('/api/pulls', mw, (req, res) => {
    res.json(db.prepare('SELECT * FROM pulls WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(req.user.id));
  });

  // ── Page views ──
  app.post('/api/page-view', mw, (req, res) => {
    const { page, entered_at, exited_at, duration_seconds } = req.body;
    db.prepare('INSERT INTO page_views (user_id,page,entered_at,exited_at,duration_seconds) VALUES (?,?,?,?,?)')
      .run(req.user.id, page, entered_at, exited_at, duration_seconds);
    res.json({ ok: true });
  });
};
