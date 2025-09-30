import * as TI from "technicalindicators";
import { padLeft } from "../utils/pad-left.js";
import { IIndicatorDecisionMin } from "./types.js";

export type Candles = {
  closes: number[];
  highs: number[];
  lows: number[];
  opens?: number[];
};

export type AdxParams = {
  candles: Candles;
  period?: number; // default 14
  confirmOnClose?: boolean; // true: usa última barra fechada (default)
  minAdx?: number; // limiar para considerar tendência válida (default 25)
  recentBars?: number; // janela p/ cruzamento recente de +DI/-DI (default 3)
};

export class ADXIndicator {
  static calculate({
    candles,
    period = 14,
    confirmOnClose = true,
    minAdx = 25,
    recentBars = 3,
  }: AdxParams) {
    const { highs, lows, closes } = candles;
    const len = closes.length;
    if (!len || !highs?.length || !lows?.length || len < period + 2) {
      return { ok: false as const, reason: "Dados insuficientes." };
    }

    const lastIndex = confirmOnClose ? len - 2 : len - 1;
    const prevIndex = lastIndex - 1;
    if (lastIndex < 1) {
      return { ok: false as const, reason: "Dados insuficientes para confirmar no fechamento." };
    }

    const raw = TI.ADX.calculate({ period, high: highs, low: lows, close: closes });
    const adx = padLeft(
      len,
      raw.map((r) => r.adx),
    );
    const plusDI = padLeft(
      len,
      raw.map((r) => r.pdi),
    );
    const minusDI = padLeft(
      len,
      raw.map((r) => r.mdi),
    );

    const lastAdx = adx[lastIndex] as number | null;
    const lastPlus = plusDI[lastIndex] as number | null;
    const lastMinus = minusDI[lastIndex] as number | null;
    const prevPlus = plusDI[prevIndex] as number | null;
    const prevMinus = minusDI[prevIndex] as number | null;

    const trendActive = lastAdx != null ? lastAdx >= minAdx : false;
    const bullBias = lastPlus != null && lastMinus != null ? lastPlus > lastMinus : false;
    const bearBias = lastPlus != null && lastMinus != null ? lastMinus > lastPlus : false;

    // cruzamentos recentes de direcionais
    let barsSinceBullCross: number | null = null;
    let barsSinceBearCross: number | null = null;
    for (let i = lastIndex; i >= Math.max(1, lastIndex - 50); i--) {
      const p = plusDI[i] as number | null;
      const m = minusDI[i] as number | null;
      const pp = plusDI[i - 1] as number | null;
      const pm = minusDI[i - 1] as number | null;
      if (p != null && m != null && pp != null && pm != null) {
        if (barsSinceBullCross == null && pp <= pm && p > m) barsSinceBullCross = lastIndex - i;
        if (barsSinceBearCross == null && pp >= pm && p < m) barsSinceBearCross = lastIndex - i;
        if (barsSinceBullCross != null && barsSinceBearCross != null) break;
      }
    }

    const recentBull = barsSinceBullCross != null && barsSinceBullCross <= recentBars;
    const recentBear = barsSinceBearCross != null && barsSinceBearCross <= recentBars;

    let entrySignal: "long" | "short" | "none" = "none";
    if (trendActive) {
      if (bullBias || recentBull) entrySignal = "long";
      else if (bearBias || recentBear) entrySignal = "short";
    }

    // confiança baseada em força da tendência e diferença entre direcionais
    const diDiff = lastPlus != null && lastMinus != null ? Math.abs(lastPlus - lastMinus) : 0;
    const adxFactor = lastAdx != null ? Math.min(1, Math.max(0, lastAdx / 50)) : 0; // adx 50 satura
    const diffFactor = Math.min(1, diDiff / 50);
    const confidence = Math.min(
      1,
      Math.max(0.3, (trendActive ? 0.5 : 0.2) + 0.5 * adxFactor + 0.3 * diffFactor),
    );

    return {
      ok: true as const,
      last: { adx: lastAdx ?? null, plusDI: lastPlus ?? null, minusDI: lastMinus ?? null },
      adx,
      plusDI,
      minusDI,
      trendActive,
      bullBias,
      bearBias,
      barsSinceBullCross,
      barsSinceBearCross,
      recentBull,
      recentBear,
      entrySignal,
      confidence,
      meta: { period, minAdx, lastIndex },
    };
  }

  static decision(
    params: AdxParams,
  ): IIndicatorDecisionMin<ReturnType<typeof ADXIndicator.calculate>> {
    const r = ADXIndicator.calculate(params);
    if (!r.ok) {
      return {
        id: "adx",
        direction: "none",
        entry: "no-trigger",
        score: { directional: 0, confidence: 0, quality: 0.5 },
        health: { isValid: false },
        data: r,
      };
    }

    const dir = r.entrySignal === "long" ? 1 : r.entrySignal === "short" ? -1 : 0;
    const quality = r.trendActive ? 1 : 0.7;

    return {
      id: "adx",
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
