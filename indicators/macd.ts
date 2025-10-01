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
  recentBars?: number; // janela p/ cruzamentos "recentes" (default 3)
};

type MacdPoint = { MACD: number; signal: number; histogram: number };

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
  const variance = (sum2 - n * mean * mean) / (n - 1);
  return variance > 0 ? Math.sqrt(variance) : 0;
}

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

    const lastIndex = confirmOnClose ? len - 2 : len - 1;
    const prevIndex = lastIndex - 1;
    if (lastIndex < 1) {
      return { ok: false as const, reason: "Dados insuficientes para confirmar no fechamento." };
    }

    // Série MACD
    const raw = TI.MACD.calculate({
      fastPeriod,
      slowPeriod,
      signalPeriod,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
      values: closes as number[],
    });

    const macd = padLeft(len, raw.map((m) => m.MACD ?? null) as Array<number | null>);
    const signal = padLeft(len, raw.map((m) => m.signal ?? null) as Array<number | null>);
    const hist = padLeft(len, raw.map((m) => m.histogram ?? null) as Array<number | null>);

    const lastMACD = macd[lastIndex] as number | null;
    const lastSignal = signal[lastIndex] as number | null;
    const lastHist = hist[lastIndex] as number | null;

    const prevMACD = macd[prevIndex] as number | null;
    const prevSignal = signal[prevIndex] as number | null;
    const prevHist = hist[prevIndex] as number | null;

    if (
      lastMACD == null ||
      lastSignal == null ||
      lastHist == null ||
      prevMACD == null ||
      prevSignal == null ||
      prevHist == null
    ) {
      return { ok: false as const, reason: "MACD/sinal/Histograma indisponíveis." };
    }

    // Estados base
    const macdAboveSignal = lastMACD > lastSignal;
    const macdAboveZero = lastMACD > 0;
    const histAboveZero = lastHist > 0;

    // Cruzamentos imediatos
    const bullCross = prevMACD <= prevSignal && lastMACD > lastSignal;
    const bearCross = prevMACD >= prevSignal && lastMACD < lastSignal;

    // Recência de cruzamentos MACD↔signal (últimos N barras)
    let barsSinceBullCross: number | null = null;
    let barsSinceBearCross: number | null = null;

    // Recência de cruzamentos MACD↔zero (zero-line)
    let barsSinceZeroUp: number | null = null;
    let barsSinceZeroDown: number | null = null;

    for (let i = lastIndex; i >= Math.max(1, lastIndex - 50); i--) {
      const m = macd[i] as number | null,
        s = signal[i] as number | null;
      const pm = macd[i - 1] as number | null,
        ps = signal[i - 1] as number | null;
      if (m != null && s != null && pm != null && ps != null) {
        if (barsSinceBullCross == null && pm <= ps && m > s) barsSinceBullCross = lastIndex - i;
        if (barsSinceBearCross == null && pm >= ps && m < s) barsSinceBearCross = lastIndex - i;
      }
      // zero-line
      if (barsSinceZeroUp == null && pm != null && m != null && pm <= 0 && m > 0) {
        barsSinceZeroUp = lastIndex - i;
      }
      if (barsSinceZeroDown == null && pm != null && m != null && pm >= 0 && m < 0) {
        barsSinceZeroDown = lastIndex - i;
      }
      if (
        barsSinceBullCross != null &&
        barsSinceBearCross != null &&
        barsSinceZeroUp != null &&
        barsSinceZeroDown != null
      ) {
        break;
      }
    }

    const recentBull = barsSinceBullCross != null && barsSinceBullCross <= recentBars;
    const recentBear = barsSinceBearCross != null && barsSinceBearCross <= recentBars;
    const recentZeroUp = barsSinceZeroUp != null && barsSinceZeroUp <= recentBars;
    const recentZeroDown = barsSinceZeroDown != null && barsSinceZeroDown <= recentBars;

    // Momentum multi-janela (evita ruído de 1 barra)
    const slopeK1 = lastMACD - prevMACD;
    const k = Math.min(3, lastIndex);
    const macdK = macd[lastIndex - k] as number | null;
    const histK = hist[lastIndex - k] as number | null;
    const slopeK3_macd = macdK != null ? (lastMACD - macdK) / k : 0;
    const slopeK3_hist = histK != null ? (lastHist - histK) / k : 0;

    // Força relativa do histograma vs média recente
    const histWindow = Math.max(5, Math.min(20, signalPeriod * 2));
    const start = Math.max(0, lastIndex - histWindow + 1);
    const recentHist = hist
      .slice(start, lastIndex + 1)
      .filter((x): x is number => x != null) as number[];
    const avgAbsHist = recentHist.length
      ? recentHist.reduce((a, b) => a + Math.abs(b), 0) / recentHist.length
      : 0;
    const histStrength = avgAbsHist ? Math.abs(lastHist) / avgAbsHist : 0; // >1 = forte

    // Significância estatística (z-score) — tanto do MACD quanto do histograma
    const stdMACD = rollingStd(macd, Math.max(10, signalPeriod), lastIndex) || 0;
    const stdHIST = rollingStd(hist, Math.max(10, signalPeriod), lastIndex) || 0;
    const zMACD = stdMACD > 0 ? lastMACD / stdMACD : 0;
    const zHIST = stdHIST > 0 ? lastHist / stdHIST : 0;

    // Leitura “profissional”: viés + gatilhos
    // Long "forte" tipicamente: MACD>Signal, Hist>0, momentum (hist subindo) e (MACD>0 ou zeroUp recente)
    // Short análogo
    let bias: "buy" | "sell" | "neutral" = "neutral";
    if (macdAboveSignal && histAboveZero && (macdAboveZero || recentZeroUp) && slopeK3_hist >= 0) {
      bias = "buy";
    } else if (
      !macdAboveSignal &&
      !histAboveZero &&
      (!macdAboveZero || recentZeroDown) &&
      slopeK3_hist <= 0
    ) {
      bias = "sell";
    }

    // Sinal de entrada: prioriza cruzamentos recentes; em seguida o bias
    const entrySignal: "long" | "short" | "none" = recentBull
      ? "long"
      : recentBear
        ? "short"
        : bias === "buy"
          ? "long"
          : bias === "sell"
            ? "short"
            : "none";

    // Confidence (0..1): combina votos + histStrength + z-scores + recência
    // Observação: no seu código original a confidence saturava ~0.62.
    const votes = [
      macdAboveSignal ? 1 : -1,
      histAboveZero ? 1 : -1,
      macdAboveZero ? 1 : -1,
      slopeK3_hist >= 0 ? 1 : -1,
      bullCross ? 1 : bearCross ? -1 : 0,
      recentZeroUp ? 1 : recentZeroDown ? -1 : 0,
    ];
    const voteScore = votes.reduce((a, b) => a + b, 0) / votes.length; // -1..+1
    const voteFactor = (voteScore + 1) / 2; // 0..1

    // Normalizações suaves (saturações)
    const histFactor = Math.min(1, histStrength / 1.5); // >=1.5 já satura
    const zMacdFactor = Math.min(1, Math.abs(zMACD) / 2.5); // |z|>=2.5 satura
    const zHistFactor = Math.min(1, Math.abs(zHIST) / 2.5);
    const recencyBoost = recentBull || recentBear || recentZeroUp || recentZeroDown ? 0.15 : 0;

    const confidence = Math.min(
      1,
      Math.max(
        0.3,
        0.35 * voteFactor +
          0.25 * histFactor +
          0.2 * zMacdFactor +
          0.15 * zHistFactor +
          recencyBoost,
      ),
    );

    // Qualidade: recompensa quando há combinação de gatilho + estrutura alinhada
    let quality = 0.8;
    const strongStructLong =
      macdAboveSignal && histAboveZero && (macdAboveZero || recentZeroUp) && slopeK3_hist > 0;
    const strongStructShort =
      !macdAboveSignal && !histAboveZero && (!macdAboveZero || recentZeroDown) && slopeK3_hist < 0;
    if ((recentBull && strongStructLong) || (recentBear && strongStructShort)) {
      quality = 1.0;
    } else if (strongStructLong || strongStructShort) {
      quality = Math.max(quality, 0.92);
    }
    if (confidence >= 0.85) quality = Math.max(quality, 0.95);

    return {
      ok: true as const,
      last: { macd: lastMACD, signal: lastSignal, hist: lastHist },
      macd,
      signal,
      hist,
      macdAboveSignal,
      macdAboveZero,
      histAboveZero,
      bullCross,
      bearCross,
      macdSlope: slopeK1,
      histSlope: lastHist - prevHist,
      slopeK3_macd,
      slopeK3_hist,
      histStrength,
      zMACD,
      zHIST,
      barsSinceBullCross,
      barsSinceBearCross,
      barsSinceZeroUp,
      barsSinceZeroDown,
      recentBull,
      recentBear,
      recentZeroUp,
      recentZeroDown,
      bias,
      confidence,
      entrySignal,
      meta: { fastPeriod, slowPeriod, signalPeriod, lastIndex, recentBars },
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

    // Qualidade já computada acima; aqui só repassamos e garantimos limites
    const quality = Math.max(
      0.5,
      Math.min(
        1,
        ((): number => {
          let q = 0.8;
          const strongStructLong =
            r.macdAboveSignal &&
            r.histAboveZero &&
            (r.macdAboveZero || r.recentZeroUp) &&
            r.slopeK3_hist > 0;
          const strongStructShort =
            !r.macdAboveSignal &&
            !r.histAboveZero &&
            (!r.macdAboveZero || r.recentZeroDown) &&
            r.slopeK3_hist < 0;
          if ((r.recentBull && strongStructLong) || (r.recentBear && strongStructShort)) q = 1.0;
          else if (strongStructLong || strongStructShort) q = Math.max(q, 0.92);
          if (r.confidence >= 0.85) q = Math.max(q, 0.95);
          return q;
        })(),
      ),
    );

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
