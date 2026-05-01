const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

// Card pools - keyed by pool name
let POOLS = {};
// Pack definitions
let PACKS = {};

// Pool file mapping: pack's "pool" field → JSON filename
const POOL_FILES = {
  'general':  'cards-general.json',
  'sv151':    'cards-sv151.json',
  'me02':     'cards-me02.json',
  'op14':     'cards-op14.json',
  'eb03':     'cards-eb03.json',
};

function loadAllData() {
  // Load packs definition
  PACKS = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'packs.json'), 'utf8'));

  // Load all card pool files that exist
  POOLS = {};
  for (const [poolName, fileName] of Object.entries(POOL_FILES)) {
    const filePath = path.join(DATA_DIR, fileName);
    if (fs.existsSync(filePath)) {
      POOLS[poolName] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      console.log(`Loaded pool "${poolName}": ${POOLS[poolName].length} cards`);
    } else {
      console.warn(`Pool file missing: ${fileName}`);
      POOLS[poolName] = [];
    }
  }

  // Backward compat: also try old filenames
  if (!POOLS.general.length) {
    const oldPath = path.join(DATA_DIR, 'cards.json');
    if (fs.existsSync(oldPath)) {
      POOLS.general = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
      console.log(`Loaded pool "general" from cards.json (legacy): ${POOLS.general.length} cards`);
    }
  }
  if (!POOLS.sv151.length) {
    const oldPath = path.join(DATA_DIR, 'sv151.json');
    if (fs.existsSync(oldPath)) {
      POOLS.sv151 = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
      console.log(`Loaded pool "sv151" from sv151.json (legacy): ${POOLS.sv151.length} cards`);
    }
  }

  return {
    getPacks: () => PACKS,
    getPools: () => POOLS,
    reload: reloadData,
    pullCard,
    rollTier,
    filterByRange,
    getCardsForPack,
    logStatus,
    BUYBACK_RATE: 0.965,
  };
}

function reloadData() {
  try {
    PACKS = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'packs.json'), 'utf8'));
    for (const [poolName, fileName] of Object.entries(POOL_FILES)) {
      const filePath = path.join(DATA_DIR, fileName);
      if (fs.existsSync(filePath)) {
        POOLS[poolName] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    }
    // Legacy fallbacks
    if (!POOLS.general.length) {
      const oldPath = path.join(DATA_DIR, 'cards.json');
      if (fs.existsSync(oldPath)) POOLS.general = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
    }
    if (!POOLS.sv151.length) {
      const oldPath = path.join(DATA_DIR, 'sv151.json');
      if (fs.existsSync(oldPath)) POOLS.sv151 = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
    }
    console.log('Data reloaded successfully');
    return true;
  } catch (e) {
    console.error('Reload failed:', e.message);
    return false;
  }
}

function logStatus() {
  for (const [poolName, cards] of Object.entries(POOLS)) {
    if (cards.length) console.log(`Pool "${poolName}": ${cards.length} cards`);
  }
  console.log(`Packs: ${Object.keys(PACKS).map(k => PACKS[k].name).join(', ')}`);

  // Verify each pack has cards in every tier
  for (const [key, pack] of Object.entries(PACKS)) {
    const cards = getCardsForPack(key);
    for (const [tierName, tier] of Object.entries(pack.tiers)) {
      const count = filterByRange(cards, tier.min, tier.max).length;
      if (count === 0) console.warn(`  ⚠ ${pack.name} / ${tierName} ($${tier.min}-$${tier.max}): 0 cards!`);
      else console.log(`  ${pack.name} / ${tierName}: ${count} cards ($${tier.min}-$${tier.max})`);
    }
  }
}

function getCardsForPack(packType) {
  const pack = PACKS[packType];
  if (!pack) return POOLS.general || [];
  const poolName = pack.pool || 'general';
  return POOLS[poolName] || POOLS.general || [];
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
  for (let i = 0; i < n; i++) {
    r -= weights[i];
    if (r <= 0) return { ...sorted[i] };
  }
  return { ...sorted[0] };
}

function rollTier(packType) {
  const tiers = PACKS[packType].tiers;
  const r = Math.random();
  let c = 0;
  for (const [name, tier] of Object.entries(tiers)) {
    c += tier.odds;
    if (r <= c) return { name, ...tier };
  }
  const entries = Object.entries(tiers);
  const last = entries[entries.length - 1];
  return { name: last[0], ...last[1] };
}

function resolveImgUrl(card) {
  // If img starts with http, use directly (new format from pokemontcg.io API)
  // Otherwise, construct legacy CDN URL
  if (card.img && card.img.startsWith('http')) return card.img;
  return `https://images.pokemontcg.io/${card.img}.png`;
}

function pullCard(packType) {
  const pack = PACKS[packType];
  const allCards = getCardsForPack(packType);
  const tier = rollTier(packType);
  const bias = pack.bias_exponent || 1.0;
  let pool = filterByRange(allCards, tier.min, tier.max);

  // Fallback: widen range if empty
  if (!pool.length) {
    pool = filterByRange(allCards, tier.min * 0.5, tier.max * 2);
    if (!pool.length) pool = allCards;
  }

  const card = pickCard(pool, bias);
  return {
    ...card,
    rarity: tier.name,
    imgUrl: resolveImgUrl(card),
  };
}

module.exports = { loadAllData, POOL_FILES };
