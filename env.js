export function getEnv() {
  /**
   * STRATEGY_KLINE
   * De onde buscar os candles.
   * Exemplos: "binance" (cripto) ou "b3" (ações brasileiras via brapi).
   */
  const STRATEGY_KLINE = process.env.STRATEGY_KLINE || process.argv[2];

  /**
   * SYMBOL
   * Ativo a ser analisado.
   * Exemplos: "BNBUSDT" (Binance), "VALE3" (B3 via brapi).
   */
  const SYMBOL = process.env.SYMBOL || process.argv[3];

  /**
   * INTERVAL
   * Tempo de cada candle.
   * Exemplos: 1m, 5m, 15m, 1h, 4h, 1d, 1w, 1M.
   */
  const INTERVAL = process.env.INTERVAL || process.argv[4];

  /**
   * MARKET
   * Mercado/segmento. Na Binance: "spot" ou "futures".
   * Na B3, manter "spot".
   */
  const MARKET = process.env.MARKET || process.argv[5];

  const LIMIT = Number(process.argv[6] || 1000);
  return { STRATEGY_KLINE, SYMBOL, INTERVAL, MARKET, LIMIT };
};
