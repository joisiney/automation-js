import { getEnv } from "./env";
import { getCandles } from "./get-candles";
import { EnsembleAdaptive } from "./utils/ensemble-multi-tf";
const getTimeFrame = async (interval: string) => {
  const envs = getEnv();
  return await getCandles(
    envs.SYMBOL,
    interval,
    envs.LIMIT,
    envs.STRATEGY_KLINE as any,
    envs.MARKET as any,
  );
};
(async () => {
  const [
    candles5m,
    candles15m,
    //, candles1h, candles1D
  ] = await Promise.all([
    getTimeFrame("5m"),
    getTimeFrame("15m"),
    // getTimeFrame("1h"),
    // getTimeFrame("1D"),
  ]);
  // 1) instancie uma vez (pode reaproveitar entre execuções)
  const ens = new EnsembleAdaptive();

  // (opcional) ajuste baseline
  ens.setBaselineWeights({ ema: 0.2, macd: 0.16 });

  // 2) decida com múltiplos TFs (ex.: 5m exec, 15m/1h confirmação, 1D regime)
  const out = ens.decision({
    timeframes: [
      { label: "5m", candles: candles5m },
      { label: "15m", candles: candles15m },
      // { label: "1h", candles: candles1h },
      // { label: "1D", candles: candles1D },
    ],
    confirmOnClose: true,
    buyThreshold: +0.15,
    sellThreshold: -0.15,
    basePositionPct: 0.25,
    maxPositionPct: 0.5,
  });

  console.log({
    direction: out.direction, // buy, sell, none
    positionPctOfDailyLimit: out.sizing?.positionPctOfDailyLimit, // 0.05 to 0.5
    stopLossPrice: out.sizing?.stopLossPrice, // stop loss price
  });
  console.table(out.weightsUsed.tfWeights);
  console.log(out.weightsUsed.indicatorWeights);

  // 3) após fechar a operação, retroalimente o learner:
  const outcomeR = +1.0; // exemplo: ganhou 1R
  const usedIndicators = out.breakdown.indicators
    .filter((x) => x.dir !== 0) // só os que puxaram direção
    .map((x) => x.id);
  ens.updateWithOutcome(outcomeR, usedIndicators);
})();
