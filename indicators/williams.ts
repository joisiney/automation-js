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
  for (let i = 0; i < Math.max(highs.length, lows.length); i++) {
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
    const len = Math.min(highs.length, lows.length);
    if (!len || len < Math.max(lipsPeriod, teethPeriod, jawPeriod) + 2) {
      return { ok: false as const, reason: "Dados insuficientes." };
    }

    const lastIndex = confirmOnClose ? len - 2 : len - 1;
    if (lastIndex < 1) {
      return { ok: false as const, reason: "Dados insuficientes para confirmar no fechamento." };
    }

    const med = medianPrice(highs, lows);

    // Alligator usa SMMA (Smoothed MA). Aproximamos com WEMA (Wilder EMA), adequada para trading systems.
    const lipsBase = TI.WEMA.calculate({ period: lipsPeriod, values: med });
    const teethBase = TI.WEMA.calculate({ period: teethPeriod, values: med });
    const jawBase = TI.WEMA.calculate({ period: jawPeriod, values: med });

    // alinhar ao len
    const lipsAligned = padLeft(len, lipsBase);
    const teethAligned = padLeft(len, teethBase);
    const jawAligned = padLeft(len, jawBase);

    // deslocar para frente (future shift) como no indicador clássico
    const lips = shiftForward(lipsAligned, lipsShift);
    const teeth = shiftForward(teethAligned, teethShift);
    const jaw = shiftForward(jawAligned, jawShift);

    const lLips = lips[lastIndex] as number | null;
    const lTeeth = teeth[lastIndex] as number | null;
    const lJaw = jaw[lastIndex] as number | null;

    // Estrutura de boca (aberta/fechando)
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

    // Recência de cruzamentos (últimos N)
    let barsSinceBullCross: number | null = null;
    let barsSinceBearCross: number | null = null;
    for (let i = lastIndex; i >= Math.max(1, lastIndex - 50); i--) {
      const lip = lips[i] as number | null;
      const tee = teeth[i] as number | null;
      const plip = lips[i - 1] as number | null;
      const ptee = teeth[i - 1] as number | null;
      if (lip != null && tee != null && plip != null && ptee != null) {
        if (barsSinceBullCross == null && plip <= ptee && lip > tee)
          barsSinceBullCross = lastIndex - i;
        if (barsSinceBearCross == null && plip >= ptee && lip < tee)
          barsSinceBearCross = lastIndex - i;
        if (barsSinceBullCross != null && barsSinceBearCross != null) break;
      }
    }

    const recentBull = barsSinceBullCross != null && barsSinceBullCross <= recentBars;
    const recentBear = barsSinceBearCross != null && barsSinceBearCross <= recentBars;

    // Sinal agregado (profissional):
    // Prioriza direção da boca (tendência) + cruzamentos recentes (gatilho)
    let entrySignal: "long" | "short" | "none" = "none";
    if (mouthBull || recentBull) entrySignal = "long";
    else if (mouthBear || recentBear) entrySignal = "short";

    // confiança baseada na abertura da boca e recência de gatilho
    const mouthFactor = Math.min(1, Math.max(0, spreadPct / 5)); // >=5% satura
    const triggerBoost = recentBull || recentBear ? 0.25 : 0;
    const dir = entrySignal === "long" ? 1 : entrySignal === "short" ? -1 : 0;
    const confidence = Math.min(
      1,
      Math.max(0.3, Math.abs(dir) * (0.5 + mouthFactor + triggerBoost)),
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
      barsSinceBullCross,
      barsSinceBearCross,
      recentBull,
      recentBear,
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
    const quality = r.spreadPct >= 2 ? 1 : 0.8;

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
