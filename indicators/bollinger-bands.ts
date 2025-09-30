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

    const widthPct = lMiddle ? (((lUpper ?? lMiddle) - (lLower ?? lMiddle)) / lMiddle) * 100 : 0;

    // Posições e eventos
    const touchUpper = lUpper != null ? lc >= lUpper : false;
    const touchLower = lLower != null ? lc <= lLower : false;
    const position: "inside" | "touch_upper" | "touch_lower" | "outside" = touchUpper
      ? "touch_upper"
      : touchLower
        ? "touch_lower"
        : lUpper != null && lLower != null && (lc > lUpper || lc < lLower)
          ? "outside"
          : "inside";

    const breakoutUp = pUpper != null && lUpper != null ? pc <= pUpper && lc > lUpper : false;
    const breakoutDown = pLower != null && lLower != null ? pc >= pLower && lc < lLower : false;

    // Squeeze simples: largura das bandas estreita
    const squeeze = widthPct > 0 ? widthPct <= 2.0 : false; // ~2% do middle

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

    // Estratégia: prioriza breakout (continuação). Mean reversion só quando squeeze e toque extremo
    let entrySignal: "long" | "short" | "none" = "none";
    if (recentBreakoutUp || breakoutUp) entrySignal = "long";
    else if (recentBreakoutDown || breakoutDown) entrySignal = "short";
    else if (squeeze && touchLower) entrySignal = "long";
    else if (squeeze && touchUpper) entrySignal = "short";

    return {
      ok: true as const,
      last: { lower: lLower ?? null, middle: lMiddle ?? null, upper: lUpper ?? null },
      lower,
      middle,
      upper,
      widthPct,
      position,
      touchUpper,
      touchLower,
      breakoutUp,
      breakoutDown,
      squeeze,
      barsSinceBreakoutUp,
      barsSinceBreakoutDown,
      recentBreakoutUp,
      recentBreakoutDown,
      entrySignal,
      meta: { period, stdDev, lastIndex },
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
    // confiança pondera breakout e largura de banda (movimentos em bandas mais largas tendem a ser mais significativos)
    const widthFactor = Math.min(1, Math.max(0, r.widthPct / 5)); // >=5% satura
    const breakoutBoost = r.recentBreakoutUp || r.recentBreakoutDown ? 0.25 : 0;
    const confidence = Math.min(
      1,
      Math.max(0.3, Math.abs(dir) * (0.5 + widthFactor + breakoutBoost)),
    );
    const quality = r.squeeze ? 0.8 : 1;

    return {
      id: "bollinger",
      direction: dir > 0 ? "buy" : dir < 0 ? "sell" : "none",
      entry: dir !== 0 ? "triggered" : "no-trigger",
      score: {
        directional: dir,
        confidence,
        quality,
      },
      health: { isValid: true },
      data: r,
    };
  }
}
