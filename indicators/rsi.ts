import * as TI from "technicalindicators";
import { padLeft } from "../utils/pad-left";
import { IIndicatorDecisionMin } from "./types";
export type Candles = {
  closes: number[];
  highs?: number[];
  lows?: number[];
  opens?: number[];
};

export type RsiParams = {
  /** Período do RSI (ex.: 14) */
  period: number;
  candles: Candles;

  /**
   * true (default): só considera sinal na virada da barra (dados fechados)
   * false: permite avaliar a barra atual em formação (intrabar)
   */
  confirmOnClose?: boolean;

  /** Limiar de sobrevenda (default: 30) */
  buyThreshold?: number;

  /** Limiar de sobrecompra (default: 70) */
  sellThreshold?: number;

  /** Janela para slope do RSI (default: 3) */
  slopeWindow?: number;

  /** Quantas barras ainda consideramos “recente” (default: 3) */
  recentBars?: number;

  /**
   * Quantas barras para buscar o último gatilho (default: 10).
   * Use Infinity para buscar no histórico inteiro.
   */
  maxLookback?: number;

  /**
   * Como retornar “não encontrado” em barsSinceCrossUp/Down.
   * 'infinity' (default) mantém compatibilidade. 'null' retorna null.
   */
  barsSinceMode?: "infinity" | "null";

  /** ATR para risco (opcional; default: 14). Só é usado se highs/lows estiverem presentes */
  atrPeriod?: number;

  /** Múltiplo do ATR p/ stop sugerido (default: 1.5) */
  atrStopMultiple?: number;
};

export class RSIIndicator {
  static calculate({
    period,
    candles,
    confirmOnClose = true,
    buyThreshold = 30,
    sellThreshold = 70,
    slopeWindow = 3,
    recentBars = 3,
    maxLookback = 10,
    barsSinceMode = "infinity",
    atrPeriod = 14,
    atrStopMultiple = 1.5,
  }: RsiParams) {
    const closes = candles.closes;
    const len = closes.length;

    // Precisamos de pelo menos (period + 2) barras e slopeWindow para cálculos estáveis.
    if (!len || len < Math.max(period, slopeWindow) + 2) {
      return { ok: false as const, reason: "Dados insuficientes." };
    }

    // Se confirmOnClose = true, trabalhamos com o último candle FECHADO.
    const lastIndex = confirmOnClose ? len - 2 : len - 1;
    const prevIndex = lastIndex - 1;
    if (lastIndex < 1) {
      return { ok: false as const, reason: "Dados insuficientes para confirmar no fechamento." };
    }

    // --- RSI
    const rsiCalc = TI.RSI.calculate({ period, values: closes });
    const rsi = padLeft(len, rsiCalc) as Array<number | null>;

    const lastRsi = rsi[lastIndex];
    const prevRsi = rsi[prevIndex];

    // Estados básicos
    const overSold = lastRsi != null ? lastRsi <= buyThreshold : false;
    const overBought = lastRsi != null ? lastRsi >= sellThreshold : false;

    // Cruzamentos de limiares (gatilhos “clássicos”)
    const crossUpFromOversold =
      prevRsi != null && lastRsi != null
        ? prevRsi <= buyThreshold && lastRsi > buyThreshold
        : false;

    const crossDownFromOverbought =
      prevRsi != null && lastRsi != null
        ? prevRsi >= sellThreshold && lastRsi < sellThreshold
        : false;

    // Cruzamentos de linha central (50) – reforço de direção
    const crossUpMid = prevRsi != null && lastRsi != null ? prevRsi <= 50 && lastRsi > 50 : false;
    const crossDownMid = prevRsi != null && lastRsi != null ? prevRsi >= 50 && lastRsi < 50 : false;

    // --- Slope do RSI
    const refIndex = lastIndex - slopeWindow;
    const rsiRef = refIndex >= 0 ? rsi[refIndex] : null;
    const slope = lastRsi != null && rsiRef != null ? (lastRsi - rsiRef) / slopeWindow : 0;
    // Normalização simples do slope do RSI (0..100) → fração
    const slopePct = (slope ?? 0) / 100;
    const slopeUp = slopePct > 0;
    const slopeDown = slopePct < 0;

    // --- ATR (opcional) para stop sugerido
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

    // Stops sugeridos (usando preço de referência = close da barra considerada)
    const referencePrice = closes[lastIndex];
    const stopLong = lastATR != null ? referencePrice - atrStopMultiple * lastATR : undefined;
    const stopShort = lastATR != null ? referencePrice + atrStopMultiple * lastATR : undefined;

    // --- Recência dos gatilhos
    const lookback = Number.isFinite(maxLookback) ? (maxLookback as number) : Infinity;

    let barsSinceCrossUp: number | null | "Infinity" =
      barsSinceMode === "infinity" ? ("Infinity" as const) : null;
    let barsSinceCrossDown: number | null | "Infinity" =
      barsSinceMode === "infinity" ? ("Infinity" as const) : null;

    const start = Math.max(1, lastIndex - (Number.isFinite(lookback) ? lookback : lastIndex));
    for (let i = lastIndex; i >= start; i--) {
      const rv = rsi[i];
      const rp = rsi[i - 1];

      if (rv != null && rp != null) {
        // último gatilho de compra (sair de sobrevenda)
        if (
          (barsSinceMode === "infinity"
            ? barsSinceCrossUp === "Infinity"
            : barsSinceCrossUp === null) &&
          rp <= buyThreshold &&
          rv > buyThreshold
        ) {
          const bars = lastIndex - i;
          barsSinceCrossUp = bars as unknown as typeof barsSinceCrossUp;
        }

        // último gatilho de venda (sair de sobrecompra)
        if (
          (barsSinceMode === "infinity"
            ? barsSinceCrossDown === "Infinity"
            : barsSinceCrossDown === null) &&
          rp >= sellThreshold &&
          rv < sellThreshold
        ) {
          const bars = lastIndex - i;
          barsSinceCrossDown = bars as unknown as typeof barsSinceCrossDown;
        }

        // sai cedo se já encontrou os dois
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

    // --- Sinal final
    // Prioriza gatilhos clássicos (sair de <30 ou >70). Como reforço, aceita cruzar a midline com slope a favor.
    const longTrigger = recentCrossUp || crossUpMid;
    const shortTrigger = recentCrossDown || crossDownMid;

    const entryLong = longTrigger && slopeUp;
    const entryShort = shortTrigger && slopeDown;

    const entrySignal = entryLong ? "long" : entryShort ? "short" : ("none" as const);

    return {
      ok: true as const,

      // Básico RSI
      last: lastRsi,
      overSold,
      overBought,

      // Gatilhos
      crossUpFromOversold,
      crossDownFromOverbought,
      crossUpMid,
      crossDownMid,

      // Tendência (via slope do próprio RSI)
      slope,
      slopePct,

      // Volatilidade / risco (opcional)
      lastATR,
      referencePrice,
      stopLong,
      stopShort,

      // Recência
      barsSinceCrossUp, // number | "Infinity" | null
      barsSinceCrossDown, // number | "Infinity" | null
      recentCrossUp,
      recentCrossDown,

      // Sinal final
      entrySignal, // "long" | "short" | "none"
    };
  }

  static decision(
    params: RsiParams,
  ): IIndicatorDecisionMin<ReturnType<typeof RSIIndicator.calculate>> {
    const r = RSIIndicator.calculate(params);

    return {
      id: `rsi${params.period}`,
      direction: r.entrySignal === "long" ? "buy" : r.entrySignal === "short" ? "sell" : "none",
      entry:
        r.entrySignal === "long"
          ? "triggered"
          : r.entrySignal === "short"
            ? "triggered"
            : "no-trigger",
      // Núcleo mínimo para o ensemble:
      score: {
        directional: r.entrySignal === "long" ? 1 : r.entrySignal === "short" ? -1 : 0,
        confidence: 1, // pode sofisticar (ex.: distância a 30/70, recência, etc.)
        quality: 1, // idem, se quiser
      },
      health: { isValid: r.ok },
      data: r,
    };
  }
}
