const { auth } = require('./auth');

module.exports = function (app, db, cardData) {
  const mw = auth(db);
  const BUYBACK_RATE = cardData.BUYBACK_RATE;

  app.get('/api/odds', mw, async (req, res) => {
    try {
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
        result[key] = { name: pack.name, cost: pack.cost, description: pack.description, ev_label: pack.ev_label, volatility: pack.volatility || 'Normal', category: pack.category || 'regular', tiers: tierInfo };
      }
      const POOLS = cardData.getPools();
      const poolCounts = {};
      for (const [k, v] of Object.entries(POOLS)) poolCounts[k] = v.length;
      res.json({ packs: result, buybackRate: BUYBACK_RATE, poolCounts });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/pull', mw, async (req, res) => {
    try {
      const PACKS = cardData.getPacks();
      const pack = PACKS[req.body.packType];
      if (!pack) return res.status(400).json({ error: 'Invalid pack' });
      const { rows } = await db.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
      const u = rows[0];
      const freeOnly = +u.free_credits > 0 && !u.has_deposited;
      if (freeOnly && pack.cost > 5) return res.status(400).json({ error: 'Free credits can only be used on $1 and $5 packs.' });
      if (+u.balance < pack.cost) return res.status(400).json({ error: 'Insufficient balance' });

      const nb = +(+u.balance - pack.cost).toFixed(2);
      let nf = Math.max(0, +(+(u.free_credits||0) - pack.cost).toFixed(2));
      await db.query('UPDATE users SET balance=$1, free_credits=$2 WHERE id=$3', [nb, nf, u.id]);
      await db.query('INSERT INTO balance_logs (user_id,type,amount,balance_after,reason) VALUES ($1,$2,$3,$4,$5)', [u.id, 'purchase', -pack.cost, nb, 'Opened ' + pack.name]);

      const card = cardData.pullCard(req.body.packType);
      const r = await db.query('INSERT INTO pulls (user_id,pack_type,pack_cost,card_name,card_set,card_number,card_img,card_rarity,card_value) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id', [u.id, req.body.packType, pack.cost, card.name, card.set, card.number, card.imgUrl, card.rarity, card.value]);
      res.json({ pullId: r.rows[0].id, card, balance: nb, sellValue: +(card.value * BUYBACK_RATE).toFixed(2), free_credits: nf });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/pull/batch', mw, async (req, res) => {
    try {
      const PACKS = cardData.getPacks();
      const pack = PACKS[req.body.packType];
      if (!pack) return res.status(400).json({ error: 'Invalid pack' });
      const tc = pack.cost * 5;
      const { rows } = await db.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
      const u = rows[0];
      const freeOnly = +u.free_credits > 0 && !u.has_deposited;
      if (freeOnly && pack.cost > 5) return res.status(400).json({ error: 'Free credits can only be used on $1 and $5 packs.' });
      if (+u.balance < tc) return res.status(400).json({ error: 'Insufficient balance' });

      const nb = +(+u.balance - tc).toFixed(2);
      let nf = Math.max(0, +(+(u.free_credits||0) - tc).toFixed(2));
      await db.query('UPDATE users SET balance=$1, free_credits=$2 WHERE id=$3', [nb, nf, u.id]);
      await db.query('INSERT INTO balance_logs (user_id,type,amount,balance_after,reason) VALUES ($1,$2,$3,$4,$5)', [u.id, 'purchase', -tc, nb, 'Opened 5x ' + pack.name]);

      const cards = [];
      for (let i = 0; i < 5; i++) cards.push(cardData.pullCard(req.body.packType));

      // Pity
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
      for (const c of cards) {
        const r = await db.query('INSERT INTO pulls (user_id,pack_type,pack_cost,card_name,card_set,card_number,card_img,card_rarity,card_value) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id', [u.id, req.body.packType, pack.cost, c.name, c.set, c.number, c.imgUrl, c.rarity, c.value]);
        pulls.push({ pullId: r.rows[0].id, card: c, sellValue: +(c.value * BUYBACK_RATE).toFixed(2) });
      }
      res.json({ pulls, balance: nb, free_credits: nf });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/pull/:id/action', mw, async (req, res) => {
    try {
      const { action } = req.body;
      if (!['keep', 'sell'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
      const { rows } = await db.query('SELECT * FROM pulls WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
      const p = rows[0];
      if (!p) return res.status(404).json({ error: 'Not found' });
      if (p.action) return res.status(400).json({ error: 'Already actioned' });

      if (action === 'keep') {
        await db.query('UPDATE pulls SET action=$1 WHERE id=$2', ['keep', p.id]);
        await db.query('INSERT INTO shipments (user_id, pull_id) VALUES ($1,$2)', [req.user.id, p.id]);
        const bal = await db.query('SELECT balance FROM users WHERE id=$1', [req.user.id]);
        res.json({ action: 'keep', balance: +bal.rows[0].balance });
      } else {
        const sc = +(+p.card_value * BUYBACK_RATE).toFixed(2);
        const bal = await db.query('SELECT balance FROM users WHERE id=$1', [req.user.id]);
        const nb = +(+bal.rows[0].balance + sc).toFixed(2);
        await db.query('UPDATE pulls SET action=$1, sell_credit=$2 WHERE id=$3', ['sell', sc, p.id]);
        await db.query('UPDATE users SET balance=$1 WHERE id=$2', [nb, req.user.id]);
        await db.query('INSERT INTO balance_logs (user_id,type,amount,balance_after,reason) VALUES ($1,$2,$3,$4,$5)', [req.user.id, 'sell', sc, nb, 'Sold ' + p.card_name]);
        res.json({ action: 'sell', sellCredit: sc, balance: nb });
      }
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
  });

  app.get('/api/vault', mw, async (req, res) => {
    try {
      const { rows } = await db.query("SELECT p.*, s.status as ship_status, s.tracking_note FROM pulls p LEFT JOIN shipments s ON s.pull_id=p.id WHERE p.user_id=$1 AND p.action='keep' ORDER BY p.created_at DESC", [req.user.id]);
      res.json(rows.map(r => ({ ...r, card_value: +r.card_value, sell_credit: +r.sell_credit, pack_cost: +r.pack_cost })));
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
  });

  app.get('/api/pulls', mw, async (req, res) => {
    try {
      const { rows } = await db.query('SELECT * FROM pulls WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [req.user.id]);
      res.json(rows.map(r => ({ ...r, card_value: +r.card_value, sell_credit: +r.sell_credit, pack_cost: +r.pack_cost })));
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
  });

  app.post('/api/page-view', mw, async (req, res) => {
    try {
      const { page, entered_at, exited_at, duration_seconds } = req.body;
      await db.query('INSERT INTO page_views (user_id,page,entered_at,exited_at,duration_seconds) VALUES ($1,$2,$3,$4,$5)', [req.user.id, page, entered_at, exited_at, duration_seconds]);
      res.json({ ok: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
  });
};
