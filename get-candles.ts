import { getKlines as getKlinesB3 } from "./b3.js";
import { getKlines as getKlinesBinance } from "./binance.js";

type Market = "spot" | "futures";

type CandlesOut = {
  opens: number[];
  closes: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
  times: number[];
  length: number;
};

const strategiesKlines = {
  binance: getKlinesBinance,
  b3: getKlinesB3,
} as const;

export async function getCandles(
  symbol: string,
  interval: string,
  limit = 500,
  klinesType: keyof typeof strategiesKlines = "binance",
  market: Market = "spot",
  t: { startTime?: number; endTime?: number } = {},
): Promise<CandlesOut> {
  const candles = await strategiesKlines[klinesType](
    symbol,
    interval,
    limit,
    {
      market,
    } as any,
    t,
  );
  const opens = candles.map((c: any) => c.open);
  const closes = candles.map((c: any) => c.close);
  const highs = candles.map((c: any) => c.high);
  const lows = candles.map((c: any) => c.low);
  const volumes = candles.map((c: any) => c.volume);
  const times = candles.map((c: any) => c.closeTime);

  return {
    opens,
    closes,
    highs,
    lows,
    volumes,
    times,
    length: candles.length,
  };
}
