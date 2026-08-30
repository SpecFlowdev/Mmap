/* Курсы валют через CoinGecko (публичный endpoint, без ключа). */

const COINGECKO_IDS = {
  BTC: 'bitcoin', ETH: 'ethereum', BNB: 'binancecoin', MATIC: 'matic-network',
  POL: 'polygon-ecosystem-token', AVAX: 'avalanche-2', TRX: 'tron', SOL: 'solana',
  LTC: 'litecoin', DOGE: 'dogecoin', USDT: 'tether', USDC: 'usd-coin',
  DAI: 'dai', WBTC: 'wrapped-bitcoin', WETH: 'weth', BUSD: 'binance-usd',
  SHIB: 'shiba-inu', LINK: 'chainlink', UNI: 'uniswap', AAVE: 'aave'
};

const STABLES = new Set(['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'USDD', 'FDUSD', 'PYUSD']);

const priceCache = new Map();

/**
 * Возвращает карту { SYMBOL: usdPrice } для запрошенных тикеров.
 * Неизвестные токены остаются без цены (undefined), стейблкоины = 1.
 */
async function getPrices(symbols) {
  const out = {};
  const need = [];
  for (const raw of new Set(symbols)) {
    const sym = String(raw || '').toUpperCase();
    if (!sym) continue;
    if (STABLES.has(sym)) { out[sym] = 1; continue; }
    if (priceCache.has(sym)) { out[sym] = priceCache.get(sym); continue; }
    if (COINGECKO_IDS[sym]) need.push(sym);
  }
  if (!need.length) return out;

  const ids = need.map(s => COINGECKO_IDS[s]).join(',');
  try {
    const data = await fetchJson(
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd`);
    for (const sym of need) {
      const price = data?.[COINGECKO_IDS[sym]]?.usd;
      if (typeof price === 'number') { out[sym] = price; priceCache.set(sym, price); }
    }
  } catch (e) {
    console.warn('price lookup failed', e);
  }
  return out;
}
