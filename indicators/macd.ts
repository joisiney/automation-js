import * as TI from "technicalindicators";
import { padLeft } from "../utils/pad-left";
import { IIndicatorDecisionMin } from "./types";

export type Candles = {
  closes: number[];
  highs?: number[];
  lows?: number[];
  opens?: number[];
};

export type MacdParams = {
  candles: Candles;
  confirmOnClose?: boolean; // default true: usa última barra fechada
  fastPeriod?: number; // default 12
  slowPeriod?: number; // default 26
  signalPeriod?: number; // default 9
  recentBars?: number; // janelinha para considerar cruzamentos "recentes" (default 3)
};

type MacdPoint = { MACD: number; signal: number; histogram: number };

export class MACDIndicator {
  static calculate({
    candles,
    confirmOnClose = true,
    fastPeriod = 12,
    slowPeriod = 26,
    signalPeriod = 9,
    recentBars = 3,
  }: MacdParams) {
    const closes = candles.closes;
    const len = closes.length;
    if (!len || len < Math.max(fastPeriod, slowPeriod, signalPeriod) + 2) {
      return { ok: false as const, reason: "Dados insuficientes." };
    }

    // índice de referência: última barra fechada (ou atual, se explicitado)
    const lastIndex = confirmOnClose ? len - 2 : len - 1;
    const prevIndex = lastIndex - 1;
    if (lastIndex < 1) {
      return { ok: false as const, reason: "Dados insuficientes para confirmar no fechamento." };
    }

    // Série MACD completa
    const raw = TI.MACD.calculate({
      fastPeriod,
      slowPeriod,
      signalPeriod,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
      values: closes as number[],
    });

    // alinhar ao comprimento dos candles
    const macd = padLeft(len, raw.map((m) => m.MACD ?? null) as Array<number | null>);
    const signal = padLeft(len, raw.map((m) => m.signal ?? null) as Array<number | null>);
    const hist = padLeft(len, raw.map((m) => m.histogram ?? null) as Array<number | null>);

    const lastMACD = macd[lastIndex] as number | null;
    const lastSignal = signal[lastIndex] as number | null;
    const lastHist = hist[lastIndex] as number | null;

    const prevMACD = macd[prevIndex] as number | null;
    const prevSignal = signal[prevIndex] as number | null;
    const prevHist = hist[prevIndex] as number | null;

    // Estados base
    const macdAboveSignal = lastMACD != null && lastSignal != null ? lastMACD > lastSignal : false;
    const macdAboveZero = lastMACD != null ? lastMACD > 0 : false;
    const histAboveZero = lastHist != null ? lastHist > 0 : false;

    // Cruzamentos entre t-1 e t
    const bullCross =
      prevMACD != null && prevSignal != null && lastMACD != null && lastSignal != null
        ? prevMACD <= prevSignal && lastMACD > lastSignal
        : false;
    const bearCross =
      prevMACD != null && prevSignal != null && lastMACD != null && lastSignal != null
        ? prevMACD >= prevSignal && lastMACD < lastSignal
        : false;

    // Inclinação (momentum) – MACD e Histograma
    const macdSlope = lastMACD != null && prevMACD != null ? lastMACD - prevMACD : 0;
    const histSlope = lastHist != null && prevHist != null ? lastHist - prevHist : 0;

    // Força relativa do sinal pelo histograma vs média recente
    const histWindow = Math.max(5, Math.min(20, signalPeriod * 2));
    const start = Math.max(0, lastIndex - histWindow + 1);
    const recentHist = hist
      .slice(start, lastIndex + 1)
      .filter((x) => typeof x === "number") as number[];
    const avgAbsHist = recentHist.length
      ? recentHist.reduce((a, b) => a + Math.abs(b), 0) / recentHist.length
      : 0;
    const histStrength = avgAbsHist ? Math.abs(lastHist ?? 0) / avgAbsHist : 0; // >1 indica hist recente relativamente forte

    // Recência de cruzamentos (últimos N bares)
    let barsSinceBullCross: number | null = null;
    let barsSinceBearCross: number | null = null;
    for (let i = lastIndex; i >= Math.max(1, lastIndex - 50); i--) {
      const m = macd[i] as number | null;
      const s = signal[i] as number | null;
      const pm = macd[i - 1] as number | null;
      const ps = signal[i - 1] as number | null;
      if (m != null && s != null && pm != null && ps != null) {
        if (barsSinceBullCross == null && pm <= ps && m > s) {
          barsSinceBullCross = lastIndex - i;
        }
        if (barsSinceBearCross == null && pm >= ps && m < s) {
          barsSinceBearCross = lastIndex - i;
        }
        if (barsSinceBullCross != null && barsSinceBearCross != null) break;
      }
    }

    const recentBull = barsSinceBullCross != null && barsSinceBullCross <= recentBars;
    const recentBear = barsSinceBearCross != null && barsSinceBearCross <= recentBars;

    // Leitura profissional resumida
    // Buy forte: MACD>Signal, hist>0, histSlope>0, MACD>0, cruzamento recente
    // Sell forte: condições espelhadas
    let bias: "buy" | "sell" | "neutral" = "neutral";
    if (macdAboveSignal && histAboveZero && macdAboveZero && histSlope >= 0) bias = "buy";
    else if (!macdAboveSignal && !histAboveZero && !macdAboveZero && histSlope <= 0) bias = "sell";

    // Confiança (0..1) ponderada por múltiplos fatores
    const votes = [
      macdAboveSignal ? 1 : -1,
      histAboveZero ? 1 : -1,
      macdAboveZero ? 1 : -1,
      histSlope >= 0 ? 1 : -1,
      bullCross ? 1 : bearCross ? -1 : 0,
    ];
    const scoreRaw = votes.reduce((a, b) => a + b, 0) / (2 * votes.length); // entre -0.5..0.5
    const confidence = Math.min(
      1,
      Math.max(0, Math.abs(scoreRaw) * (0.75 + 0.25 * Math.min(2, histStrength))),
    );

    const entrySignal: "long" | "short" | "none" = recentBull
      ? "long"
      : recentBear
        ? "short"
        : bias === "buy"
          ? "long"
          : bias === "sell"
            ? "short"
            : "none";

    return {
      ok: true as const,
      last: {
        macd: lastMACD ?? null,
        signal: lastSignal ?? null,
        hist: lastHist ?? null,
      },
      macd,
      signal,
      hist,
      macdAboveSignal,
      macdAboveZero,
      histAboveZero,
      bullCross,
      bearCross,
      macdSlope,
      histSlope,
      histStrength,
      barsSinceBullCross,
      barsSinceBearCross,
      recentBull,
      recentBear,
      bias,
      confidence,
      entrySignal,
      meta: {
        fastPeriod,
        slowPeriod,
        signalPeriod,
        lastIndex,
      },
    };
  }

  static decision(
    params: MacdParams,
  ): IIndicatorDecisionMin<ReturnType<typeof MACDIndicator.calculate>> {
    const r = MACDIndicator.calculate(params);
    if (!r.ok) {
      return {
        id: "macd",
        direction: "none",
        entry: "no-trigger",
        score: { directional: 0, confidence: 0, quality: 0.5 },
        health: { isValid: false },
        data: r,
      };
    }

    const dir = r.entrySignal === "long" ? 1 : r.entrySignal === "short" ? -1 : 0;

    // qualidade: combina força do histograma e recência de cruzamento
    let quality = 1;
    if (r.recentBull || r.recentBear) quality += 0.0;
    quality = Math.min(1, Math.max(0.5, quality));

    return {
      id: "macd",
      direction: dir > 0 ? "buy" : dir < 0 ? "sell" : "none",
      entry: dir !== 0 ? "triggered" : "no-trigger",
      score: {
        directional: dir,
        confidence: Math.max(0, Math.min(1, r.confidence)),
        quality,
      },
      health: { isValid: true },
      data: r,
    };
  }
}
