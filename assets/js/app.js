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
  assetFilter: 'all',
  peers: new Set(),   // выбранные контрагенты; пусто = все
  hidden: new Set(),  // контрагенты, убранные со схемы правым кликом
  view: 'flow',
  groupMode: 'asset'
};
let graph, mindmap, flowmap, timeline;

/* ---------------------------------------------------------- тема и язык */
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  store.set('theme', theme);
  document.querySelectorAll('#theme-switch .seg-btn')
    .forEach(b => b.classList.toggle('active', b.dataset.themeSet === theme));
  graph?.draw();
  mindmap?.draw();
  flowmap?.draw();
  timeline?.draw();
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
    state.peers.clear();
    state.hidden.clear();

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

function visibleTransfers(useTextFilter = true, usePeerFilter = true) {
  const q = useTextFilter ? state.filter.toLowerCase() : '';
  return state.transfers.filter(tx => {
    // скрытые контрагенты не участвуют нигде, пока их не вернут кнопкой
    if (state.hidden.has(peerOf(tx))) return false;
    // выбранные контрагенты сужают вообще всё: схемы, таблицу и статистику
    if (usePeerFilter && state.peers.size && !state.peers.has(peerOf(tx))) return false;
    if (state.dirFilter !== 'all' && tx.direction !== state.dirFilter) return false;
    if (state.assetFilter !== 'all' && tx.symbol !== state.assetFilter) return false;
    if (!q) return true;
    return (tx.hash + ' ' + tx.from + ' ' + tx.to + ' ' + tx.symbol).toLowerCase().includes(q);
  });
}


/* ------------------------------------------------- дерево для майндмапа */
/*
 * Кошелёк → группы (актив или направление) → контрагенты.
 * В группе показываем до 12 самых крупных контрагентов, остальные сворачиваем
 * в один узел «ещё N», чтобы карта оставалась читаемой.
 */
const PEERS_PER_GROUP = 8;

function buildTree() {
  const cs = getComputedStyle(document.documentElement);
  const colIn = cs.getPropertyValue('--node-in').trim();
  const colOut = cs.getPropertyValue('--node-out').trim();
  const txs = visibleTransfers();

  const groups = new Map();
  for (const tx of txs) {
    const key = state.groupMode === 'dir'
      ? (tx.direction === 'out' ? 'out' : 'in')
      : tx.symbol;
    let g = groups.get(key);
    if (!g) { g = { key, txs: 0, usd: 0, peers: new Map() }; groups.set(key, g); }
    g.txs++;
    g.usd += tx.usd || 0;

    const addr = peerOf(tx);
    let pr = g.peers.get(addr);
    if (!pr) { pr = { addr, txs: 0, usd: 0, amount: 0, out: 0, usdIn: 0, usdOut: 0, symbols: new Set() }; g.peers.set(addr, pr); }
    pr.txs++;
    pr.usd += tx.usd || 0;
    pr.amount += tx.amount;
    pr.symbols.add(tx.symbol);
    if (tx.direction === 'out') { pr.out++; pr.usdOut += tx.usd || 0; } else { pr.usdIn += tx.usd || 0; }
  }

  const sorted = [...groups.values()].sort((a, b) => b.usd - a.usd || b.txs - a.txs);
  const children = sorted.map(g => {
    const label = state.groupMode === 'dir' ? t('dir.' + g.key) : g.key;
    const color = state.groupMode === 'dir' ? (g.key === 'out' ? colOut : colIn) : undefined;
    const peers = [...g.peers.values()].sort((a, b) => b.usd - a.usd || b.txs - a.txs);
    const head = peers.slice(0, PEERS_PER_GROUP);
    const rest = peers.slice(PEERS_PER_GROUP);

    const kids = head.map(pr => {
      const inTxs = pr.txs - pr.out;
      // ← деньги пришли от этого адреса, → ушли на него, ↔ было и то и другое
      const arrow = pr.out && inTxs ? '↔' : pr.out ? '→' : '←';
      const dirColor = pr.out > inTxs ? colOut : colIn;
      const sub = pr.out && inTxs
        ? `←${pr.usdIn ? fmtUsd(pr.usdIn) : inTxs + '×'} · →${pr.usdOut ? fmtUsd(pr.usdOut) : pr.out + '×'}`
        : `${pr.txs} ${t('peers.txs')} · ${pr.usd ? fmtUsd(pr.usd) : fmtAmount(pr.amount)}`;
      return {
        key: `${g.key}|${pr.addr}`,
        label: `${arrow} ${shortAddr(pr.addr, 8, 6)}`,
        sub,
        color: color || dirColor,
        addr: pr.addr,
        tip: `<b>${pr.addr}</b><br>` +
             `${t('dir.in')}: ${inTxs}× ${fmtUsd(pr.usdIn)} · ${t('dir.out')}: ${pr.out}× ${fmtUsd(pr.usdOut)}<br>` +
             `${[...pr.symbols].slice(0, 5).join(', ')}`
      };
    });

    if (rest.length) {
      const restUsd = rest.reduce((sum, p) => sum + p.usd, 0);
      const restTxs = rest.reduce((sum, p) => sum + p.txs, 0);
      kids.push({
        key: `${g.key}|rest`,
        label: t('mm.more', { n: rest.length }),
        sub: `${restTxs} ${t('peers.txs')} · ${fmtUsd(restUsd)}`,
        color: color || cs.getPropertyValue('--text-dim').trim()
      });
    }

    return {
      key: 'g|' + g.key,
      label,
      sub: `${g.txs} ${t('peers.txs')} · ${g.usd ? fmtUsd(g.usd) : ''}`.trim(),
      color: color || cs.getPropertyValue('--accent').trim(),
      children: kids
    };
  });

  return {
    key: 'root',
    label: shortAddr(state.address, 10, 8),
    sub: `${CHAINS[state.chain]?.name || ''} · ${txs.length} ${t('peers.txs')}`,
    children
  };
}

const VIEW_CANVAS = { flow: 'flowmap', mind: 'mindmap', graph: 'graph', time: 'timeline' };

function activeView() {
  return { flow: flowmap, mind: mindmap, graph, time: timeline }[state.view];
}

function setView(view) {
  state.view = VIEW_CANVAS[view] ? view : 'flow';
  view = state.view;
  store.set('view', view);
  for (const [key, id] of Object.entries(VIEW_CANVAS)) el(id).hidden = key !== view;
  el('group-mode').disabled = view !== 'mind';
  // в потоке и хронологии цвета подписаны заголовками колонок — легенда только мешает
  document.querySelector('.legend').hidden = view === 'flow' || view === 'time';
  document.querySelectorAll('#view-switch .seg-btn')
    .forEach(b => b.classList.toggle('active', b.dataset.view === view));
  if (state.transfers.length) renderGraph();
}


/* ------------------------------------------- данные для потока и времени */
/*
 * Поток отвечает на главный вопрос: откуда деньги пришли и куда ушли.
 * Отправители и получатели считаются раздельно, вес — сумма в USD,
 * а если цены нет — объём в монетах.
 */
const FLOW_SIDE_LIMIT = 10;

function buildFlow() {
  const txs = visibleTransfers();
  const sides = { in: new Map(), out: new Map() };

  for (const tx of txs) {
    const dir = tx.direction === 'out' ? 'out' : 'in';
    const addr = peerOf(tx);
    const m = sides[dir];
    let p = m.get(addr);
    if (!p) { p = { addr, usd: 0, amount: 0, txs: 0, symbols: new Set() }; m.set(addr, p); }
    p.usd += tx.usd || 0;
    p.amount += tx.amount;
    p.txs++;
    p.symbols.add(tx.symbol);
  }

  const pack = (map, dir) => {
    const list = [...map.values()]
      .map(p => ({ ...p, value: p.usd || p.amount }))
      .sort((a, b) => b.value - a.value);
    const head = list.slice(0, FLOW_SIDE_LIMIT);
    const rest = list.slice(FLOW_SIDE_LIMIT);
    const boxes = head.map(p => ({
      addr: p.addr,
      label: shortAddr(p.addr, 8, 6),
      sub: `${p.txs} ${t('peers.txs')} · ${p.usd ? fmtUsd(p.usd) : fmtAmount(p.amount)}`,
      value: p.value,
      tip: `<b>${p.addr}</b><br>${t('dir.' + dir)} · ${p.txs} ${t('peers.txs')}<br>` +
           `${p.usd ? fmtUsd(p.usd) : fmtAmount(p.amount)} · ${[...p.symbols].slice(0, 5).join(', ')}`
    }));
    if (rest.length) {
      const value = rest.reduce((sum, p) => sum + p.value, 0);
      const cnt = rest.reduce((sum, p) => sum + p.txs, 0);
      const usdRest = rest.reduce((sum, p) => sum + p.usd, 0);
      boxes.push({
        label: t('flow.rest', { n: rest.length }),
        sub: `${cnt} ${t('peers.txs')} · ${usdRest ? fmtUsd(usdRest) : fmtAmount(value)}`,
        value
      });
    }
    return boxes;
  };

  const sources = pack(sides.in, 'in');
  const dests = pack(sides.out, 'out');
  const totalIn = sources.reduce((s, p) => s + p.value, 0);
  const totalOut = dests.reduce((s, p) => s + p.value, 0);
  const usdIn = txs.reduce((s, x) => s + (x.direction !== 'out' ? (x.usd || 0) : 0), 0);
  const usdOut = txs.reduce((s, x) => s + (x.direction === 'out' ? (x.usd || 0) : 0), 0);

  const amtIn = txs.reduce((s, x) => s + (x.direction !== 'out' ? x.amount : 0), 0);
  const amtOut = txs.reduce((s, x) => s + (x.direction === 'out' ? x.amount : 0), 0);

  return {
    sources, dests, totalIn, totalOut,
    selfLabel: shortAddr(state.address, 7, 5),
    chainLabel: `${CHAINS[state.chain]?.name || ''} · ${txs.length} ${t('peers.txs')}`,
    labelIn: t('flow.senders', { n: sides.in.size }),
    labelOut: t('flow.receivers', { n: sides.out.size }),
    inWord: t('flow.inWord'),
    outWord: t('flow.outWord'),
    inTotal: usdIn ? fmtUsd(usdIn) : fmtAmount(amtIn),
    outTotal: usdOut ? fmtUsd(usdOut) : fmtAmount(amtOut)
  };
}

function buildTimeline() {
  const txs = visibleTransfers();
  const usdIn = txs.reduce((s, x) => s + (x.direction !== 'out' ? (x.usd || 0) : 0), 0);
  const usdOut = txs.reduce((s, x) => s + (x.direction === 'out' ? (x.usd || 0) : 0), 0);
  return {
    labelIn: t('flow.in', { v: usdIn ? fmtUsd(usdIn) : '' }).trim(),
    labelOut: t('flow.out', { v: usdOut ? fmtUsd(usdOut) : '' }).trim(),
    points: txs.map(tx => ({
      ts: tx.ts, usd: tx.usd || 0, amount: tx.amount,
      dir: tx.direction === 'out' ? 'out' : 'in',
      addr: peerOf(tx),
      tip: `<b>${shortAddr(peerOf(tx), 10, 8)}</b><br>` +
           `${t('dir.' + (tx.direction === 'out' ? 'out' : 'in'))} · ${fmtAmount(tx.amount)} ${tx.symbol}` +
           `${tx.usd ? ' · ' + fmtUsd(tx.usd) : ''}<br>${fmtDate(tx.ts)}`
    }))
  };
}


/* ------------------------------------------------ выбор контрагентов */
/*
 * Пустой набор = схема по всем кошелькам. Выбрав один или несколько адресов,
 * получаем схему и таблицу только по переводам с ними.
 */
function togglePeer(addr) {
  if (!addr) return;
  if (state.peers.has(addr)) state.peers.delete(addr); else state.peers.add(addr);
  refreshAll();
}

function clearPeers() {
  state.peers.clear();
  refreshAll();
}

function hidePeer(addr) {
  if (!addr) return;
  state.hidden.add(addr);
  state.peers.delete(addr);
  refreshAll();
}

function unhidePeer(addr) {
  state.hidden.delete(addr);
  refreshAll();
}

function refreshAll() {
  renderSelection();
  renderHidden();
  renderStats();
  renderTable();
  renderPeers();
  renderGraph();
}

function renderHidden() {
  const list = [...state.hidden];
  el('hidden-bar').hidden = list.length === 0;
  el('hidden-list').innerHTML = list.map(addr =>
    `<span class="chip" data-addr="${addr}" title="${addr}">
       <span class="chip-addr">${shortAddr(addr, 8, 6)}</span>
       <button class="chip-x" data-restore="1">↺</button>
     </span>`).join('');
}

function renderSelection() {
  const list = [...state.peers];
  el('selection').hidden = list.length === 0;
  el('selection-list').innerHTML = list.map(addr =>
    `<span class="chip active" data-addr="${addr}" title="${addr}">
       <span class="chip-addr">${shortAddr(addr, 8, 6)}</span>
       <button class="chip-x" data-remove="1">✕</button>
     </span>`).join('');
}

/* ----------------------------------------------------------- отрисовка */
function render() {
  el('layout').hidden = false;
  el('stats').hidden = false;
  renderSelection();
  renderHidden();
  renderStats();
  renderAssetSelect();
  renderTable();
  renderPeers();
  renderGraph();
}

function renderStats() {
  // статистика считается по тому, что реально показано: с учётом выбранных кошельков и фильтров
  const txs = visibleTransfers();
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
  // список не сужается ни текстом, ни выбором — иначе из него не добавить второй кошелёк
  const peers = aggregate(visibleTransfers(false, false)).slice(0, 40);
  const max = Math.max(1, ...peers.map(p => p.in + p.out));
  el('peers-list').innerHTML = peers.length ? peers.map(p => {
    const total = p.in + p.out;
    const syms = [...p.symbols].slice(0, 3).join(', ');
    const on = state.peers.has(p.addr);
    return `<div class="peer${on ? ' selected' : ''}" data-addr="${p.addr}">
      <div class="peer-top">
        <span class="peer-addr" title="${p.addr}"><i class="peer-check"></i>${shortAddr(p.addr, 10, 6)}</span>
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
  const view = state.view;
  if (view === 'mind') {
    mindmap.resize();
    mindmap.setData(buildTree());
  } else if (view === 'flow') {
    flowmap.setData(buildFlow());
  } else if (view === 'time') {
    timeline.setData(buildTimeline());
  } else {
    graph.resize();
    graph.setData({ self: state.address, peers: aggregate(visibleTransfers()) });
  }
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
    if (peer) togglePeer(peer.dataset.addr);
  });

  el('selection-list').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (chip) togglePeer(chip.dataset.addr);
  });
  el('selection-clear').addEventListener('click', clearPeers);

  // клик по узлу любой схемы добавляет/убирает кошелёк из выборки
  document.addEventListener('peerpick', e => togglePeer(e.detail));
  // правый клик по узлу или стрелке — убрать эти переводы со схемы
  document.addEventListener('peerhide', e => hidePeer(e.detail));

  el('hidden-list').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (chip) unhidePeer(chip.dataset.addr);
  });
  el('hidden-clear').addEventListener('click', () => { state.hidden.clear(); refreshAll(); });

  // ПКМ по строке контрагента прячет его так же, как на схеме
  el('peers-list').addEventListener('contextmenu', e => {
    const peer = e.target.closest('.peer');
    if (!peer) return;
    e.preventDefault();
    hidePeer(peer.dataset.addr);
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

  el('graph-fit').addEventListener('click', () => activeView().fit());
  el('graph-export').addEventListener('click', () => {
    const v = activeView();
    v.exportPng(v === graph || v === mindmap ? undefined : `mmap-${state.view}.png`);
  });
  document.querySelectorAll('#view-switch .seg-btn').forEach(b =>
    b.addEventListener('click', () => setView(b.dataset.view)));
  el('group-mode').addEventListener('change', e => {
    state.groupMode = e.target.value;
    store.set('groupMode', state.groupMode);
    mindmap.collapsed.clear();
    renderGraph();
  });
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
  mindmap = new MindMap(el('mindmap'), el('graph-tip'));
  flowmap = new FlowMap(el('flowmap'), el('graph-tip'));
  timeline = new Timeline(el('timeline'), el('graph-tip'));
  bind();
  state.groupMode = store.get('groupMode', 'asset');
  el('group-mode').value = state.groupMode;
  setView(store.get('view', 'flow'));
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
