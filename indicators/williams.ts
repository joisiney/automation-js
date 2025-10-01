import * as TI from "technicalindicators";
import { padLeft } from "../utils/pad-left.js";
import { Candles, IIndicatorDecisionMin } from "./types.js";

export type AlligatorParams = {
  candles: Candles;
  confirmOnClose?: boolean; // true: usa última barra fechada (default)
  lipsPeriod?: number; // default 5
  teethPeriod?: number; // default 8
  jawPeriod?: number; // default 13
  lipsShift?: number; // default 3 (para frente)
  teethShift?: number; // default 5 (para frente)
  jawShift?: number; // default 8 (para frente)
  recentBars?: number; // janela para cruzamentos recentes (default 3)
};

function medianPrice(highs: number[], lows: number[]): number[] {
  const out: number[] = [];
  const len = Math.max(highs.length, lows.length);
  for (let i = 0; i < len; i++) {
    const h = highs[i];
    const l = lows[i];
    out.push((h + l) / 2);
  }
  return out;
}

function shiftForward<T>(values: Array<T | null>, shift: number): Array<T | null> {
  if (shift <= 0) return values.slice();
  const len = values.length;
  const out = Array<T | null>(len).fill(null);
  for (let i = 0; i < len; i++) {
    const src = i - shift;
    out[i] = src >= 0 ? values[src] : null;
  }
  return out;
}

function slopeAt(arr: Array<number | null>, idx: number, k: number): number | null {
  if (k <= 0) return 0;
  const a = arr[idx];
  const b = arr[idx - k];
  if (a == null || b == null) return null;
  return a - b;
}

export class WilliamsAlligatorIndicator {
  static calculate({
    candles,
    confirmOnClose = true,
    lipsPeriod = 5,
    teethPeriod = 8,
    jawPeriod = 13,
    lipsShift = 3,
    teethShift = 5,
    jawShift = 8,
    recentBars = 3,
  }: AlligatorParams) {
    const { highs, lows } = candles;
    // Base do cálculo: mínimos para highs/lows
    let len = Math.min(highs.length, lows.length);
    if (!len || len < Math.max(lipsPeriod, teethPeriod, jawPeriod) + 2) {
      return { ok: false as const, reason: "Dados insuficientes." };
    }

    // Index de referência (último fechado ou atual)
    const lastIndex = confirmOnClose ? len - 2 : len - 1;
    if (lastIndex < 1) {
      return { ok: false as const, reason: "Dados insuficientes para confirmar no fechamento." };
    }

    const med = medianPrice(highs, lows);

    // Alligator usa SMMA (Wilder). WEMA de TI aproxima bem o SMMA.
    const lipsBase = TI.WEMA.calculate({ period: lipsPeriod, values: med });
    const teethBase = TI.WEMA.calculate({ period: teethPeriod, values: med });
    const jawBase = TI.WEMA.calculate({ period: jawPeriod, values: med });

    // alinhar ao len e aplicar deslocamentos (future shift clássico)
    const lipsAligned = padLeft(len, lipsBase);
    const teethAligned = padLeft(len, teethBase);
    const jawAligned = padLeft(len, jawBase);

    const lips = shiftForward(lipsAligned, lipsShift);
    const teeth = shiftForward(teethAligned, teethShift);
    const jaw = shiftForward(jawAligned, jawShift);

    const lLips = lips[lastIndex] as number | null;
    const lTeeth = teeth[lastIndex] as number | null;
    const lJaw = jaw[lastIndex] as number | null;

    // Estrutura de boca (alinhamento)
    const mouthBull =
      lLips != null && lTeeth != null && lJaw != null ? lLips > lTeeth && lTeeth > lJaw : false;
    const mouthBear =
      lLips != null && lTeeth != null && lJaw != null ? lLips < lTeeth && lTeeth < lJaw : false;

    // Abertura da boca (distância relativa média entre as três linhas)
    let spreadPct = 0;
    if (lLips != null && lTeeth != null && lJaw != null) {
      const maxL = Math.max(lLips, lTeeth, lJaw);
      const minL = Math.min(lLips, lTeeth, lJaw);
      const mid = (maxL + minL) / 2;
      spreadPct = mid !== 0 ? ((maxL - minL) / mid) * 100 : 0;
    }

    // Recência de cruzamentos: lips↔teeth e teeth↔jaw (últimos N)
    let barsSinceBullCrossLT: number | null = null;
    let barsSinceBearCrossLT: number | null = null;
    let barsSinceBullCrossTJ: number | null = null;
    let barsSinceBearCrossTJ: number | null = null;

    for (let i = lastIndex; i >= Math.max(1, lastIndex - 50); i--) {
      // lips-teeth
      const lip = lips[i] as number | null;
      const tee = teeth[i] as number | null;
      const plip = lips[i - 1] as number | null;
      const ptee = teeth[i - 1] as number | null;
      if (lip != null && tee != null && plip != null && ptee != null) {
        if (barsSinceBullCrossLT == null && plip <= ptee && lip > tee)
          barsSinceBullCrossLT = lastIndex - i;
        if (barsSinceBearCrossLT == null && plip >= ptee && lip < tee)
          barsSinceBearCrossLT = lastIndex - i;
      }

      // teeth-jaw
      const tj = teeth[i] as number | null;
      const jw = jaw[i] as number | null;
      const ptj = teeth[i - 1] as number | null;
      const pjw = jaw[i - 1] as number | null;
      if (tj != null && jw != null && ptj != null && pjw != null) {
        if (barsSinceBullCrossTJ == null && ptj <= pjw && tj > jw)
          barsSinceBullCrossTJ = lastIndex - i;
        if (barsSinceBearCrossTJ == null && ptj >= pjw && tj < jw)
          barsSinceBearCrossTJ = lastIndex - i;
      }

      if (
        barsSinceBullCrossLT != null &&
        barsSinceBearCrossLT != null &&
        barsSinceBullCrossTJ != null &&
        barsSinceBearCrossTJ != null
      ) {
        break;
      }
    }

    const recentBullLT = barsSinceBullCrossLT != null && barsSinceBullCrossLT <= recentBars;
    const recentBearLT = barsSinceBearCrossLT != null && barsSinceBearCrossLT <= recentBars;
    const recentBullTJ = barsSinceBullCrossTJ != null && barsSinceBullCrossTJ <= recentBars;
    const recentBearTJ = barsSinceBearCrossTJ != null && barsSinceBearCrossTJ <= recentBars;

    // Slope (inclinação) das três linhas
    const k = Math.min(3, lastIndex);
    const slopeL = slopeAt(lips, lastIndex, k);
    const slopeT = slopeAt(teeth, lastIndex, k);
    const slopeJ = slopeAt(jaw, lastIndex, k);
    const slopesUp =
      slopeL != null && slopeT != null && slopeJ != null && slopeL > 0 && slopeT > 0 && slopeJ > 0;
    const slopesDown =
      slopeL != null && slopeT != null && slopeJ != null && slopeL < 0 && slopeT < 0 && slopeJ < 0;

    // Posição do preço vs linhas (se closes existir)
    const closes = (candles as any).closes as number[] | undefined;
    const hasCloses = Array.isArray(closes) && closes.length > lastIndex;
    const close = hasCloses ? (closes as number[])[lastIndex] : null;

    const priceAboveAll =
      hasCloses && lLips != null && lTeeth != null && lJaw != null
        ? (close as number) > lLips && (close as number) > lTeeth && (close as number) > lJaw
        : false;

    const priceBelowAll =
      hasCloses && lLips != null && lTeeth != null && lJaw != null
        ? (close as number) < lLips && (close as number) < lTeeth && (close as number) < lJaw
        : false;

    // Normalização da abertura por ATR (se possível)
    let spreadNorm = spreadPct / 100; // fallback
    try {
      if (hasCloses) {
        // ATR(14) default da Wilder
        const atrRaw = TI.ATR.calculate({
          high: highs.slice(0, Math.min(highs.length, closes!.length)),
          low: lows.slice(0, Math.min(lows.length, closes!.length)),
          close: closes!.slice(0, Math.min(closes!.length, highs.length, lows.length)),
          period: 14,
        });
        const atrAligned = padLeft(len, atrRaw);
        const lastATR = atrAligned[lastIndex] as number | null;
        if (lastATR && lastATR > 0 && lLips != null && lTeeth != null && lJaw != null) {
          const spreadAbs = Math.max(lLips, lTeeth, lJaw) - Math.min(lLips, lTeeth, lJaw);
          spreadNorm = spreadAbs / lastATR;
        }
      }
    } catch {
      // mantém fallback (spreadPct/100)
    }

    // Regras de entrada mais conservadoras:
    // - exige boca alinhada E pelo menos um (gatilho recente OU slopes coerentes OU preço confirmando)
    const bullishTrigger = recentBullLT || recentBullTJ || slopesUp || priceAboveAll;
    const bearishTrigger = recentBearLT || recentBearTJ || slopesDown || priceBelowAll;

    let entrySignal: "long" | "short" | "none" = "none";
    if (mouthBull && bullishTrigger) entrySignal = "long";
    else if (mouthBear && bearishTrigger) entrySignal = "short";

    // Confiança ponderando abertura normalizada, slopes e confirmação de preço/gatilho
    const mouthFactor = Math.min(1, Math.max(0, spreadNorm / 0.5)); // satura ~0.5 (ajustável)
    const slopeBoost =
      (slopesUp && entrySignal === "long") || (slopesDown && entrySignal === "short") ? 0.25 : 0;
    const priceBoost =
      (priceAboveAll && entrySignal === "long") || (priceBelowAll && entrySignal === "short")
        ? 0.2
        : 0;
    const triggerBoost =
      (recentBullLT || recentBearLT || recentBullTJ || recentBearTJ) && entrySignal !== "none"
        ? 0.2
        : 0;

    const dir = entrySignal === "long" ? 1 : entrySignal === "short" ? -1 : 0;
    const confidence = Math.min(
      1,
      Math.max(0.3, Math.abs(dir) * (0.5 + mouthFactor + slopeBoost + priceBoost + triggerBoost)),
    );

    return {
      ok: true as const,
      last: { lips: lLips ?? null, teeth: lTeeth ?? null, jaw: lJaw ?? null },
      lips,
      teeth,
      jaw,
      mouthBull,
      mouthBear,
      spreadPct,
      spreadNorm, // novo: abertura normalizada (por ATR quando disponível)
      barsSinceBullCrossLT,
      barsSinceBearCrossLT,
      barsSinceBullCrossTJ,
      barsSinceBearCrossTJ,
      recentBullLT,
      recentBearLT,
      recentBullTJ,
      recentBearTJ,
      slopeL,
      slopeT,
      slopeJ,
      slopesUp,
      slopesDown,
      priceAboveAll,
      priceBelowAll,
      entrySignal,
      confidence,
      meta: {
        lipsPeriod,
        teethPeriod,
        jawPeriod,
        lipsShift,
        teethShift,
        jawShift,
        lastIndex,
        confirmOnClose,
      },
    };
  }

  static decision(
    params: AlligatorParams,
  ): IIndicatorDecisionMin<ReturnType<typeof WilliamsAlligatorIndicator.calculate>> {
    const r = WilliamsAlligatorIndicator.calculate(params);
    if (!r.ok) {
      return {
        id: "alligator",
        direction: "none",
        entry: "no-trigger",
        score: { directional: 0, confidence: 0, quality: 0.5 },
        health: { isValid: false },
        data: r,
      };
    }

    const dir = r.entrySignal === "long" ? 1 : r.entrySignal === "short" ? -1 : 0;

    // Qualidade pode considerar abertura e coerência de slopes
    let quality = 0.8;
    if (r.spreadNorm != null) {
      if (r.spreadNorm >= 1.0)
        quality = 1.0; // boca bem aberta (>= ~1 ATR)
      else if (r.spreadNorm >= 0.5) quality = 0.9;
    } else {
      // Usar spreadPct como fallback quando spreadNorm não estiver disponível
      const spreadPct = (r as any).spreadPct;
      if (spreadPct && spreadPct >= 2) {
        quality = 1.0;
      }
    }

    return {
      id: "alligator",
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
