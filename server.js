// server.js
require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const fetch = require('node-fetch');  // must be BEFORE eosjs usage
const { Api, JsonRpc } = require('eosjs');
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig');
const { TextEncoder, TextDecoder } = require('util');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 3000;
const FAUCET_ACCOUNT = process.env.FAUCET_ACCOUNT;
const FAUCET_PRIVKEY = process.env.FAUCET_PRIVKEY;
const TOKEN_CONTRACT = process.env.TOKEN_CONTRACT || 'rupdud143143';
const RPC_ENDPOINT = process.env.RPC_ENDPOINT || 'https://wax.greymass.com';
const DAILY_LIMIT = parseInt(process.env.DAILY_LIMIT_PER_ACCOUNT || '1000', 10);
const MAX_PER_REQUEST = parseInt(process.env.MAX_REDEEM_PER_REQUEST || '200', 10);

// Basic validation
if (!FAUCET_ACCOUNT || !FAUCET_PRIVKEY) {
  console.error('Please set FAUCET_ACCOUNT and FAUCET_PRIVKEY in .env');
  process.exit(1);
}

const signatureProvider = new JsSignatureProvider([FAUCET_PRIVKEY]);
const rpc = new JsonRpc(RPC_ENDPOINT, { fetch });
const api = new Api({
  rpc,
  signatureProvider,
  textDecoder: new TextDecoder(),
  textEncoder: new TextEncoder(),
});

const app = express();
app.use(express.json());
app.use(cors({
  origin: 'https://rupdud143.github.io',
  methods: ['GET','POST']
}));

// per-IP rate limiter
const ipLimiter = rateLimit({
  windowMs: parseInt(process.env.IP_RATE_LIMIT_WINDOW_MS || '60000'),
  max: parseInt(process.env.IP_RATE_LIMIT_MAX || '60'),
  standardHeaders: true,
  legacyHeaders: false
});
app.use(ipLimiter);

// DB init
const db = new Database('faucet_game.db');

db.prepare(`
CREATE TABLE IF NOT EXISTS users (
  account TEXT PRIMARY KEY,
  coins INTEGER NOT NULL DEFAULT 0,          -- integer coins (1 coin = 1 unit)
  gems INTEGER NOT NULL DEFAULT 0,           -- integer gems
  rate INTEGER NOT NULL DEFAULT 1,           -- coins per second (base 1)
  level INTEGER NOT NULL DEFAULT 0,          -- upgrade level
  last_active_ms INTEGER DEFAULT NULL,       -- last heartbeat time (ms)
  active INTEGER NOT NULL DEFAULT 0,         -- 1 if logged-in session active
  kahel_offchain INTEGER NOT NULL DEFAULT 0  -- in-game KAHEL balance (integer KAHEL units)
);
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL,
  amount INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  txid TEXT
)
`).run();

// helpers
const getUser = db.prepare('SELECT * FROM users WHERE account = ?');
const createUser = db.prepare('INSERT OR IGNORE INTO users (account) VALUES (?)');
const insertUser = db.prepare('INSERT INTO users (account,coins,gems,rate,level,last_active_ms,active,kahel_offchain) VALUES (?,?,?,?,?,?,?,?)');
const upsertUser = db.prepare('INSERT OR REPLACE INTO users (account,coins,gems,rate,level,last_active_ms,active,kahel_offchain) VALUES (@account,@coins,@gems,@rate,@level,@last_active_ms,@active,@kahel_offchain)');
const updateUserFields = db.prepare('UPDATE users SET coins=@coins,gems=@gems,rate=@rate,level=@level,last_active_ms=@last_active_ms,active=@active,kahel_offchain=@kahel_offchain WHERE account=@account');

const insertClaim = db.prepare('INSERT INTO claims (account,amount,timestamp,txid) VALUES (@account,@amount,@timestamp,@txid)');
const getDailyTotal = db.prepare('SELECT COALESCE(SUM(amount),0) as sum FROM claims WHERE account = ? AND timestamp >= ?');

// format quantity for on-chain transfer with 2 decimals
function formatQtyDecimal(amountKahel) {
  // amountKahel is integer KAHEL units (1 = 1 KAHEL)
  return Number(amountKahel).toFixed(2) + ' KAHEL';
}

function nowMs() { return Date.now(); }
function clampInt(n) { return Math.floor(Number(n) || 0); }

// login: register and mark active session
app.post('/login', (req, res) => {
  try {
    const { account } = req.body;
    if (!account || typeof account !== 'string') return res.status(400).json({ error: 'account required' });

    // ensure user record exists
    createUser.run(account); // IGNORE IF EXISTS
    const user = getUser.get(account);
    // mark active and set last_active_ms to now
    const updated = {
      account,
      coins: user.coins,
      gems: user.gems,
      rate: user.rate,
      level: user.level,
      last_active_ms: nowMs(),
      active: 1,
      kahel_offchain: user.kahel_offchain
    };
    updateUserFields.run(updated);
    return res.json({ success: true, user: updated });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
});

// logout: mark inactive and flush any pending accrual
app.post('/logout', (req, res) => {
  try {
    const { account } = req.body;
    if (!account) return res.status(400).json({ error: 'account required' });
    const user = getUser.get(account);
    if (!user) return res.status(400).json({ error: 'unknown account' });

    // accrue up to now if active
    let coins = user.coins;
    if (user.active) {
      const elapsedSec = Math.floor((nowMs() - (user.last_active_ms || nowMs())) / 1000);
      if (elapsedSec > 0) {
        coins += elapsedSec * user.rate;
      }
    }
    const updated = {
      account,
      coins,
      gems: user.gems,
      rate: user.rate,
      level: user.level,
      last_active_ms: nowMs(),
      active: 0,
      kahel_offchain: user.kahel_offchain
    };
    updateUserFields.run(updated);
    return res.json({ success: true, user: updated });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
});

// heartbeat/ping: call frequently while logged in (server awards coins between last_active and now)
app.post('/ping', (req, res) => {
  try {
    const { account } = req.body;
    if (!account) return res.status(400).json({ error: 'account required' });
    const user = getUser.get(account);
    if (!user) return res.status(400).json({ error: 'unknown account' });

    if (!user.active) {
      // if not already active, start session
      user.last_active_ms = nowMs();
      user.active = 1;
      updateUserFields.run(user);
      return res.json({ success: true, user });
    }

    const now = nowMs();
    const last = user.last_active_ms || now;
    const elapsedSec = Math.floor((now - last) / 1000);
    let newCoins = user.coins;
    if (elapsedSec > 0) {
      newCoins += elapsedSec * user.rate;
      user.coins = newCoins;
      user.last_active_ms = now;
      updateUserFields.run(user);
    } else {
      // no full second elapsed; update last_active_ms to now (prevent double counting)
      user.last_active_ms = now;
      updateUserFields.run(user);
    }
    return res.json({ success: true, user });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
});

// get user state
app.get('/state/:account', (req, res) => {
  const account = req.params.account;
  if (!account) return res.status(400).json({ error: 'account required' });
  const user = getUser.get(account);
  if (!user) return res.status(404).json({ error: 'not found' });
  return res.json({ success: true, user });
});

// upgrade: spend Gems to increase level and rate
app.post('/upgrade', (req, res) => {
  try {
    const { account } = req.body;
    if (!account) return res.status(400).json({ error: 'account required' });
    const user = getUser.get(account);
    if (!user) return res.status(404).json({ error: 'not found' });

    const currentLevel = user.level || 0;
    const cost = 5 + currentLevel; // base 5, increases by 1 per existing level
    if (user.gems < cost) return res.status(400).json({ error: 'insufficient_gems', cost });

    user.gems -= cost;
    user.level = currentLevel + 1;
    user.rate = (user.rate || 1) + 1; // +1 coin/sec per level
    updateUserFields.run(user);
    return res.json({ success: true, user, spent: cost });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
});

// burn coins -> earn in-game KAHEL
app.post('/burn', (req, res) => {
  try {
    const { account, coins_to_burn } = req.body;
    if (!account) return res.status(400).json({ error: 'account required' });
    const burnCoins = clampInt(coins_to_burn);
    if (burnCoins <= 0) return res.status(400).json({ error: 'burn amount must be positive integer' });
    const MIN_BURN = 1000000; // min required to produce KAHEL
    if (burnCoins < MIN_BURN) return res.status(400).json({ error: `minimum burn is ${MIN_BURN} coins` });

    const user = getUser.get(account);
    if (!user) return res.status(404).json({ error: 'not found' });

    // compute how many full KAHEL units are earned (1 KAHEL per 1_000_000 coins)
    const kahelEarned = Math.floor(burnCoins / MIN_BURN);
    if (kahelEarned <= 0) return res.status(400).json({ error: 'not enough coins for Kahel' });

    const coinsNeeded = kahelEarned * MIN_BURN;
    if (user.coins < coinsNeeded) return res.status(400).json({ error: 'insufficient_coins', coinsNeeded });

    user.coins -= coinsNeeded;
    user.kahel_offchain += kahelEarned;
    updateUserFields.run(user);

    return res.json({ success: true, earned: kahelEarned, user });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
});

// convert in-game KAHEL -> GEMS (1:1)
app.post('/convert', (req, res) => {
  try {
    const { account, kahel } = req.body;
    if (!account) return res.status(400).json({ error: 'account required' });
    const kahelInt = clampInt(kahel);
    if (kahelInt <= 0) return res.status(400).json({ error: 'kahel must be positive integer' });

    const user = getUser.get(account);
    if (!user) return res.status(404).json({ error: 'not found' });
    if (user.kahel_offchain < kahelInt) return res.status(400).json({ error: 'insufficient_kahel' });

    user.kahel_offchain -= kahelInt;
    user.gems += kahelInt; // 1:1
    updateUserFields.run(user);
    return res.json({ success: true, user });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
});

// cashout: send on-chain KAHEL via faucet (uses your existing transfer code)
// body: { account, kahel_amount }  (kahel_amount is integer KAHEL units)
app.post('/cashout', async (req, res) => {
  try {
    const { account, kahel_amount } = req.body;
    if (!account) return res.status(400).json({ error: 'account required' });
    const amountInt = clampInt(kahel_amount);
    if (amountInt <= 0) return res.status(400).json({ error: 'amount must be positive integer' });
    if (amountInt > MAX_PER_REQUEST) return res.status(400).json({ error: `max ${MAX_PER_REQUEST} per request` });

    const user = getUser.get(account);
    if (!user) return res.status(404).json({ error: 'not found' });
    if (user.kahel_offchain < amountInt) return res.status(400).json({ error: 'insufficient_offchain_kahel' });

    // check daily limit
    const startMs = (new Date()).setUTCHours(0,0,0,0);
    const row = getDailyTotal.get(account, startMs);
    const dailySum = row ? row.sum : 0;
    if (dailySum + amountInt > DAILY_LIMIT) {
      return res.status(429).json({ error: `Daily limit exceeded. Already redeemed ${dailySum}, limit ${DAILY_LIMIT}` });
    }

    // perform transfer on chain: format quantity with 2 decimals
    const quantity = formatQtyDecimal(amountInt);

    const timestamp = nowMs();
    const info = { account, amount: amountInt, timestamp, txid: null };
    const txInsert = insertClaim.run(info);

    const result = await api.transact({
      actions: [{
        account: TOKEN_CONTRACT,
        name: 'transfer',
        authorization: [{
          actor: FAUCET_ACCOUNT,
          permission: 'active',
        }],
        data: {
          from: FAUCET_ACCOUNT,
          to: account,
          quantity,
          memo: 'KAHEL faucet cashout'
        }
      }]
    }, {
      blocksBehind: 3,
      expireSeconds: 60,
    });

    const txid = result.transaction_id || (result.processed && result.processed.id) || null;

    // update claim record
    const update = db.prepare('UPDATE claims SET txid = ? WHERE id = ?');
    update.run(txid, txInsert.lastInsertRowid);

    // deduct in-game kahel
    user.kahel_offchain -= amountInt;
    updateUserFields.run(user);

    return res.json({
      success: true,
      txid,
      redeemed: amountInt,
      daily_total_after: dailySum + amountInt
    });

  } catch (err) {
    console.error('Cashout error:', err);
    return res.status(500).json({
      error: 'internal_error',
      message: err.message || String(err)
    });
  }
});

// admin: recent claims
app.get('/claims/recent', (req, res) => {
  const rows = db.prepare('SELECT id,account,amount,timestamp,txid FROM claims ORDER BY id DESC LIMIT 50').all();
  res.json(rows);
});

app.listen(PORT, () => {
  console.log(`Miner Faucet server listening on ${PORT}`);
});
