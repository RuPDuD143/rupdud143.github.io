// server.js (NFT-ready backend for Render)
// Requirements: npm install express better-sqlite3 cors dotenv node-fetch eosjs express-rate-limit
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const fetch = require('node-fetch');
const rateLimit = require('express-rate-limit');
const { Api, JsonRpc } = require('eosjs');
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig');
const { TextEncoder, TextDecoder } = require('util');

const PORT = process.env.PORT || 3000;

// 🌐 CORS — allow your frontend domains
const FRONTEND_ORIGINS = [
  'https://rupdud143.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

// 🔑 Faucet / RPC setup (optional)
const FAUCET_ACCOUNT = process.env.FAUCET_ACCOUNT;
const FAUCET_PRIVKEY = process.env.FAUCET_PRIVKEY;
const TOKEN_CONTRACT = process.env.TOKEN_CONTRACT || 'rupdud143143';
const RPC_ENDPOINT = process.env.RPC_ENDPOINT || 'https://wax.greymass.com';

const signatureProvider = FAUCET_PRIVKEY ? new JsSignatureProvider([FAUCET_PRIVKEY]) : null;
const rpc = new JsonRpc(RPC_ENDPOINT, { fetch });
const api = signatureProvider
  ? new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() })
  : null;

const app = express();
app.use(express.json());
app.use(cors({
  origin: [
    'https://rupdud143.github.io',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));




// 🛡️ Optional rate limit: max 20 NFT calls per minute per IP
app.use('/get-nfts', rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Rate limit exceeded. Try again in a minute.' }
}));

// ✅ More reliable AtomicAssets mirrors
const ATOMIC_ENDPOINTS = [
  'https://aa.dapplica.io/atomicassets/v1/assets',
  'https://atomic.wax.eosrio.io/atomicassets/v1/assets',
  'https://wax-aa.eu.eosamsterdam.net/atomicassets/v1/assets'
];

// Helper to try multiple mirrors until one works
async function fetchAtomicAssets(urlPath) {
  for (const base of ATOMIC_ENDPOINTS) {
    const fullUrl = `${base}${urlPath}`;
    try {
      const res = await fetch(fullUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://wax.atomichub.io/'
        }
      });

      const text = await res.text();
      try {
        const json = JSON.parse(text);
        return json; // ✅ success
      } catch {
        console.warn(`⚠️ Non-JSON from ${base}:`, text.slice(0, 120));
        continue; // try next mirror
      }
    } catch (e) {
      console.warn(`❌ Failed ${base}:`, e.message);
    }
  }
  throw new Error('All AtomicAssets mirrors failed');
}

// 🎨 NFT fetch endpoint
app.post('/get-nfts', async (req, res) => {
  try {
    const { account } = req.body;
    if (!account) return res.status(400).json({ error: 'Missing account' });

    const path = `?owner=${account}&collection_name=brostreasure&schema_name=materials&limit=100`;
    const data = await fetchAtomicAssets(path);

    if (!data || !data.data)
      return res.status(502).json({ error: 'Invalid response from AtomicAssets API' });

    res.json({
      account,
      total: data.data.length,
      nfts: data.data.map(nft => ({
        name: nft.name,
        template_id: nft.template?.template_id,
        img: nft.data?.img,
      }))
    });
  } catch (err) {
    console.error('Error fetching NFTs:', err);
    res.status(500).json({ error: 'Failed to fetch NFTs' });
  }
});

app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));



