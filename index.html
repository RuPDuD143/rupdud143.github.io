<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>MyCloudWallet NFT Gallery — Debug (List & Merge View)</title>
  <script src="./waxjs.js"></script>
  <style>
    body {
      font-family: "Segoe UI", sans-serif;
      background: #0b0b0b;
      color: #fff;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    header {
      background: #111;
      padding: 20px;
      border-bottom: 2px solid #ff9900;
      flex-shrink: 0;
      text-align: center;
    }

    h1 {
      margin: 0;
      font-size: 1.8rem;
      color: #ff9900;
    }

    button {
      background: #ff9900;
      border: none;
      border-radius: 8px;
      padding: 10px 20px;
      font-size: 1rem;
      cursor: pointer;
      color: #000;
      font-weight: bold;
      margin-top: 15px;
      transition: background 0.2s;
    }

    button:hover {
      background: #ffaa33;
    }

    main {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    #leftPanel {
      flex: 1;
      padding: 20px;
      overflow-y: auto;
    }

    #output {
      white-space: pre-wrap;
      color: #bbb;
      font-size: 0.9rem;
      margin-bottom: 20px;
    }

    #gallery {
      width: 25%;
      height: 100%;
      overflow-y: auto;
      background: #111;
      border-left: 2px solid #ff9900;
      display: flex;
      flex-direction: column;
    }

    .nft-row {
      display: flex;
      align-items: center;
      padding: 8px;
      border-bottom: 1px solid #222;
      min-height: 80px;
      transition: background 0.2s;
    }

    .nft-row:hover {
      background: #1a1a1a;
    }

    .nft-row img {
      width: 64px;
      height: 64px;
      object-fit: cover;
      border-radius: 8px;
      margin-right: 12px;
      border: 1px solid #333;
    }

    .nft-row span {
      font-size: 0.95rem;
      color: #fff;
      flex: 1;
      text-align: left;
    }

    /* Merge section styling */
    #mergeSection {
      margin-top: 30px;
    }
    #mergeSection h2 {
      color: #ff9900;
      font-size: 1.3rem;
      margin-bottom: 10px;
    }
    .blend-card {
      background: #181818;
      border-radius: 12px;
      box-shadow: 0 0 8px rgba(255, 153, 0, 0.2);
      padding: 12px;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
    }
    .blend-card img {
      width: 64px;
      height: 64px;
      margin-right: 12px;
      object-fit: cover;
      border-radius: 8px;
      border: 1px solid #333;
    }
    .blend-card .details {
      flex: 1;
      color: #ccc;
    }
    .blend-card button {
      background: #ff9900;
      border: none;
      padding: 6px 12px;
      border-radius: 6px;
      color: #000;
      font-weight: bold;
      cursor: pointer;
      transition: background 0.2s;
    }
    .blend-card button:hover {
      background: #ffaa33;
    }
  </style>
</head>
<body>
  <header>
    <h1>MyCloudWallet NFT Gallery (List & Merge View)</h1>
    <button id="loginBtn">Login with MyCloudWallet</button>
  </header>

  <main>
    <div id="leftPanel">
      <div id="output"></div>
      <div id="mergeSection">
        <h2>Available Blends (brostreasure)</h2>
        <div id="blendList"></div>
      </div>
    </div>
    <div id="gallery"></div>
  </main>

  <script>
    const backendURL = 'https://rupdud143backend.onrender.com/get-nfts';
    const wax = new waxjs.WaxJS({ rpcEndpoint: 'https://wax.greymass.com' });

    function resolveIpfsUrl(ipfsPath) {
      if (!ipfsPath) return '';
      if (ipfsPath.startsWith('http')) return ipfsPath;
      if (ipfsPath.startsWith('ipfs://')) {
        return ipfsPath.replace('ipfs://', 'https://ipfs.neftyblocks.io/ipfs/');
      }
      return `https://ipfs.neftyblocks.io/ipfs/${ipfsPath}`;
    }

    async function getNFTs(account) {
      try {
        const res = await fetch(backendURL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account })
        });
        const data = await res.json();
    
        if (data.error) {
          document.getElementById('output').textContent = `Error: ${data.error}`;
          return;
        }
    
        document.getElementById('output').textContent =
          `Account: ${data.account} | Total NFTs: ${data.total}`;
    
        const gallery = document.getElementById('gallery');
        gallery.innerHTML = '';
    
        if (!data.nfts || data.nfts.length === 0) {
          gallery.innerHTML = '<p style="padding:10px;">No NFTs found for this collection.</p>';
        } else {
          for (const nft of data.nfts) {
            const imgHash =
              nft.img ||
              nft.image ||
              nft.data?.img ||
              nft.data?.image ||
              nft.data?.image_url ||
              nft.immutable_data?.img ||
              nft.immutable_data?.image ||
              nft.template?.immutable_data?.img ||
              nft.template?.immutable_data?.image;

            const imgUrl = resolveIpfsUrl(imgHash);

            const row = document.createElement('div');
            row.className = 'nft-row';
            row.innerHTML = `
              <img src="${imgUrl}" alt="${nft.name || 'NFT'}" onerror="this.src='https://via.placeholder.com/64x64?text=No+Image'; this.onerror=null;">
              <span>${nft.name || 'Untitled NFT'}</span>
            `;
            gallery.appendChild(row);
          }
        }

        // After listing NFTs, fetch blends
        await getBlends(account);

      } catch (err) {
        console.error('❌ Error fetching NFTs:', err);
        document.getElementById('output').textContent = 'Failed to fetch NFTs.';
      }
    }

    async function getBlends(account) {
      try {
        // Example URL: replace with real NeftyBlocks API endpoint for blends.
        const blendsURL = `https://neftyblocks.com/collection/brostreasure/blends`; 
        const res = await fetch(blendsURL);
        const data = await res.json();

        const blendListDiv = document.getElementById('blendList');
        blendListDiv.innerHTML = '';

        if (!data.blends || data.blends.length === 0) {
          blendListDiv.innerHTML = '<p style="padding:10px;">No blends available currently.</p>';
          return;
        }

        for (const blend of data.blends) {
          const imgUrl = resolveIpfsUrl(blend.image_url || blend.img);

          const card = document.createElement('div');
          card.className = 'blend-card';
          card.innerHTML = `
            <img src="${imgUrl}" alt="${blend.name}">
            <div class="details">
              <div><strong>${blend.name}</strong></div>
              <div>Requires: ${blend.requirements.join(', ')}</div>
            </div>
            <button data-blend-id="${blend.id}">Merge</button>
          `;
          card.querySelector('button').onclick = async () => {
            await executeBlend(account, blend.id);
          };
          blendListDiv.appendChild(card);
        }

      } catch (err) {
        console.error('❌ Error fetching blends:', err);
        const blendListDiv = document.getElementById('blendList');
        blendListDiv.textContent = 'Failed to fetch blends.';
      }
    }

    async function executeBlend(account, blendId) {
      try {
        // Example action: call the smart contract to execute the blend
        // Update with the actual contract, action, and params
        const contract = 'neftyblend';            // <-- replace
        const action = 'mixblend';                // <-- replace
        const params = {
          account: account,
          blend_id: blendId
        };

        const result = await wax.api.transact({
          actions: [{
            account: contract,
            name: action,
            authorization: [{
              actor: account,
              permission: 'active'
            }],
            data: params
          }]
        }, {
          blocksBehind: 3,
          expireSeconds: 30
        });

        console.log('✅ Blend executed:', result);
        alert('Blend executed successfully!');
        // Optionally refresh NFT list
        await getNFTs(account);

      } catch (err) {
        console.error('❌ Blend execution failed:', err);
        alert('Blend failed: ' + err.message);
      }
    }

    document.getElementById('loginBtn').onclick = async () => {
      try {
        const userAccount = await wax.login();
        document.getElementById('output').textContent =
          `Logged in as: ${userAccount}\nFetching NFTs...`;
        await getNFTs(userAccount);
      } catch (err) {
        document.getElementById('output').textContent = 'Login failed.';
      }
    };
  </script>
</body>
</html>
