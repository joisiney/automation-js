import * as TI from "technicalindicators";
import { padLeft } from "../utils/pad-left";
import { IIndicatorDecisionMin } from "./types";

export type Candles = {
  closes: number[];
  highs?: number[];
  lows?: number[];
  opens?: number[];
};

export type EmaProParams = {
  /** EMA curta (TF de execução) */
  period: number;
  candles: Candles;

  /** Usa última barra fechada (default: true). Se false, avalia intrabar. */
  confirmOnClose?: boolean;

  /** ATR para volatilidade/risco (default: 14) */
  atrPeriod?: number;

  /** Janela do slope da EMA curta (default: 3) */
  slopeWindow?: number;

  /** “Recente” (default: 3) — usado para cruzamentos/touch */
  recentBars?: number;

  /** Múltiplo do ATR para stop sugerido (default: 1.5) */
  atrStopMultiple?: number;

  /** Lookback para buscar último cruzamento (default: 10; use Infinity p/ todo histórico) */
  maxLookback?: number;

  /** Como retornar “não encontrado” (compat) */
  barsSinceMode?: "infinity" | "null";

  /** >>> Regime de 1 HTF (opcional). Veta operações contra o regime. <<< */
  htf?: {
    candles: Candles; // série do HTF (ex.: 1h se executa em 5m)
    period?: number; // EMA do HTF (default: 50)
    confirmOnClose?: boolean; // default: true
  };
};

export class EMAIndicator {
  static calculate({
    period,
    candles,
    confirmOnClose = true,
    atrPeriod = 14,
    slopeWindow = 3,
    recentBars = 3,
    atrStopMultiple = 1.5,
    maxLookback = 10,
    barsSinceMode = "infinity",
    htf,
  }: EmaProParams) {
    const closes = candles.closes;
    const len = closes.length;
    if (!len || len < Math.max(period, slopeWindow) + 2) {
      return { ok: false as const, reason: "Dados insuficientes." };
    }

    const lastIndex = confirmOnClose ? len - 2 : len - 1;
    const prevIndex = lastIndex - 1;
    if (lastIndex < 1) {
      return { ok: false as const, reason: "Dados insuficientes para confirmar no fechamento." };
    }

    // -------- EMA curta (núcleo de timing)
    const emaArr = padLeft(len, TI.EMA.calculate({ period, values: closes }));
    const lastEma = emaArr[lastIndex] as number | null;
    const prevEma = emaArr[prevIndex] as number | null;

    const price = closes[lastIndex];
    const prevPrice = closes[prevIndex];

    const above = lastEma != null ? price > lastEma : false;
    const below = lastEma != null ? price < lastEma : false;

    // Cruzamento preço↔EMA (sem look-ahead)
    const crossUp =
      prevEma != null && lastEma != null ? prevPrice <= prevEma && price > lastEma : false;
    const crossDown =
      prevEma != null && lastEma != null ? prevPrice >= prevEma && price < lastEma : false;

    // Slope (inclinação) da EMA
    const refIndex = lastIndex - slopeWindow;
    const emaRef = refIndex >= 0 ? (emaArr[refIndex] as number | null) : null;
    const slopeAbs = lastEma != null && emaRef != null ? (lastEma - emaRef) / slopeWindow : 0;
    const slopePct = lastEma ? slopeAbs / lastEma : 0;

    // -------- ATR (volatilidade) e limites ADAPTATIVOS
    let lastATR: number | undefined;
    if (candles.highs && candles.lows) {
      const atrCalc = TI.ATR.calculate({
        period: atrPeriod,
        high: candles.highs,
        low: candles.lows,
        close: closes,
      });
      const atr = padLeft(len, atrCalc);
      const v = atr[lastIndex];
      lastATR = typeof v === "number" ? v : undefined;
    }

    // Distância preço↔EMA
    const distance = lastEma != null ? price - lastEma : 0;
    const distancePct = lastEma ? distance / lastEma : 0;

    // Extensão e slope mínimos adaptativos à volatilidade
    const volPct = lastATR && lastEma ? lastATR / lastEma : 0; // ATR como % do preço médio
    const maxExt = Math.max(0.006, Math.min(0.03, 1.2 * volPct)); // 0.6%..3.0% (flexível)
    const slopeFloor = Math.max(0.0001, 0.3 * volPct); // mínimo de slope por barra relativo à vol
    const slopeUp = slopePct > slopeFloor;
    const slopeDown = slopePct < -slopeFloor;
    const withinExtension = Math.abs(distancePct) <= maxExt;

    // -------- Pullback/Reteste à EMA após o cruzamento (timing realista)
    function touchedEMA(iFrom: number, iTo: number): boolean {
      const start = iFrom;
      const end = Math.max(0, iTo);
      const tolAbs = lastATR ? 0.2 * lastATR : 0; // 0.2×ATR como folga
      for (let i = start; i >= end; i--) {
        const e = emaArr[i] as number | null;
        if (e == null) continue;
        const diff = Math.abs(closes[i] - e);
        if (diff <= (tolAbs || Math.abs(e) * 0.001)) return true; // fallback 0.1% da EMA
      }
      return false;
    }
    const pullbackWindow = Math.max(2, recentBars);
    const pullbackOk = touchedEMA(lastIndex, lastIndex - pullbackWindow);

    // -------- Recência do cruzamento (para gatilho)
    const lookback = Number.isFinite(maxLookback) ? (maxLookback as number) : Infinity;
    let barsSinceCrossUp: number | null | "Infinity" =
      barsSinceMode === "infinity" ? ("Infinity" as const) : null;
    let barsSinceCrossDown: number | null | "Infinity" =
      barsSinceMode === "infinity" ? ("Infinity" as const) : null;

    const start = Math.max(1, lastIndex - (Number.isFinite(lookback) ? lookback : lastIndex));
    for (let i = lastIndex; i >= start; i--) {
      const p = closes[i];
      const e = emaArr[i] as number | null;
      const pp = closes[i - 1];
      const pe = emaArr[i - 1] as number | null;
      if (pp != null && pe != null && e != null) {
        if (
          (barsSinceMode === "infinity"
            ? barsSinceCrossUp === "Infinity"
            : barsSinceCrossUp === null) &&
          pp <= pe &&
          p > e
        )
          barsSinceCrossUp = (lastIndex - i) as unknown as typeof barsSinceCrossUp;
        if (
          (barsSinceMode === "infinity"
            ? barsSinceCrossDown === "Infinity"
            : barsSinceCrossDown === null) &&
          pp >= pe &&
          p < e
        )
          barsSinceCrossDown = (lastIndex - i) as unknown as typeof barsSinceCrossDown;

        const upDone =
          barsSinceMode === "infinity"
            ? barsSinceCrossUp !== "Infinity"
            : barsSinceCrossUp !== null;
        const dnDone =
          barsSinceMode === "infinity"
            ? barsSinceCrossDown !== "Infinity"
            : barsSinceCrossDown !== null;
        if (upDone && dnDone) break;
      }
    }

    const upBarsNum: number =
      barsSinceMode === "infinity"
        ? barsSinceCrossUp === "Infinity"
          ? Infinity
          : (barsSinceCrossUp as unknown as number)
        : typeof barsSinceCrossUp === "number"
          ? barsSinceCrossUp
          : Infinity;

    const dnBarsNum: number =
      barsSinceMode === "infinity"
        ? barsSinceCrossDown === "Infinity"
          ? Infinity
          : (barsSinceCrossDown as unknown as number)
        : typeof barsSinceCrossDown === "number"
          ? barsSinceCrossDown
          : Infinity;

    const recentCrossUp = upBarsNum <= recentBars;
    const recentCrossDown = dnBarsNum <= recentBars;

    // -------- Regime do HTF (apenas 1 nível, opcional) — veto contra-tendência
    let regime: "bull" | "bear" | "neutral" = "neutral";
    if (htf?.candles?.closes?.length) {
      const hcloses = htf.candles.closes;
      const hlen = hcloses.length;
      const hLast = (htf.confirmOnClose ?? true) ? hlen - 2 : hlen - 1;
      if (hlen > 2 && hLast >= 1) {
        const hPeriod = htf.period ?? 50;
        const hema = padLeft(hlen, TI.EMA.calculate({ period: hPeriod, values: hcloses }));
        const hEmaLast = hema[hLast] as number | null;
        const hPrice = hcloses[hLast];
        if (hEmaLast != null) {
          regime = hPrice > hEmaLast ? "bull" : hPrice < hEmaLast ? "bear" : "neutral";
        }
      }
    }

    // -------- Regras profissionais (simples e conservadoras)
    // Direção básica precisa de: posição vs EMA + slope adaptativo
    const longOkDir = above && slopeUp;
    const shortOkDir = below && slopeDown;

    // Gatilho: cruzamento recente OU preço/EMA dentro de extensão saudável E pullback realizado
    const longTrigger = (recentCrossUp || (withinExtension && above)) && pullbackOk;
    const shortTrigger = (recentCrossDown || (withinExtension && below)) && pullbackOk;

    // Veto do HTF (se configurado)
    const regimeOkLong = regime !== "bear";
    const regimeOkShort = regime !== "bull";

    const entryLong = longOkDir && longTrigger && withinExtension && regimeOkLong;
    const entryShort = shortOkDir && shortTrigger && withinExtension && regimeOkShort;

    const entrySignal: "long" | "short" | "none" = entryLong
      ? "long"
      : entryShort
        ? "short"
        : "none";

    // -------- Stops sugeridos (ATR)
    const stopLong = lastATR != null ? price - atrStopMultiple * lastATR : undefined;
    const stopShort = lastATR != null ? price + atrStopMultiple * lastATR : undefined;

    // -------- Confiança/Qualidade (explicáveis, 0..1)
    const base = entrySignal !== "none" ? 0.55 : 0.35;

    // Quanto melhor o slope (vs piso) e quanto mais “colado” na EMA (evita esticado)
    const slopeGain = lastEma
      ? Math.min(1, Math.max(0, Math.abs(slopePct) / Math.max(1e-6, slopeFloor)))
      : 0;
    const distGood = Math.min(1, 1 - Math.min(1, Math.abs(distancePct) / Math.max(1e-6, maxExt)));
    const pullBoost = pullbackOk ? 0.15 : 0;
    const regimeBoost =
      (entrySignal === "long" && regime === "bull") ||
      (entrySignal === "short" && regime === "bear")
        ? 0.15
        : 0;

    const confidence = Math.min(
      1,
      Math.max(0.3, base + 0.35 * slopeGain + 0.35 * distGood + pullBoost + regimeBoost),
    );

    let quality = 0.85;
    if (entrySignal !== "none") quality = Math.max(quality, 0.92);
    if (pullBoost > 0 && regimeBoost > 0) quality = 1.0;

    return {
      ok: true as const,

      // Núcleo p/ o ensemble e debugging
      last: lastEma,
      above,
      below,
      crossUp,
      crossDown,

      slopeAbs,
      slopePct,
      withinExtension,
      distancePct,

      // Vol/risco
      lastATR,
      stopLong,
      stopShort,

      // Recência
      barsSinceCrossUp,
      barsSinceCrossDown,
      recentCrossUp,
      recentCrossDown,

      // Pullback e regime
      pullbackOk,
      regime,

      // Sinal final
      entrySignal,

      // Scoring
      confidence,
      quality,

      meta: {
        period,
        atrPeriod,
        slopeWindow,
        recentBars,
        atrStopMultiple,
        maxLookback,
        barsSinceMode,
        maxExtPctAdaptive: maxExt,
        slopeFloorAdaptive: slopeFloor,
        confirmOnClose,
        htf: htf ? { period: htf.period ?? 50, used: true } : { used: false },
        lastIndex,
      },
    };
  }

  static decision(
    params: EmaProParams,
  ): IIndicatorDecisionMin<ReturnType<typeof EMAIndicator.calculate>> {
    const r = EMAIndicator.calculate(params);
    if (!r.ok) {
      return {
        id: "ema",
        direction: "none",
        entry: "no-trigger",
        score: { directional: 0, confidence: 0, quality: 0.5 },
        health: { isValid: false },
        data: r,
      };
    }
    const dir = r.entrySignal === "long" ? 1 : r.entrySignal === "short" ? -1 : 0;
    return {
      id: "ema",
      direction: dir > 0 ? "buy" : dir < 0 ? "sell" : "none",
      entry: dir !== 0 ? "triggered" : "no-trigger",
      score: { directional: dir, confidence: r.confidence, quality: r.quality },
      health: { isValid: true },
      data: r,
    };
  }
}
