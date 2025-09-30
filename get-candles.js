import { getKlines as getKlinesBinance } from "./binance.js";
import { getKlines as getKlinesB3 } from "./b3.js";
const strategiesKlines = {
  binance: getKlinesBinance,
  b3: getKlinesB3,
};
export async function getCandles(symbol, interval, limit = 500, klinesType = "binance", market = "spot") {
  
  const candles = await strategiesKlines[klinesType](symbol, interval, limit, {
    market,
  });
  const opens = candles.map((c) => c.open);
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);
  const times = candles.map((c) => c.closeTime);

  return {
    opens,
    closes,
    highs,
    lows,
    volumes,
    times,
    length: candles.length,
  };
};
