import { padLeft } from "../utils/pad-left.js";
import { IIndicatorDecisionMin } from "./types.js";

export type Candles = {
  opens: number[];
  closes: number[];
  volumes: number[];
};

export type VolumeParams = {
  candles: Candles;
  confirmOnClose?: boolean; // true: usa última barra fechada (default)
  maPeriod?: number; // período da média de volume (default 20)
  recentBars?: number; // janela p/ consistência (default 3)
  highFactor?: number; // fator p/ considerar volume alto (default 1.5 = 150% da média)
  extremeFactor?: number; // fator de volume extremo (default 2.5 = 250% da média)
};

function sma(values: number[], period: number): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i + 1 >= period ? sum / period : NaN);
  }
  return out;
}

export class VolumeIndicator {
  static calculate({
    candles,
    confirmOnClose = true,
    maPeriod = 20,
    recentBars = 3,
    highFactor = 1.5,
    extremeFactor = 2.5,
  }: VolumeParams) {
    const { opens, closes, volumes } = candles;
    const len = Math.min(opens.length, closes.length, volumes.length);
    if (!len || len < Math.max(5, maPeriod) + 1) {
      return { ok: false as const, reason: "Dados insuficientes." };
    }

    const lastIndex = confirmOnClose ? len - 2 : len - 1;
    const prevIndex = lastIndex - 1;
    if (lastIndex < 1) {
      return { ok: false as const, reason: "Dados insuficientes para confirmar no fechamento." };
    }

    const vmaRaw = sma(volumes, maPeriod);
    const vma = padLeft(
      len,
      vmaRaw.map((v) => (Number.isFinite(v) ? (v as number) : null)),
    );

    const lastVol = volumes[lastIndex];
    const lastVMA = vma[lastIndex] as number | null;
    const lastOpen = opens[lastIndex];
    const lastClose = closes[lastIndex];

    const barUp = lastClose > lastOpen;
    const barDown = lastClose < lastOpen;

    const rel = lastVMA ? lastVol / lastVMA : 0; // 1.0 = na média, 2.0 = 200%
    const highVolume = rel >= highFactor;
    const extremeVolume = rel >= extremeFactor;

    // Consistência recente: quantas barras nos últimos N tiveram volume >= média e mesma direção do candle
    let recentConfirm = 0;
    for (let i = lastIndex; i >= Math.max(0, lastIndex - (recentBars - 1)); i--) {
      const rv = vma[i] as number | null;
      if (!rv) continue;
      const hv = volumes[i] >= rv;
      const up = closes[i] > opens[i];
      const dn = closes[i] < opens[i];
      if ((up && barUp && hv) || (dn && barDown && hv)) recentConfirm++;
    }

    // Regras de decisão
    let entrySignal: "long" | "short" | "none" = "none";
    if ((barUp && highVolume) || (barUp && recentConfirm >= 2)) entrySignal = "long";
    else if ((barDown && highVolume) || (barDown && recentConfirm >= 2)) entrySignal = "short";

    // confiança baseada em quão acima da média o volume está + consistência
    const relClamped = Math.min(3, Math.max(0, rel)); // 0..3
    const baseConf = Math.min(1, (relClamped - 1) / (extremeFactor - 1)); // 0..1 mapeado da média ao extremo
    const consistencyBoost = Math.min(0.3, (recentConfirm / recentBars) * 0.3);
    const confidence = Math.min(
      1,
      Math.max(0.3, (entrySignal !== "none" ? 0.5 : 0.3) + baseConf + consistencyBoost),
    );

    return {
      ok: true as const,
      last: {
        volume: lastVol,
        vma: lastVMA ?? null,
        rel,
        bar: barUp ? "up" : barDown ? "down" : "doji",
      },
      vma,
      rel,
      highVolume,
      extremeVolume,
      recentConfirm,
      entrySignal,
      confidence,
      meta: { maPeriod, lastIndex, highFactor, extremeFactor },
    };
  }

  static decision(params: VolumeParams): IIndicatorDecisionMin<ReturnType<typeof VolumeIndicator.calculate>> {
    const r = VolumeIndicator.calculate(params);
    if (!r.ok) {
      return {
        id: "volume",
        direction: "none",
        entry: "no-trigger",
        score: { directional: 0, confidence: 0, quality: 0.5 },
        health: { isValid: false },
        data: r,
      };
    }

    const dir = r.entrySignal === "long" ? 1 : r.entrySignal === "short" ? -1 : 0;
    const quality = r.highVolume ? 1 : 0.8;

    return {
      id: "volume",
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
