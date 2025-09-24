import axios from "axios";
// =======================
// KLINE SMART START
// =======================
const BINANCE_SPOT = "https://api.binance.com";
const BINANCE_FUT = "https://fapi.binance.com";

// cache simples do exchangeInfo
let _exchangeInfoCache = { spot: null, futures: null, ts: 0 };
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getExchangeInfo(market = "spot") {
  const now = Date.now();
  const cached = market === "spot" ? _exchangeInfoCache.spot : _exchangeInfoCache.futures;
  if (cached && now - _exchangeInfoCache.ts < CACHE_TTL_MS) return cached;

  const baseUrl = market === "spot" ? BINANCE_SPOT : BINANCE_FUT;
  const path = market === "spot" ? "/api/v3/exchangeInfo" : "/fapi/v1/exchangeInfo";
  const { data } = await axios.get(baseUrl + path);

  if (market === "spot") _exchangeInfoCache.spot = data;
  else _exchangeInfoCache.futures = data;
  _exchangeInfoCache.ts = now;
  return data;
}

/** Resolve "BOB" -> "BOBUSDT" (ou valida "BOBUSDT") */
async function resolveSymbol(
  input,
  { market = "spot", quotePriority = ["USDT", "FDUSD", "USDC", "BTC", "TRY", "BUSD"] } = {},
) {
  const target = String(input).toUpperCase().replace(/\s+/g, "");
  const info = await getExchangeInfo(market);
  const symbols = info.symbols || [];

  const exact = symbols.find((s) => s.symbol === target && s.status === "TRADING");
  if (exact) return exact.symbol;

  const candidates = symbols.filter(
    (s) => s.status === "TRADING" && (s.baseAsset === target || s.symbol.startsWith(target)),
  );
  if (candidates.length) {
    candidates.sort(
      (a, b) => quotePriority.indexOf(a.quoteAsset) - quotePriority.indexOf(b.quoteAsset),
    );
    return candidates[0].symbol;
  }

  const loose = symbols.filter((s) => s.status === "TRADING" && s.symbol.includes(target));
  if (loose.length) {
    loose.sort(
      (a, b) => quotePriority.indexOf(a.quoteAsset) - quotePriority.indexOf(b.quoteAsset),
    );
    return loose[0].symbol;
  }

  throw new Error(`Não encontrei símbolo para "${input}" em ${market}.`);
}

/** Carrega klines (spot ou futures) */
export async function getKlines(inputSymbol, interval, limit = 500, { market = "spot" } = {}) {
  const symbol = await resolveSymbol(inputSymbol, { market });

  if (market === "spot") {
    const url = `${BINANCE_SPOT}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const { data } = await axios.get(url);
    return data.map((k) => ({
      openTime: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      closeTime: k[6],
    }));
  }

  const url = `${BINANCE_FUT}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const { data } = await axios.get(url);
  return data.map((k) => ({
    openTime: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
    closeTime: k[6],
  }));
}
// =======================
// KLINE SMART END
// =======================