import { padLeft } from "../utils/pad-left.js";
import { IIndicatorDecisionMin } from "./types.js";


export type Candles = {
  highs: number[];
  lows: number[];
  closes: number[];
};

export type IchimokuParams = {
  candles: Candles;
  confirmOnClose?: boolean; // true: usa última barra fechada (default)
  convPeriod?: number; // Tenkan (default 9)
  basePeriod?: number; // Kijun (default 26)
  spanBPeriod?: number; // Senkou Span B (default 52)
  displacement?: number; // deslocamento para frente do cloud (default 26)
};

function highest(values: number[], start: number, len: number): number {
  let h = -Infinity;
  for (let i = start - len + 1; i <= start; i++) h = Math.max(h, values[i]);
  return h;
}

function lowest(values: number[], start: number, len: number): number {
  let l = Infinity;
  for (let i = start - len + 1; i <= start; i++) l = Math.min(l, values[i]);
  return l;
}

function shiftForward<T>(arr: Array<T | null>, shift: number): Array<T | null> {
  if (shift <= 0) return arr.slice();
  const out = Array<T | null>(arr.length).fill(null);
  for (let i = 0; i < arr.length; i++) {
    const src = i - shift;
    out[i] = src >= 0 ? arr[src] : null;
  }
  return out;
}

function shiftBackward<T>(arr: Array<T | null>, shift: number): Array<T | null> {
  if (shift <= 0) return arr.slice();
  const out = Array<T | null>(arr.length).fill(null);
  for (let i = 0; i < arr.length; i++) {
    const src = i + shift;
    out[i] = src < arr.length ? arr[src] : null;
  }
  return out;
}

function slopeAt(arr: Array<number | null>, idx: number, k: number): number | null {
  if (k <= 0) return 0;
  const a = arr[idx];
  const b = arr[idx - k];
  if (a == null || b == null) return null;
  return (a - b) / k;
}

export class IchimokuIndicator {
  static calculate({
    candles,
    confirmOnClose = true,
    convPeriod = 9,
    basePeriod = 26,
    spanBPeriod = 52,
    displacement = 26,
  }: IchimokuParams) {
    const { highs, lows, closes } = candles;
    const len = Math.min(highs.length, lows.length, closes.length);
    const minNeeded = Math.max(spanBPeriod, basePeriod, convPeriod) + displacement + 2;
    if (!len || len < minNeeded) {
      return { ok: false as const, reason: "Dados insuficientes." };
    }

    const lastIndex = confirmOnClose ? len - 2 : len - 1;
    const prevIndex = lastIndex - 1;
    if (lastIndex < Math.max(spanBPeriod - 1, basePeriod - 1, convPeriod - 1)) {
      return { ok: false as const, reason: "Dados insuficientes para confirmar no fechamento." };
    }

    // Tenkan, Kijun, SpanB (não deslocados)
    const tenkanRaw: Array<number | null> = Array(len).fill(null);
    const kijunRaw: Array<number | null> = Array(len).fill(null);
    const spanBRaw: Array<number | null> = Array(len).fill(null);

    for (let i = 0; i < len; i++) {
      if (i >= convPeriod - 1)
        tenkanRaw[i] = (highest(highs, i, convPeriod) + lowest(lows, i, convPeriod)) / 2;
      if (i >= basePeriod - 1)
        kijunRaw[i] = (highest(highs, i, basePeriod) + lowest(lows, i, basePeriod)) / 2;
      if (i >= spanBPeriod - 1)
        spanBRaw[i] = (highest(highs, i, spanBPeriod) + lowest(lows, i, spanBPeriod)) / 2;
    }

    const tenkan = padLeft(len, tenkanRaw);
    const kijun = padLeft(len, kijunRaw);
    const spanB = padLeft(len, spanBRaw);

    // Senkou A (média de Tenkan e Kijun) e deslocamentos
    const senkouA = shiftForward(
      padLeft(
        len,
        tenkan.map((t, i) =>
          t != null && kijun[i] != null ? (t + (kijun[i] as number)) / 2 : null,
        ),
      ),
      displacement,
    );
    const senkouB = shiftForward(spanB, displacement);

    // Chikou (fechamento deslocado para trás)
    const chikou = shiftBackward(
      padLeft(
        len,
        closes.map((c) => c as number),
      ),
      displacement,
    );

    // Valores atuais
    const lClose = closes[lastIndex];
    const lTenkan = tenkan[lastIndex] as number | null;
    const lKijun = kijun[lastIndex] as number | null;
    const lSpanA = senkouA[lastIndex] as number | null;
    const lSpanB = senkouB[lastIndex] as number | null;

    const pTenkan = tenkan[prevIndex] as number | null;
    const pKijun = kijun[prevIndex] as number | null;

    // Posição do preço vs nuvem
    const cloudTop = lSpanA != null && lSpanB != null ? Math.max(lSpanA, lSpanB) : null;
    const cloudBottom = lSpanA != null && lSpanB != null ? Math.min(lSpanA, lSpanB) : null;

    const priceAboveCloud = cloudTop != null ? lClose > cloudTop : false;
    const priceBelowCloud = cloudBottom != null ? lClose < cloudBottom : false;
    const priceInCloud = lSpanA != null && lSpanB != null && !priceAboveCloud && !priceBelowCloud;

    // Cor da nuvem (atual, baseada nos valores deslocados que já consideram o futuro no índice atual)
    const cloudBull = lSpanA != null && lSpanB != null ? lSpanA > lSpanB : false;
    const cloudBear = lSpanA != null && lSpanB != null ? lSpanA < lSpanB : false;

    // TK cross
    const bullTKCross =
      pTenkan != null && pKijun != null && lTenkan != null && lKijun != null
        ? pTenkan <= pKijun && lTenkan > lKijun
        : false;
    const bearTKCross =
      pTenkan != null && pKijun != null && lTenkan != null && lKijun != null
        ? pTenkan >= pKijun && lTenkan < lKijun
        : false;

    // Recência de TK cross e de rompimento da nuvem (últimos N)
    const RECENT = 5;
    let barsSinceBullTK: number | null = null;
    let barsSinceBearTK: number | null = null;
    let barsSinceCloudUp: number | null = null;
    let barsSinceCloudDown: number | null = null;

    for (let i = lastIndex; i >= Math.max(1, lastIndex - 50); i--) {
      // TK
      const t = tenkan[i] as number | null,
        k = kijun[i] as number | null;
      const pt = tenkan[i - 1] as number | null,
        pk = kijun[i - 1] as number | null;
      if (t != null && k != null && pt != null && pk != null) {
        if (barsSinceBullTK == null && pt <= pk && t > k) barsSinceBullTK = lastIndex - i;
        if (barsSinceBearTK == null && pt >= pk && t < k) barsSinceBearTK = lastIndex - i;
      }
      // Cloud breakout (usando close vs nuvem naquele i)
      const a = senkouA[i] as number | null,
        b = senkouB[i] as number | null;
      if (a != null && b != null) {
        const top = Math.max(a, b),
          bot = Math.min(a, b);
        const c = closes[i];
        const pc = closes[i - 1];
        if (barsSinceCloudUp == null && pc <= top && c > top) barsSinceCloudUp = lastIndex - i;
        if (barsSinceCloudDown == null && pc >= bot && c < bot) barsSinceCloudDown = lastIndex - i;
      }
      if (
        barsSinceBullTK != null &&
        barsSinceBearTK != null &&
        barsSinceCloudUp != null &&
        barsSinceCloudDown != null
      ) {
        break;
      }
    }

    const recentBullTK = barsSinceBullTK != null && barsSinceBullTK <= RECENT;
    const recentBearTK = barsSinceBearTK != null && barsSinceBearTK <= RECENT;
    const recentCloudUp = barsSinceCloudUp != null && barsSinceCloudUp <= RECENT;
    const recentCloudDown = barsSinceCloudDown != null && barsSinceCloudDown <= RECENT;

    // Slopes (tendência mais saudável quando coerentes)
    const K = Math.min(3, lastIndex);
    const slopeTenkan = slopeAt(tenkan, lastIndex, K);
    const slopeKijun = slopeAt(kijun, lastIndex, K);
    const slopeSpanA = slopeAt(senkouA, lastIndex, K);
    const slopeSpanB = slopeAt(senkouB, lastIndex, K);
    const slopesUp = [slopeTenkan, slopeKijun, slopeSpanA, slopeSpanB].every(
      (s) => s != null && s > 0,
    );
    const slopesDown = [slopeTenkan, slopeKijun, slopeSpanA, slopeSpanB].every(
      (s) => s != null && s < 0,
    );

    // Overextension (distância do close à Kijun)
    const kijunDistPct = lKijun ? (Math.abs(lClose - lKijun) / lKijun) * 100 : 0;
    const overExtendedLong = priceAboveCloud && kijunDistPct > 3; // >~3% acima da Kijun
    const overExtendedShort = priceBelowCloud && kijunDistPct > 3;

    // Espessura da nuvem (relativa ao preço)
    const kumoThicknessPct =
      cloudTop != null && cloudBottom != null && cloudTop !== 0
        ? ((cloudTop - cloudBottom) / ((cloudTop + cloudBottom) / 2)) * 100
        : 0;

    // Chikou: acima/abaixo do preço passado (no mesmo índice deslocado)
    const lChikou = chikou[lastIndex] as number | null;
    const pricePast = closes[lastIndex - displacement];
    const chikouBull = lChikou != null ? lChikou > pricePast : false;
    const chikouBear = lChikou != null ? lChikou < pricePast : false;

    // Regras profissionais (conservadoras):
    // Long: preço acima da nuvem + nuvem bullish + TK bullish (de preferência recente) + Chikou bullish + slopesUp
    // Short: espelhado
    let entrySignal: "long" | "short" | "none" = "none";
    const longStruct =
      priceAboveCloud &&
      cloudBull &&
      bullTKCross &&
      chikouBull &&
      (slopesUp || recentBullTK || recentCloudUp);
    const shortStruct =
      priceBelowCloud &&
      cloudBear &&
      bearTKCross &&
      chikouBear &&
      (slopesDown || recentBearTK || recentCloudDown);

    if (longStruct && !overExtendedLong) entrySignal = "long";
    else if (shortStruct && !overExtendedShort) entrySignal = "short";
    else entrySignal = "none";

    // Confidence (0..1): soma ponderada de evidências
    const pieces = [
      priceAboveCloud || priceBelowCloud ? 0.22 : 0, // sair da nuvem vale muito
      cloudBull || cloudBear ? 0.15 : 0,
      bullTKCross || bearTKCross ? 0.18 : 0,
      chikouBull || chikouBear ? 0.15 : 0,
      slopesUp || slopesDown ? 0.12 : 0,
      recentBullTK || recentBearTK ? 0.08 : 0,
      recentCloudUp || recentCloudDown ? 0.05 : 0,
      // nuvem muito grossa aumenta confiança do rompimento
      Math.min(0.05, Math.max(0, kumoThicknessPct / 10) * 0.05),
    ];
    let confidence = pieces.reduce((a, b) => a + b, 0);
    if (entrySignal === "none") confidence = Math.min(confidence, 0.6); // sem sinal, confiança capada
    if (overExtendedLong || overExtendedShort) confidence = Math.max(0.3, confidence - 0.15);
    confidence = Math.max(0, Math.min(1, confidence));

    return {
      ok: true as const,
      last: {
        tenkan: lTenkan ?? null,
        kijun: lKijun ?? null,
        spanA: lSpanA ?? null,
        spanB: lSpanB ?? null,
        chikou: lChikou ?? null,
      },
      tenkan,
      kijun,
      senkouA,
      senkouB,
      chikou,

      priceAboveCloud,
      priceBelowCloud,
      priceInCloud,
      cloudBull,
      cloudBear,

      bullTKCross,
      bearTKCross,
      recentBullTK,
      recentBearTK,

      recentCloudUp,
      recentCloudDown,

      slopeTenkan,
      slopeKijun,
      slopeSpanA,
      slopeSpanB,
      slopesUp,
      slopesDown,

      kijunDistPct,
      overExtendedLong,
      overExtendedShort,

      kumoThicknessPct,

      chikouBull,
      chikouBear,

      entrySignal,
      confidence,
      meta: { convPeriod, basePeriod, spanBPeriod, displacement, lastIndex, recentWindow: RECENT },
    };
  }

  static decision(
    params: IchimokuParams,
  ): IIndicatorDecisionMin<ReturnType<typeof IchimokuIndicator.calculate>> {
    const r = IchimokuIndicator.calculate(params);
    if (!r.ok) {
      return {
        id: "ichimoku",
        direction: "none",
        entry: "no-trigger",
        score: { directional: 0, confidence: 0, quality: 0.5 },
        health: { isValid: false },
        data: r,
      };
    }

    const dir = r.entrySignal === "long" ? 1 : r.entrySignal === "short" ? -1 : 0;

    // Qualidade: maior quando estrutura completa e não esticado
    let quality = 0.85;
    const strongLong =
      r.priceAboveCloud &&
      r.cloudBull &&
      r.bullTKCross &&
      r.chikouBull &&
      (r.slopesUp || r.recentBullTK || r.recentCloudUp);
    const strongShort =
      r.priceBelowCloud &&
      r.cloudBear &&
      r.bearTKCross &&
      r.chikouBear &&
      (r.slopesDown || r.recentBearTK || r.recentCloudDown);
    if ((dir > 0 && strongLong) || (dir < 0 && strongShort)) quality = 1.0;
    if (r.overExtendedLong || r.overExtendedShort) quality = Math.min(quality, 0.8);
    if (r.priceInCloud) quality = Math.min(quality, 0.7); // em nuvem é mais incerto

    return {
      id: "ichimoku",
      direction: dir > 0 ? "buy" : dir < 0 ? "sell" : "none",
      entry: dir !== 0 ? "triggered" : "no-trigger",
      score: { directional: dir, confidence: r.confidence, quality },
      health: { isValid: true },
      data: r,
    };
  }
}
