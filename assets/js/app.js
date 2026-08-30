/* Сборка интерфейса: поиск → загрузка → статистика, граф, таблица, контрагенты. */

const el = id => document.getElementById(id);
const state = {
  address: '',
  chain: '',
  transfers: [],
  prices: {},
  sort: { key: 'ts', dir: -1 },
  filter: '',
  dirFilter: 'all',
  assetFilter: 'all'
};
let graph;

/* ---------------------------------------------------------- тема и язык */
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  store.set('theme', theme);
  document.querySelectorAll('#theme-switch .seg-btn')
    .forEach(b => b.classList.toggle('active', b.dataset.themeSet === theme));
  graph?.draw();
}

function fillChainSelect() {
  const sel = el('chain-select');
  const prev = sel.value;
  sel.innerHTML = `<option value="auto">${t('chain.auto')}</option>` +
    Object.entries(CHAINS).map(([k, c]) => `<option value="${k}">${c.name} (${c.symbol})</option>`).join('');
  sel.value = prev || 'auto';
}


/* --------------------------------------------- сохранённые кошельки */
/*
 * Список отслеживаемых кошельков живёт в localStorage браузера, поэтому
 * переживает перезапуск контейнера. Экспорт/импорт JSON позволяет перенести
 * список на другую машину.
 */
const watchlist = {
  all() {
    try {
      const raw = JSON.parse(store.get('wallets', '[]'));
      return Array.isArray(raw) ? raw.filter(w => w && w.address && w.chain) : [];
    } catch { return []; }
  },
  save(list) { store.set('wallets', JSON.stringify(list.slice(0, 200))); },
  add(chain, address, meta = {}) {
    const list = this.all();
    const i = list.findIndex(w => w.address === address && w.chain === chain);
    const entry = {
      chain, address,
      txs: meta.txs ?? null,
      usd: typeof meta.usd === 'number' ? meta.usd : null,
      seen: Math.floor(Date.now() / 1000)
    };
    if (i >= 0) list[i] = entry; else list.unshift(entry);
    this.save(list);
    return i < 0;
  },
  remove(chain, address) {
    this.save(this.all().filter(w => !(w.address === address && w.chain === chain)));
  }
};

function renderSaved() {
  const list = watchlist.all();
  el('saved-bar').hidden = list.length === 0;
  el('saved-list').innerHTML = list.map(w => {
    const active = w.address === state.address && w.chain === state.chain;
    const sym = CHAINS[w.chain]?.symbol || '?';
    const sub = w.txs !== null ? `${w.txs}×` : '';
    return `<span class="chip${active ? ' active' : ''}" data-chain="${w.chain}" data-addr="${w.address}"
                  title="${w.address}">
      <i class="chip-net">${sym}</i>
      <span class="chip-addr">${shortAddr(w.address, 6, 4)}</span>
      ${sub ? `<i class="chip-sub">${sub}</i>` : ''}
      <button class="chip-x" data-remove="1" title="${t('saved.remove')}">✕</button>
    </span>`;
  }).join('');
}

function exportWallets() {
  download('mmap-wallets.json',
    JSON.stringify({ app: 'mmap', version: 1, wallets: watchlist.all() }, null, 2),
    'application/json');
}

async function importWallets(file) {
  try {
    const data = JSON.parse(await file.text());
    const incoming = Array.isArray(data) ? data : data.wallets;
    if (!Array.isArray(incoming)) throw new Error('bad');
    const list = watchlist.all();
    let added = 0;
    for (const w of incoming) {
      if (!w?.address || !CHAINS[w?.chain]) continue;
      if (list.some(x => x.address === w.address && x.chain === w.chain)) continue;
      list.push({ chain: w.chain, address: w.address, txs: w.txs ?? null, usd: w.usd ?? null, seen: w.seen || 0 });
      added++;
    }
    watchlist.save(list);
    renderSaved();
    status(t('saved.imported', { n: added }));
  } catch {
    status(t('saved.badfile'), true);
  }
}

/* ------------------------------------------------------------- статусы */
function status(msg, isError = false) {
  const s = el('status');
  if (!msg) { s.hidden = true; return; }
  s.hidden = false;
  s.textContent = msg;
  s.classList.toggle('error', isError);
}

/* ------------------------------------------------------------ загрузка */
async function scan() {
  const address = el('address-input').value.trim();
  if (!address) return status(t('msg.noaddress'), true);

  let chain = el('chain-select').value;
  if (chain === 'auto') {
    const candidates = detectChains(address);
    if (!candidates.length) return status(t('msg.unknown'), true);
    chain = candidates[0];
    el('chain-select').value = chain;
    el('detected-hint').textContent = t('detected', { c: CHAINS[chain].name });
  } else {
    el('detected-hint').textContent = '';
  }

  const btn = el('scan-btn');
  btn.disabled = true;
  status(t('msg.loading'));

  try {
    const transfers = await fetchTransfers(chain, address, {
      limit: Number(el('limit-select').value),
      tokens: el('opt-tokens').checked,
      keys: {
        etherscan: store.get('key.etherscan'),
        trongrid: store.get('key.trongrid'),
        solana: store.get('key.solana')
      }
    });

    transfers.sort((a, b) => b.ts - a.ts);
    state.address = address;
    state.chain = chain;
    state.transfers = transfers;
    state.prices = {};

    if (!transfers.length) {
      status(t('msg.empty'), true);
      el('layout').hidden = true;
      el('stats').hidden = true;
      return;
    }

    if (el('opt-usd').checked) {
      status(t('msg.prices'));
      state.prices = await getPrices(transfers.map(x => x.symbol));
    }
    for (const x of transfers) {
      const p = state.prices[x.symbol];
      x.usd = typeof p === 'number' ? x.amount * p : null;
    }

    const net = transfers.reduce((sum, x) =>
      sum + (typeof x.usd === 'number' ? (x.direction === 'out' ? -x.usd : x.usd) : 0), 0);
    watchlist.add(chain, address, { txs: transfers.length, usd: net });
    renderSaved();

    status(t('msg.done', { n: transfers.length }));
    render();
    location.hash = `${chain}:${address}`;
  } catch (e) {
    console.error(e);
    status(t('msg.error', { e: e.message || e }), true);
  } finally {
    btn.disabled = false;
  }
}

/* -------------------------------------------------------- агрегирование */
function peerOf(tx) {
  return (tx.direction === 'out' ? tx.to : tx.from) || '—';
}

function aggregate(transfers) {
  const map = new Map();
  for (const tx of transfers) {
    const addr = peerOf(tx);
    if (!addr || addr === state.address) continue;
    let p = map.get(addr);
    if (!p) { p = { addr, in: 0, out: 0, txs: 0, symbols: new Set(), amounts: {} }; map.set(addr, p); }
    p.txs++;
    p.symbols.add(tx.symbol);
    p.amounts[tx.symbol] = (p.amounts[tx.symbol] || 0) + tx.amount;
    const usd = tx.usd || 0;
    if (tx.direction === 'out') p.out += usd; else p.in += usd;
  }
  return [...map.values()].sort((a, b) => (b.in + b.out) - (a.in + a.out) || b.txs - a.txs);
}

function visibleTransfers(useTextFilter = true) {
  const q = useTextFilter ? state.filter.toLowerCase() : '';
  return state.transfers.filter(tx => {
    if (state.dirFilter !== 'all' && tx.direction !== state.dirFilter) return false;
    if (state.assetFilter !== 'all' && tx.symbol !== state.assetFilter) return false;
    if (!q) return true;
    return (tx.hash + ' ' + tx.from + ' ' + tx.to + ' ' + tx.symbol).toLowerCase().includes(q);
  });
}

/* ----------------------------------------------------------- отрисовка */
function render() {
  el('layout').hidden = false;
  el('stats').hidden = false;
  renderStats();
  renderAssetSelect();
  renderTable();
  renderPeers();
  renderGraph();
}

function renderStats() {
  const txs = state.transfers;
  let inUsd = 0, outUsd = 0, priced = 0;
  for (const x of txs) {
    if (typeof x.usd === 'number') {
      priced++;
      if (x.direction === 'out') outUsd += x.usd; else inUsd += x.usd;
    }
  }
  const peers = aggregate(txs);
  const assets = new Set(txs.map(x => x.symbol));
  el('st-txs').textContent = txs.length;
  el('st-in').textContent = priced ? fmtUsd(inUsd) : '—';
  el('st-out').textContent = priced ? fmtUsd(outUsd) : '—';
  el('st-net').textContent = priced ? fmtUsd(inUsd - outUsd) : '—';
  el('st-net').className = 'stat-value ' + (inUsd - outUsd >= 0 ? 'pos' : 'neg');
  el('st-peers').textContent = peers.length;
  el('st-assets').textContent = assets.size;
}

function renderAssetSelect() {
  const sel = el('graph-asset');
  const assets = [...new Set(state.transfers.map(x => x.symbol))].sort();
  sel.innerHTML = `<option value="all">${t('graph.all')}</option>` +
    assets.map(a => `<option value="${a}">${a}</option>`).join('');
  sel.value = assets.includes(state.assetFilter) ? state.assetFilter : 'all';
}

function renderTable() {
  const rows = visibleTransfers().slice().sort((a, b) => {
    const k = state.sort.key;
    const av = a[k] ?? -Infinity, bv = b[k] ?? -Infinity;
    return (av > bv ? 1 : av < bv ? -1 : 0) * state.sort.dir;
  });

  const body = el('tx-body');
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="6" class="empty">${t('nothing')}</td></tr>`;
    el('table-count').textContent = '';
    return;
  }

  body.innerHTML = rows.slice(0, 800).map(tx => {
    const peer = peerOf(tx);
    const sign = tx.direction === 'out' ? '−' : '+';
    return `<tr>
      <td class="mono">${fmtDate(tx.ts)}</td>
      <td><span class="tag ${tx.direction === 'out' ? 'out' : 'in'}">${t('dir.' + (tx.direction === 'out' ? 'out' : 'in'))}</span></td>
      <td><a class="mono" href="${addrUrl(tx.chain, peer)}" target="_blank" rel="noopener"
             title="${peer}">${shortAddr(peer, 8, 6)}</a></td>
      <td class="amount ${tx.direction === 'out' ? 'out' : 'in'}">${sign}${fmtAmount(tx.amount)} ${tx.symbol}</td>
      <td class="amount">${fmtUsd(tx.usd)}</td>
      <td><a class="mono" href="${txUrl(tx.chain, tx.hash)}" target="_blank" rel="noopener">${shortAddr(tx.hash, 6, 4)}</a></td>
    </tr>`;
  }).join('');

  el('table-count').textContent = t('showing', { n: Math.min(rows.length, 800), t: state.transfers.length });
}

function renderPeers() {
  // список контрагентов не сужается текстовым фильтром — иначе клик по строке схлопывает список
  const peers = aggregate(visibleTransfers(false)).slice(0, 40);
  const max = Math.max(1, ...peers.map(p => p.in + p.out));
  el('peers-list').innerHTML = peers.length ? peers.map(p => {
    const total = p.in + p.out;
    const syms = [...p.symbols].slice(0, 3).join(', ');
    return `<div class="peer" data-addr="${p.addr}">
      <div class="peer-top">
        <span class="peer-addr" title="${p.addr}">${shortAddr(p.addr, 10, 6)}</span>
        <span class="peer-usd">${total ? fmtUsd(total) : p.txs + '×'}</span>
      </div>
      <div class="peer-bar"><i style="width:${Math.max(3, (total / max) * 100)}%"></i></div>
      <div class="peer-meta">${p.txs} ${t('peers.txs')} · ${syms}
        · <span style="color:var(--pos)">${fmtUsd(p.in)}</span>
        / <span style="color:var(--neg)">${fmtUsd(p.out)}</span></div>
    </div>`;
  }).join('') : `<div class="empty">${t('nothing')}</div>`;
}

function renderGraph() {
  graph.setData({ self: state.address, peers: aggregate(visibleTransfers()) });
}

/* -------------------------------------------------------------- события */
function bind() {
  el('scan-btn').addEventListener('click', scan);
  el('address-input').addEventListener('keydown', e => { if (e.key === 'Enter') scan(); });
  el('address-input').addEventListener('input', () => {
    const c = detectChains(el('address-input').value.trim());
    el('detected-hint').textContent = c.length ? t('detected', { c: CHAINS[c[0]].name }) : '';
    // адрес другой сети переключает выбор сам — иначе остаётся сеть от прошлого поиска
    const sel = el('chain-select');
    if (c.length && sel.value !== 'auto' && !c.includes(sel.value)) sel.value = c[0];
  });

  document.querySelectorAll('#lang-switch .seg-btn').forEach(b =>
    b.addEventListener('click', () => setLang(b.dataset.lang)));
  document.querySelectorAll('#theme-switch .seg-btn').forEach(b =>
    b.addEventListener('click', () => setTheme(b.dataset.themeSet)));

  document.addEventListener('langchange', () => {
    fillChainSelect();
    renderSaved();
    if (state.transfers.length) render();
  });

  el('filter-input').addEventListener('input', e => {
    state.filter = e.target.value; renderTable(); renderPeers(); renderGraph();
  });
  el('dir-filter').addEventListener('change', e => {
    state.dirFilter = e.target.value; renderTable(); renderPeers(); renderGraph();
  });
  el('graph-asset').addEventListener('change', e => {
    state.assetFilter = e.target.value; renderTable(); renderPeers(); renderGraph();
  });

  document.querySelectorAll('.tx-table th[data-sort]').forEach(th =>
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      state.sort = { key, dir: state.sort.key === key ? -state.sort.dir : -1 };
      renderTable();
    }));

  el('peers-list').addEventListener('click', e => {
    const peer = e.target.closest('.peer');
    if (!peer) return;
    el('filter-input').value = peer.dataset.addr;
    state.filter = peer.dataset.addr;
    renderTable(); renderGraph();
  });

  document.addEventListener('peerpick', e => {
    el('filter-input').value = e.detail;
    state.filter = e.detail;
    renderTable();
  });

  el('saved-list').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    if (e.target.dataset.remove) {
      watchlist.remove(chip.dataset.chain, chip.dataset.addr);
      renderSaved();
      return;
    }
    el('chain-select').value = chip.dataset.chain;
    el('address-input').value = chip.dataset.addr;
    scan();
  });
  el('saved-export').addEventListener('click', exportWallets);
  el('saved-import').addEventListener('click', () => el('saved-file').click());
  el('saved-file').addEventListener('change', e => {
    if (e.target.files?.[0]) importWallets(e.target.files[0]);
    e.target.value = '';
  });

  el('graph-fit').addEventListener('click', () => graph.fit());
  el('graph-export').addEventListener('click', () => graph.exportPng());
  el('csv-export').addEventListener('click', exportCsv);

  el('settings-open').addEventListener('click', () => {
    el('key-etherscan').value = store.get('key.etherscan');
    el('key-trongrid').value = store.get('key.trongrid');
    el('key-solana').value = store.get('key.solana');
    el('settings-modal').hidden = false;
  });
  el('settings-close').addEventListener('click', () => el('settings-modal').hidden = true);
  el('settings-modal').addEventListener('click', e => {
    if (e.target === el('settings-modal')) el('settings-modal').hidden = true;
  });
  el('settings-save').addEventListener('click', () => {
    store.set('key.etherscan', el('key-etherscan').value.trim());
    store.set('key.trongrid', el('key-trongrid').value.trim());
    store.set('key.solana', el('key-solana').value.trim());
    el('settings-modal').hidden = true;
    status(t('settings.saved'));
  });
}

function exportCsv() {
  const rows = [['date', 'direction', 'from', 'to', 'amount', 'symbol', 'usd', 'chain', 'hash']];
  for (const tx of visibleTransfers()) {
    rows.push([
      new Date(tx.ts * 1000).toISOString(), tx.direction, tx.from, tx.to,
      tx.amount, tx.symbol, tx.usd ?? '', tx.chain, tx.hash
    ]);
  }
  const name = `mmap-${state.chain}-${state.address.slice(0, 10)}.csv`.replace(/[^\w.-]/g, '_');
  download(name, toCsv(rows));
}

/* ----------------------------------------------------------------- init */
function init() {
  setTheme(store.get('theme', 'dark'));
  setLang(currentLang);
  fillChainSelect();
  graph = new TransferGraph(el('graph'), el('graph-tip'));
  bind();
  renderSaved();

  const hash = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (hash.includes(':')) {
    const [chain, addr] = hash.split(':');
    if (CHAINS[chain] && addr) {
      el('chain-select').value = chain;
      el('address-input').value = addr;
      scan();
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
