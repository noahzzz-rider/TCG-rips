const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'tcg-rips-secret-key-change-me';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'tcg.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL, role TEXT DEFAULT 'user' CHECK(role IN ('user','admin')),
    balance REAL DEFAULT 0, first_login_at TEXT, last_active_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS balance_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, operator_id INTEGER,
    type TEXT NOT NULL CHECK(type IN ('topup','deduct','refund','initial','referral','airdrop','withdrawal','recycle','purchase')),
    amount REAL NOT NULL, balance_after REAL NOT NULL, reason TEXT,
    created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS pulls (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, pack_type TEXT NOT NULL,
    pack_cost REAL NOT NULL, card_name TEXT NOT NULL, card_set TEXT NOT NULL,
    card_number TEXT NOT NULL, card_img TEXT NOT NULL, card_rarity TEXT NOT NULL,
    card_value REAL NOT NULL, action TEXT CHECK(action IN ('keep','recycle')),
    recycle_credit REAL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS shipments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, pull_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','shipped','delivered')),
    tracking_note TEXT, created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (pull_id) REFERENCES pulls(id)
  );
  CREATE TABLE IF NOT EXISTS login_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, ip TEXT,
    login_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS page_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, page TEXT NOT NULL,
    entered_at TEXT, exited_at TEXT, duration_seconds REAL,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (username, password_hash, role, balance) VALUES (?, ?, ?, ?)').run('admin', hash, 'admin', 0);
  console.log('Default admin created: admin / admin123');
}

// ===========================================================================
//  POOL A — SV-151 EXCLUSIVE (sv3pt5 only, ~110 cards)
//  Used ONLY by the SV-151 Pack
// ===========================================================================
const SV151_POOLS = {

bulk: [
  { name:'Bulbasaur',      set:'SV—151', number:'1/165',   img:'sv3pt5/1',   value:0.25 },
  { name:'Ivysaur',         set:'SV—151', number:'2/165',   img:'sv3pt5/2',   value:0.15 },
  { name:'Charmander',      set:'SV—151', number:'4/165',   img:'sv3pt5/4',   value:0.35 },
  { name:'Charmeleon',      set:'SV—151', number:'5/165',   img:'sv3pt5/5',   value:0.20 },
  { name:'Squirtle',        set:'SV—151', number:'7/165',   img:'sv3pt5/7',   value:0.25 },
  { name:'Wartortle',       set:'SV—151', number:'8/165',   img:'sv3pt5/8',   value:0.15 },
  { name:'Caterpie',        set:'SV—151', number:'10/165',  img:'sv3pt5/10',  value:0.10 },
  { name:'Metapod',         set:'SV—151', number:'11/165',  img:'sv3pt5/11',  value:0.10 },
  { name:'Butterfree',      set:'SV—151', number:'12/165',  img:'sv3pt5/12',  value:0.15 },
  { name:'Weedle',          set:'SV—151', number:'13/165',  img:'sv3pt5/13',  value:0.10 },
  { name:'Kakuna',          set:'SV—151', number:'14/165',  img:'sv3pt5/14',  value:0.10 },
  { name:'Beedrill',        set:'SV—151', number:'15/165',  img:'sv3pt5/15',  value:0.15 },
  { name:'Pidgey',          set:'SV—151', number:'16/165',  img:'sv3pt5/16',  value:0.10 },
  { name:'Pidgeotto',       set:'SV—151', number:'17/165',  img:'sv3pt5/17',  value:0.10 },
  { name:'Pidgeot',         set:'SV—151', number:'18/165',  img:'sv3pt5/18',  value:0.15 },
  { name:'Rattata',         set:'SV—151', number:'19/165',  img:'sv3pt5/19',  value:0.10 },
  { name:'Raticate',        set:'SV—151', number:'20/165',  img:'sv3pt5/20',  value:0.10 },
  { name:'Spearow',         set:'SV—151', number:'21/165',  img:'sv3pt5/21',  value:0.10 },
  { name:'Fearow',          set:'SV—151', number:'22/165',  img:'sv3pt5/22',  value:0.10 },
  { name:'Ekans',           set:'SV—151', number:'23/165',  img:'sv3pt5/23',  value:0.10 },
  { name:'Arbok',           set:'SV—151', number:'24/165',  img:'sv3pt5/24',  value:0.10 },
  { name:'Pikachu',         set:'SV—151', number:'25/165',  img:'sv3pt5/25',  value:0.50 },
  { name:'Sandshrew',       set:'SV—151', number:'27/165',  img:'sv3pt5/27',  value:0.10 },
  { name:'Sandslash',       set:'SV—151', number:'28/165',  img:'sv3pt5/28',  value:0.10 },
  { name:'Nidoran F',       set:'SV—151', number:'29/165',  img:'sv3pt5/29',  value:0.10 },
  { name:'Nidorina',        set:'SV—151', number:'30/165',  img:'sv3pt5/30',  value:0.10 },
  { name:'Nidoqueen',       set:'SV—151', number:'31/165',  img:'sv3pt5/31',  value:0.15 },
  { name:'Nidoran M',       set:'SV—151', number:'32/165',  img:'sv3pt5/32',  value:0.10 },
  { name:'Nidorino',        set:'SV—151', number:'33/165',  img:'sv3pt5/33',  value:0.10 },
  { name:'Nidoking',        set:'SV—151', number:'34/165',  img:'sv3pt5/34',  value:0.15 },
  { name:'Clefairy',        set:'SV—151', number:'35/165',  img:'sv3pt5/35',  value:0.15 },
  { name:'Clefable',        set:'SV—151', number:'36/165',  img:'sv3pt5/36',  value:0.10 },
  { name:'Vulpix',          set:'SV—151', number:'37/165',  img:'sv3pt5/37',  value:0.20 },
  { name:'Jigglypuff',      set:'SV—151', number:'39/165',  img:'sv3pt5/39',  value:0.15 },
  { name:'Wigglytuff',      set:'SV—151', number:'40/165',  img:'sv3pt5/40',  value:0.10 },
  { name:'Zubat',           set:'SV—151', number:'41/165',  img:'sv3pt5/41',  value:0.10 },
  { name:'Golbat',          set:'SV—151', number:'42/165',  img:'sv3pt5/42',  value:0.10 },
  { name:'Oddish',          set:'SV—151', number:'43/165',  img:'sv3pt5/43',  value:0.10 },
  { name:'Gloom',           set:'SV—151', number:'44/165',  img:'sv3pt5/44',  value:0.10 },
  { name:'Vileplume',       set:'SV—151', number:'45/165',  img:'sv3pt5/45',  value:0.10 },
  { name:'Paras',           set:'SV—151', number:'46/165',  img:'sv3pt5/46',  value:0.10 },
  { name:'Parasect',        set:'SV—151', number:'47/165',  img:'sv3pt5/47',  value:0.10 },
  { name:'Venonat',         set:'SV—151', number:'48/165',  img:'sv3pt5/48',  value:0.10 },
  { name:'Venomoth',        set:'SV—151', number:'49/165',  img:'sv3pt5/49',  value:0.10 },
  { name:'Diglett',         set:'SV—151', number:'50/165',  img:'sv3pt5/50',  value:0.10 },
  { name:'Dugtrio',         set:'SV—151', number:'51/165',  img:'sv3pt5/51',  value:0.10 },
  { name:'Meowth',          set:'SV—151', number:'52/165',  img:'sv3pt5/52',  value:0.10 },
  { name:'Persian',         set:'SV—151', number:'53/165',  img:'sv3pt5/53',  value:0.10 },
  { name:'Psyduck',         set:'SV—151', number:'54/165',  img:'sv3pt5/54',  value:0.15 },
  { name:'Golduck',         set:'SV—151', number:'55/165',  img:'sv3pt5/55',  value:0.10 },
  { name:'Mankey',          set:'SV—151', number:'56/165',  img:'sv3pt5/56',  value:0.10 },
  { name:'Primeape',        set:'SV—151', number:'57/165',  img:'sv3pt5/57',  value:0.10 },
  { name:'Growlithe',       set:'SV—151', number:'58/165',  img:'sv3pt5/58',  value:0.15 },
  { name:'Poliwag',         set:'SV—151', number:'60/165',  img:'sv3pt5/60',  value:0.10 },
  { name:'Poliwhirl',       set:'SV—151', number:'61/165',  img:'sv3pt5/61',  value:0.10 },
  { name:'Poliwrath',       set:'SV—151', number:'62/165',  img:'sv3pt5/62',  value:0.10 },
  { name:'Abra',            set:'SV—151', number:'63/165',  img:'sv3pt5/63',  value:0.15 },
  { name:'Kadabra',         set:'SV—151', number:'64/165',  img:'sv3pt5/64',  value:0.10 },
  { name:'Machop',          set:'SV—151', number:'66/165',  img:'sv3pt5/66',  value:0.10 },
  { name:'Machoke',         set:'SV—151', number:'67/165',  img:'sv3pt5/67',  value:0.10 },
  { name:'Bellsprout',      set:'SV—151', number:'69/165',  img:'sv3pt5/69',  value:0.10 },
  { name:'Weepinbell',      set:'SV—151', number:'70/165',  img:'sv3pt5/70',  value:0.10 },
  { name:'Victreebel',      set:'SV—151', number:'71/165',  img:'sv3pt5/71',  value:0.10 },
  { name:'Tentacool',       set:'SV—151', number:'72/165',  img:'sv3pt5/72',  value:0.10 },
  { name:'Tentacruel',      set:'SV—151', number:'73/165',  img:'sv3pt5/73',  value:0.10 },
  { name:'Geodude',         set:'SV—151', number:'74/165',  img:'sv3pt5/74',  value:0.10 },
  { name:'Graveler',        set:'SV—151', number:'75/165',  img:'sv3pt5/75',  value:0.10 },
  { name:'Ponyta',          set:'SV—151', number:'77/165',  img:'sv3pt5/77',  value:0.15 },
  { name:'Rapidash',        set:'SV—151', number:'78/165',  img:'sv3pt5/78',  value:0.15 },
  { name:'Slowpoke',        set:'SV—151', number:'79/165',  img:'sv3pt5/79',  value:0.15 },
  { name:'Slowbro',         set:'SV—151', number:'80/165',  img:'sv3pt5/80',  value:0.10 },
  { name:'Magnemite',       set:'SV—151', number:'81/165',  img:'sv3pt5/81',  value:0.10 },
  { name:'Magneton',        set:'SV—151', number:'82/165',  img:'sv3pt5/82',  value:0.10 },
  { name:"Farfetch'd",      set:'SV—151', number:'83/165',  img:'sv3pt5/83',  value:0.10 },
  { name:'Doduo',           set:'SV—151', number:'84/165',  img:'sv3pt5/84',  value:0.10 },
  { name:'Dodrio',          set:'SV—151', number:'85/165',  img:'sv3pt5/85',  value:0.10 },
  { name:'Seel',            set:'SV—151', number:'86/165',  img:'sv3pt5/86',  value:0.10 },
  { name:'Dewgong',         set:'SV—151', number:'87/165',  img:'sv3pt5/87',  value:0.10 },
  { name:'Grimer',          set:'SV—151', number:'88/165',  img:'sv3pt5/88',  value:0.10 },
  { name:'Muk',             set:'SV—151', number:'89/165',  img:'sv3pt5/89',  value:0.10 },
  { name:'Shellder',        set:'SV—151', number:'90/165',  img:'sv3pt5/90',  value:0.10 },
  { name:'Cloyster',        set:'SV—151', number:'91/165',  img:'sv3pt5/91',  value:0.10 },
  { name:'Gastly',          set:'SV—151', number:'92/165',  img:'sv3pt5/92',  value:0.10 },
  { name:'Haunter',         set:'SV—151', number:'93/165',  img:'sv3pt5/93',  value:0.15 },
  { name:'Onix',            set:'SV—151', number:'95/165',  img:'sv3pt5/95',  value:0.10 },
  { name:'Drowzee',         set:'SV—151', number:'96/165',  img:'sv3pt5/96',  value:0.10 },
  { name:'Hypno',           set:'SV—151', number:'97/165',  img:'sv3pt5/97',  value:0.10 },
  { name:'Krabby',          set:'SV—151', number:'98/165',  img:'sv3pt5/98',  value:0.10 },
  { name:'Kingler',         set:'SV—151', number:'99/165',  img:'sv3pt5/99',  value:0.10 },
  { name:'Voltorb',         set:'SV—151', number:'100/165', img:'sv3pt5/100', value:0.10 },
  { name:'Electrode',       set:'SV—151', number:'101/165', img:'sv3pt5/101', value:0.10 },
  { name:'Exeggcute',       set:'SV—151', number:'102/165', img:'sv3pt5/102', value:0.10 },
  { name:'Exeggutor',       set:'SV—151', number:'103/165', img:'sv3pt5/103', value:0.10 },
  { name:'Cubone',          set:'SV—151', number:'104/165', img:'sv3pt5/104', value:0.15 },
  { name:'Marowak',         set:'SV—151', number:'105/165', img:'sv3pt5/105', value:0.10 },
  { name:'Hitmonlee',       set:'SV—151', number:'106/165', img:'sv3pt5/106', value:0.10 },
  { name:'Hitmonchan',      set:'SV—151', number:'107/165', img:'sv3pt5/107', value:0.10 },
  { name:'Lickitung',       set:'SV—151', number:'108/165', img:'sv3pt5/108', value:0.10 },
  { name:'Koffing',         set:'SV—151', number:'109/165', img:'sv3pt5/109', value:0.10 },
  { name:'Weezing',         set:'SV—151', number:'110/165', img:'sv3pt5/110', value:0.10 },
  { name:'Rhyhorn',         set:'SV—151', number:'111/165', img:'sv3pt5/111', value:0.10 },
  { name:'Rhydon',          set:'SV—151', number:'112/165', img:'sv3pt5/112', value:0.10 },
  { name:'Chansey',         set:'SV—151', number:'113/165', img:'sv3pt5/113', value:0.20 },
  { name:'Tangela',         set:'SV—151', number:'114/165', img:'sv3pt5/114', value:0.10 },
  { name:'Horsea',          set:'SV—151', number:'116/165', img:'sv3pt5/116', value:0.10 },
  { name:'Seadra',          set:'SV—151', number:'117/165', img:'sv3pt5/117', value:0.10 },
  { name:'Goldeen',         set:'SV—151', number:'118/165', img:'sv3pt5/118', value:0.10 },
  { name:'Seaking',         set:'SV—151', number:'119/165', img:'sv3pt5/119', value:0.10 },
  { name:'Staryu',          set:'SV—151', number:'120/165', img:'sv3pt5/120', value:0.10 },
  { name:'Starmie',         set:'SV—151', number:'121/165', img:'sv3pt5/121', value:0.15 },
  { name:'Mr. Mime',        set:'SV—151', number:'122/165', img:'sv3pt5/122', value:0.15 },
  { name:'Scyther',         set:'SV—151', number:'123/165', img:'sv3pt5/123', value:0.20 },
  { name:'Electabuzz',      set:'SV—151', number:'125/165', img:'sv3pt5/125', value:0.15 },
  { name:'Magmar',          set:'SV—151', number:'126/165', img:'sv3pt5/126', value:0.10 },
  { name:'Tauros',          set:'SV—151', number:'128/165', img:'sv3pt5/128', value:0.10 },
  { name:'Magikarp',        set:'SV—151', number:'129/165', img:'sv3pt5/129', value:0.15 },
  { name:'Ditto',           set:'SV—151', number:'132/165', img:'sv3pt5/132', value:0.20 },
  { name:'Eevee',           set:'SV—151', number:'133/165', img:'sv3pt5/133', value:0.40 },
  { name:'Porygon',         set:'SV—151', number:'137/165', img:'sv3pt5/137', value:0.10 },
  { name:'Omanyte',         set:'SV—151', number:'138/165', img:'sv3pt5/138', value:0.10 },
  { name:'Omastar',         set:'SV—151', number:'139/165', img:'sv3pt5/139', value:0.10 },
  { name:'Kabuto',          set:'SV—151', number:'140/165', img:'sv3pt5/140', value:0.10 },
  { name:'Kabutops',        set:'SV—151', number:'141/165', img:'sv3pt5/141', value:0.15 },
  { name:'Aerodactyl',      set:'SV—151', number:'142/165', img:'sv3pt5/142', value:0.15 },
  { name:'Dratini',         set:'SV—151', number:'147/165', img:'sv3pt5/147', value:0.15 },
  { name:'Dragonair',       set:'SV—151', number:'148/165', img:'sv3pt5/148', value:0.20 },
],

common_holo: [
  { name:'Venusaur ex',     set:'SV—151', number:'3/165',   img:'sv3pt5/3',   value:2.50 },
  { name:'Charizard ex',    set:'SV—151', number:'6/165',   img:'sv3pt5/6',   value:2.90 },
  { name:'Blastoise ex',    set:'SV—151', number:'9/165',   img:'sv3pt5/9',   value:2.80 },
  { name:'Raichu',          set:'SV—151', number:'26/165',  img:'sv3pt5/26',  value:1.00 },
  { name:'Ninetales',       set:'SV—151', number:'38/165',  img:'sv3pt5/38',  value:1.50 },
  { name:'Arcanine',        set:'SV—151', number:'59/165',  img:'sv3pt5/59',  value:1.20 },
  { name:'Alakazam ex',     set:'SV—151', number:'65/165',  img:'sv3pt5/65',  value:1.80 },
  { name:'Machamp',         set:'SV—151', number:'68/165',  img:'sv3pt5/68',  value:1.00 },
  { name:'Golem ex',        set:'SV—151', number:'76/165',  img:'sv3pt5/76',  value:1.50 },
  { name:'Gengar',          set:'SV—151', number:'94/165',  img:'sv3pt5/94',  value:1.80 },
  { name:'Gyarados',        set:'SV—151', number:'130/165', img:'sv3pt5/130', value:1.50 },
  { name:'Lapras',          set:'SV—151', number:'131/165', img:'sv3pt5/131', value:1.00 },
  { name:'Vaporeon',        set:'SV—151', number:'134/165', img:'sv3pt5/134', value:1.20 },
  { name:'Jolteon',         set:'SV—151', number:'135/165', img:'sv3pt5/135', value:1.20 },
  { name:'Flareon',         set:'SV—151', number:'136/165', img:'sv3pt5/136', value:1.20 },
  { name:'Snorlax',         set:'SV—151', number:'143/165', img:'sv3pt5/143', value:1.30 },
  { name:'Dragonite',       set:'SV—151', number:'149/165', img:'sv3pt5/149', value:1.50 },
  { name:'Mewtwo ex',       set:'SV—151', number:'150/165', img:'sv3pt5/150', value:2.50 },
  { name:'Kangaskhan ex',   set:'SV—151', number:'115/165', img:'sv3pt5/115', value:2.00 },
  { name:'Jynx ex',         set:'SV—151', number:'124/165', img:'sv3pt5/124', value:1.50 },
  { name:'Pinsir ex',       set:'SV—151', number:'127/165', img:'sv3pt5/127', value:1.80 },
],

rare: [
  { name:'Mew ex',          set:'SV—151', number:'151/165', img:'sv3pt5/151', value:4.50 },
  { name:'Zapdos ex',       set:'SV—151', number:'145/165', img:'sv3pt5/145', value:3.50 },
  { name:'Articuno ex',     set:'SV—151', number:'144/165', img:'sv3pt5/144', value:3.50 },
  { name:'Moltres ex',      set:'SV—151', number:'146/165', img:'sv3pt5/146', value:3.80 },
  { name:'Alakazam ex FA',  set:'SV—151', number:'164/165', img:'sv3pt5/164', value:5.00 },
  { name:'Golem ex FA',     set:'SV—151', number:'171/165', img:'sv3pt5/171', value:4.50 },
  { name:'Kangaskhan ex FA',set:'SV—151', number:'172/165', img:'sv3pt5/172', value:4.00 },
  { name:'Bills Transfer',  set:'SV—151', number:'194/165', img:'sv3pt5/194', value:3.50 },
],

ultra: [
  { name:'Venusaur ex FA',      set:'SV—151', number:'166/165', img:'sv3pt5/166', value:9.50 },
  { name:'Ninetales ex FA',     set:'SV—151', number:'169/165', img:'sv3pt5/169', value:8.50 },
  { name:'Blastoise ex FA',     set:'SV—151', number:'186/165', img:'sv3pt5/186', value:11.00 },
  { name:'Mew ex FA',           set:'SV—151', number:'205/165', img:'sv3pt5/205', value:12.00 },
  { name:'Zapdos ex FA',        set:'SV—151', number:'176/165', img:'sv3pt5/176', value:9.00 },
  { name:'Mewtwo ex FA',        set:'SV—151', number:'178/165', img:'sv3pt5/178', value:13.00 },
  { name:'Erikas Invitation',   set:'SV—151', number:'196/165', img:'sv3pt5/196', value:10.00 },
  { name:'Charizard ex FA',     set:'SV—151', number:'183/165', img:'sv3pt5/183', value:14.00 },
],

special: [
  { name:'Charizard ex SAR',    set:'SV—151', number:'199/165', img:'sv3pt5/199', value:28.00 },
  { name:'Blastoise ex SAR',    set:'SV—151', number:'200/165', img:'sv3pt5/200', value:25.00 },
  { name:'Venusaur ex SAR',     set:'SV—151', number:'198/165', img:'sv3pt5/198', value:22.00 },
  { name:"Erika's Invitation SAR",set:'SV—151',number:'203/165',img:'sv3pt5/203',value:18.00 },
  { name:'Charmander IR',       set:'SV—151', number:'168/165', img:'sv3pt5/168', value:20.00 },
  { name:'Bulbasaur IR',        set:'SV—151', number:'167/165', img:'sv3pt5/167', value:16.00 },
  { name:'Squirtle IR',         set:'SV—151', number:'170/165', img:'sv3pt5/170', value:16.00 },
  { name:'Poliwag IR',          set:'SV—151', number:'174/165', img:'sv3pt5/174', value:15.00 },
  { name:'Pikachu IR',          set:'SV—151', number:'173/165', img:'sv3pt5/173', value:25.00 },
],

grail: [
  { name:'Dragonair IR',        set:'SV—151', number:'181/165', img:'sv3pt5/181', value:50.00 },
  { name:'Mew ex SAR',          set:'SV—151', number:'205/165', img:'sv3pt5/205', value:55.00 },
  { name:'Mewtwo ex SAR',       set:'SV—151', number:'207/165', img:'sv3pt5/207', value:60.00 },
  { name:'Snorlax IR',          set:'SV—151', number:'190/165', img:'sv3pt5/190', value:52.00 },
  { name:'Alakazam ex SAR',     set:'SV—151', number:'201/165', img:'sv3pt5/201', value:50.00 },
],

};

// ===========================================================================
//  POOL B — GENERAL (300+ cards from all sets)
//  Used by Starter / Basic / Signature Packs
// ===========================================================================
const CARD_POOLS = {

bulk: [
  { name:'Sprigatito',      set:'Scarlet & Violet',    number:'13/198',  img:'sv1/13',   value:0.15 },
  { name:'Fuecoco',         set:'Scarlet & Violet',    number:'32/198',  img:'sv1/32',   value:0.15 },
  { name:'Quaxly',          set:'Scarlet & Violet',    number:'54/198',  img:'sv1/54',   value:0.15 },
  { name:'Fidough',         set:'Scarlet & Violet',    number:'175/198', img:'sv1/175',  value:0.10 },
  { name:'Pawmi',           set:'Scarlet & Violet',    number:'74/198',  img:'sv1/74',   value:0.15 },
  { name:'Lechonk',         set:'Scarlet & Violet',    number:'155/198', img:'sv1/155',  value:0.10 },
  { name:'Tandemaus',       set:'Scarlet & Violet',    number:'160/198', img:'sv1/160',  value:0.10 },
  { name:'Smoliv',          set:'Scarlet & Violet',    number:'21/198',  img:'sv1/21',   value:0.10 },
  { name:'Iron Treads',     set:'Scarlet & Violet',    number:'128/198', img:'sv1/128',  value:0.15 },
  { name:'Nacli',           set:'Scarlet & Violet',    number:'120/198', img:'sv1/120',  value:0.10 },
  { name:'Ralts',           set:'Paldea Evolved',      number:'77/193',  img:'sv2/77',   value:0.20 },
  { name:'Tinkatink',       set:'Paldea Evolved',      number:'101/193', img:'sv2/101',  value:0.10 },
  { name:'Wiglett',         set:'Paldea Evolved',      number:'56/193',  img:'sv2/56',   value:0.10 },
  { name:'Greavard',        set:'Paldea Evolved',      number:'114/193', img:'sv2/114',  value:0.10 },
  { name:'Frigibax',        set:'Paldea Evolved',      number:'58/193',  img:'sv2/58',   value:0.10 },
  { name:'Charcadet',       set:'Obsidian Flames',     number:'27/197',  img:'sv3/27',   value:0.15 },
  { name:'Toedscool',       set:'Obsidian Flames',     number:'12/197',  img:'sv3/12',   value:0.10 },
  { name:'Flittle',         set:'Obsidian Flames',     number:'77/197',  img:'sv3/77',   value:0.10 },
  { name:'Capsakid',        set:'Obsidian Flames',     number:'16/197',  img:'sv3/16',   value:0.10 },
  { name:'Litwick',         set:'Obsidian Flames',     number:'33/197',  img:'sv3/33',   value:0.10 },
  { name:'Deino',           set:'Obsidian Flames',     number:'92/197',  img:'sv3/92',   value:0.10 },
  { name:'Riolu',           set:'Paradox Rift',        number:'113/182', img:'sv4/113',  value:0.20 },
  { name:'Larvitar',        set:'Paradox Rift',        number:'107/182', img:'sv4/107',  value:0.15 },
  { name:'Cleffa',          set:'Paldean Fates',       number:'30/091',  img:'sv4pt5/30',value:0.15 },
  { name:'Pichu',           set:'Paldean Fates',       number:'26/091',  img:'sv4pt5/26',value:0.25 },
  { name:'Mimikyu',         set:'Paldean Fates',       number:'39/091',  img:'sv4pt5/39',value:0.30 },
  { name:'Shinx',           set:'Temporal Forces',     number:'49/162',  img:'sv5/49',   value:0.15 },
  { name:'Hatenna',         set:'Temporal Forces',     number:'74/162',  img:'sv5/74',   value:0.10 },
  { name:'Dreepy',          set:'Temporal Forces',     number:'88/162',  img:'sv5/88',   value:0.15 },
  { name:'Teddiursa',       set:'Temporal Forces',     number:'123/162', img:'sv5/123',  value:0.10 },
  { name:'Magby',           set:'Temporal Forces',     number:'19/162',  img:'sv5/19',   value:0.10 },
  { name:'Applin',          set:'Twilight Masquerade',  number:'17/167',  img:'sv6/17',   value:0.10 },
  { name:'Rockruff',        set:'Twilight Masquerade',  number:'88/167',  img:'sv6/88',   value:0.10 },
  { name:'Popplio',         set:'Stellar Crown',       number:'35/142',  img:'sv7/35',   value:0.15 },
  { name:'Bulbasaur',       set:'SV—151',              number:'1/165',   img:'sv3pt5/1', value:0.25 },
  { name:'Charmander',      set:'SV—151',              number:'4/165',   img:'sv3pt5/4', value:0.35 },
  { name:'Squirtle',        set:'SV—151',              number:'7/165',   img:'sv3pt5/7', value:0.25 },
  { name:'Pikachu',         set:'SV—151',              number:'25/165',  img:'sv3pt5/25',value:0.50 },
  { name:'Eevee',           set:'SV—151',              number:'133/165', img:'sv3pt5/133',value:0.40 },
  { name:'Vulpix',          set:'SV—151',              number:'37/165',  img:'sv3pt5/37',value:0.20 },
  { name:'Gastly',          set:'SV—151',              number:'92/165',  img:'sv3pt5/92',value:0.10 },
  { name:'Magikarp',        set:'SV—151',              number:'129/165', img:'sv3pt5/129',value:0.15 },
  { name:'Ditto',           set:'SV—151',              number:'132/165', img:'sv3pt5/132',value:0.20 },
  { name:'Jigglypuff',      set:'SV—151',              number:'39/165',  img:'sv3pt5/39',value:0.15 },
  { name:'Psyduck',         set:'SV—151',              number:'54/165',  img:'sv3pt5/54',value:0.15 },
  { name:'Growlithe',       set:'SV—151',              number:'58/165',  img:'sv3pt5/58',value:0.15 },
],

common_holo: [
  { name:'Gardevoir ex',    set:'Paldea Evolved',      number:'86/193',  img:'sv2/86',   value:2.00 },
  { name:'Meowscarada ex',  set:'Scarlet & Violet',    number:'15/198',  img:'sv1/15',   value:1.50 },
  { name:'Skeledirge ex',   set:'Scarlet & Violet',    number:'37/198',  img:'sv1/37',   value:1.20 },
  { name:'Quaquaval ex',    set:'Scarlet & Violet',    number:'58/198',  img:'sv1/58',   value:1.00 },
  { name:'Pawmot ex',       set:'Scarlet & Violet',    number:'78/198',  img:'sv1/78',   value:1.00 },
  { name:'Lucario ex',      set:'Scarlet & Violet',    number:'135/198', img:'sv1/135',  value:1.80 },
  { name:'Armarouge ex',    set:'Scarlet & Violet',    number:'41/198',  img:'sv1/41',   value:1.50 },
  { name:'Ceruledge ex',    set:'Paldea Evolved',      number:'28/193',  img:'sv2/28',   value:1.50 },
  { name:'Dedenne ex',      set:'Paldea Evolved',      number:'75/193',  img:'sv2/75',   value:1.00 },
  { name:'Tinkaton ex',     set:'Paldea Evolved',      number:'103/193', img:'sv2/103',  value:1.30 },
  { name:'Tyranitar ex',    set:'Obsidian Flames',     number:'134/197', img:'sv3/134',  value:2.00 },
  { name:'Pidgeot ex',      set:'Obsidian Flames',     number:'164/197', img:'sv3/164',  value:2.80 },
  { name:'Iron Valiant ex', set:'Paradox Rift',        number:'89/182',  img:'sv4/89',   value:1.50 },
  { name:'Roaring Moon ex', set:'Paradox Rift',        number:'109/182', img:'sv4/109',  value:2.00 },
  { name:'Iron Hands ex',   set:'Paradox Rift',        number:'70/182',  img:'sv4/70',   value:1.50 },
  { name:'Garchomp ex',     set:'Paradox Rift',        number:'116/182', img:'sv4/116',  value:1.80 },
  { name:'Mimikyu ex',      set:'Paldean Fates',       number:'40/091',  img:'sv4pt5/40',value:2.00 },
  { name:'Charizard ex',    set:'Paldean Fates',       number:'54/091',  img:'sv4pt5/54',value:2.50 },
  { name:'Pikachu ex',      set:'Paldean Fates',       number:'28/091',  img:'sv4pt5/28',value:2.80 },
  { name:'Walking Wake ex', set:'Temporal Forces',     number:'24/162',  img:'sv5/24',   value:1.50 },
  { name:'Greninja ex',     set:'Twilight Masquerade',  number:'55/167',  img:'sv6/55',   value:1.80 },
  { name:'Dragapult ex',    set:'Twilight Masquerade',  number:'91/167',  img:'sv6/91',   value:2.50 },
  { name:'Bloodmoon Ursaluna ex',set:'Twilight Masquerade',number:'141/167',img:'sv6/141',value:1.50 },
  { name:'Terapagos ex',    set:'Stellar Crown',       number:'128/142', img:'sv7/128',  value:2.50 },
  { name:'Archaludon ex',   set:'Stellar Crown',       number:'104/142', img:'sv7/104',  value:1.20 },
  { name:'Hydrapple ex',    set:'Stellar Crown',       number:'16/142',  img:'sv7/16',   value:1.00 },
  { name:'Charizard V',     set:'Brilliant Stars',     number:'17/172',  img:'swsh9/17',  value:2.80 },
  { name:'Mew V',           set:'Lost Origin',         number:'60/196',  img:'swsh11/60', value:1.50 },
  { name:'Giratina V',      set:'Lost Origin',         number:'130/196', img:'swsh11/130',value:2.00 },
  { name:'Palkia V',        set:'Astral Radiance',     number:'26/189',  img:'swsh10/26', value:1.50 },
  { name:'Dialga V',        set:'Astral Radiance',     number:'113/189', img:'swsh10/113',value:1.80 },
  { name:'Lugia V',         set:'Silver Tempest',      number:'138/195', img:'swsh12/138',value:2.50 },
  { name:'Rayquaza V',      set:'Evolving Skies',      number:'110/203', img:'swsh7/110', value:2.50 },
  { name:'Umbreon V',       set:'Evolving Skies',      number:'94/203',  img:'swsh7/94',  value:2.50 },
  { name:'Sylveon V',       set:'Evolving Skies',      number:'74/203',  img:'swsh7/74',  value:1.80 },
  { name:'Espeon V',        set:'Evolving Skies',      number:'64/203',  img:'swsh7/64',  value:1.80 },
  { name:'Glaceon V',       set:'Evolving Skies',      number:'40/203',  img:'swsh7/40',  value:1.50 },
  { name:'Leafeon V',       set:'Evolving Skies',      number:'7/203',   img:'swsh7/7',   value:1.50 },
  { name:'Dragonite V',     set:'Evolving Skies',      number:'192/203', img:'swsh7/192', value:2.00 },
  { name:'Pikachu V',       set:'Crown Zenith',        number:'46/159',  img:'swsh12pt5/46',value:1.80 },
  { name:'Mewtwo V',        set:'Pokemon GO',          number:'30/078',  img:'pgo/30',    value:1.50 },
  { name:'Charizard',       set:'Pokemon GO',          number:'10/078',  img:'pgo/10',    value:1.80 },
  { name:'Pikachu',         set:'Crown Zenith',        number:'28/159',  img:'swsh12pt5/28',value:1.00 },
  { name:'Gengar',          set:'Paldean Fates',       number:'36/091',  img:'sv4pt5/36', value:1.00 },
  { name:'Eevee',           set:'Paldean Fates',       number:'69/091',  img:'sv4pt5/69', value:1.00 },
  { name:'Sylveon',         set:'Paldean Fates',       number:'38/091',  img:'sv4pt5/38', value:1.20 },
  { name:'Snorlax',         set:'Pokemon GO',          number:'55/078',  img:'pgo/55',    value:1.00 },
  { name:'Iron Thorns ex',  set:'Temporal Forces',     number:'62/162',  img:'sv5/62',    value:1.00 },
  { name:'Vespiquen ex',    set:'Obsidian Flames',     number:'10/197',  img:'sv3/10',    value:1.00 },
  { name:'Magneton ex',     set:'Scarlet & Violet',    number:'88/198',  img:'sv1/88',    value:1.00 },
],

rare: [
  // Charizard variants
  { name:'Charizard ex',    set:'Obsidian Flames',     number:'125/197', img:'sv3/125',   value:4.80 },
  { name:'Charizard VMAX',  set:'Brilliant Stars',     number:'18/172',  img:'swsh9/18',  value:6.50 },
  { name:'Charizard VSTAR', set:'Brilliant Stars',     number:'19/172',  img:'swsh9/19',  value:5.00 },
  { name:'Charizard V',     set:'Pokemon GO',          number:'14/078',  img:'pgo/14',    value:4.50 },
  // Pikachu
  { name:'Pikachu VMAX',    set:'Crown Zenith',        number:'47/159',  img:'swsh12pt5/47',value:5.00 },
  { name:'Flying Pikachu V',set:'Celebrations',        number:'6/25',    img:'cel25/6',   value:3.50 },
  { name:'Surfing Pikachu V',set:'Celebrations',       number:'8/25',    img:'cel25/8',   value:3.50 },
  // Popular meta
  { name:'Chien-Pao ex',    set:'Paldea Evolved',      number:'61/193',  img:'sv2/61',    value:5.50 },
  { name:'Koraidon ex',     set:'Scarlet & Violet',    number:'125/198', img:'sv1/125',   value:6.00 },
  { name:'Miraidon ex',     set:'Scarlet & Violet',    number:'81/198',  img:'sv1/81',    value:5.50 },
  { name:'Gardevoir ex',    set:'Paldean Fates',       number:'37/091',  img:'sv4pt5/37', value:4.00 },
  { name:'Giratina VSTAR',  set:'Lost Origin',         number:'131/196', img:'swsh11/131',value:6.50 },
  { name:'Palkia VSTAR',    set:'Astral Radiance',     number:'27/189',  img:'swsh10/27', value:5.00 },
  { name:'Lugia VSTAR',     set:'Silver Tempest',      number:'139/195', img:'swsh12/139',value:6.00 },
  { name:'Mewtwo VSTAR',    set:'Pokemon GO',          number:'31/078',  img:'pgo/31',    value:5.00 },
  // Eeveelutions VMAX
  { name:'Rayquaza VMAX',   set:'Evolving Skies',      number:'111/203', img:'swsh7/111', value:6.50 },
  { name:'Umbreon VMAX',    set:'Evolving Skies',      number:'95/203',  img:'swsh7/95',  value:6.00 },
  { name:'Sylveon VMAX',    set:'Evolving Skies',      number:'75/203',  img:'swsh7/75',  value:4.50 },
  { name:'Glaceon VMAX',    set:'Evolving Skies',      number:'41/203',  img:'swsh7/41',  value:4.00 },
  { name:'Leafeon VMAX',    set:'Evolving Skies',      number:'8/203',   img:'swsh7/8',   value:4.00 },
  { name:'Espeon VMAX',     set:'Evolving Skies',      number:'65/203',  img:'swsh7/65',  value:4.50 },
  { name:'Flareon VMAX',    set:'Evolving Skies',      number:'18/203',  img:'swsh7/18',  value:4.50 },
  { name:'Jolteon VMAX',    set:'Evolving Skies',      number:'51/203',  img:'swsh7/51',  value:4.00 },
  { name:'Vaporeon V',      set:'Evolving Skies',      number:'30/203',  img:'swsh7/30',  value:3.50 },
  { name:'Flareon V',       set:'Evolving Skies',      number:'17/203',  img:'swsh7/17',  value:3.50 },
  { name:'Jolteon V',       set:'Evolving Skies',      number:'50/203',  img:'swsh7/50',  value:3.50 },
  // Waifu trainers
  { name:'Iono',            set:'Paldea Evolved',      number:'185/193', img:'sv2/185',   value:3.50 },
  { name:'Nemona',          set:'Scarlet & Violet',    number:'181/198', img:'sv1/181',   value:3.00 },
  { name:'Penny',           set:'Scarlet & Violet',    number:'183/198', img:'sv1/183',   value:3.50 },
  { name:'Miriam',          set:'Scarlet & Violet',    number:'179/198', img:'sv1/179',   value:3.00 },
  { name:'Perrin',          set:'Temporal Forces',     number:'152/162', img:'sv5/152',   value:3.50 },
  { name:'Lacey',           set:'Twilight Masquerade',  number:'157/167', img:'sv6/157',   value:4.50 },
  { name:'Carmine',         set:'Twilight Masquerade',  number:'155/167', img:'sv6/155',   value:3.50 },
  // Recent sets
  { name:'Dragapult ex',    set:'Shrouded Fable',      number:'38/064',  img:'sv6pt5/38', value:4.00 },
  { name:'Darkrai ex',      set:'Shrouded Fable',      number:'22/064',  img:'sv6pt5/22', value:3.50 },
  { name:'Pecharunt ex',    set:'Shrouded Fable',      number:'45/064',  img:'sv6pt5/45', value:3.00 },
  { name:'Terapagos ex',    set:'Prismatic Evolutions', number:'43/091', img:'sv8a/43',   value:5.00 },
  { name:'Sylveon ex',      set:'Prismatic Evolutions', number:'30/091', img:'sv8a/30',   value:5.50 },
  { name:'Umbreon ex',      set:'Prismatic Evolutions', number:'28/091', img:'sv8a/28',   value:6.50 },
  { name:'Espeon ex',       set:'Prismatic Evolutions', number:'25/091', img:'sv8a/25',   value:5.00 },
  { name:'Glaceon ex',      set:'Prismatic Evolutions', number:'23/091', img:'sv8a/23',   value:4.50 },
  // Celebrations
  { name:'Blastoise',       set:'Celebrations',        number:'2/25',    img:'cel25/2',   value:4.00 },
  { name:'Venusaur',        set:'Celebrations',        number:'15/25',   img:'cel25/15',  value:3.50 },
  { name:'Dark Gyarados',   set:'Celebrations',        number:'4/25',    img:'cel25/4',   value:3.50 },
  { name:'Mew ex',          set:'Celebrations',        number:'11/25',   img:'cel25/11',  value:5.00 },
  { name:'Roaring Moon ex FA',set:'Paradox Rift',      number:'204/182', img:'sv4/204',   value:4.00 },
],

ultra: [
  // Charizard chase
  { name:'Charizard ex FA',     set:'Obsidian Flames',     number:'183/197', img:'sv3/183',  value:14.00 },
  { name:'Charizard VSTAR Rainbow',set:'Brilliant Stars',  number:'174/172', img:'swsh9/174',value:12.00 },
  { name:'Charizard GX Promo',  set:'SM Promos',          number:'SM211',   img:'smp/SM211', value:8.00 },
  // Waifu Full Arts
  { name:'Iono FA',             set:'Paldea Evolved',      number:'254/193', img:'sv2/254',  value:13.00 },
  { name:'Nemona FA',           set:'Scarlet & Violet',    number:'229/198', img:'sv1/229',  value:8.00 },
  { name:'Penny FA',            set:'Scarlet & Violet',    number:'230/198', img:'sv1/230',  value:10.00 },
  { name:'Miriam FA',           set:'Scarlet & Violet',    number:'228/198', img:'sv1/228',  value:8.00 },
  { name:'Lacey FA',            set:'Twilight Masquerade',  number:'193/167', img:'sv6/193',  value:12.00 },
  { name:'Carmine FA',          set:'Twilight Masquerade',  number:'191/167', img:'sv6/191',  value:9.00 },
  { name:'Perrin FA',           set:'Temporal Forces',     number:'189/162', img:'sv5/189',  value:8.50 },
  { name:'Cynthias Ambition FA',set:'Brilliant Stars',     number:'169/172', img:'swsh9/169',value:10.00 },
  { name:'Marnie Premium',      set:'Crown Zenith',        number:'145/159', img:'swsh12pt5/145',value:9.00 },
  { name:'Irida FA',            set:'Astral Radiance',     number:'186/189', img:'swsh10/186',value:12.00 },
  { name:'Nessa FA',            set:'Crown Zenith',        number:'148/159', img:'swsh12pt5/148',value:9.50 },
  { name:'Acerola FA',          set:'Crown Zenith',        number:'129/159', img:'swsh12pt5/129',value:8.50 },
  { name:'Serena FA',           set:'Silver Tempest',      number:'193/195', img:'swsh12/193',value:10.00 },
  // Other FA
  { name:'Miraidon ex FA',      set:'Scarlet & Violet',    number:'227/198', img:'sv1/227',  value:10.50 },
  { name:'Koraidon ex FA',      set:'Scarlet & Violet',    number:'231/198', img:'sv1/231',  value:12.00 },
  { name:'Gardevoir ex FA',     set:'Paldea Evolved',      number:'245/193', img:'sv2/245',  value:9.00 },
  { name:'Dragapult ex FA',     set:'Twilight Masquerade',  number:'184/167', img:'sv6/184',  value:9.50 },
  { name:'Terapagos ex FA',     set:'Stellar Crown',       number:'153/142', img:'sv7/153',  value:10.00 },
  { name:'Giratina VSTAR Gold', set:'Lost Origin',         number:'195/196', img:'swsh11/195',value:14.00 },
  { name:'Palkia VSTAR Gold',   set:'Astral Radiance',     number:'189/189', img:'swsh10/189',value:11.00 },
  { name:'Rayquaza VMAX FA',    set:'Evolving Skies',      number:'218/203', img:'swsh7/218', value:12.00 },
  { name:'Pikachu VMAX Rainbow',set:'Crown Zenith',        number:'116/159', img:'swsh12pt5/116',value:9.00 },
  // Eeveelution V FA
  { name:'Umbreon V FA',        set:'Evolving Skies',      number:'189/203', img:'swsh7/189', value:10.00 },
  { name:'Sylveon V FA',        set:'Evolving Skies',      number:'184/203', img:'swsh7/184', value:8.50 },
  { name:'Espeon V FA',         set:'Evolving Skies',      number:'180/203', img:'swsh7/180', value:8.00 },
  { name:'Glaceon V FA',        set:'Evolving Skies',      number:'175/203', img:'swsh7/175', value:7.50 },
  { name:'Leafeon V FA',        set:'Evolving Skies',      number:'167/203', img:'swsh7/167', value:7.50 },
  { name:'Flareon V FA',        set:'Evolving Skies',      number:'169/203', img:'swsh7/169', value:7.50 },
  { name:'Vaporeon V FA',       set:'Evolving Skies',      number:'172/203', img:'swsh7/172', value:7.50 },
  { name:'Jolteon V FA',        set:'Evolving Skies',      number:'177/203', img:'swsh7/177', value:7.50 },
],

special: [
  // Waifu SARs
  { name:'Iono SAR',            set:'Paldea Evolved',      number:'269/193', img:'sv2/269',  value:30.00 },
  { name:'Lacey SAR',           set:'Twilight Masquerade',  number:'201/167', img:'sv6/201',  value:35.00 },
  { name:'Irida SAR',           set:'Crown Zenith GG',     number:'GG60/GG70',img:'swsh12pt5gg/GG60',value:28.00 },
  { name:'Serena SAR',          set:'Crown Zenith GG',     number:'GG57/GG70',img:'swsh12pt5gg/GG57',value:25.00 },
  { name:'Nessa SAR',           set:'Crown Zenith GG',     number:'GG58/GG70',img:'swsh12pt5gg/GG58',value:22.00 },
  { name:'Cynthia SAR',         set:'Crown Zenith GG',     number:'GG64/GG70',img:'swsh12pt5gg/GG64',value:30.00 },
  { name:'Acerola SAR',         set:'Crown Zenith GG',     number:'GG55/GG70',img:'swsh12pt5gg/GG55',value:20.00 },
  { name:'Penny SAR',           set:'Scarlet & Violet',    number:'239/198', img:'sv1/239',  value:22.00 },
  { name:'Nemona SAR',          set:'Scarlet & Violet',    number:'238/198', img:'sv1/238',  value:18.00 },
  { name:'Perrin SAR',          set:'Temporal Forces',     number:'196/162', img:'sv5/196',  value:20.00 },
  // Charizard / Pikachu chase
  { name:'Charizard ex SAR',    set:'Paldean Fates',       number:'234/091', img:'sv4pt5/234',value:30.00 },
  { name:'Pikachu ex SAR',      set:'Paldean Fates',       number:'228/091', img:'sv4pt5/228',value:35.00 },
  { name:'Pikachu Celebrations',set:'Celebrations',        number:'25/25',   img:'cel25/25',  value:16.00 },
  // Eeveelution SARs
  { name:'Umbreon ex SAR',      set:'Prismatic Evolutions', number:'130/091',img:'sv8a/130',  value:45.00 },
  { name:'Sylveon ex SAR',      set:'Prismatic Evolutions', number:'131/091',img:'sv8a/131',  value:40.00 },
  { name:'Espeon ex SAR',       set:'Prismatic Evolutions', number:'128/091',img:'sv8a/128',  value:35.00 },
  // Others
  { name:'Rayquaza VMAX AA',    set:'Evolving Skies',      number:'217/203', img:'swsh7/217', value:45.00 },
  { name:'Giratina VSTAR SAR',  set:'Crown Zenith GG',     number:'GG69/GG70',img:'swsh12pt5gg/GG69',value:30.00 },
  { name:'Charizard Classic',   set:'Celebrations',        number:'4/25',    img:'cel25/4',   value:25.00 },
  { name:'Umbreon Gold Star',   set:'Celebrations',        number:'24/25',   img:'cel25/24',  value:18.00 },
],

grail: [
  // Charizard grails
  { name:'Charizard ex SAR',    set:'Obsidian Flames',     number:'223/197', img:'sv3/223',   value:72.00 },
  { name:'Charizard ex Gold',   set:'Obsidian Flames',     number:'228/197', img:'sv3/228',   value:85.00 },
  { name:'Shiny Charizard ex',  set:'Paldean Fates',       number:'261/091', img:'sv4pt5/261',value:65.00 },
  // Van Gogh Pikachu
  { name:'Pikachu with Grey Felt Hat',set:'SV Promos',     number:'SVP 085', img:'svp/85',    value:300.00 },
  // Umbreon VMAX AA
  { name:'Umbreon VMAX AA',     set:'Evolving Skies',      number:'215/203', img:'swsh7/215', value:180.00 },
  // Mew grails
  { name:'Mew ex SAR',          set:'Paldean Fates',       number:'232/091', img:'sv4pt5/232',value:150.00 },
  { name:'Mewtwo VSTAR SAR',    set:'Crown Zenith GG',     number:'GG44/GG70',img:'swsh12pt5gg/GG44',value:55.00 },
  // Eeveelution AA grails
  { name:'Espeon VMAX AA',      set:'Evolving Skies',      number:'203/203', img:'swsh7/203', value:65.00 },
  { name:'Sylveon VMAX AA',     set:'Evolving Skies',      number:'211/203', img:'swsh7/211', value:70.00 },
  { name:'Glaceon VMAX AA',     set:'Evolving Skies',      number:'209/203', img:'swsh7/209', value:60.00 },
  { name:'Leafeon VMAX AA',     set:'Evolving Skies',      number:'205/203', img:'swsh7/205', value:55.00 },
  { name:'Flareon VMAX AA',     set:'Evolving Skies',      number:'207/203', img:'swsh7/207', value:50.00 },
  { name:'Jolteon VMAX AA',     set:'Evolving Skies',      number:'213/203', img:'swsh7/213', value:52.00 },
  // Waifu grails
  { name:'Iono SAR (Grail)',    set:'Paldea Evolved',      number:'269/193', img:'sv2/269',   value:85.00 },
  { name:'Lillie FA',           set:'Ultra Prism',         number:'151/156', img:'sm5/151',   value:120.00 },
  { name:'Marnie FA Premium',   set:'Shining Fates SV',    number:'SV108/122',img:'swsh45sv/SV108',value:70.00 },
  // Rayquaza AA
  { name:'Rayquaza VMAX AA',    set:'Evolving Skies',      number:'218/203', img:'swsh7/218', value:90.00 },
  // Prismatic Evolutions
  { name:'Umbreon ex SAR PE',   set:'Prismatic Evolutions', number:'186/091',img:'sv8a/186',  value:200.00 },
  { name:'Pikachu ex SAR PE',   set:'Prismatic Evolutions', number:'187/091',img:'sv8a/187',  value:120.00 },
],

};


// ===========================================================================
const RARITY_MAP = { Common:'bulk', Uncommon:'common_holo', Rare:'rare', Epic:'ultra', Legendary:'special', Grail:'grail' };

const PACK_TYPES = {
  'sv151':     { name:'SV-151 Pack',     cost:1,  odds:{ Common:0.89, Uncommon:0.085, Rare:0.018, Epic:0.005, Legendary:0.0015, Grail:0.0005 }, exclusive:true },
  'starter':   { name:'Starter Pack',    cost:1,  odds:{ Common:0.55, Uncommon:0.30, Rare:0.11, Epic:0.028, Legendary:0.009, Grail:0.003 } },
  'basic':     { name:'Basic Pack',      cost:5,  odds:{ Common:0.176, Uncommon:0.324, Rare:0.237, Epic:0.139, Legendary:0.103, Grail:0.021 } },
  'signature': { name:'Signature Pack',  cost:10, odds:{ Common:0.341, Uncommon:0.159, Rare:0.427, Epic:0.061, Legendary:0.01, Grail:0.001 } },
};

// ===========================================================================
// Card Selection — power-law bias toward cheaper cards
// ===========================================================================
function pickCardFromPool(pool) {
  if (!pool || pool.length === 0) return null;
  const sorted = [...pool].sort((a, b) => a.value - b.value);
  const n = sorted.length;
  const weights = sorted.map((_, i) => Math.pow(n - i, 2));
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < n; i++) { r -= weights[i]; if (r <= 0) return { ...sorted[i] }; }
  return { ...sorted[0] };
}

function rollRarity(pt) {
  const odds = PACK_TYPES[pt].odds;
  const r = Math.random(); let c = 0;
  for (const [rarity, prob] of Object.entries(odds)) { c += prob; if (r <= c) return rarity; }
  return 'Common';
}

function getPoolsForPack(packType) {
  // SV-151 pack uses exclusive SV-151 pools; all others use general pools
  return PACK_TYPES[packType].exclusive ? SV151_POOLS : CARD_POOLS;
}

function pullCard(packType) {
  const rarity = rollRarity(packType);
  const pools = getPoolsForPack(packType);
  const poolName = RARITY_MAP[rarity];
  const card = pickCardFromPool(pools[poolName]);
  return { ...card, rarity, imgUrl: `https://images.pokemontcg.io/${card.img}.png` };
}

// ===========================================================================
// Auth
// ===========================================================================
function authMiddleware(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ error:'No token' });
  try {
    req.user = jwt.verify(h.replace('Bearer ',''), JWT_SECRET);
    db.prepare("UPDATE users SET last_active_at=datetime('now') WHERE id=?").run(req.user.id);
    next();
  } catch { return res.status(401).json({ error:'Invalid token' }); }
}
function adminMiddleware(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error:'Admin only' });
  next();
}

// ===========================================================================
// Routes
// ===========================================================================
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error:'Credentials required' });
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!u || !bcrypt.compareSync(password, u.password_hash)) return res.status(401).json({ error:'Invalid credentials' });
  if (!u.first_login_at) db.prepare("UPDATE users SET first_login_at=datetime('now') WHERE id=?").run(u.id);
  db.prepare("UPDATE users SET last_active_at=datetime('now') WHERE id=?").run(u.id);
  db.prepare('INSERT INTO login_logs (user_id,ip) VALUES (?,?)').run(u.id, req.headers['x-forwarded-for']||req.socket.remoteAddress||'');
  const token = jwt.sign({ id:u.id, username:u.username, role:u.role }, JWT_SECRET, { expiresIn:'7d' });
  res.json({ token, user:{ id:u.id, username:u.username, role:u.role, balance:u.balance } });
});

app.get('/api/me', authMiddleware, (req, res) => {
  const u = db.prepare('SELECT id,username,role,balance FROM users WHERE id=?').get(req.user.id);
  if (!u) return res.status(404).json({ error:'Not found' });
  const vc = db.prepare("SELECT COUNT(*) as c FROM pulls WHERE user_id=? AND action='keep'").get(req.user.id).c;
  res.json({ ...u, vaultCount:vc });
});

app.post('/api/pull', authMiddleware, (req, res) => {
  const pack = PACK_TYPES[req.body.packType];
  if (!pack) return res.status(400).json({ error:'Invalid pack' });
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (u.balance < pack.cost) return res.status(400).json({ error:'Insufficient balance' });
  const nb = +(u.balance - pack.cost).toFixed(2);
  db.prepare('UPDATE users SET balance=? WHERE id=?').run(nb, u.id);
  db.prepare('INSERT INTO balance_logs (user_id,type,amount,balance_after,reason) VALUES (?,?,?,?,?)').run(u.id,'purchase',-pack.cost,nb,'Opened '+pack.name);
  const card = pullCard(req.body.packType);
  const r = db.prepare('INSERT INTO pulls (user_id,pack_type,pack_cost,card_name,card_set,card_number,card_img,card_rarity,card_value) VALUES (?,?,?,?,?,?,?,?,?)').run(u.id,req.body.packType,pack.cost,card.name,card.set,card.number,card.imgUrl,card.rarity,card.value);
  res.json({ pullId:r.lastInsertRowid, card, balance:nb, recycleValue:+(card.value*0.965).toFixed(2) });
});

app.post('/api/pull/batch', authMiddleware, (req, res) => {
  const pack = PACK_TYPES[req.body.packType];
  if (!pack) return res.status(400).json({ error:'Invalid pack' });
  const tc = pack.cost*5;
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (u.balance < tc) return res.status(400).json({ error:'Insufficient balance' });
  const nb = +(u.balance - tc).toFixed(2);
  db.prepare('UPDATE users SET balance=? WHERE id=?').run(nb, u.id);
  db.prepare('INSERT INTO balance_logs (user_id,type,amount,balance_after,reason) VALUES (?,?,?,?,?)').run(u.id,'purchase',-tc,nb,'Opened 5x '+pack.name);
  const cards = []; for (let i=0;i<5;i++) cards.push(pullCard(req.body.packType));
  const allC = cards.every(c => c.rarity==='Common');
  if (allC) {
    const pools = getPoolsForPack(req.body.packType);
    const up = pickCardFromPool(pools.common_holo);
    cards[4] = { ...up, rarity:'Uncommon', imgUrl:'https://images.pokemontcg.io/'+up.img+'.png' };
  }
  const pulls = [];
  const ins = db.prepare('INSERT INTO pulls (user_id,pack_type,pack_cost,card_name,card_set,card_number,card_img,card_rarity,card_value) VALUES (?,?,?,?,?,?,?,?,?)');
  for (const c of cards) { const r = ins.run(u.id,req.body.packType,pack.cost,c.name,c.set,c.number,c.imgUrl,c.rarity,c.value); pulls.push({ pullId:r.lastInsertRowid, card:c, recycleValue:+(c.value*0.965).toFixed(2) }); }
  res.json({ pulls, balance:nb, pityTriggered:allC });
});

app.post('/api/pull/:id/action', authMiddleware, (req, res) => {
  const { action } = req.body;
  if (!['keep','recycle'].includes(action)) return res.status(400).json({ error:'Invalid action' });
  const p = db.prepare('SELECT * FROM pulls WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!p) return res.status(404).json({ error:'Not found' });
  if (p.action) return res.status(400).json({ error:'Already actioned' });
  if (action==='keep') {
    db.prepare('UPDATE pulls SET action=? WHERE id=?').run('keep',p.id);
    db.prepare('INSERT INTO shipments (user_id,pull_id) VALUES (?,?)').run(req.user.id,p.id);
    res.json({ action:'keep', balance:db.prepare('SELECT balance FROM users WHERE id=?').get(req.user.id).balance });
  } else {
    const rc = +(p.card_value*0.965).toFixed(2);
    const u = db.prepare('SELECT balance FROM users WHERE id=?').get(req.user.id);
    const nb = +(u.balance+rc).toFixed(2);
    db.prepare('UPDATE pulls SET action=?,recycle_credit=? WHERE id=?').run('recycle',rc,p.id);
    db.prepare('UPDATE users SET balance=? WHERE id=?').run(nb,req.user.id);
    db.prepare('INSERT INTO balance_logs (user_id,type,amount,balance_after,reason) VALUES (?,?,?,?,?)').run(req.user.id,'recycle',rc,nb,'Recycled '+p.card_name+' ('+p.card_set+')');
    res.json({ action:'recycle', recycleCredit:rc, balance:nb });
  }
});

app.get('/api/vault', authMiddleware, (req, res) => {
  res.json(db.prepare("SELECT p.*,s.status as ship_status,s.tracking_note FROM pulls p LEFT JOIN shipments s ON s.pull_id=p.id WHERE p.user_id=? AND p.action='keep' ORDER BY p.created_at DESC").all(req.user.id));
});
app.get('/api/pulls', authMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM pulls WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(req.user.id));
});
app.post('/api/page-view', authMiddleware, (req, res) => {
  const { page, entered_at, exited_at, duration_seconds } = req.body;
  db.prepare('INSERT INTO page_views (user_id,page,entered_at,exited_at,duration_seconds) VALUES (?,?,?,?,?)').run(req.user.id,page,entered_at,exited_at,duration_seconds);
  res.json({ ok:true });
});

// Admin
app.post('/api/admin/create-user', authMiddleware, adminMiddleware, (req, res) => {
  const { username, password } = req.body;
  if (!username||!password) return res.status(400).json({ error:'Credentials required' });
  if (db.prepare('SELECT id FROM users WHERE username=?').get(username)) return res.status(400).json({ error:'Username exists' });
  const h = bcrypt.hashSync(password,10);
  const r = db.prepare('INSERT INTO users (username,password_hash,balance) VALUES (?,?,?)').run(username,h,20);
  db.prepare('INSERT INTO balance_logs (user_id,operator_id,type,amount,balance_after,reason) VALUES (?,?,?,?,?,?)').run(r.lastInsertRowid,req.user.id,'initial',20,20,'New user welcome bonus');
  res.json({ id:r.lastInsertRowid, username, balance:20 });
});
app.get('/api/admin/users', authMiddleware, adminMiddleware, (req, res) => {
  res.json(db.prepare("SELECT u.id,u.username,u.role,u.balance,u.first_login_at,u.last_active_at,u.created_at,(SELECT COUNT(*) FROM pulls WHERE user_id=u.id) as total_pulls,(SELECT COALESCE(SUM(amount),0) FROM balance_logs WHERE user_id=u.id AND type='topup') as total_topup FROM users u ORDER BY u.created_at DESC").all());
});
app.post('/api/admin/balance', authMiddleware, adminMiddleware, (req, res) => {
  const { userId, type, amount, reason } = req.body;
  if (!userId||!type||!amount) return res.status(400).json({ error:'Missing fields' });
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!u) return res.status(404).json({ error:'Not found' });
  const isD = ['deduct','refund','withdrawal'].includes(type);
  const d = isD ? -Math.abs(parseFloat(amount)) : Math.abs(parseFloat(amount));
  const nb = +(u.balance+d).toFixed(2);
  if (nb<0) return res.status(400).json({ error:'Balance would go negative' });
  db.prepare('UPDATE users SET balance=? WHERE id=?').run(nb,userId);
  db.prepare('INSERT INTO balance_logs (user_id,operator_id,type,amount,balance_after,reason) VALUES (?,?,?,?,?,?)').run(userId,req.user.id,type,d,nb,reason||'');
  res.json({ balance:nb });
});
app.get('/api/admin/pulls', authMiddleware, adminMiddleware, (req, res) => {
  const { userId } = req.query;
  res.json(userId ? db.prepare('SELECT p.*,u.username FROM pulls p JOIN users u ON u.id=p.user_id WHERE p.user_id=? ORDER BY p.created_at DESC LIMIT 500').all(userId) : db.prepare('SELECT p.*,u.username FROM pulls p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 500').all());
});
app.get('/api/admin/vault', authMiddleware, adminMiddleware, (req, res) => {
  res.json(db.prepare("SELECT p.*,u.username,s.status as ship_status,s.tracking_note,s.id as shipment_id FROM pulls p JOIN users u ON u.id=p.user_id LEFT JOIN shipments s ON s.pull_id=p.id WHERE p.action='keep' ORDER BY p.created_at DESC").all());
});
app.post('/api/admin/shipment/:id/status', authMiddleware, adminMiddleware, (req, res) => {
  const { status, tracking_note } = req.body;
  if (!['pending','shipped','delivered'].includes(status)) return res.status(400).json({ error:'Invalid status' });
  db.prepare("UPDATE shipments SET status=?,tracking_note=?,updated_at=datetime('now') WHERE id=?").run(status,tracking_note||'',req.params.id);
  res.json({ ok:true });
});
app.get('/api/admin/balance-logs', authMiddleware, adminMiddleware, (req, res) => {
  const { userId } = req.query;
  res.json(userId ? db.prepare('SELECT bl.*,u.username FROM balance_logs bl JOIN users u ON u.id=bl.user_id WHERE bl.user_id=? ORDER BY bl.created_at DESC LIMIT 500').all(userId) : db.prepare('SELECT bl.*,u.username FROM balance_logs bl JOIN users u ON u.id=bl.user_id ORDER BY bl.created_at DESC LIMIT 500').all());
});

// CSV Export
function toCsv(rows) {
  if (!rows.length) return '';
  const ks = Object.keys(rows[0]);
  return [ks.join(','), ...rows.map(r => ks.map(k => { let v=r[k]; if(v==null)v=''; return '"'+String(v).replace(/"/g,'""')+'"'; }).join(','))].join('\n');
}
const EX_TABLES = ['users','balance_logs','pulls','shipments','login_logs','page_views'];
app.get('/api/admin/export/:table', authMiddleware, adminMiddleware, (req, res) => {
  const t = req.params.table;
  if (!EX_TABLES.includes(t)) return res.status(400).json({ error:'Invalid table' });
  const q = t==='users' ? 'SELECT id,username,role,balance,first_login_at,last_active_at,created_at FROM users' : 'SELECT * FROM '+t;
  res.setHeader('Content-Type','text/csv');
  res.setHeader('Content-Disposition','attachment; filename='+t+'_'+Date.now()+'.csv');
  res.send(toCsv(db.prepare(q).all()));
});

app.get('/api/odds', authMiddleware, (req, res) => {
  const od = {}; for (const [k,p] of Object.entries(PACK_TYPES)) od[k] = { name:p.name, cost:p.cost, odds:p.odds, exclusive:!!p.exclusive };
  // Merge both pool systems for display
  const allPools = {};
  for (const [n,cs] of Object.entries(CARD_POOLS)) { const vs=cs.map(c=>c.value); allPools[n]={ min:Math.min(...vs), max:Math.max(...vs), count:cs.length }; }
  const sv151Pools = {};
  for (const [n,cs] of Object.entries(SV151_POOLS)) { const vs=cs.map(c=>c.value); sv151Pools[n]={ min:Math.min(...vs), max:Math.max(...vs), count:cs.length }; }
  res.json({ packs:od, pools:allPools, sv151Pools, recycleRate:0.965 });
});

app.get('*', (req, res) => { res.sendFile(path.join(__dirname,'public','index.html')); });

app.listen(PORT, () => {
  let t1=0, t2=0;
  for (const [n,cs] of Object.entries(SV151_POOLS)) { console.log('  SV151 ['+n+']: '+cs.length); t1+=cs.length; }
  console.log('  SV-151 exclusive total: '+t1);
  for (const [n,cs] of Object.entries(CARD_POOLS)) { console.log('  General ['+n+']: '+cs.length); t2+=cs.length; }
  console.log('  General pool total: '+t2);
  console.log('  Combined unique entries: '+(t1+t2));
  console.log('TCG Rips running on port '+PORT);
});
