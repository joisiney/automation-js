import { padLeft } from "../utils/pad-left.js";
import { Candles, IIndicatorDecisionMin } from "./types.js";

export type VwapParams = {
  candles: Candles;
  confirmOnClose?: boolean; // true: usa última barra fechada (default)
  thresholdPct?: number; // distância percentual para compra/venda (default 1%)
  recentBars?: number; // janela para checar toques recentes (default 3)
  slopeWindow?: number; // janela p/ slope da VWAP (default 3)
};

export class VWAPIndicator {
  static calculate({
    candles,
    confirmOnClose = true,
    thresholdPct = 1,
    recentBars = 3,
    slopeWindow = 3,
  }: VwapParams) {
    const { highs, lows, closes = [], volumes = [] } = candles;
    const len = Math.min(highs.length, lows.length, closes.length, volumes.length);
    if (!len || len < Math.max(5, slopeWindow) + 1) {
      return { ok: false as const, reason: "Dados insuficientes." };
    }

    const lastIndex = confirmOnClose ? len - 2 : len - 1;
    if (lastIndex < 1) {
      return { ok: false as const, reason: "Dados insuficientes para confirmar no fechamento." };
    }

    // VWAP acumulado: vwap[i] = sum(TP*Vol)/sum(Vol)
    const vwapRaw: number[] = Array(len).fill(0);
    let cumPV = 0;
    let cumV = 0;
    for (let i = 0; i < len; i++) {
      const tp = (highs[i] + lows[i] + closes[i]) / 3;
      const vol = volumes[i];
      cumPV += tp * vol;
      cumV += vol;
      vwapRaw[i] = cumV ? cumPV / cumV : tp;
    }
    const vwap = padLeft(len, vwapRaw);

    const lClose = closes[lastIndex];
    // const pClose = closes[prevIndex];
    const lVWAP = vwap[lastIndex] as number | null;
    const pVWAP = vwap[lastIndex - slopeWindow] as number | null;

    const diffPct = lVWAP ? ((lClose - lVWAP) / lVWAP) * 100 : 0;
    const threshold = Math.max(0, thresholdPct);

    // slope simples da VWAP
    const slope = lVWAP != null && pVWAP != null ? (lVWAP - pVWAP) / slopeWindow : 0;
    const slopePct = lVWAP ? (slope / lVWAP) * 100 : 0;

    // toques/rompimentos recentes
    let barsSinceAbove: number | null = null;
    let barsSinceBelow: number | null = null;
    for (let i = lastIndex; i >= Math.max(0, lastIndex - 50); i--) {
      const c = closes[i];
      const w = vwap[i] as number | null;
      if (w == null) continue;
      if (barsSinceAbove == null && c >= w * (1 + threshold / 100)) barsSinceAbove = lastIndex - i;
      if (barsSinceBelow == null && c <= w * (1 - threshold / 100)) barsSinceBelow = lastIndex - i;
      if (barsSinceAbove != null && barsSinceBelow != null) break;
    }

    const recentAbove = barsSinceAbove != null && barsSinceAbove <= recentBars;
    const recentBelow = barsSinceBelow != null && barsSinceBelow <= recentBars;

    // Sinal
    let entrySignal: "long" | "short" | "none" = "none";
    if (lVWAP != null) {
      if (lClose >= lVWAP * (1 + threshold / 100) || recentAbove) entrySignal = "long";
      else if (lClose <= lVWAP * (1 - threshold / 100) || recentBelow) entrySignal = "short";
    }

    // confiança ponderada por distância e slope
    const distFactor = Math.min(1, Math.max(0, Math.abs(diffPct) / (2 * threshold)));
    const slopeFactor = Math.min(1, Math.max(0, Math.abs(slopePct) / 0.5)); // 0.5% por barra satura
    const confidence = Math.min(
      1,
      Math.max(0.3, (entrySignal !== "none" ? 0.5 : 0.3) + 0.5 * distFactor + 0.3 * slopeFactor),
    );

    return {
      ok: true as const,
      last: {
        price: lClose,
        vwap: lVWAP ?? null,
        diffPct,
        slopePct,
      },
      vwap,
      diffPct,
      slopePct,
      barsSinceAbove,
      barsSinceBelow,
      recentAbove,
      recentBelow,
      entrySignal,
      confidence,
      meta: { thresholdPct: threshold, lastIndex },
    };
  }

  static decision(
    params: VwapParams,
  ): IIndicatorDecisionMin<ReturnType<typeof VWAPIndicator.calculate>> {
    const r = VWAPIndicator.calculate(params);
    if (!r.ok) {
      return {
        id: "vwap",
        direction: "none",
        entry: "no-trigger",
        score: { directional: 0, confidence: 0, quality: 0.5 },
        health: { isValid: false },
        data: r,
      };
    }
    const dir = r.entrySignal === "long" ? 1 : r.entrySignal === "short" ? -1 : 0;
    const quality = Math.min(1, 0.7 + Math.min(0.3, Math.abs(r.slopePct) / 1));
    return {
      id: "vwap",
      direction: dir > 0 ? "buy" : dir < 0 ? "sell" : "none",
      entry: dir !== 0 ? "triggered" : "no-trigger",
      score: { directional: dir, confidence: r.confidence, quality },
      health: { isValid: true },
      data: r,
    };
  }
}
