/* Общие утилиты / shared helpers */

const store = {
  get(key, fallback = '') { try { return localStorage.getItem('mmap.' + key) ?? fallback; } catch { return fallback; } },
  set(key, val) { try { localStorage.setItem('mmap.' + key, val); } catch {} }
};

function shortAddr(a, head = 6, tail = 4) {
  if (!a) return '—';
  return a.length <= head + tail + 3 ? a : a.slice(0, head) + '…' + a.slice(-tail);
}

function fmtAmount(n, decimals = 6) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs === 0) return '0';
  if (abs < 0.000001) return n.toExponential(2);
  const d = abs < 1 ? decimals : abs < 1000 ? 4 : 2;
  return n.toLocaleString(currentLang === 'ru' ? 'ru-RU' : 'en-US',
    { maximumFractionDigits: d, minimumFractionDigits: 0 });
}

function fmtUsd(n) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  if (n === 0) return '$0';
  const abs = Math.abs(n);
  // мелочь показываем точнее, но без хвоста нулей: $0.0000 читается как мусор
  const d = abs >= 1000 ? 0 : abs >= 1 ? 2 : 4;
  const body = n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });
  return '$' + body;
}

function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  return d.toLocaleString(currentLang === 'ru' ? 'ru-RU' : 'en-US',
    { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Делит целочисленную строку на 10^decimals без потери точности на больших числах. */
function scaleUnits(raw, decimals) {
  const s = String(raw ?? '0').replace(/[^0-9]/g, '') || '0';
  const d = Number(decimals) || 0;
  if (d === 0) return Number(s);
  const pad = s.padStart(d + 1, '0');
  const int = pad.slice(0, pad.length - d);
  const frac = pad.slice(pad.length - d);
  return Number(int + '.' + frac);
}

async function fetchJson(url, opts = {}, retries = 3) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, opts);
      if (res.status === 429) {
        await sleep(1200 * (i + 1));
        lastErr = new Error('RATE_LIMIT');
        continue;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (i < retries) await sleep(500 * (i + 1));
    }
  }
  throw lastErr;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function toCsv(rows) {
  const esc = v => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return rows.map(r => r.map(esc).join(',')).join('\n');
}

function download(filename, content, type = 'text/csv;charset=utf-8') {
  // BOM нужен только CSV, чтобы Excel не ломал кириллицу; в JSON он делает файл невалидным.
  const bom = /csv/.test(type) ? '\ufeff' : '';
  const blob = content instanceof Blob ? content : new Blob([bom + content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
