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
  minAdx?: number; // limiar de “tendência válida” (default 25)
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
    const len = Math.min(highs.length, lows.length, closes.length);
    if (!len || len < period + 2) {
      return { ok: false as const, reason: "Dados insuficientes." };
    }

    const lastIndex = confirmOnClose ? len - 2 : len - 1;
    const prevIndex = lastIndex - 1;
    if (lastIndex < 1) {
      return { ok: false as const, reason: "Dados insuficientes para confirmar no fechamento." };
    }

    // Série ADX / +DI / -DI
    const raw = TI.ADX.calculate({ period, high: highs, low: lows, close: closes });
    const adxArr = padLeft(
      len,
      raw.map((r) => r.adx),
    );
    const plusArr = padLeft(
      len,
      raw.map((r) => r.pdi),
    );
    const minusArr = padLeft(
      len,
      raw.map((r) => r.mdi),
    );

    const lastAdx = adxArr[lastIndex] as number | null;
    const prevAdx = adxArr[prevIndex] as number | null;
    const lastPlus = plusArr[lastIndex] as number | null;
    const lastMinus = minusArr[lastIndex] as number | null;

    if (lastAdx == null || prevAdx == null || lastPlus == null || lastMinus == null) {
      return { ok: false as const, reason: "Valores ADX/DIs indisponíveis." };
    }

    // Momentum do ADX
    const adxSlope = lastAdx - prevAdx;
    let adxUpStreak = 0; // nº de barras consecutivas com ADX subindo
    for (let i = lastIndex; i >= Math.max(1, lastIndex - 10); i--) {
      const cur = adxArr[i] as number | null;
      const prv = adxArr[i - 1] as number | null;
      if (cur == null || prv == null) break;
      if (cur > prv) adxUpStreak++;
      else break;
    }

    // ADXR (suavização clássica: média do ADX atual com o de "period" barras atrás)
    const adxrSourceIdx = lastIndex - period;
    const pastAdx = adxrSourceIdx >= 0 ? (adxArr[adxrSourceIdx] as number | null) : null;
    const adxr = pastAdx != null ? (lastAdx + pastAdx) / 2 : lastAdx;

    // Direção atual (dominância normalizada)
    // diDom: 0..1 mede o "quanto" uma direcional domina a outra (DX instantâneo)
    const diDiff = Math.abs(lastPlus - lastMinus);
    const diSum = Math.max(1e-9, lastPlus + lastMinus);
    const diDom = diDiff / diSum; // 0..1
    const bullBias = lastPlus > lastMinus;
    const bearBias = lastMinus > lastPlus;

    // Cruzamentos recentes de direcionais (+DI/-DI)
    let barsSinceBullCross: number | null = null;
    let barsSinceBearCross: number | null = null;
    for (let i = lastIndex; i >= Math.max(1, lastIndex - 50); i--) {
      const p = plusArr[i] as number | null;
      const m = minusArr[i] as number | null;
      const pp = plusArr[i - 1] as number | null;
      const pm = minusArr[i - 1] as number | null;
      if (p != null && m != null && pp != null && pm != null) {
        if (barsSinceBullCross == null && pp <= pm && p > m) barsSinceBullCross = lastIndex - i;
        if (barsSinceBearCross == null && pp >= pm && p < m) barsSinceBearCross = lastIndex - i;
        if (barsSinceBullCross != null && barsSinceBearCross != null) break;
      }
    }
    const recentBull = barsSinceBullCross != null && barsSinceBullCross <= recentBars;
    const recentBear = barsSinceBearCross != null && barsSinceBearCross <= recentBars;

    // Estado da tendência (níveis “de mesa” usados por muitos traders)
    const trendActive = lastAdx >= minAdx;
    const adxStrong = lastAdx >= 35;
    const adxVeryStrong = lastAdx >= 45;

    // Exaustão simples: ADX muito alto caindo por >=2 barras
    let adxDownStreak = 0;
    for (let i = lastIndex; i >= Math.max(1, lastIndex - 10); i--) {
      const cur = adxArr[i] as number | null;
      const prv = adxArr[i - 1] as number | null;
      if (cur == null || prv == null) break;
      if (cur < prv) adxDownStreak++;
      else break;
    }
    const possibleExhaustion = adxVeryStrong && adxDownStreak >= 2;

    // Lógicas de entrada (pro):
    // - Exige tendência ativa (ADX >= minAdx)
    // - Direção via dominância de DI
    // - Reforço se ADX subindo (ou streak) OU cruzamento recente de DI
    // - Evitar entradas em exaustão, salvo se o cruzamento for muito recente e dominância for alta
    const momentumOkLong = adxSlope > 0 || adxUpStreak >= 2 || recentBull;
    const momentumOkShort = adxSlope < 0 || adxUpStreak >= 2 || recentBear; // Para short, ADX pode estar subindo também; mantemos simétrico via “streak”
    const dominanceOK = diDom >= 0.1; // ~10% de dominância mínima

    const allowDespiteExhaustionLong = recentBull && diDom >= 0.25;
    const allowDespiteExhaustionShort = recentBear && diDom >= 0.25;

    let entrySignal: "long" | "short" | "none" = "none";
    if (trendActive) {
      if (
        bullBias &&
        dominanceOK &&
        momentumOkLong &&
        (!possibleExhaustion || allowDespiteExhaustionLong)
      ) {
        entrySignal = "long";
      } else if (
        bearBias &&
        dominanceOK &&
        momentumOkShort &&
        (!possibleExhaustion || allowDespiteExhaustionShort)
      ) {
        entrySignal = "short";
      }
    }

    // Confiança (0..1): mistura nível do ADX, momentum, dominância e recência
    const adxLevelFactor = Math.min(1, Math.max(0, lastAdx / 50)); // ADX 50 satura
    const adxrFactor = Math.min(1, Math.max(0, adxr / 50));
    const momentumFactor = Math.min(1, Math.max(0, adxUpStreak) / 3); // 0..1 (>=3 satura)
    const diDomFactor = Math.min(1, diDom / 0.5); // 0..1 (50% de dominância satura)
    const recencyBoost = recentBull || recentBear ? 0.12 : 0;

    let confidence = Math.max(
      0.3,
      0.35 * adxLevelFactor +
        0.2 * adxrFactor +
        0.3 * diDomFactor +
        0.15 * momentumFactor +
        recencyBoost,
    );
    if (!trendActive) confidence = Math.min(confidence, 0.6);
    if (possibleExhaustion && entrySignal !== "none") confidence = Math.max(0.3, confidence - 0.1);
    confidence = Math.min(1, confidence);

    // Qualidade: melhor quando tendência é forte e estável, dominância alta e sem exaustão
    let quality = 0.85;
    if (trendActive && (adxStrong || adxUpStreak >= 2) && diDom >= 0.2)
      quality = Math.max(quality, 0.95);
    if (adxVeryStrong && adxUpStreak >= 2 && diDom >= 0.25) quality = 1.0;
    if (possibleExhaustion) quality = Math.min(quality, 0.9);

    return {
      ok: true as const,
      last: { adx: lastAdx, plusDI: lastPlus, minusDI: lastMinus },
      adx: adxArr,
      plusDI: plusArr,
      minusDI: minusArr,

      // Estados & métricas “pro”
      trendActive,
      bullBias,
      bearBias,
      diDom, // 0..1 (dominância normalizada)
      adxSlope,
      adxUpStreak,
      adxDownStreak,
      adxr,
      adxStrong,
      adxVeryStrong,
      possibleExhaustion,

      // Recência de cruzamentos
      barsSinceBullCross,
      barsSinceBearCross,
      recentBull,
      recentBear,

      // Sinal e scoring
      entrySignal,
      confidence,

      meta: { period, minAdx, lastIndex, recentBars },
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

    // Qualidade coerente com as métricas calculadas acima
    const quality = (() => {
      let q = 0.85;
      if (r.trendActive && (r.adxStrong || r.adxUpStreak >= 2) && r.diDom >= 0.2)
        q = Math.max(q, 0.95);
      if (r.adxVeryStrong && r.adxUpStreak >= 2 && r.diDom >= 0.25) q = 1.0;
      if (r.possibleExhaustion) q = Math.min(q, 0.9);
      return q;
    })();

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
