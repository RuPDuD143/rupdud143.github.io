// server.js (simplified for Miner frontend)
// Requirements: npm install express better-sqlite3 cors dotenv node-fetch eosjs express-rate-limit
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const fetch = require('node-fetch'); // for eosjs
const rateLimit = require('express-rate-limit');
const { Api, JsonRpc } = require('eosjs');
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig');
const { TextEncoder, TextDecoder } = require('util');

const PORT = process.env.PORT || 3000;
const BACKEND_ORIGINS = [
  'https://rupdud143.github.io',
  'http://localhost',
  'http://127.0.0.1'
];

const FAUCET_ACCOUNT = process.env.FAUCET_ACCOUNT;
const FAUCET_PRIVKEY = process.env.FAUCET_PRIVKEY;
const TOKEN_CONTRACT = process.env.TOKEN_CONTRACT || 'rupdud143143';
const RPC_ENDPOINT = process.env.RPC_ENDPOINT || 'https://wax.greymass.com';

// optional on-chain API if faucet private key set
const signatureProvider = FAUCET_PRIVKEY ? new JsSignatureProvider([FAUCET_PRIVKEY]) : null;
const rpc = new JsonRpc(RPC_ENDPOINT, { fetch });
const api = signatureProvider ? new Api({
  rpc,
  signatureProvider,
  textDecoder: new TextDecoder(),
  textEncoder: new TextEncoder(),
}) : null;

const app = express();
app.use(express.json());
app.use(cors());

// DB (file name: minergame.db)
const db = new Database('minergame.db');

// Create tables: users, submits
db.prepare(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT UNIQUE NOT NULL,
  name TEXT,            -- their wax address or friendly name
  coins INTEGER DEFAULT 0,
  gems INTEGER DEFAULT 0,
  miner_level INTEGER DEFAULT 1
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS submits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL,
  amount INTEGER NOT NULL,
  day TEXT NOT NULL, -- yyyymmdd UTC
  timestamp INTEGER NOT NULL
)
`).run();
db.prepare(`
CREATE TABLE IF NOT EXISTS rewards_given (
  account TEXT,
  day TEXT,
  PRIMARY KEY (account, day)
)
`).run();


// prepared statements
const getUserByAccount = db.prepare('SELECT * FROM users WHERE account = ?');
const insertUser = db.prepare('INSERT INTO users (account, name, coins, gems, miner_level) VALUES (@account,@name,@coins,@gems,@miner_level)');
const upsertUser = db.prepare(`
INSERT INTO users (account,name,coins,gems,miner_level)
VALUES (@account,@name,@coins,@gems,@miner_level)
ON CONFLICT(account) DO UPDATE SET name=excluded.name
`);
const updateUserCols = db.prepare('UPDATE users SET coins=@coins, gems=@gems, miner_level=@miner_level WHERE account=@account');

const insertSubmit = db.prepare('INSERT INTO submits (account,amount,day,timestamp) VALUES (@account,@amount,@day,@timestamp)');
const sumSubmissionsByDay = db.prepare('SELECT COALESCE(SUM(amount),0) as total FROM submits WHERE day = ?');
const sumSubmissionsByDayAndAccount = db.prepare('SELECT COALESCE(SUM(amount),0) as total FROM submits WHERE day = ? AND account = ?');

// helpers
function yyyymmdd(ms = Date.now()) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;
}
function distributeGemsForDay(day) {
  const submits = db.prepare('SELECT account, amount FROM submits WHERE day=?').all(day);
  if (!submits.length) return;

  const total = submits.reduce((a, b) => a + b.amount, 0);
  if (!total) return;

  const pool = 1000; // total gems to distribute

  for (const row of submits) {
    const share = (row.amount / total) * pool;
    const alreadyGiven = db.prepare('SELECT 1 FROM rewards_given WHERE account=? AND day=?').get(row.account, day);
    if (alreadyGiven) continue;

    db.prepare('UPDATE users SET gems = gems + ? WHERE account=?').run(share, row.account);
    db.prepare('INSERT INTO rewards_given (account, day) VALUES (?, ?)').run(row.account, day);
  }
}

function ensureUser(account) {
  let row = getUserByAccount.get(account);
  if (!row) {
    insertUser.run({ account, name: account, coins: 0, gems: 0, miner_level: 1 }); // default miner_level 1
    row = getUserByAccount.get(account);
  }
  return row;
}

// ROUTES

app.get('/', (req, res) => res.send('Miner Game backend online ✅'));

// get player data
// app.get('/player/:account', (req, res) => {
//   try {
//     const account = req.params.account;
//     if (!account) return res.status(400).json({ error: 'account required' });
//     const user = ensureUser(account);
//     res.json({
//       account: user.account,
//       name: user.name,
//       coins: user.coins,
//       gems: user.gems,
//       miner_level: user.miner_level
//     });
//   } catch (e) {
//     console.error('player error', e);
//     res.status(500).json({ error: e.message });
//   }
// });
app.get('/player/:account', async (req, res) => {
  try {
    const account = req.params.account;
    if (!account) return res.status(400).json({ error: 'account required' });

    const user = ensureUser(account);

    // 🔹 Fetch NFTs from AtomicAssets
    const response = await fetch(`https://wax.api.atomicassets.io/atomicassets/v1/assets?collection_name=riskyblocks1&owner=${account}&limit=100`);
    const data = await response.json();
    const assets = data.data || [];

    // 🔹 Template ranking and mining rate mapping
    const rankMap = {
      822690: { rank: 7, rate: 40 },
      822688: { rank: 6, rate: 35 },
      822687: { rank: 5, rate: 30 },
      822686: { rank: 4, rate: 25 },
      822685: { rank: 3, rate: 20 },
      822684: { rank: 2, rate: 15 },
      822385: { rank: 1, rate: 10 }
    };

    // 🔹 Find strongest NFT
    let strongest = null;
    for (const nft of assets) {
      const tpl = parseInt(nft.template?.template_id);
      const info = rankMap[tpl];
      if (!info) continue;

      const tierAttr = nft.data?.tier ? parseInt(nft.data.tier) || 0 : 0;

      if (
        !strongest ||
        info.rank > strongest.rank ||
        (info.rank === strongest.rank && tierAttr > strongest.tier)
      ) {
        strongest = {
          nft,
          rank: info.rank,
          rate: info.rate,
          tier: tierAttr
        };
      }
    }

    // 🔹 Set mining rate (default 1/sec if no NFT)
    const miningRate = strongest ? strongest.rate : 1;

    // 🔹 Return player info + NFT summary + mining rate
    res.json({
      account: user.account,
      name: user.name,
      coins: user.coins,
      gems: user.gems,
      miner_level: user.miner_level,
      mining_rate: miningRate,
      strongest_nft: strongest
        ? {
            asset_id: strongest.nft.asset_id,
            template_id: strongest.nft.template?.template_id,
            name: strongest.nft.name,
            img: strongest.nft.data?.img,
            rank: strongest.rank,
            tier: strongest.tier
          }
        : null
    });

  } catch (e) {
    console.error('player error', e);
    res.status(500).json({ error: e.message });
  }
});

// upgrade: cost = 5 + level gems
app.post('/upgrade', (req, res) => {
  try {
    const { account } = req.body;
    if (!account) return res.status(400).json({ error: 'account required' });
    const user = ensureUser(account);
    const cost = 5 + (user.miner_level || 0);
    if ((user.gems || 0) < cost) return res.status(400).json({ error: 'not_enough_gems', required: cost, have: user.gems });
    const newLevel = (user.miner_level || 0) + 1;
    const newGems = user.gems - cost;
    updateUserCols.run({ account, coins: user.coins, gems: newGems, miner_level: newLevel });
    res.json({ ok:true, new_level: newLevel, gems_left: newGems });
  } catch (e) {
    console.error('upgrade error', e);
    res.status(500).json({ error: e.message });
  }
});

// take: user deposits their front-end mined coins into their server-side coins
app.post('/take', (req, res) => {
  try {
    const { account, amount } = req.body;
    if (!account) return res.status(400).json({ error: 'account required' });
    const amt = Math.floor(Number(amount || 0));
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'amount must be positive integer' });

    let user = ensureUser(account);

    // enforce sanity check: client should cap based on miner_level * 100
    const cap = (user.miner_level || 0) * 100;
    if (amt > cap) return res.status(400).json({ error: 'amount_exceeds_cap', cap });

    user.coins = (user.coins || 0) + amt;
    updateUserCols.run({ account, coins: user.coins, gems: user.gems, miner_level: user.miner_level });

    res.json({ ok:true, added: amt, coins: user.coins });
  } catch (e) {
    console.error('take error', e);
    res.status(500).json({ error: e.message });
  }
});

// submit: submit coins to today's pool (replaces burn)
app.post('/submit', (req, res) => {
  try {
    const { account, amount } = req.body;
    if (!account) return res.status(400).json({ error: 'account required' });
    const amt = Math.floor(Number(amount || 0));
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'amount must be positive integer' });

    let user = ensureUser(account);
    if ((user.coins || 0) < amt) return res.status(400).json({ error: 'not_enough_coins', have: user.coins });

    // subtract coins and record submission for today's UTC day
    user.coins -= amt;
    updateUserCols.run({ account, coins: user.coins, gems: user.gems, miner_level: user.miner_level });

    const day = yyyymmdd();
    insertSubmit.run({ account, amount: amt, day, timestamp: Date.now() });

    const row = sumSubmissionsByDayAndAccount.get(day, account);
    const userTotalToday = row ? row.total : 0;

    res.json({ ok:true, submitted: amt, user_coins: user.coins, your_total_today: userTotalToday });
  } catch (e) {
    console.error('submit error', e);
    res.status(500).json({ error: e.message });
  }
});
// pool info: total submissions + user submission for today
app.get('/pool/:account', (req, res) => {
  try {
    const account = req.params.account;
    if (!account) return res.status(400).json({ error: 'account required' });
    const day = yyyymmdd();

    const totalRow = sumSubmissionsByDay.get(day);
    const userRow = sumSubmissionsByDayAndAccount.get(day, account);

    const total = totalRow ? totalRow.total : 0;
    const userTotal = userRow ? userRow.total : 0;

    const POOL_GEMS = 1000; // matches frontend display
    const approxShare = total > 0 ? ((userTotal / total) * POOL_GEMS).toFixed(2) : 0;
    // Auto-distribute last contribution's gems
    const last = db.prepare('SELECT day FROM submits WHERE account=? ORDER BY day DESC LIMIT 1').get(account);
    const today = yyyymmdd();
    if (last && last.day < today) {
      // only reward if their last submission was from a previous day
      distributeGemsForDay(last.day);
    }


    res.json({
      ok: true,
      day,
      total_submissions: total,
      user_submission: userTotal,
      user_approx_share: approxShare // 👈 ADD THIS
    });
  } catch (e) {
    console.error('pool info error', e);
    res.status(500).json({ error: e.message });
  }
});


// cashout: exchange gems -> onchain KAHEL (1000 gems -> 1 KAHEL). Server must be configured with FAUCET_PRIVKEY
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false
});
app.post('/cashout', limiter, async (req, res) => {
  try {
    const { account, gems_to_cashout } = req.body;
    if (!account) return res.status(400).json({ error: 'account required' });
    const gemsToCashout = Math.floor(Number(gems_to_cashout || 0));
    if (!Number.isFinite(gemsToCashout) || gemsToCashout <= 0) return res.status(400).json({ error: 'invalid_gems_to_cashout' });

    let user = ensureUser(account);
    if ((user.gems || 0) < gemsToCashout) return res.status(400).json({ error: 'not_enough_gems', have: user.gems });

    // compute kahel quantity: 1000 gems -> 1 KAHEL
    const kahelAmount = (gemsToCashout / 1000); // can be fractional
    // we will floor to 2 decimals when sending onchain
    const kahelStr = kahelAmount.toFixed(2) + ' KAHEL';

    // optimistic deduct gems
    user.gems -= gemsToCashout;
    updateUserCols.run({ account, coins: user.coins, gems: user.gems, miner_level: user.miner_level });

    if (!api) {
      // rollback
      user.gems += gemsToCashout;
      updateUserCols.run({ account, coins: user.coins, gems: user.gems, miner_level: user.miner_level });
      return res.status(500).json({ error: 'onchain_unavailable', message: 'Server not configured for on-chain transfers.' });
    }

    // perform transfer
    const result = await api.transact({
      actions: [{
        account: TOKEN_CONTRACT,
        name: 'transfer',
        authorization: [{ actor: FAUCET_ACCOUNT, permission: 'active' }],
        data: { from: FAUCET_ACCOUNT, to: account, quantity: kahelStr, memo: 'Cashout from Miner Game' }
      }]
    }, { blocksBehind: 3, expireSeconds: 60 });

    const txid = result.transaction_id || (result.processed && result.processed.id) || null;

    res.json({ ok:true, txid, kahel: kahelStr, gems_left: user.gems });
  } catch (err) {
    console.error('cashout error', err);
    res.status(500).json({ error: 'internal_error', message: err.message, details: err.json || {} });
  }
});

// admin: view submissions for day
app.get('/admin/day/:day/submits', (req, res) => {
  try {
    const day = req.params.day || yyyymmdd();
    const rows = db.prepare('SELECT account, SUM(amount) as total FROM submits WHERE day = ? GROUP BY account ORDER BY total DESC').all(day);
    res.json({ day, totals: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Miner Game server listening on ${PORT}`);
});






