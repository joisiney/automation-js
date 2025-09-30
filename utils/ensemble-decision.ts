import { IIndicatorDecisionMin, TDirection } from "../indicators/types";

type WeightMap = Record<string, number>;

export function ensembleDecision(
  decisions: IIndicatorDecisionMin<unknown>[],
  weights: WeightMap,
  {
    buyThreshold = +0.15,
    sellThreshold = -0.15,
  }: { buyThreshold?: number; sellThreshold?: number } = {},
) {
  let weightedSum = 0;
  let weightTotal = 0;

  for (const d of decisions) {
    if (!d.health.isValid) continue;
    const w = weights[d.id] ?? 0;
    const contrib = d.score.directional * d.score.confidence * (d.score.quality ?? 1);
    weightedSum += w * contrib;
    weightTotal += w;
  }

  const finalScore = weightTotal ? weightedSum / weightTotal : 0;

  const direction: TDirection =
    finalScore > buyThreshold ? "buy" : finalScore < sellThreshold ? "sell" : "none";

  // Classificação mais clara (faixas sugeridas)
  // strong buy:  >= 0.30
  // buy:         [0.15, 0.30)
  // neutral:     (-0.15, 0.15)
  // sell:        (-0.30, -0.15]
  // strong sell: <= -0.30
  let band: "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell" = "neutral";
  if (finalScore >= 0.3) band = "strong_buy";
  else if (finalScore >= 0.15) band = "buy";
  else if (finalScore <= -0.3) band = "strong_sell";
  else if (finalScore <= -0.15) band = "sell";

  const explanation =
    band === "strong_buy"
      ? "Consenso forte de compra entre os indicadores."
      : band === "buy"
        ? "Viés comprador; sinais majoritariamente positivos."
        : band === "sell"
          ? "Viés vendedor; sinais majoritariamente negativos."
          : band === "strong_sell"
            ? "Consenso forte de venda entre os indicadores."
            : "Sinais mistos/insuficientes; evitar gatilho.";

  return {
    finalScore,
    direction,
    band,
    thresholds: { buyThreshold, sellThreshold, strongBuy: 0.3, strongSell: -0.3 },
    explanation,
  };
}
