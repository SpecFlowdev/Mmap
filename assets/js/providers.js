/*
 * Провайдеры блокчейн-данных.
 * Каждый провайдер возвращает единый формат перевода:
 * { hash, ts, from, to, direction: 'in'|'out'|'self', amount, symbol, chain, kind, explorer }
 */

const EVM_CHAINS = {
  ethereum:  { id: 1,     name: 'Ethereum',  symbol: 'ETH',   explorer: 'https://etherscan.io' },
  bsc:       { id: 56,    name: 'BNB Chain', symbol: 'BNB',   explorer: 'https://bscscan.com' },
  polygon:   { id: 137,   name: 'Polygon',   symbol: 'POL',   explorer: 'https://polygonscan.com' },
  arbitrum:  { id: 42161, name: 'Arbitrum',  symbol: 'ETH',   explorer: 'https://arbiscan.io' },
  optimism:  { id: 10,    name: 'Optimism',  symbol: 'ETH',   explorer: 'https://optimistic.etherscan.io' },
  base:      { id: 8453,  name: 'Base',      symbol: 'ETH',   explorer: 'https://basescan.org' },
  avalanche: { id: 43114, name: 'Avalanche', symbol: 'AVAX',  explorer: 'https://snowscan.xyz' }
};

const CHAINS = {
  ...Object.fromEntries(Object.entries(EVM_CHAINS).map(([k, v]) => [k, { ...v, kind: 'evm' }])),
  bitcoin:  { name: 'Bitcoin',  symbol: 'BTC',  kind: 'btc',    explorer: 'https://mempool.space' },
  litecoin: { name: 'Litecoin', symbol: 'LTC',  kind: 'chair',  chair: 'litecoin', explorer: 'https://blockchair.com/litecoin' },
  dogecoin: { name: 'Dogecoin', symbol: 'DOGE', kind: 'chair',  chair: 'dogecoin', explorer: 'https://blockchair.com/dogecoin' },
  tron:     { name: 'Tron',     symbol: 'TRX',  kind: 'tron',   explorer: 'https://tronscan.org/#' },
  solana:   { name: 'Solana',   symbol: 'SOL',  kind: 'solana', explorer: 'https://solscan.io' }
};

/** Пытается определить сеть по формату адреса. Возвращает список кандидатов. */
function detectChains(addr) {
  const a = (addr || '').trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(a)) return Object.keys(EVM_CHAINS);
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a)) return ['tron'];
  if (/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(a)) return ['bitcoin'];
  if (/^(ltc1|[LM3])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(a)) return ['litecoin'];
  if (/^D[5-9A-HJ-NP-U][1-9A-HJ-NP-Za-km-z]{32}$/.test(a)) return ['dogecoin'];
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return ['solana'];
  return [];
}

function txUrl(chainKey, hash) {
  const c = CHAINS[chainKey];
  if (!c) return '#';
  if (c.kind === 'tron') return `${c.explorer}/transaction/${hash}`;
  if (c.kind === 'solana') return `${c.explorer}/tx/${hash}`;
  if (c.kind === 'btc') return `${c.explorer}/tx/${hash}`;
  if (c.kind === 'chair') return `${c.explorer}/transaction/${hash}`;
  return `${c.explorer}/tx/${hash}`;
}

function addrUrl(chainKey, addr) {
  const c = CHAINS[chainKey];
  if (!c) return '#';
  if (c.kind === 'tron') return `${c.explorer}/address/${addr}`;
  if (c.kind === 'solana') return `${c.explorer}/account/${addr}`;
  return `${c.explorer}/address/${addr}`;
}

function direction(self, from, to) {
  const s = (self || '').toLowerCase();
  const f = (from || '').toLowerCase();
  const tt = (to || '').toLowerCase();
  if (f === s && tt === s) return 'self';
  return f === s ? 'out' : 'in';
}

/* ------------------------------------------------------------------ EVM */
async function fetchEvm(chainKey, address, { limit, tokens, keys }) {
  const chain = EVM_CHAINS[chainKey];
  const key = (keys.etherscan || '').trim();
  if (!key) throw new Error(t('msg.needkey'));

  const base = 'https://api.etherscan.io/v2/api';
  const call = async action => {
    const url = `${base}?chainid=${chain.id}&module=account&action=${action}` +
      `&address=${address}&startblock=0&endblock=99999999&page=1&offset=${limit}` +
      `&sort=desc&apikey=${encodeURIComponent(key)}`;
    const data = await fetchJson(url);
    if (data.status === '0' && !Array.isArray(data.result)) {
      if (/no transactions|not found/i.test(data.message || data.result || '')) return [];
      throw new Error(data.result || data.message || 'Etherscan error');
    }
    return Array.isArray(data.result) ? data.result : [];
  };

  const jobs = [call('txlist')];
  if (tokens) jobs.push(call('tokentx'));
  const [native, erc20 = []] = await Promise.all(jobs);

  const out = [];
  for (const tx of native) {
    if (tx.value === '0') continue;
    out.push({
      hash: tx.hash, ts: Number(tx.timeStamp), from: tx.from, to: tx.to || '',
      direction: direction(address, tx.from, tx.to), chain: chainKey, kind: 'native',
      symbol: chain.symbol, amount: scaleUnits(tx.value, 18),
      failed: tx.isError === '1'
    });
  }
  for (const tx of erc20) {
    out.push({
      hash: tx.hash, ts: Number(tx.timeStamp), from: tx.from, to: tx.to || '',
      direction: direction(address, tx.from, tx.to), chain: chainKey, kind: 'token',
      symbol: (tx.tokenSymbol || '???').toUpperCase(),
      amount: scaleUnits(tx.value, tx.tokenDecimal),
      contract: tx.contractAddress
    });
  }
  return out;
}

/* -------------------------------------------------------------- Bitcoin */
async function fetchBitcoin(address, { limit }) {
  const txs = [];
  let lastSeen = '';
  while (txs.length < limit) {
    const url = `https://mempool.space/api/address/${address}/txs` + (lastSeen ? `/chain/${lastSeen}` : '');
    const page = await fetchJson(url);
    if (!Array.isArray(page) || !page.length) break;
    txs.push(...page);
    lastSeen = page[page.length - 1].txid;
    if (page.length < 25) break;
  }
  return txs.slice(0, limit).flatMap(tx => utxoToTransfers(tx, address, 'bitcoin', 'BTC'));
}

/* --------------------------------------------- Litecoin / Dogecoin (UTXO) */
async function fetchBlockchair(chainKey, address, { limit }) {
  const chain = CHAINS[chainKey];
  const url = `https://api.blockchair.com/${chain.chair}/dashboards/address/${address}` +
    `?transaction_details=true&limit=${Math.min(limit, 100)}`;
  const data = await fetchJson(url);
  const info = data?.data?.[address];
  const list = info?.transactions || [];
  return list.map(tx => ({
    hash: tx.hash,
    ts: Math.floor(new Date((tx.time || '').replace(' ', 'T') + 'Z').getTime() / 1000) || 0,
    from: tx.balance_change < 0 ? address : '',
    to: tx.balance_change < 0 ? '' : address,
    direction: tx.balance_change < 0 ? 'out' : 'in',
    chain: chainKey, kind: 'native', symbol: chain.symbol,
    amount: Math.abs(tx.balance_change) / 1e8,
    aggregated: true
  }));
}

/** Разворачивает UTXO-транзакцию в переводы «адрес → контрагент». */
function utxoToTransfers(tx, address, chainKey, symbol) {
  const ts = tx.status?.block_time || tx.block_time || 0;
  const addrOf = v => v?.scriptpubkey_address || v?.prevout?.scriptpubkey_address || '';
  const inputs = (tx.vin || []).map(v => ({ addr: addrOf(v), value: v?.prevout?.value || 0 }));
  const outputs = (tx.vout || []).map(v => ({ addr: addrOf(v), value: v?.value || 0 }));

  const spent = inputs.filter(i => i.addr === address).reduce((s, i) => s + i.value, 0);
  const isOut = spent > 0;
  const rows = [];

  if (isOut) {
    for (const o of outputs) {
      if (!o.addr || o.addr === address) continue; // сдача возвращается себе
      rows.push({
        hash: tx.txid, ts, from: address, to: o.addr, direction: 'out',
        chain: chainKey, kind: 'native', symbol, amount: o.value / 1e8
      });
    }
  } else {
    const received = outputs.filter(o => o.addr === address).reduce((s, o) => s + o.value, 0);
    const senders = [...new Set(inputs.map(i => i.addr).filter(Boolean))];
    rows.push({
      hash: tx.txid, ts, from: senders[0] || '', to: address, direction: 'in',
      chain: chainKey, kind: 'native', symbol, amount: received / 1e8,
      extraSenders: senders.length > 1 ? senders.length - 1 : 0
    });
  }
  return rows.filter(r => r.amount > 0);
}

/* ----------------------------------------------------------------- Tron */
async function fetchTron(address, { limit, tokens, keys }) {
  const headers = keys.trongrid ? { 'TRON-PRO-API-KEY': keys.trongrid } : {};
  const cap = Math.min(limit, 200);
  const out = [];

  const native = await fetchJson(
    `https://api.trongrid.io/v1/accounts/${address}/transactions?limit=${cap}&order_by=block_timestamp,desc`,
    { headers });
  for (const tx of native.data || []) {
    const c = tx.raw_data?.contract?.[0];
    if (c?.type !== 'TransferContract') continue;
    const v = c.parameter?.value || {};
    const from = hexToTron(v.owner_address), to = hexToTron(v.to_address);
    out.push({
      hash: tx.txID, ts: Math.floor((tx.block_timestamp || 0) / 1000),
      from, to, direction: direction(address, from, to),
      chain: 'tron', kind: 'native', symbol: 'TRX', amount: (v.amount || 0) / 1e6,
      failed: tx.ret?.[0]?.contractRet && tx.ret[0].contractRet !== 'SUCCESS'
    });
  }

  if (tokens) {
    const trc20 = await fetchJson(
      `https://api.trongrid.io/v1/accounts/${address}/transactions/trc20?limit=${cap}&order_by=block_timestamp,desc`,
      { headers });
    for (const tx of trc20.data || []) {
      out.push({
        hash: tx.transaction_id, ts: Math.floor((tx.block_timestamp || 0) / 1000),
        from: tx.from, to: tx.to, direction: direction(address, tx.from, tx.to),
        chain: 'tron', kind: 'token',
        symbol: (tx.token_info?.symbol || '???').toUpperCase(),
        amount: scaleUnits(tx.value, tx.token_info?.decimals ?? 6),
        contract: tx.token_info?.address
      });
    }
  }
  return out;
}

/** hex41… → base58 Tron-адрес */
function hexToTron(hex) {
  if (!hex) return '';
  if (!/^41[0-9a-fA-F]{40}$/.test(hex)) return hex;
  const bytes = hex.match(/../g).map(h => parseInt(h, 16));
  const checksum = sha256d(bytes).slice(0, 4);
  return base58(bytes.concat(checksum));
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes) {
  let digits = [0];
  for (const b of bytes) {
    let carry = b;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let out = '';
  for (const b of bytes) { if (b === 0) out += '1'; else break; }
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}

/* Минимальный синхронный SHA-256 (нужен только для контрольной суммы Tron-адреса). */
function sha256d(bytes) { return sha256(sha256(bytes)); }
function sha256(bytes) {
  const K = sha256.K || (sha256.K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
  const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const msg = bytes.slice();
  const bitLen = msg.length * 8;
  msg.push(0x80);
  while (msg.length % 64 !== 56) msg.push(0);
  for (let i = 7; i >= 0; i--) msg.push((bitLen / Math.pow(2, i * 8)) & 0xff);

  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  const w = new Array(64);
  for (let off = 0; off < msg.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = (msg[off+i*4] << 24) | (msg[off+i*4+1] << 16) | (msg[off+i*4+2] << 8) | msg[off+i*4+3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i-15],7) ^ rotr(w[i-15],18) ^ (w[i-15] >>> 3);
      const s1 = rotr(w[i-2],17) ^ rotr(w[i-2],19) ^ (w[i-2] >>> 10);
      w[i] = (w[i-16] + s0 + w[i-7] + s1) | 0;
    }
    let [a,b,c,d,e,f,g,h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    [a,b,c,d,e,f,g,h].forEach((v, i) => { H[i] = (H[i] + v) | 0; });
  }
  const out = [];
  for (const v of H) out.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
  return out;
}

/* --------------------------------------------------------------- Solana */
async function fetchSolana(address, { limit, keys }) {
  const rpc = (keys.solana || 'https://api.mainnet-beta.solana.com').trim();
  const post = (method, params) => fetchJson(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });

  const sigsRes = await post('getSignaturesForAddress', [address, { limit: Math.min(limit, 100) }]);
  const sigs = (sigsRes.result || []).filter(s => !s.err).map(s => s.signature);
  const out = [];

  for (let i = 0; i < sigs.length; i += 5) {
    const batch = sigs.slice(i, i + 5);
    const results = await Promise.all(batch.map(sig =>
      post('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }])
        .catch(() => null)));
    for (const r of results) {
      const tx = r?.result;
      if (!tx) continue;
      out.push(...solanaTransfers(tx, address));
    }
    if (i + 5 < sigs.length) await sleep(120);
  }
  return out;
}

function solanaTransfers(tx, address) {
  const ts = tx.blockTime || 0;
  const sig = tx.transaction?.signatures?.[0] || '';
  const rows = [];
  const walk = instrs => {
    for (const ix of instrs || []) {
      const p = ix.parsed;
      if (!p) continue;
      if (p.type === 'transfer' && ix.program === 'system') {
        const { source, destination, lamports } = p.info || {};
        if (!source || !destination) continue;
        rows.push({
          hash: sig, ts, from: source, to: destination,
          direction: direction(address, source, destination),
          chain: 'solana', kind: 'native', symbol: 'SOL', amount: (lamports || 0) / 1e9
        });
      } else if ((p.type === 'transfer' || p.type === 'transferChecked') && ix.program === 'spl-token') {
        const info = p.info || {};
        const amt = info.tokenAmount
          ? Number(info.tokenAmount.uiAmount)
          : scaleUnits(info.amount, 0);
        rows.push({
          hash: sig, ts, from: info.authority || info.source || '', to: info.destination || '',
          direction: (info.authority || info.source) === address ? 'out' : 'in',
          chain: 'solana', kind: 'token',
          symbol: info.mint ? 'SPL:' + info.mint.slice(0, 4) : 'SPL', amount: amt || 0,
          contract: info.mint
        });
      }
    }
  };
  walk(tx.transaction?.message?.instructions);
  (tx.meta?.innerInstructions || []).forEach(g => walk(g.instructions));
  return rows.filter(r => r.amount > 0);
}

/* ------------------------------------------------------------ диспетчер */
async function fetchTransfers(chainKey, address, opts) {
  const chain = CHAINS[chainKey];
  if (!chain) throw new Error('unknown chain: ' + chainKey);
  switch (chain.kind) {
    case 'evm': return fetchEvm(chainKey, address, opts);
    case 'btc': return fetchBitcoin(address, opts);
    case 'chair': return fetchBlockchair(chainKey, address, opts);
    case 'tron': return fetchTron(address, opts);
    case 'solana': return fetchSolana(address, opts);
    default: throw new Error('unsupported chain kind');
  }
}
