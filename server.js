// server.js
require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const fetch = require('node-fetch'); // must be BEFORE eosjs usage
const { Api, JsonRpc } = require('eosjs');
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig');
const { TextEncoder, TextDecoder } = require('util');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 3000;
const FAUCET_ACCOUNT = process.env.FAUCET_ACCOUNT;
const FAUCET_PRIVKEY = process.env.FAUCET_PRIVKEY;
const TOKEN_CONTRACT = process.env.TOKEN_CONTRACT || 'rupdud143143';
const RPC_ENDPOINT = process.env.RPC_ENDPOINT || 'https://wax.greymass.com';

// Note: If FAUCET_ACCOUNT/FAUCET_PRIVKEY are not set, cashout will return an error and roll back.
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
app.use(cors({
  origin: [
    'https://rupdud143.github.io',
    'http://localhost',
    'http://127.0.0.1'
  ],
  methods: ['GET','POST']
}));

// DB
const db = new Database('faucet_game.db');

// tables: users, burns, claims
db.prepare(`
CREATE TABLE IF NOT EXISTS users (
  account TEXT PRIMARY KEY,
  coins INTEGER DEFAULT 0,
  gems INTEGER DEFAULT 0,
  rate INTEGER DEFAULT 1,
  level INTEGER DEFAULT 0,
  last_tick INTEGER DEFAULT 0,
  kahel_in_game INTEGER DEFAULT 0,   -- stored in cents (1 KAHEL = 100)
  last_claim_day INTEGER DEFAULT 0   -- yyyymmdd of last claim processed
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS burns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL,
  amount INTEGER NOT NULL, -- integer coins burned
  day TEXT NOT NULL,       -- yyyymmdd (UTC)
  timestamp INTEGER NOT NULL
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL,
  day TEXT NOT NULL,
  kahel_cents INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  txid TEXT
)
`).run();

// helpers / prepared statements
const getUser = db.prepare('SELECT * FROM users WHERE account = ?');
const insertUser = db.prepare('INSERT INTO users (account, coins, gems, rate, level, last_tick, kahel_in_game, last_claim_day) VALUES (@account,@coins,@gems,@rate,@level,@last_tick,@kahel_in_game,@last_claim_day)');
const updateUserCols = db.prepare('UPDATE users SET coins=@coins, gems=@gems, rate=@rate, level=@level, last_tick=@last_tick, kahel_in_game=@kahel_in_game, last_claim_day=@last_claim_day WHERE account=@account');

const insertBurn = db.prepare('INSERT INTO burns (account, amount, day, timestamp) VALUES (@account,@amount,@day,@timestamp)');
const sumBurnsByDay = db.prepare('SELECT COALESCE(SUM(amount),0) as total FROM burns WHERE day = ?');
const sumBurnsByDayAndAccount = db.prepare('SELECT COALESCE(SUM(amount),0) as total FROM burns WHERE day = ? AND account = ?');

const insertClaim = db.prepare('INSERT INTO claims (account, day, kahel_cents, timestamp, txid) VALUES (@account,@day,@kahel_cents,@timestamp,@txid)');
const getClaimByAccountDay = db.prepare('SELECT * FROM claims WHERE account = ? AND day = ?');

// utility: yyyymmdd UTC
function yyyymmdd(ms = Date.now()) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;
}

// coins accrual on heartbeat: only accrues when heartbeat is received
function accrueCoinsForUser(user) {
  const now = Date.now();
  if (!user.last_tick || user.last_tick <= 0) {
    user.last_tick = now;
    return user;
  }
  const deltaMs = now - user.last_tick;
  if (deltaMs < 1000) {
    user.last_tick = now;
    return user;
  }
  const seconds = Math.floor(deltaMs / 1000);
  const add = Math.floor(seconds * (user.rate || 1));
  user.coins = (user.coins || 0) + add;
  user.last_tick = now;
  return user;
}

function ensureUser(account) {
  let row = getUser.get(account);
  if (!row) {
    const now = Date.now();
    insertUser.run({ account, coins: 0, gems: 0, rate: 1, level: 0, last_tick: now, kahel_in_game: 0, last_claim_day: 0 });
    row = getUser.get(account);
  }
  return row;
}

function kahelFromCents(cents) {
  return (cents / 100).toFixed(2);
}
function kahelToCents(kahel) {
  return Math.round(parseFloat(kahel) * 100);
}

// ROUTES

app.get('/', (req, res) => res.send('Miner Game backend online ✅'));

// get player data incl today's burn total and claim status
app.get('/player/:account', (req, res) => {
  try {
    const account = req.params.account;
    if (!account) return res.status(400).json({ error: 'account required' });
    let user = ensureUser(account);
    // do not automatically accrue here; heartbeat does accrual. but include last_tick and rate.
    const today = yyyymmdd();
    const row = sumBurnsByDayAndAccount.get(today, account);
    const userBurnToday = row ? row.total : 0;
    const claim = getClaimByAccountDay.get(account, today);
    res.json({
      account: user.account,
      coins: user.coins,
      gems: user.gems,
      rate: user.rate,
      level: user.level,
      kahel_in_game: kahelFromCents(user.kahel_in_game),
      last_tick: user.last_tick,
      today_burn_total: userBurnToday,
      has_claimed_today: !!claim
    });
  } catch (e) {
    console.error('player error', e);
    res.status(500).json({ error: e.message });
  }
});

// heartbeat: accrues coins (only while user is online)
app.post('/heartbeat', (req, res) => {
  try {
    const { account } = req.body;
    if (!account) return res.status(400).json({ error: 'account required' });
    let user = ensureUser(account);
    user = accrueCoinsForUser(user);
    updateUserCols.run(user);
    res.json({
      ok: true,
      coins: user.coins,
      gems: user.gems,
      rate: user.rate,
      level: user.level,
      kahel_in_game: kahelFromCents(user.kahel_in_game)
    });
  } catch (e) {
    console.error('heartbeat error', e);
    res.status(500).json({ error: e.message });
  }
});

// upgrade: cost = 5 + level gems
app.post('/upgrade', (req, res) => {
  try {
    const { account } = req.body;
    if (!account) return res.status(400).json({ error: 'account required' });
    let user = ensureUser(account);
    user = accrueCoinsForUser(user);
    const cost = 5 + user.level;
    if (user.gems < cost) return res.status(400).json({ error: 'not_enough_gems', required: cost, have: user.gems });
    user.gems -= cost;
    user.level += 1;
    user.rate += 1;
    updateUserCols.run(user);
    res.json({ ok: true, new_level: user.level, new_rate: user.rate, gems_left: user.gems });
  } catch (e) {
    console.error('upgrade error', e);
    res.status(500).json({ error: e.message });
  }
});

// burn: players may burn any amount >= 1_000_000 coins, multiple times.
// burns are recorded into burns table under current UTC day and subtracted from coins immediately.
app.post('/burn', (req, res) => {
  try {
    const { account, amount } = req.body;
    if (!account) return res.status(400).json({ error: 'account required' });
    const burn = Math.floor(Number(amount));
    if (!Number.isFinite(burn) || burn <= 0) return res.status(400).json({ error: 'amount must be positive integer' });
    if (burn < 1000000) return res.status(400).json({ error: 'min_burn', min: 1000000 });

    let user = ensureUser(account);
    user = accrueCoinsForUser(user);

    if (user.coins < burn) return res.status(400).json({ error: 'not_enough_coins', have: user.coins });

    user.coins -= burn;
    const day = yyyymmdd();
    insertBurn.run({ account, amount: burn, day, timestamp: Date.now() });
    updateUserCols.run(user);

    // reflect their new coins in response and current day's personal total
    const row = sumBurnsByDayAndAccount.get(day, account);
    const userBurnToday = row ? row.total : 0;

    res.json({
      ok: true,
      coins: user.coins,
      recorded_burn: burn,
      today_burn_total: userBurnToday
    });
  } catch (e) {
    console.error('burn error', e);
    res.status(500).json({ error: e.message });
  }
});

// claim: player claims their share of today's 1.00 KAHEL pool.
// rules:
// - The pool size is exactly 1.00 KAHEL per UTC day (100 cents).
// - user_share_cents = round( user_burn_today / total_burn_today * 100 )
// - If total_burn_today === 0 -> nothing to claim.
// - A player may claim at most once per UTC day (tracked in claims table).
app.post('/claim', (req, res) => {
  try {
    const { account } = req.body;
    if (!account) return res.status(400).json({ error: 'account required' });
    let user = ensureUser(account);
    user = accrueCoinsForUser(user);

    const day = yyyymmdd();
    // already claimed?
    const existingClaim = getClaimByAccountDay.get(account, day);
    if (existingClaim) {
      return res.status(400).json({ error: 'already_claimed_today', kahel_awarded: kahelFromCents(existingClaim.kahel_cents) });
    }

    const totalRow = sumBurnsByDay.get(day);
    const totalBurn = totalRow ? totalRow.total : 0;
    if (!totalBurn || totalBurn <= 0) {
      return res.status(400).json({ error: 'no_burns_today', message: 'No burns recorded today; nothing to claim.' });
    }

    const userRow = sumBurnsByDayAndAccount.get(day, account);
    const userBurn = userRow ? userRow.total : 0;
    if (!userBurn || userBurn <= 0) {
      return res.status(400).json({ error: 'no_personal_burns', message: 'You have not burned any coins today.' });
    }

    // compute share in cents (1 KAHEL = 100 cents)
    // round to nearest cent; ensure <= 100
    let shareCents = Math.round((userBurn / totalBurn) * 100);
    if (shareCents > 100) shareCents = 100;

    // To avoid giving 0 cents due to rounding for very small burns, we can give at least 0 cents (no automatic rounding up).
    if (shareCents <= 0) {
      // if rounding gave zero, deny (too small to receive any cent)
      return res.status(400).json({ error: 'share_too_small', message: 'Your share rounds to 0.00 KAHEL today.' });
    }

    // award in-game KAHEL
    user.kahel_in_game = (user.kahel_in_game || 0) + shareCents;
    updateUserCols.run(user);

    // record claim
    insertClaim.run({ account, day, kahel_cents: shareCents, timestamp: Date.now(), txid: null });

    res.json({
      ok: true,
      awarded_kahel: (shareCents / 100).toFixed(2),
      kahel_in_game: kahelFromCents(user.kahel_in_game),
      total_burn_today: totalBurn,
      your_burn_today: userBurn
    });

  } catch (e) {
    console.error('claim error', e);
    res.status(500).json({ error: e.message });
  }
});

// convert in-game KAHEL -> Gems at 1:1 (1.00 KAHEL -> 1 Gem)
app.post('/convert', (req, res) => {
  try {
    const { account, kahel_amount } = req.body;
    if (!account) return res.status(400).json({ error: 'account required' });
    if (!kahel_amount || isNaN(kahel_amount)) return res.status(400).json({ error: 'kahel_amount required' });

    const kahelCents = Math.round(parseFloat(kahel_amount) * 100);
    if (kahelCents <= 0) return res.status(400).json({ error: 'invalid_amount' });

    let user = ensureUser(account);
    user = accrueCoinsForUser(user);

    if ((user.kahel_in_game || 0) < kahelCents) return res.status(400).json({ error: 'not_enough_in_game_kahel' });

    const gemsToAdd = Math.floor(kahelCents / 100); // floor to whole gems
    if (gemsToAdd <= 0) return res.status(400).json({ error: 'amount_too_small_to_convert' });

    user.kahel_in_game -= gemsToAdd * 100;
    user.gems = (user.gems || 0) + gemsToAdd;
    updateUserCols.run(user);

    res.json({ ok: true, gems: user.gems, kahel_in_game: kahelFromCents(user.kahel_in_game), converted_gems: gemsToAdd });
  } catch (e) {
    console.error('convert error', e);
    res.status(500).json({ error: e.message });
  }
});

// cashout: send on-chain KAHEL from faucet to user's account
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5, // only 5 cashouts per minute per IP
  standardHeaders: true,
  legacyHeaders: false
});
app.post('/cashout', async (req, res) => {
  try {
    const { account, kahel_amount } = req.body;
    if (!account) return res.status(400).json({ error: 'account required' });
    if (!kahel_amount || isNaN(kahel_amount)) return res.status(400).json({ error: 'kahel_amount required' });

    const kahelCents = Math.round(parseFloat(kahel_amount) * 100);
    if (kahelCents <= 0) return res.status(400).json({ error: 'invalid_amount' });

    let user = ensureUser(account);
    user = accrueCoinsForUser(user);

    if ((user.kahel_in_game || 0) < kahelCents) return res.status(400).json({ error: 'not_enough_in_game_kahel' });

    // optimistic debit
    user.kahel_in_game -= kahelCents;
    updateUserCols.run(user);

    const quantity = (kahelCents / 100).toFixed(2) + ' KAHEL';

    if (!api) {
      // rollback
      user.kahel_in_game += kahelCents;
      updateUserCols.run(user);
      return res.status(500).json({ error: 'onchain_unavailable', message: 'Server not configured for on-chain transfers.' });
    }

    // perform transfer
    const result = await api.transact({
      actions: [{
        account: TOKEN_CONTRACT,
        name: 'transfer',
        authorization: [{ actor: FAUCET_ACCOUNT, permission: 'active' }],
        data: { from: FAUCET_ACCOUNT, to: account, quantity, memo: 'Miner game cashout' }
      }]
    }, { blocksBehind: 3, expireSeconds: 60 });

    const txid = result.transaction_id || (result.processed && result.processed.id) || null;
    insertClaim.run({ account, day: yyyymmdd(), kahel_cents: kahelCents, timestamp: Date.now(), txid });

    res.json({ ok: true, txid, quantity, kahel_in_game: kahelFromCents(user.kahel_in_game) });

  } catch (err) {
    console.error('cashout error full object:', err);
    console.error('cashout error JSON:', err.json || {});
    res.status(500).json({ error: 'internal_error', message: err.message, details: err.json || {} });
  }
});

// admin-ish: view burns and claims for a day (simple)
app.get('/admin/day/:day/burns', (req, res) => {
  try {
    const day = req.params.day || yyyymmdd();
    const rows = db.prepare('SELECT account, SUM(amount) as total FROM burns WHERE day = ? GROUP BY account ORDER BY total DESC').all(day);
    res.json({ day, totals: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/claims/recent', (req, res) => {
  const rows = db.prepare('SELECT id,account,day,kahel_cents,timestamp,txid FROM claims ORDER BY id DESC LIMIT 100').all();
  res.json(rows);
});

app.listen(PORT, () => {
  console.log(`Miner Game server listening on ${PORT}`);
});

