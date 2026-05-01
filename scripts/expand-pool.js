#!/usr/bin/env node
/**
 * K2 Collection — Card Pool Expansion Script
 * 
 * Pulls card data from pokemontcg.io free API and outputs cards-general.json
 * 
 * Usage:
 *   node scripts/expand-pool.js
 * 
 * Output:
 *   data/cards-general.json — expanded general card pool
 * 
 * No API key needed (free tier). Rate limited but sufficient for one-time pull.
 */

const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.pokemontcg.io/v2/cards';

// Sets to pull from (recent + popular)
const TARGET_SETS = [
  'sv1',    // Scarlet & Violet
  'sv2',    // Paldea Evolved
  'sv3',    // Obsidian Flames
  'sv3pt5', // 151 — skip, separate pool
  'sv4',    // Paradox Rift
  'sv4pt5', // Paldean Fates
  'sv5',    // Temporal Forces
  'sv6',    // Twilight Masquerade
  'sv6pt5', // Shrouded Fable
  'sv7',    // Stellar Crown
  'sv8',    // Surging Sparks
  'sv8pt5', // Prismatic Evolutions
  'swsh9',  // Brilliant Stars
  'swsh11', // Lost Origin
  'swsh12', // Crown Zenith
  'swsh7',  // Evolving Skies
  'swsh10', // Astral Radiance
  'pgo',    // Pokemon GO
  'cel25',  // Celebrations
];

// Price mapping by rarity
const PRICE_BY_RARITY = {
  'Common':                () => rand(0.05, 0.25),
  'Uncommon':              () => rand(0.10, 0.30),
  'Rare':                  () => rand(0.30, 1.00),
  'Rare Holo':             () => rand(0.50, 2.50),
  'Rare Holo V':           () => rand(2.00, 6.00),
  'Rare Holo VMAX':        () => rand(3.00, 8.00),
  'Rare Holo VSTAR':       () => rand(2.50, 7.00),
  'Rare Ultra':            () => rand(3.00, 10.00),
  'Rare Holo EX':          () => rand(1.50, 5.00),
  'Double Rare':           () => rand(1.50, 6.00),
  'Ultra Rare':            () => rand(5.00, 15.00),
  'Illustration Rare':     () => rand(8.00, 30.00),
  'Special Illustration Rare': () => rand(15.00, 80.00),
  'Hyper Rare':            () => rand(20.00, 60.00),
  'ACE SPEC Rare':         () => rand(3.00, 12.00),
  'Rare Shiny':            () => rand(2.00, 8.00),
  'Rare Shining':          () => rand(5.00, 20.00),
  'Rare Rainbow':          () => rand(8.00, 25.00),
  'Rare Secret':           () => rand(10.00, 40.00),
  'Amazing Rare':          () => rand(3.00, 10.00),
  'Rare BREAK':            () => rand(1.50, 5.00),
  'Promo':                 () => rand(0.50, 3.00),
  'Classic Collection':    () => rand(1.00, 5.00),
};

function rand(min, max) {
  return +(min + Math.random() * (max - min)).toFixed(2);
}

function getPriceForRarity(rarity) {
  if (!rarity) return rand(0.10, 0.50);
  // Check exact match
  if (PRICE_BY_RARITY[rarity]) return PRICE_BY_RARITY[rarity]();
  // Fuzzy match
  const lower = rarity.toLowerCase();
  if (lower.includes('illustration') && lower.includes('special')) return rand(15.00, 80.00);
  if (lower.includes('illustration')) return rand(8.00, 30.00);
  if (lower.includes('hyper')) return rand(20.00, 60.00);
  if (lower.includes('secret')) return rand(10.00, 40.00);
  if (lower.includes('ultra')) return rand(5.00, 15.00);
  if (lower.includes('double')) return rand(1.50, 6.00);
  if (lower.includes('holo') && (lower.includes('v') || lower.includes('ex'))) return rand(2.00, 6.00);
  if (lower.includes('holo')) return rand(0.50, 2.50);
  if (lower.includes('rare')) return rand(0.30, 1.00);
  if (lower.includes('uncommon')) return rand(0.10, 0.30);
  return rand(0.05, 0.25);
}

async function fetchSet(setId) {
  const url = `${API_BASE}?q=set.id:${setId}&pageSize=250`;
  console.log(`Fetching ${setId}...`);
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`  Failed: ${res.status}`);
      return [];
    }
    const data = await res.json();
    const cards = (data.data || []).map(card => ({
      name: card.name,
      set: card.set?.name || setId,
      number: card.number + '/' + (card.set?.printedTotal || card.set?.total || '?'),
      img: card.images?.large || card.images?.small || `${card.set?.id}/${card.number}`,
      value: getPriceForRarity(card.rarity),
      rarity: card.rarity || 'Common',
      // Keep original for reference
      _setId: card.set?.id,
      _cardId: card.id,
    }));
    console.log(`  Got ${cards.length} cards from ${card.set?.name || setId}`);
    // Rate limit: wait 1.5s between requests
    await new Promise(r => setTimeout(r, 1500));
    return cards;
  } catch (e) {
    console.error(`  Error fetching ${setId}:`, e.message);
    return [];
  }
}

async function main() {
  console.log('K2 Collection — Card Pool Expansion');
  console.log('====================================\n');

  let allCards = [];

  for (const setId of TARGET_SETS) {
    if (setId === 'sv3pt5') {
      console.log(`Skipping ${setId} (separate sv151 pool)`);
      continue;
    }
    const cards = await fetchSet(setId);
    allCards = allCards.concat(cards);
    console.log(`  Total so far: ${allCards.length}\n`);
  }

  // Remove internal fields
  const output = allCards.map(({ _setId, _cardId, rarity, ...card }) => card);

  const outPath = path.join(__dirname, '..', 'data', 'cards-general.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nDone! Wrote ${output.length} cards to ${outPath}`);

  // Stats
  const priceRanges = {
    '$0-$0.50': 0, '$0.50-$1': 0, '$1-$3': 0, '$3-$8': 0,
    '$8-$15': 0, '$15-$50': 0, '$50+': 0,
  };
  for (const c of output) {
    if (c.value < 0.50) priceRanges['$0-$0.50']++;
    else if (c.value < 1) priceRanges['$0.50-$1']++;
    else if (c.value < 3) priceRanges['$1-$3']++;
    else if (c.value < 8) priceRanges['$3-$8']++;
    else if (c.value < 15) priceRanges['$8-$15']++;
    else if (c.value < 50) priceRanges['$15-$50']++;
    else priceRanges['$50+']++;
  }
  console.log('\nPrice distribution:');
  for (const [range, count] of Object.entries(priceRanges)) {
    console.log(`  ${range}: ${count} cards (${(count/output.length*100).toFixed(1)}%)`);
  }
}

main().catch(console.error);
