import { getCandles } from "./get-candles";
import { saveCandlesToCSV } from "./saveCandlesToCSV";

const symbol = process.env.SYMBOL!;
const interval = process.env.INTERVAL!;
const market = (process.env.MARKET as "spot" | "futures") || "spot";
const limit = parseInt(process.env.LIMIT || "500");
const klinesType = "binance";
// se não tiver startTime ou endTime, usa os 2 dias anteriores
const startTime = process.env.START_TIME
  ? parseInt(process.env.START_TIME)
  : new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).getTime();
const endTime = process.env.END_TIME ? parseInt(process.env.END_TIME) : new Date().getTime();

(async () => {
  if (!symbol || !interval) {
    console.error("SYMBOL and INTERVAL env vars are required");
    process.exit(1);
  }
  const candles = await getCandles(symbol, interval, limit, klinesType, market, {
    startTime: startTime ?? 0,
    endTime: endTime ?? 0,
  });

  await saveCandlesToCSV(
    candles.opens,
    candles.closes,
    candles.highs,
    candles.lows,
    candles.volumes,
    candles.times,
    { symbol, interval },
  );
})().catch(console.error);
