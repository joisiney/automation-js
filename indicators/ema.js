import * as TI from "technicalindicators";
import { padLeft } from "../utils/pad-left.js";
import { last as lastOf } from "../utils/last.js";

/**
 * @typedef {Object} Candles
 * @property {number[]} closes
 * @property {number[]=} highs
 * @property {number[]=} lows
 * @property {number[]=} opens
 *
 * @typedef {Object} EmaProParams
 * @property {number} period                // EMA curta (ex.: 21)
 * @property {Candles} candles
 * @property {boolean=} confirmOnClose      // true = só sinal na virada da barra (default true)
 * @property {number=} longPeriod           // EMA longa p/ filtro (ex.: 200). Opcional
 * @property {number=} atrPeriod            // ATR p/ risco (default 14)
 * @property {number=} slopeWindow          // janelinha p/ slope da EMA (default 3)
 * @property {number=} maxExtensionPct      // máx distância % do preço acima/abaixo da EMA p/ entrada (default 1.5% = 0.015)
 * @property {number=} slopeMinPct          // inclinação mínima da EMA curta p/ validar tendência (default 0.02% = 0.0002)
 * @property {number=} recentBars           // quantas barras atrás ainda consideramos o “cruzamento” recente (default 3)
 * @property {number=} atrStopMultiple      // múltiplo de ATR para stop-sugestão (default 1.5)
 */

export function emaPro({
  period,
  candles,
  confirmOnClose = true,
  longPeriod,
  atrPeriod = 14,
  slopeWindow = 3,
  maxExtensionPct = 0.015, // ~1.5%
  slopeMinPct = 0.0002,    // ~0.02%
  recentBars = 3,
  atrStopMultiple = 1.5,
} /** @type {EmaProParams} */) {
  const closes = candles.closes;
  const len = closes.length;
  if (!len || len < Math.max(period, slopeWindow) + 2) {
    return { ok: false, reason: "Dados insuficientes." };
  }

  // --- EMA curta
  const emaCalc = TI.EMA.calculate({ period, values: closes });
  const ema = padLeft(len, emaCalc);
  const price = lastOf(closes);
  const lastEma = lastOf(ema);

  const prevPrice = closes[len - 2];
  const prevEma  = ema[len - 2];

  const above = price > lastEma;
  const below = price < lastEma;

  // Cruzamento "correto" (preço vs EMA, t-1 para t)
  const crossUp   = prevPrice <= prevEma && price > lastEma;
  const crossDown = prevPrice >= prevEma && price < lastEma;

  // Opcional: considerar somente na virada da barra (com dados fechados você já está ok)
  const crossUpConfirmed = crossUp && (confirmOnClose ? true : true);
  const crossDownConfirmed = crossDown && (confirmOnClose ? true : true);

  // --- Slope da EMA curta (magnitude e direção)
  const emaRef = ema[len - 1 - slopeWindow];
  const slope = (lastEma != null && emaRef != null) ? (lastEma - emaRef) / slopeWindow : 0;
  const slopePct = lastEma ? (slope / lastEma) : 0;
  const slopeUp = slopePct > slopeMinPct;
  const slopeDown = slopePct < -slopeMinPct;
  const trendShort =
    slopeUp ? "bull" : (slopeDown ? "bear" : "chop"); // “chop” = sem inclinação relevante

  // --- Distância do preço até a EMA (evitar esticado)
  const distance = price - lastEma;
  const distancePct = lastEma ? distance / lastEma : 0;
  const withinExtension = Math.abs(distancePct) <= maxExtensionPct;

  // --- EMA longa (filtro direcional opcional)
  let emaLong, lastEmaLong, trendLong = "neutral";
  if (longPeriod) {
    emaLong = padLeft(len, TI.EMA.calculate({ period: longPeriod, values: closes }));
    lastEmaLong = emaLong[len - 1];
    if (lastEma != null && lastEmaLong != null) {
      trendLong = lastEma > lastEmaLong ? "bull" : (lastEma < lastEmaLong ? "bear" : "neutral");
    }
  }

  // --- ATR (volatilidade) para risco/stop
  let atr, lastATR;
  if (candles.highs && candles.lows) {
    const atrArr = TI.ATR.calculate({
      period: atrPeriod,
      high: candles.highs,
      low: candles.lows,
      close: closes,
    });
    atr = padLeft(len, atrArr);
    lastATR = lastOf(atr);
  }

  // Stop sugerido (ex.: abaixo/ acima da EMA por múltiplos do ATR)
  const stopLong  = (lastATR != null) ? price - atrStopMultiple * lastATR : undefined;
  const stopShort = (lastATR != null) ? price + atrStopMultiple * lastATR : undefined;

  // --- Recência de cruzamento (quantas barras atrás)
  // Procura o último crossUp/crossDown recente
  let barsSinceCrossUp = Infinity;
  let barsSinceCrossDown = Infinity;
  for (let i = len - 1; i >= Math.max(1, len - 1 - 10); i--) {
    const p  = closes[i];
    const e  = ema[i];
    const pp = closes[i - 1];
    const pe = ema[i - 1];
    if (pp != null && pe != null) {
      if (barsSinceCrossUp === Infinity && (pp <= pe && p > e)) {
        barsSinceCrossUp = (len - 1) - i;
      }
      if (barsSinceCrossDown === Infinity && (pp >= pe && p < e)) {
        barsSinceCrossDown = (len - 1) - i;
      }
    }
  }

  const recentCrossUp = barsSinceCrossUp <= recentBars;
  const recentCrossDown = barsSinceCrossDown <= recentBars;

  // --- Regras de entrada “de prateleira”
  // LONG: acima da EMA curta, slopeUp, (opcional) EMA curta > EMA longa, não esticado, e cruzamento recente
  const longOkDir   = above && slopeUp && (trendLong === "bull" || trendLong === "neutral" || !longPeriod);
  const longTrigger = recentCrossUp || (withinExtension && above); // cruzou há pouco OU pullback limpo
  const entryLong   = longOkDir && longTrigger && withinExtension;

  // SHORT: abaixo da EMA curta, slopeDown, (opcional) EMA curta < EMA longa, não esticado, e cruzamento recente
  const shortOkDir   = below && slopeDown && (trendLong === "bear" || trendLong === "neutral" || !longPeriod);
  const shortTrigger = recentCrossDown || (withinExtension && below);
  const entryShort   = shortOkDir && shortTrigger && withinExtension;

  const entrySignal = entryLong ? "long" : (entryShort ? "short" : "none");

  return {
    ok: true,
    ema,
    last: lastEma,
    above,
    below,
    crossUp: crossUpConfirmed,
    crossDown: crossDownConfirmed,

    // Pró-trader:
    slope,
    slopePct,
    trendShort,           // "bull" | "bear" | "chop"
    emaLong,
    lastEmaLong,
    trendLong,            // "bull" | "bear" | "neutral"
    distancePct,          // quão “esticado” está
    withinExtension,      // está dentro do limite de extensão permitido?

    atr,
    lastATR,
    stopLong,
    stopShort,

    barsSinceCrossUp,
    barsSinceCrossDown,
    recentCrossUp,
    recentCrossDown,

    // Sinal pronto para orquestrar entradas:
    entrySignal,          // "long" | "short" | "none"
  };
}
