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
  highFactor?: number; // volume alto (>= 1.5 = 150% da média)
  extremeFactor?: number; // volume extremo (>= 2.5 = 250% da média)
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

function rollingStd(values: number[], window: number, endIdx: number): number | null {
  if (window <= 1) return null;
  const start = Math.max(0, endIdx - window + 1);
  let n = 0,
    sum = 0,
    sum2 = 0;
  for (let i = start; i <= endIdx; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    n++;
    sum += v;
    sum2 += v * v;
  }
  if (n < 2) return null;
  const mean = sum / n;
  const variance = (sum2 - n * mean * mean) / (n - 1);
  return variance > 0 ? Math.sqrt(variance) : 0;
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
    if (lastIndex < 1) {
      return { ok: false as const, reason: "Dados insuficientes para confirmar no fechamento." };
    }

    // Média de volume
    const vmaRaw = sma(volumes, maPeriod);
    const vma = padLeft(
      len,
      vmaRaw.map((v) => (Number.isFinite(v) ? (v as number) : null)),
    );

    const lastVol = volumes[lastIndex];
    const lastVMA = vma[lastIndex] as number | null;
    const lastOpen = opens[lastIndex];
    const lastClose = closes[lastIndex];

    // Direção do candle (sem high/low disponíveis, usamos variação corpo)
    const barUp = lastClose > lastOpen;
    const barDown = lastClose < lastOpen;
    const priceChangePct = lastOpen !== 0 ? ((lastClose - lastOpen) / lastOpen) * 100 : 0;

    // Relação volume / média
    const rel = lastVMA ? lastVol / lastVMA : 0; // 1.0 = média, 2.0 = 200%
    const highVolume = rel >= highFactor;
    const extremeVolume = rel >= extremeFactor;

    // z-score de volume (relevância estatística)
    const std = rollingStd(volumes, maPeriod, lastIndex);
    const volMean = vmaRaw[Math.min(vmaRaw.length - 1, lastIndex)];
    const zVol = std && std > 0 && Number.isFinite(volMean) ? (lastVol - volMean) / std : 0;

    // Consistência recente: barras nas últimas N com volume >= média e MESMA direção do candle atual
    let recentConfirm = 0;
    for (let i = lastIndex; i >= Math.max(0, lastIndex - (recentBars - 1)); i--) {
      const rv = vma[i] as number | null;
      if (!rv) continue;
      const hv = volumes[i] >= rv;
      const up = closes[i] > opens[i];
      const dn = closes[i] < opens[i];
      if ((up && barUp && hv) || (dn && barDown && hv)) recentConfirm++;
    }

    // Regras de entrada (conservadoras):
    // - Long: candle de alta + (rel >= highFactor E zVol >= 1) OU consistência recente (>=2) e rel >= 1
    // - Short: candle de baixa + (rel >= highFactor E zVol <= -1) OU consistência recente (>=2) e rel >= 1
    let entrySignal: "long" | "short" | "none" = "none";
    if (barUp && ((highVolume && zVol >= 1) || (recentConfirm >= 2 && rel >= 1))) {
      entrySignal = "long";
    } else if (barDown && ((highVolume && zVol <= -1) || (recentConfirm >= 2 && rel >= 1))) {
      entrySignal = "short";
    }

    // Confiança:
    // - relFactor: intensidade vs média (satura em 3x)
    // - zFactor: magnitude estatística (satura |z|>=3)
    // - consistencyBoost: confirmação de fluxo (até +0.3)
    // - bodyBoost: corpo do candle (magnitude da variação) até +0.2 (cap em 1.5%)
    const relFactor = Math.min(1, Math.max(0, rel / 3)); // 0..1
    const zFactor = Math.min(1, Math.max(0, Math.abs(zVol) / 3)); // |z|>=3
    const consistencyBoost = Math.min(0.3, (recentConfirm / recentBars) * 0.3);
    const bodyBoost = Math.min(0.2, (Math.min(1.5, Math.abs(priceChangePct)) / 1.5) * 0.2);

    const base = entrySignal !== "none" ? 0.5 : 0.3;
    const confidence = Math.min(
      1,
      Math.max(0.3, base + 0.4 * relFactor + 0.3 * zFactor + consistencyBoost + bodyBoost),
    );

    return {
      ok: true as const,
      last: {
        volume: lastVol,
        vma: lastVMA ?? null,
        rel,
        zVol,
        bar: barUp ? "up" : barDown ? "down" : "doji",
        priceChangePct,
      },
      vma,
      rel,
      zVol,
      highVolume,
      extremeVolume,
      recentConfirm,
      entrySignal,
      confidence,
      meta: { maPeriod, lastIndex, highFactor, extremeFactor, recentBars },
    };
  }

  static decision(
    params: VolumeParams,
  ): IIndicatorDecisionMin<ReturnType<typeof VolumeIndicator.calculate>> {
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

    // Qualidade: maior quando volume é extremo OU (rel>=high e |zVol|>=1.5)
    let quality = 0.8;
    if (r.extremeVolume || (r.rel >= (params.highFactor ?? 1.5) && Math.abs(r.zVol ?? 0) >= 1.5)) {
      quality = 1.0;
    } else if (r.rel >= (params.highFactor ?? 1.5)) {
      quality = 0.9;
    }

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
