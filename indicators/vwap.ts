import { padLeft } from "../utils/pad-left.js";
import { Candles, IIndicatorDecisionMin } from "./types.js";

export type VwapParams = {
  candles: Candles;
  confirmOnClose?: boolean; // true: usa última barra fechada (default)
  thresholdPct?: number; // distância percentual p/ compra/venda (default 1%)
  recentBars?: number; // janela p/ checar toques recentes (default 3)
  slopeWindow?: number; // janela p/ slope da VWAP (default 3)
};

function rollingStd(values: Array<number | null>, window: number, endIdx: number): number | null {
  if (window <= 1) return null;
  const start = Math.max(0, endIdx - window + 1);
  let n = 0,
    sum = 0,
    sum2 = 0;
  for (let i = start; i <= endIdx; i++) {
    const v = values[i];
    if (v == null || !Number.isFinite(v)) continue;
    n++;
    sum += v;
    sum2 += v * v;
  }
  if (n < 2) return null;
  const mean = sum / n;
  const var_ = (sum2 - n * mean * mean) / (n - 1);
  return var_ > 0 ? Math.sqrt(var_) : 0;
}

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

    // Typical Price
    const tp: number[] = new Array(len);
    for (let i = 0; i < len; i++) {
      tp[i] = (highs[i] + lows[i] + closes[i]) / 3;
    }

    // VWAP acumulado: sum(TP*Vol) / sum(Vol), protegendo contra vol=0
    const vwapRaw: number[] = Array(len).fill(0);
    let cumPV = 0;
    let cumV = 0;
    for (let i = 0; i < len; i++) {
      const vol = Math.max(0, volumes[i] ?? 0);
      const wtp = tp[i];
      cumPV += wtp * vol;
      cumV += vol;
      vwapRaw[i] = cumV > 0 ? cumPV / cumV : i > 0 ? vwapRaw[i - 1] : wtp;
    }
    const vwap = padLeft(len, vwapRaw);

    // Medidas no candle de referência
    const lClose = closes[lastIndex];
    const lVWAP = vwap[lastIndex] as number | null;

    // Slope da VWAP (percentual por barra) usando janela fixa
    const pVWAP = vwap[lastIndex - slopeWindow] as number | null;
    const slopeAbs = lVWAP != null && pVWAP != null ? (lVWAP - pVWAP) / slopeWindow : 0;
    const slopePct = lVWAP ? (slopeAbs / lVWAP) * 100 : 0;

    // Distância percentual do preço ao VWAP
    const diffPct = lVWAP ? ((lClose - lVWAP) / lVWAP) * 100 : 0;

    // z-score da distância (volatilidade local) — rolling no desvio do TP para o VWAP
    const STDEV_WINDOW = 20;
    const devSeries: Array<number | null> = new Array(len).fill(null);
    for (let i = 0; i < len; i++) {
      const w = vwap[i] as number | null;
      devSeries[i] = w != null ? tp[i] - w : null;
    }
    const devStdev = rollingStd(devSeries, STDEV_WINDOW, lastIndex);
    const lastDev = devSeries[lastIndex] != null ? (devSeries[lastIndex] as number) : null;
    const zScore = devStdev && devStdev > 0 && lastDev != null ? lastDev / devStdev : 0;

    // Toques/rompimentos recentes em relação ao limiar
    const threshold = Math.max(0, thresholdPct);
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

    // Cruzamento direto no último passo (sem threshold) — reforço
    const prevClose = closes[lastIndex - 1];
    const prevVWAP = vwap[lastIndex - 1] as number | null;
    const crossUp =
      prevVWAP != null && lVWAP != null ? prevClose <= prevVWAP && lClose > lVWAP : false;
    const crossDown =
      prevVWAP != null && lVWAP != null ? prevClose >= prevVWAP && lClose < lVWAP : false;

    // Regras profissionais (conservadoras):
    // - Long: distância acima do limiar E slope da VWAP positivo
    //         OU cruzamento recente pra cima com slope >= 0
    // - Short: distância abaixo do limiar E slope da VWAP negativo
    //          OU cruzamento recente pra baixo com slope <= 0
    let entrySignal: "long" | "short" | "none" = "none";
    if (lVWAP != null) {
      const aboveTh = lClose >= lVWAP * (1 + threshold / 100);
      const belowTh = lClose <= lVWAP * (1 - threshold / 100);

      const longOk = (aboveTh && slopePct > 0) || ((recentAbove || crossUp) && slopePct >= 0);
      const shortOk = (belowTh && slopePct < 0) || ((recentBelow || crossDown) && slopePct <= 0);

      if (longOk) entrySignal = "long";
      else if (shortOk) entrySignal = "short";
    }

    // Confiança:
    // - distFactor: distância relativa vs limiar (satura em 2x threshold)
    // - slopeFactor: magnitude da inclinação (satura ~0.5% por barra)
    // - zFactor: magnitude do z-score (satura em |z|>=2)
    // - triggerBoost: toque/rompimento ou cruzamento recente
    const distFactor = Math.min(
      1,
      Math.max(0, Math.abs(diffPct) / (2 * Math.max(0.0001, threshold))),
    );
    const slopeFactor = Math.min(1, Math.max(0, Math.abs(slopePct) / 0.5)); // 0.5%/barra satura
    const zFactor = Math.min(1, Math.max(0, Math.abs(zScore) / 2)); // |z|>=2 satura
    const triggerBoost = recentAbove || recentBelow || crossUp || crossDown ? 0.2 : 0;

    const base = entrySignal !== "none" ? 0.5 : 0.3;
    const confidence = Math.min(
      1,
      Math.max(0.3, base + 0.4 * distFactor + 0.3 * slopeFactor + 0.2 * zFactor + triggerBoost),
    );

    return {
      ok: true as const,
      last: {
        price: lClose,
        vwap: lVWAP ?? null,
        diffPct,
        slopePct,
        zScore,
      },
      vwap,
      diffPct,
      slopePct,
      zScore,
      barsSinceAbove,
      barsSinceBelow,
      recentAbove,
      recentBelow,
      entrySignal,
      confidence,
      meta: {
        thresholdPct: threshold,
        lastIndex,
        confirmOnClose,
        slopeWindow,
        stdevWindow: 20,
      },
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

    // Qualidade: mais alta quando há slope relevante e z-score significativo
    let quality = 0.8;
    const slopeMag = Math.abs(r.slopePct);
    const zMag = Math.abs(r.zScore ?? 0);
    if (slopeMag >= 0.5 && zMag >= 1.0) quality = 1.0;
    else if (slopeMag >= 0.3 || zMag >= 0.8) quality = 0.9;

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
