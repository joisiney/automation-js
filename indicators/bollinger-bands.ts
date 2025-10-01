import * as TI from "technicalindicators";
import { padLeft } from "../utils/pad-left";
import { IIndicatorDecisionMin } from "./types";

export type Candles = {
  closes: number[];
  highs?: number[];
  lows?: number[];
  opens?: number[];
};

export type BollingerParams = {
  candles: Candles;
  period?: number; // default 20
  stdDev?: number; // default 2
  confirmOnClose?: boolean; // default true (usa última barra fechada)
  recentBars?: number; // janela p/ breakout recente (default 3)
};

type BBPoint = { lower: number; middle: number; upper: number };

function slopeAt(arr: Array<number | null>, idx: number, k: number): number {
  const a = arr[idx] as number | null;
  const b = idx - k >= 0 ? (arr[idx - k] as number | null) : null;
  if (a == null || b == null) return 0;
  return (a - b) / k;
}

export class BollingerBandsIndicator {
  static calculate({
    candles,
    period = 20,
    stdDev = 2,
    confirmOnClose = true,
    recentBars = 3,
  }: BollingerParams) {
    const closes = candles.closes;
    const len = closes.length;
    if (!len || len < period + 2) {
      return { ok: false as const, reason: "Dados insuficientes." };
    }

    const lastIndex = confirmOnClose ? len - 2 : len - 1;
    const prevIndex = lastIndex - 1;
    if (lastIndex < 1) {
      return { ok: false as const, reason: "Dados insuficientes para confirmar no fechamento." };
    }

    // --- Bandas
    const raw: BBPoint[] = TI.BollingerBands.calculate({
      period,
      values: closes as number[],
      stdDev,
    });
    const lower = padLeft(
      len,
      raw.map((b) => b.lower),
    );
    const middle = padLeft(
      len,
      raw.map((b) => b.middle),
    );
    const upper = padLeft(
      len,
      raw.map((b) => b.upper),
    );

    const lc = closes[lastIndex];
    const pc = closes[prevIndex];
    const lLower = lower[lastIndex] as number | null;
    const lMiddle = middle[lastIndex] as number | null;
    const lUpper = upper[lastIndex] as number | null;
    const pLower = lower[prevIndex] as number | null;
    const pUpper = upper[prevIndex] as number | null;

    // Largura e %B (métricas “pro”)
    const bandWidth = lUpper != null && lLower != null ? lUpper - lLower : 0;
    const widthPct = lMiddle ? (bandWidth / lMiddle) * 100 : 0; // largura relativa (%)
    const percentB =
      lUpper != null && lLower != null && bandWidth !== 0 ? (lc - lLower) / bandWidth : 0; // 0..1 dentro das bandas; <0 abaixo; >1 acima

    // Slope da média (tendência ajuda a decidir se é continuação ou MR)
    const SLOPE_K = Math.min(3, lastIndex);
    const middleSlope = slopeAt(middle, lastIndex, SLOPE_K); // valor absoluto por barra
    const middleSlopePct = lMiddle ? (middleSlope / lMiddle) * 100 : 0; // % por barra

    // Posições/eventos
    const touchUpper = lUpper != null ? lc >= lUpper : false;
    const touchLower = lLower != null ? lc <= lLower : false;

    // Reentrada após exceder a banda (mean reversion “clássico”)
    const reenterFromBelow = pLower != null && lLower != null ? pc <= pLower && lc > lLower : false;
    const reenterFromAbove = pUpper != null && lUpper != null ? pc >= pUpper && lc < lUpper : false;

    // Breakout (continuação)
    const breakoutUp = pUpper != null && lUpper != null ? pc <= pUpper && lc > lUpper : false;
    const breakoutDown = pLower != null && lLower != null ? pc >= pLower && lc < lLower : false;

    // “Walking the band”: continua colando na banda com slope a favor
    const walkingUp = touchUpper && middleSlopePct > 0;
    const walkingDown = touchLower && middleSlopePct < 0;

    // Squeeze “de verdade”: largura atual está entre as mais estreitas do lookback
    const SQUEEZE_LOOKBACK = Math.max(40, period * 3);
    const startSq = Math.max(0, lastIndex - SQUEEZE_LOOKBACK + 1);
    const widths = [];
    for (let i = startSq; i <= lastIndex; i++) {
      const m = middle[i] as number | null;
      const u = upper[i] as number | null;
      const l = lower[i] as number | null;
      if (m != null && u != null && l != null && m !== 0) {
        widths.push(((u - l) / m) * 100);
      }
    }
    const sorted = widths.slice().sort((a, b) => a - b);
    const pctRank = sorted.length
      ? sorted.findIndex((w) => w >= widthPct) / Math.max(1, sorted.length - 1)
      : 1; // 0=estreitíssimo, 1=larguíssimo
    const squeeze = pctRank <= 0.2; // largura atual nos 20% mais estreitos do período

    // Recência de breakout (últimos N)
    let barsSinceBreakoutUp: number | null = null;
    let barsSinceBreakoutDown: number | null = null;
    for (let i = lastIndex; i >= Math.max(1, lastIndex - 50); i--) {
      const c = closes[i];
      const u = upper[i] as number | null;
      const l = lower[i] as number | null;
      const pc2 = closes[i - 1];
      const pu = upper[i - 1] as number | null;
      const pl = lower[i - 1] as number | null;
      if (u != null && l != null && pu != null && pl != null) {
        if (barsSinceBreakoutUp == null && pc2 <= pu && c > u) barsSinceBreakoutUp = lastIndex - i;
        if (barsSinceBreakoutDown == null && pc2 >= pl && c < l)
          barsSinceBreakoutDown = lastIndex - i;
        if (barsSinceBreakoutUp != null && barsSinceBreakoutDown != null) break;
      }
    }
    const recentBreakoutUp = barsSinceBreakoutUp != null && barsSinceBreakoutUp <= recentBars;
    const recentBreakoutDown = barsSinceBreakoutDown != null && barsSinceBreakoutDown <= recentBars;

    // Estratégia “pro”:
    // 1) Continuação: breakout recente + slope da média a favor (ou walking the band)
    // 2) Mean reversion: apenas em squeeze + reentrada na banda (não só “toque”)
    let entrySignal: "long" | "short" | "none" = "none";

    // Continuação
    const contLong = (recentBreakoutUp || breakoutUp || walkingUp) && middleSlopePct > 0;
    const contShort = (recentBreakoutDown || breakoutDown || walkingDown) && middleSlopePct < 0;

    // Mean reversion (mais conservador)
    const mrLong =
      squeeze &&
      reenterFromBelow &&
      percentB > 0 &&
      percentB < 0.35 &&
      Math.abs(middleSlopePct) < 0.15;
    const mrShort =
      squeeze &&
      reenterFromAbove &&
      percentB < 1 &&
      percentB > 0.65 &&
      Math.abs(middleSlopePct) < 0.15;

    if (contLong) entrySignal = "long";
    else if (contShort) entrySignal = "short";
    else if (mrLong) entrySignal = "long";
    else if (mrShort) entrySignal = "short";

    // Confiança (0..1): combina estrutura, largura, posição %B e recência
    const structure = contLong || contShort ? 0.55 : mrLong || mrShort ? 0.45 : 0.3;

    // largura maior → movimentos de continuação tendem a ter mais follow-through
    const widthFactor = Math.min(1, Math.max(0, widthPct / 6)); // >=6% satura
    // squeeze forte ajuda MR
    const squeezeFactor = squeeze ? (1 - pctRank) * 0.6 : 0;

    // %B distância do centro, útil p/ medir “força”/“afastamento”
    const distFromMid = Math.abs(percentB - 0.5) * 2; // 0..1
    const trendFactor = contLong
      ? Math.min(1, Math.max(0, middleSlopePct / 0.3))
      : contShort
        ? Math.min(1, Math.max(0, -middleSlopePct / 0.3))
        : 0;

    const breakoutBoost = recentBreakoutUp || recentBreakoutDown ? 0.15 : 0;

    let confidence =
      structure +
      0.25 * (contLong || contShort ? widthFactor : squeezeFactor) +
      0.25 * distFromMid +
      0.25 * trendFactor +
      breakoutBoost;

    confidence = Math.max(0.3, Math.min(1, confidence));

    // Qualidade: continuação com largura expandida é a melhor; MR em squeeze é boa, mas menor
    let quality = 0.85;
    if (contLong || contShort) {
      quality = Math.max(quality, 0.95);
      if (widthPct >= 4 && Math.abs(middleSlopePct) >= 0.15) quality = 1.0;
    } else if (mrLong || mrShort) {
      quality = Math.max(quality, 0.9);
    }

    return {
      ok: true as const,
      last: { lower: lLower ?? null, middle: lMiddle ?? null, upper: lUpper ?? null },
      lower,
      middle,
      upper,
      widthPct,
      percentB,
      middleSlopePct,
      touchUpper,
      touchLower,
      reenterFromBelow,
      reenterFromAbove,
      breakoutUp,
      breakoutDown,
      walkingUp,
      walkingDown,
      squeeze,
      barsSinceBreakoutUp,
      barsSinceBreakoutDown,
      recentBreakoutUp,
      recentBreakoutDown,
      entrySignal,
      meta: { period, stdDev, lastIndex, squeezeLookback: SQUEEZE_LOOKBACK, slopeWindow: SLOPE_K },
      confidence,
    };
  }

  static decision(
    params: BollingerParams,
  ): IIndicatorDecisionMin<ReturnType<typeof BollingerBandsIndicator.calculate>> {
    const r = BollingerBandsIndicator.calculate(params);
    if (!r.ok) {
      return {
        id: "bollinger",
        direction: "none",
        entry: "no-trigger",
        score: { directional: 0, confidence: 0, quality: 0.5 },
        health: { isValid: false },
        data: r,
      };
    }

    const dir = r.entrySignal === "long" ? 1 : r.entrySignal === "short" ? -1 : 0;
    const quality = (() => {
      if (r.entrySignal === "none") return 0.8;
      // promover continuação com largura expandindo e slope forte
      if (
        (r.breakoutUp || r.breakoutDown || r.walkingUp || r.walkingDown) &&
        Math.abs(r.middleSlopePct) >= 0.15
      ) {
        return r.widthPct >= 4 ? 1 : 0.95;
      }
      // MR em squeeze tem qualidade boa, mas menor que continuação forte
      if (r.squeeze && (r.reenterFromBelow || r.reenterFromAbove)) return 0.9;
      return 0.85;
    })();

    return {
      id: "bollinger",
      direction: dir > 0 ? "buy" : dir < 0 ? "sell" : "none",
      entry: dir !== 0 ? "triggered" : "no-trigger",
      score: {
        directional: dir,
        confidence: r.confidence,
        quality,
      },
      health: { isValid: true },
      data: r,
    };
  }
}
