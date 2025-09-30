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
  /** EMA curta */
  period: number;
  candles: Candles;

  /**
   * true (default): só considera sinal na virada da barra (dados fechados)
   * false: permite avaliar a barra atual em formação (intrabar)
   */
  confirmOnClose?: boolean;

  /** EMA longa (filtro macro opcional) */
  longPeriod?: number;

  /** ATR para risco (default: 14) */
  atrPeriod?: number;

  /** Janela para slope da EMA curta (default: 3) */
  slopeWindow?: number;

  /** Máx. distância relativa do preço para EMA (default: 1.5% = 0.015) */
  maxExtensionPct?: number;

  /** Inclinação mínima relativa por barra (default: 0.02% = 0.0002) */
  slopeMinPct?: number;

  /** Quantas barras ainda consideramos “recente” (default: 3) */
  recentBars?: number;

  /** Múltiplo do ATR p/ stop sugerido (default: 1.5) */
  atrStopMultiple?: number;

  /**
   * Quantas barras para buscar o último cruzamento (default: 10).
   * Use Infinity para buscar no histórico inteiro.
   */
  maxLookback?: number;

  /**
   * Como retornar “não encontrado” em barsSinceCrossUp/Down.
   * 'infinity' (default) mantém compatibilidade. 'null' retorna null.
   */
  barsSinceMode?: "infinity" | "null";
};

export class EMAIndicator {
  static calculate({
    period,
    candles,
    confirmOnClose = true,
    longPeriod,
    atrPeriod = 14,
    slopeWindow = 3,
    maxExtensionPct = 0.015,
    slopeMinPct = 0.0002,
    recentBars = 3,
    atrStopMultiple = 1.5,
    maxLookback = 10,
    barsSinceMode = "infinity",
  }: EmaProParams) {
    const closes = candles.closes;
    const len = closes.length;

    // Precisamos de pelo menos (period + 2) barras e slopeWindow para cálculos estáveis.
    if (!len || len < Math.max(period, slopeWindow) + 2) {
      return { ok: false as const, reason: "Dados insuficientes." };
    }

    // Se confirmOnClose = true, trabalhamos com o último candle FECHADO.
    // Isso evita ruído intrabar.
    const lastIndex = confirmOnClose ? len - 2 : len - 1;
    const prevIndex = lastIndex - 1;
    if (lastIndex < 1) {
      return { ok: false as const, reason: "Dados insuficientes para confirmar no fechamento." };
    }

    // --- EMA curta
    const emaCalc = TI.EMA.calculate({ period, values: closes });
    const ema = padLeft(len, emaCalc);

    const price = closes[lastIndex];
    const lastEma = ema[lastIndex] as number | null;

    const prevPrice = closes[prevIndex];
    const prevEma = ema[prevIndex] as number | null;

    // Comparações seguras quando lastEma é null (início da série)
    const above = lastEma != null ? price > lastEma : false;
    const below = lastEma != null ? price < lastEma : false;

    // Cruzamento correto: preço vs EMA entre t-1 e t
    const crossUp =
      prevEma != null && lastEma != null ? prevPrice <= prevEma && price > lastEma : false;
    const crossDown =
      prevEma != null && lastEma != null ? prevPrice >= prevEma && price < lastEma : false;

    // Em confirmOnClose=true já estamos medindo na barra fechada.
    const crossUpConfirmed = crossUp;
    const crossDownConfirmed = crossDown;

    // --- Slope da EMA curta
    const refIndex = lastIndex - slopeWindow;
    const emaRef = refIndex >= 0 ? (ema[refIndex] as number | null) : null;
    const slope = lastEma != null && emaRef != null ? (lastEma - emaRef) / slopeWindow : 0;
    const slopePct = lastEma != null && lastEma !== 0 ? slope / lastEma : 0;
    const slopeUp = slopePct > slopeMinPct;
    const slopeDown = slopePct < -slopeMinPct;
    const trendShort = slopeUp ? "bull" : slopeDown ? "bear" : ("chop" as const);

    // --- Distância do preço até a EMA (evita “esticado”)
    const distance = lastEma != null ? price - lastEma : 0;
    const distancePct = lastEma != null && lastEma !== 0 ? distance / lastEma : 0;
    const withinExtension = Math.abs(distancePct) <= maxExtensionPct;

    // --- EMA longa (filtro macro opcional)
    let lastEmaLong: number | null | undefined;
    let trendLong: "bull" | "bear" | "neutral" = "neutral";
    if (longPeriod) {
      const emaLong = padLeft(len, TI.EMA.calculate({ period: longPeriod, values: closes }));
      lastEmaLong = emaLong[lastIndex] as number | null;
      if (lastEma != null && lastEmaLong != null) {
        trendLong = lastEma > lastEmaLong ? "bull" : lastEma < lastEmaLong ? "bear" : "neutral";
      }
    }

    // --- ATR (volatilidade) para risco
    let lastATR: number | undefined;
    if (candles.highs && candles.lows) {
      const atrArr = TI.ATR.calculate({
        period: atrPeriod,
        high: candles.highs,
        low: candles.lows,
        close: closes,
      });
      const atr = padLeft(len, atrArr);
      const val = atr[lastIndex];
      lastATR = typeof val === "number" ? val : undefined;
    }

    // Stops sugeridos
    const stopLong = lastATR != null ? price - atrStopMultiple * lastATR : undefined;
    const stopShort = lastATR != null ? price + atrStopMultiple * lastATR : undefined;

    // --- Recência do cruzamento (lookback configurável)
    const lookback = Number.isFinite(maxLookback) ? (maxLookback as number) : Infinity;

    let barsSinceCrossUp: number | null | "Infinity" =
      barsSinceMode === "infinity" ? ("Infinity" as const) : null;
    let barsSinceCrossDown: number | null | "Infinity" =
      barsSinceMode === "infinity" ? ("Infinity" as const) : null;

    // Varre para trás a partir de lastIndex
    const start = Math.max(1, lastIndex - (Number.isFinite(lookback) ? lookback : lastIndex));
    for (let i = lastIndex; i >= start; i--) {
      const p = closes[i];
      const e = ema[i] as number | null;
      const pp = closes[i - 1];
      const pe = ema[i - 1] as number | null;
      if (pp != null && pe != null && e != null) {
        // último crossUp: pp <= pe && p > e
        if (
          (barsSinceMode === "infinity"
            ? barsSinceCrossUp === "Infinity"
            : barsSinceCrossUp === null) &&
          pp <= pe &&
          p > e
        ) {
          const bars = lastIndex - i;
          barsSinceCrossUp = bars as unknown as typeof barsSinceCrossUp;
        }
        // último crossDown: pp >= pe && p < e
        if (
          (barsSinceMode === "infinity"
            ? barsSinceCrossDown === "Infinity"
            : barsSinceCrossDown === null) &&
          pp >= pe &&
          p < e
        ) {
          const bars = lastIndex - i;
          barsSinceCrossDown = bars as unknown as typeof barsSinceCrossDown;
        }
        // Se já achamos os dois, podemos sair
        const upDone =
          barsSinceMode === "infinity"
            ? barsSinceCrossUp !== "Infinity"
            : barsSinceCrossUp !== null;
        const downDone =
          barsSinceMode === "infinity"
            ? barsSinceCrossDown !== "Infinity"
            : barsSinceCrossDown !== null;
        if (upDone && downDone) break;
      }
    }

    // Helpers para comparações com recentBars
    const upBarsNumber: number =
      barsSinceMode === "infinity"
        ? barsSinceCrossUp === "Infinity"
          ? Infinity
          : (barsSinceCrossUp as unknown as number)
        : typeof barsSinceCrossUp === "number"
          ? barsSinceCrossUp
          : Infinity;

    const downBarsNumber: number =
      barsSinceMode === "infinity"
        ? barsSinceCrossDown === "Infinity"
          ? Infinity
          : (barsSinceCrossDown as unknown as number)
        : typeof barsSinceCrossDown === "number"
          ? barsSinceCrossDown
          : Infinity;

    const recentCrossUp = upBarsNumber <= recentBars;
    const recentCrossDown = downBarsNumber <= recentBars;

    // --- Regras de entrada “prontas”
    const longOkDir =
      above && slopeUp && (trendLong === "bull" || trendLong === "neutral" || !longPeriod);
    const longTrigger = recentCrossUp || (withinExtension && above);
    const entryLong = longOkDir && longTrigger && withinExtension;

    const shortOkDir =
      below && slopeDown && (trendLong === "bear" || trendLong === "neutral" || !longPeriod);
    const shortTrigger = recentCrossDown || (withinExtension && below);
    const entryShort = shortOkDir && shortTrigger && withinExtension;

    const entrySignal = entryLong ? "long" : entryShort ? "short" : ("none" as const);

    return {
      ok: true as const,

      // Básico
      last: lastEma,
      above,
      below,
      crossUp: crossUpConfirmed,
      crossDown: crossDownConfirmed,

      // Tendência
      slope,
      slopePct,
      trendShort,
      lastEmaLong,
      trendLong,

      // Extensão
      distancePct,
      withinExtension,

      // Volatilidade / risco
      lastATR,
      stopLong,
      stopShort,

      // Recência de cruzamentos
      barsSinceCrossUp, // number | "Infinity" | null (conforme barsSinceMode)
      barsSinceCrossDown, // number | "Infinity" | null
      recentCrossUp,
      recentCrossDown,

      // Sinal final
      entrySignal, // "long" | "short" | "none"
    };
  }

  static decision(
    params: EmaProParams,
  ): IIndicatorDecisionMin<ReturnType<typeof EMAIndicator.calculate>> {
    const result = EMAIndicator.calculate(params);
    return {
      id: "ema",
      direction:
        result.entrySignal === "long" ? "buy" : result.entrySignal === "short" ? "sell" : "none",
      entry:
        result.entrySignal === "long"
          ? "triggered"
          : result.entrySignal === "short"
            ? "triggered"
            : "no-trigger",
      score: {
        directional: result.entrySignal === "long" ? 1 : result.entrySignal === "short" ? -1 : 0,
        confidence: 1,
        quality: 1,
      },
      health: { isValid: result.ok },
      data: result,
    };
  }
}
