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

// server.js (continuation)
const ATOMIC_API = 'https://wax.api.atomicassets.io/atomicassets/v1/assets';

// --- Example POST route ---
// Body should contain { account: "mycloudwallet" }
app.post('/get-nfts', async (req, res) => {
  try {
    const { account } = req.body;
    if (!account) return res.status(400).json({ error: 'Missing account' });

    const url = `${ATOMIC_API}?owner=${account}&collection_name=riskyblocks1&limit=100`;
    const response = await fetch(url);
    const data = await response.json();

    // Print to console for testing
    console.log(`NFTs for ${account}:`, JSON.stringify(data.data, null, 2));

    res.json(data);
  } catch (err) {
    console.error('Error fetching NFTs:', err);
    res.status(500).json({ error: 'Failed to fetch NFTs' });
  }
});

// optional simple test route
app.get('/', (req, res) => {
  res.send('Miner Backend is running');
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));













