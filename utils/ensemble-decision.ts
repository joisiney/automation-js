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

  return { finalScore, direction };
}
