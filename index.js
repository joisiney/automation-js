// index.js
const axios = require("axios");
const {
  EMA,
  RSI,
  MACD,
  BollingerBands,
  ADX,
  ATR,
} = require("technicalindicators");
const fs = require("fs");

const BINANCE_API = "https://api.binance.com";
const SYMBOL = process.env.SYMBOL || process.argv[2] || "BTCUSDT";
const INTERVAL = process.env.INTERVAL || process.argv[3] || "1h";
const LIMIT = Number(process.env.LIMIT || 1000);

async function getKlines(symbol, interval, limit = 500) {
  const url = `${BINANCE_API}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
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

// VWAP
function computeVWAP(candles) {
  const out = [];
  let cumPV = 0;
  let cumVol = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    cumPV += tp * c.volume;
    cumVol += c.volume;
    out.push(cumPV / (cumVol || 1));
  }
  return out;
}

function padLeft(fullLen, arr) {
  const pad = Array(Math.max(0, fullLen - arr.length)).fill(null);
  return pad.concat(arr);
}

(async () => {
  try {
    const candles = await getKlines(SYMBOL, INTERVAL, LIMIT);
    if (!candles.length) throw new Error("Nenhum candle retornado.");

    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const volumes = candles.map((c) => c.volume);

    // === Indicadores ===
    const ema9 = EMA.calculate({ period: 9, values: closes });
    const ema21 = EMA.calculate({ period: 21, values: closes });
    const ema99 = EMA.calculate({ period: 99, values: closes });
    const ema200 = EMA.calculate({ period: 200, values: closes });

    const rsi9 = RSI.calculate({ period: 9, values: closes });

    const macd = MACD.calculate({
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
      values: closes,
    });

    const bb = BollingerBands.calculate({
      period: 20,
      values: closes,
      stdDev: 2,
    });

    const adx14 = ADX.calculate({ period: 14, high: highs, low: lows, close: closes });

    const atr14 = ATR.calculate({ period: 14, high: highs, low: lows, close: closes });

    const vwap = computeVWAP(candles);

    const len = candles.length;
    const aligned = {
      ema9: padLeft(len, ema9),
      ema21: padLeft(len, ema21),
      ema99: padLeft(len, ema99),
      ema200: padLeft(len, ema200),
      rsi9: padLeft(len, rsi9),
      macd: padLeft(len, macd.map((m) => m.MACD)),
      macdSignal: padLeft(len, macd.map((m) => m.signal)),
      macdHist: padLeft(len, macd.map((m) => m.histogram)),
      bbLower: padLeft(len, bb.map((b) => b.lower)),
      bbMiddle: padLeft(len, bb.map((b) => b.middle)),
      bbUpper: padLeft(len, bb.map((b) => b.upper)),
      adx: padLeft(len, adx14.map((x) => x.adx)),
      plusDI: padLeft(len, adx14.map((x) => x.pdi)),
      minusDI: padLeft(len, adx14.map((x) => x.mdi)),
      atr14: padLeft(len, atr14),
      vwap,
      volume: volumes,
      open: candles.map((c) => c.open),
      close: closes,
      time: candles.map((c) => c.closeTime),
    };

    const last = (arr) => arr.filter((x) => x !== null && x !== undefined).slice(-1)[0];

    // === Snapshot ===
    const lastOpen = last(aligned.open);
    const lastClose = last(aligned.close);
    const lastVolume = last(aligned.volume);

    // Volume Operator
    let volumeOperator = "neutral";
    if (lastClose > lastOpen) volumeOperator = "buy";
    else if (lastClose < lastOpen) volumeOperator = "sell";

    // ADX Operator
    const lastPlusDI = last(aligned.plusDI);
    const lastMinusDI = last(aligned.minusDI);
    let adxOperator = "neutral";
    if (lastPlusDI > lastMinusDI) adxOperator = "buy";
    else if (lastMinusDI > lastPlusDI) adxOperator = "sell";

    const snapshot = {
      symbol: SYMBOL,
      interval: INTERVAL,
      close: lastClose,
      ema9: last(aligned.ema9),
      ema21: last(aligned.ema21),
      ema99: last(aligned.ema99),
      ema200: last(aligned.ema200),
      rsi9: last(aligned.rsi9),
      macd: last(aligned.macd),
      macdSignal: last(aligned.macdSignal),
      macdHist: last(aligned.macdHist),
      bbLower: last(aligned.bbLower),
      bbMiddle: last(aligned.bbMiddle),
      bbUpper: last(aligned.bbUpper),
      adx: last(aligned.adx),
      plusDI: lastPlusDI,
      minusDI: lastMinusDI,
      adxOperator,
      atr14: last(aligned.atr14),
      vwap: last(aligned.vwap),
      volume: lastVolume,
      volumeOperator,
      time: last(aligned.time),
    };

    fs.writeFileSync("output.json", JSON.stringify(aligned, null, 2));
    console.log(JSON.stringify(snapshot, null, 2));
    console.error('Séries completas salvas em "output.json".');
  } catch (err) {
    console.error("Erro:", err.message);
    process.exit(1);
  }
})();
