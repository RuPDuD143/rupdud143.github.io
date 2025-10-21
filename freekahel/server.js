// server.js
require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const fetch = require('node-fetch');  // ✅ must be BEFORE eosjs usage
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
app.use(cors());

// per-IP rate limiter
const ipLimiter = rateLimit({
  windowMs: parseInt(process.env.IP_RATE_LIMIT_WINDOW_MS || '60000'),
  max: parseInt(process.env.IP_RATE_LIMIT_MAX || '10'),
  standardHeaders: true,
  legacyHeaders: false
});
app.use(ipLimiter);

// Simple SQLite DB to track redeem history and daily totals
const db = new Database('faucet.db');
db.prepare(`
  CREATE TABLE IF NOT EXISTS claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account TEXT NOT NULL,
    amount INTEGER NOT NULL,
    timestamp INTEGER NOT NULL,
    txid TEXT
  )
`).run();

const insertClaim = db.prepare('INSERT INTO claims (account,amount,timestamp,txid) VALUES (@account,@amount,@timestamp,@txid)');
const getDailyTotal = db.prepare('SELECT COALESCE(SUM(amount),0) as sum FROM claims WHERE account = ? AND timestamp >= ?');

// helper: get start-of-day unix ms
function startOfDayMs(nowMs = Date.now()) {
  const d = new Date(nowMs);
  d.setUTCHours(0,0,0,0);
  return d.getTime();
}

// small helper to format quantity to "X.0000 KAHEL"
function formatQty(intAmount) {
  // token precision assumed 4 decimals
  return Number(intAmount).toFixed(2) + ' KAHEL';
}

// Endpoint: redeem (body: { account: 'alice', amount: 10 })
app.post('/redeem', async (req, res) => {
  try {
    const { account, amount } = req.body;
    if (!account || typeof account !== 'string') return res.status(400).json({ error: 'account required' });
    const intAmount = parseInt(amount, 10);
    if (!Number.isFinite(intAmount) || intAmount <= 0) return res.status(400).json({ error: 'amount must be positive integer' });
    if (intAmount > MAX_PER_REQUEST) return res.status(400).json({ error: `max ${MAX_PER_REQUEST} per request` });

    // check daily limit
    const startMs = startOfDayMs();
    const row = getDailyTotal.get(account, startMs);
    const dailySum = row ? row.sum : 0;
    if (dailySum + intAmount > DAILY_LIMIT) {
      return res.status(429).json({ error: `Daily limit exceeded. Already redeemed ${dailySum}, limit ${DAILY_LIMIT}` });
    }

    // Compose transfer: from FAUCET_ACCOUNT -> account, quantity = intAmount KAHEL (4 decimals)
    const quantity = formatQty(intAmount);

    // Optional: insert pending claim with txid null then update after success
    const timestamp = Date.now();
    const info = { account, amount: intAmount, timestamp, txid: null };
    const txInsert = insertClaim.run(info);

    // perform transfer on chain
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
          memo: 'KAHEL faucet reward'
        }
      }]
    }, {
      blocksBehind: 3,
      expireSeconds: 60,
    });

    const txid = result.transaction_id || (result.processed && result.processed.id) || null;

    // update record with txid
    const update = db.prepare('UPDATE claims SET txid = ? WHERE id = ?');
    update.run(txid, txInsert.lastInsertRowid);

    return res.json({
      success: true,
      txid,
      redeemed: intAmount,
      daily_total_after: dailySum + intAmount
    });

  } catch (err) {
    console.error('Redeem error', err);
    return res.status(500).json({ error: 'internal_error', detail: err.message });
  }
});

// Admin: view last claims (very minimal - protect this in prod!)
app.get('/claims/recent', (req, res) => {
  const rows = db.prepare('SELECT id,account,amount,timestamp,txid FROM claims ORDER BY id DESC LIMIT 50').all();
  res.json(rows);
});

app.listen(PORT, () => {
  console.log(`Faucet server listening on ${PORT}`);
});
