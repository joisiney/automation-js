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
    if (!len || len < Math.max(spanBPeriod, basePeriod) + displacement + 2) {
      return { ok: false as const, reason: "Dados insuficientes." };
    }

    const lastIndex = confirmOnClose ? len - 2 : len - 1;
    const prevIndex = lastIndex - 1;
    if (lastIndex < Math.max(spanBPeriod - 1, basePeriod - 1, convPeriod - 1)) {
      return { ok: false as const, reason: "Dados insuficientes para confirmar no fechamento." };
    }

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
    const senkouA = shiftForward(
      padLeft(
        len,
        tenkan.map((t, i) =>
          t != null && kijun[i] != null ? (t + (kijun[i] as number)) / 2 : null,
        ),
      ),
      displacement,
    );
    const senkouB = shiftForward(padLeft(len, spanBRaw), displacement);
    const chikou = shiftBackward(
      padLeft(
        len,
        closes.map((c) => c as number),
      ),
      displacement,
    );

    const lClose = closes[lastIndex];
    const lTenkan = tenkan[lastIndex] as number | null;
    const lKijun = kijun[lastIndex] as number | null;
    const lSpanA = senkouA[lastIndex] as number | null;
    const lSpanB = senkouB[lastIndex] as number | null;
    const pTenkan = tenkan[prevIndex] as number | null;
    const pKijun = kijun[prevIndex] as number | null;

    const priceAboveCloud =
      lSpanA != null && lSpanB != null ? lClose > Math.max(lSpanA, lSpanB) : false;
    const priceBelowCloud =
      lSpanA != null && lSpanB != null ? lClose < Math.min(lSpanA, lSpanB) : false;
    const priceInCloud = lSpanA != null && lSpanB != null && !priceAboveCloud && !priceBelowCloud;

    const bullTKCross =
      pTenkan != null && pKijun != null && lTenkan != null && lKijun != null
        ? pTenkan <= pKijun && lTenkan > lKijun
        : false;
    const bearTKCross =
      pTenkan != null && pKijun != null && lTenkan != null && lKijun != null
        ? pTenkan >= pKijun && lTenkan < lKijun
        : false;

    const cloudBull = lSpanA != null && lSpanB != null ? lSpanA > lSpanB : false;
    const cloudBear = lSpanA != null && lSpanB != null ? lSpanA < lSpanB : false;

    // Chikou acima/abaixo do preço de 26 períodos atrás
    const lChikou = chikou[lastIndex] as number | null;
    const pricePast = closes[lastIndex - displacement];
    const chikouBull = lChikou != null ? lChikou > pricePast : false;
    const chikouBear = lChikou != null ? lChikou < pricePast : false;

    let entrySignal: "long" | "short" | "none" = "none";
    if (priceAboveCloud && cloudBull && bullTKCross && chikouBull) entrySignal = "long";
    else if (priceBelowCloud && cloudBear && bearTKCross && chikouBear) entrySignal = "short";

    // confiança: soma de condições satisfeitas
    const checks = [
      priceAboveCloud || priceBelowCloud,
      cloudBull || cloudBear,
      bullTKCross || bearTKCross,
      chikouBull || chikouBear,
    ];
    const confidence = Math.min(1, checks.filter(Boolean).length / checks.length);

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
      chikouBull,
      chikouBear,
      entrySignal,
      confidence,
      meta: { convPeriod, basePeriod, spanBPeriod, displacement, lastIndex },
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
    const quality = r.priceInCloud ? 0.7 : 1;
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
