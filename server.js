// server.js — KAHEL <-> Credits converter (local dev ready)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
//const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
const { Api, JsonRpc } = require('eosjs');
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(cors({
    origin: [
        "https://rupdud143backend.github.io",   // your frontend
        "http://localhost:8080"          // local dev
    ],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    credentials: false
}));




// --- Setup ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const rpc = new JsonRpc(process.env.WAX_RPC, { fetch });
const signatureProvider = new JsSignatureProvider([process.env.APP_PRIVATE_KEY]);
const api = new Api({ rpc, signatureProvider });

const PORT = process.env.PORT || 8080;
const APP_WALLET = process.env.APP_WALLET;
const KAHEL_CONTRACT = process.env.KAHEL_CONTRACT;
const RATE = Number(process.env.CONVERSION_RATE) || 100;

// --- Helper: get or create player record ---
async function getPlayer(wallet) {
  const { data } = await supabase.from('players').select('*').eq('wallet', wallet).single();
  if (data) return data;

  const { data: inserted } = await supabase
    .from('players')
    .insert({ wallet, credits: 0 })
    .select()
    .single();
  return inserted;
}

// --- Start Game ---
app.post('/game/start', async (req, res) => {
  const { wallet, bet_amount, bombCount } = req.body;
  if (!wallet || !bet_amount || !bombCount)
    return res.status(400).json({ error: 'Missing parameters' });

  const bet = Number(bet_amount);
  const bombs = Number(bombCount);

  if (!Number.isFinite(bet) || bet <= 0)
    return res.status(400).json({ error: 'Invalid bet amount' });
  if (!Number.isInteger(bombs) || bombs < 1 || bombs > 24)
    return res.status(400).json({ error: 'Invalid bomb count' });

  try {
    const { data: player } = await supabase.from('players').select('*').eq('wallet', wallet).single();
    if (!player) return res.status(404).json({ error: 'Player not found' });
    if (player.credits < bet) return res.status(400).json({ error: 'Not enough credits' });

    // Deduct bet
    await supabase.from('players').update({ credits: player.credits - bet }).eq('wallet', wallet);

    // Generate mine positions
    const mine_positions = [];
    while (mine_positions.length < bombs) {
      const r = Math.floor(Math.random() * 25);
      if (!mine_positions.includes(r)) mine_positions.push(r);
    }

    const gameId = crypto.randomUUID();
    await supabase.from('games').insert({
      game_id: gameId,
      wallet,
      bet,
      mine_positions,
      revealed: [],
      safe_clicks: 0,
      multiplier: 1,
      status: 'active'
    });

    res.json({ gameId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to start game', details: err.message });
  }
});

// --- Click a Tile ---
app.post('/game/click', async (req, res) => {
  const { gameId, tileIndex, wallet } = req.body;
  if (!gameId || tileIndex == null || !wallet)
    return res.status(400).json({ error: 'Missing parameters' });

  const index = Number(tileIndex);
  if (!Number.isInteger(index) || index < 0 || index >= 25)
    return res.status(400).json({ error: 'Invalid tileIndex' });

  try {
    const { data: game } = await supabase.from('games').select('*').eq('game_id', gameId).single();
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (game.wallet !== wallet) return res.status(403).json({ error: 'Not your game' });
    if (game.status !== 'active') return res.status(400).json({ error: 'Game is not active' });

    const revealed = new Set(game.revealed || []);
    if (revealed.has(index)) return res.status(400).json({ error: 'Tile already revealed' });

    const minePositions = game.mine_positions;
    const bombs = minePositions.length;
    const totalTiles = 25;

    // --- IF PLAYER HIT A MINE ---
    if (minePositions.includes(index)) {
      revealed.add(index);

      await supabase.from('games').update({
        revealed: Array.from(revealed),
        status: 'lost'
      }).eq('game_id', gameId);

      return res.json({
        result: 'mine',
        gameOver: true,
        multiplier: Number(game.multiplier),
        mine_positions: minePositions
      });
    }

    // --- SAFE TILE ---
    revealed.add(index);
    const safeClicks = game.safe_clicks + 1;

    // ===== CORRECT MULTIPLIER FORMULA =====
    // Survivor chance for each click:
    // payout *= remainingTiles / remainingSafe
    //
    let fairPayout = 1;
    const safeTiles = totalTiles - bombs;

    for (let i = 0; i < safeClicks; i++) {
      const remainingTiles = totalTiles - i;
      const remainingSafe = safeTiles - i;

      fairPayout *= remainingTiles / remainingSafe; // Always safe, never 0
    }

    // Cap insane values from overflow
    if (!Number.isFinite(fairPayout) || fairPayout > 1e12) {
      fairPayout = 1e12;
    }

    const houseEdge = 0.035;
    const finalMultiplier = Number((fairPayout * (1 - houseEdge)).toFixed(2));

    // NEVER allow 0 multiplier
    const multiplier = Math.max(finalMultiplier, 1.01);

    await supabase.from('games').update({
      revealed: Array.from(revealed),
      safe_clicks: safeClicks,
      multiplier,
      status: 'active'
    }).eq('game_id', gameId);

    return res.json({
      result: 'safe',
      multiplier,
      gameOver: false
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Click failed', details: err.message });
  }
});

// --- Cash Out ---
app.post('/game/cashout', async (req, res) => {
  const { gameId, wallet } = req.body;
  if (!gameId || !wallet) return res.status(400).json({ error: 'Missing parameters' });

  try {
    // Atomic update: only update if game is active
    const { data: updated } = await supabase
      .from('games')
      .update({ status: 'cashedOut' })
      .match({ game_id: gameId, wallet, status: 'active' })
      .select();

    if (!updated || updated.length === 0)
      return res.status(400).json({ error: 'Game not active or not yours' });

    const game = updated[0];
    const winnings = Number(game.bet) * Number(game.multiplier);

    // Credit player
    const { data: player } = await supabase.from('players').select('*').eq('wallet', wallet).single();
    await supabase.from('players').update({ credits: player.credits + winnings }).eq('wallet', wallet);

    res.json({ wallet, winnings, totalCredits: player.credits + winnings });
  } catch (err) {
    res.status(500).json({ error: 'Cash out failed', details: err.message });
  }
});

// --- Get Credits ---
app.get('/credits/:wallet', async (req, res) => {
  try {
    const wallet = req.params.wallet;
    const player = await getPlayer(wallet);
    res.json({ wallet, credits: player.credits });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch credits', details: err.message });
  }
});

// --- Deposit (pending verification) ---
app.post('/convert/deposit', async (req, res) => {
  const { wallet, kahel_amount, txid } = req.body;
  if (!wallet || !kahel_amount || !txid)
    return res.status(400).json({ error: 'Missing wallet, amount, or txid' });

  try {
    const { data: player } = await supabase.from('players').select('*').eq('wallet', wallet).single();
    if (!player) return res.status(404).json({ error: 'Player not found' });

    const sentAmount = Number(kahel_amount);
    if (!Number.isFinite(sentAmount) || sentAmount <= 0)
      return res.status(400).json({ error: 'Invalid deposit amount' });

    const creditsToAdd = Number(sentAmount * RATE);
    const newCredits = Number(player.credits) + creditsToAdd;

    // Update player credits immediately
    await supabase.from('players').update({ credits: newCredits }).eq('wallet', wallet);

    // Record pending deposit (optional)
    await supabase.from('pending_deposits').insert({
      wallet,
      txid,
      kahel_amount: sentAmount,
      credited: true,
      verified: false
    });

    res.json({
      message: 'Deposit credited instantly (awaiting chain verify)',
      wallet,
      added_credits: creditsToAdd,
      total_credits: newCredits,
      txid
    });
  } catch (err) {
    res.status(500).json({ error: 'Deposit failed', details: err.message });
  }
});


// --- Withdraw ---
app.post('/convert/withdraw', async (req, res) => {
  const { wallet, credits_to_use } = req.body;
  if (!wallet || !credits_to_use) return res.status(400).json({ error: 'Missing wallet or credits' });

  const credits = Number(credits_to_use);
  if (!Number.isFinite(credits) || credits <= 0)
    return res.status(400).json({ error: 'Invalid credits_to_use' });

  const kahel_amount = (credits / RATE).toFixed(2);

  try {
    const { data: player } = await supabase.from('players').select('*').eq('wallet', wallet).single();
    if (!player) return res.status(404).json({ error: 'Player not found' });
    if (player.credits < credits) return res.status(400).json({ error: 'Not enough credits' });

    // Deduct credits
    await supabase.from('players').update({ credits: player.credits - credits }).eq('wallet', wallet);

    // Try sending KAHEL
    try {
      const result = await api.transact({
        actions: [{
          account: KAHEL_CONTRACT,
          name: 'transfer',
          authorization: [{ actor: APP_WALLET, permission: 'active' }],
          data: { from: APP_WALLET, to: wallet, quantity: `${kahel_amount} KAHEL`, memo: 'In-game withdrawal' }
        }]
      }, { blocksBehind: 3, expireSeconds: 30 });

      res.json({ message: 'Withdrawal successful', wallet, credits_spent: credits, kahel_sent: `${kahel_amount} KAHEL`, txid: result.transaction_id });
    } catch (chainError) {
      // Refund credits if on-chain transfer fails
      await supabase.from('players').update({ credits: player.credits }).eq('wallet', wallet);
      res.status(500).json({ error: 'KAHEL transfer failed; credits refunded', details: chainError.message });
    }
  } catch (err) {
    res.status(500).json({ error: 'Withdraw failed', details: err.message });
  }
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});



