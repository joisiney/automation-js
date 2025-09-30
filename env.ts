export type Env = {
  STRATEGY_KLINE: string;
  SYMBOL: string;
  INTERVAL: string;
  MARKET: string;
  LIMIT: number;
};

export function getEnv(): Env {
  const STRATEGY_KLINE = process.env.STRATEGY_KLINE || process.argv[2];
  const SYMBOL = process.env.SYMBOL || process.argv[3];
  const INTERVAL = process.env.INTERVAL || process.argv[4];
  const MARKET = process.env.MARKET || process.argv[5];
  const LIMIT = Number(process.argv[6] || 1000);
  return { STRATEGY_KLINE, SYMBOL, INTERVAL, MARKET, LIMIT };
}
