// EnsembleAdaptive.ts
import { ADXIndicator } from "../indicators/adx";
import { BollingerBandsIndicator } from "../indicators/bollinger-bands";
import { EMAIndicator } from "../indicators/ema";
import { IchimokuIndicator } from "../indicators/Ichimoku";
import { MACDIndicator } from "../indicators/macd";
import { RSIIndicator } from "../indicators/rsi";
import { VolumeIndicator } from "../indicators/volume";
import { VWAPIndicator } from "../indicators/vwap";
import { WilliamsAlligatorIndicator } from "../indicators/williams";

type Candles = {
  closes: number[];
  highs?: number[];
  lows?: number[];
  opens?: number[];
  volumes?: number[];
};

// ---------- entradas ----------
export type TFInput = {
  label: string; // "5m", "15m", "1h", "4h", "1D"...
  candles: Candles;
  weight?: number; // opcional: override do peso do TF
  params?: Partial<{
    ema: Parameters<typeof EMAIndicator.decision>[0];
    macd: Parameters<typeof MACDIndicator.decision>[0];
    rsi: Parameters<typeof RSIIndicator.decision>[0];
    ichimoku: Parameters<typeof IchimokuIndicator.decision>[0];
    alligator: Parameters<typeof WilliamsAlligatorIndicator.decision>[0];
    vwap: Parameters<typeof VWAPIndicator.decision>[0];
    bollinger: Parameters<typeof BollingerBandsIndicator.decision>[0];
    volume: Parameters<typeof VolumeIndicator.decision>[0];
    adx: Parameters<typeof ADXIndicator.decision>[0];
  }>;
};

export type EnsembleParams = {
  timeframes: TFInput[];
  confirmOnClose?: boolean;

  // thresholds p/ decisão final
  buyThreshold?: number; // default +0.15
  sellThreshold?: number; // default -0.15

  // sizing
  basePositionPct?: number; // default 0.25 (25% do limite diário)
  maxPositionPct?: number; // default 0.50 (teto 50%)

  // risco (failsafe p/ stops)
  minStopATRMultiple?: number; // default 1.0
  maxStopATRMultiple?: number; // default 3.0
};

// ---------- estrutura de estado para aprendizado ----------
type IndicatorPerf = {
  ewmaWin: number; // EWMA de taxa de acerto (0..1)
  ewmaEdge: number; // EWMA do edge médio por trade (+/- em %)
  n: number; // contagem (para info)
};

type PerformanceDB = Record<string, IndicatorPerf>;

// ---------- saída ----------
type IndicatorVote = {
  id: string;
  dir: number; // -1,0,+1
  conf: number; // 0..1
  qual?: number; // 0..1
  priceRef?: number;
  stopLong?: number;
  stopShort?: number;
  atr?: number;
};

type TFVote = {
  tf: string;
  weight: number;
  votes: IndicatorVote[];
  tfScore: number; // -1..+1
};

export type DecisionOut = {
  ok: true;
  direction: "buy" | "sell" | "none";
  entry: "triggered" | "no-trigger";
  score: { directional: number; confidence: number; quality: number };
  sizing?: { positionPctOfDailyLimit: number; stopLossPrice?: number };
  weightsUsed: {
    tfWeights: Array<{ tf: string; weight: number }>;
    indicatorWeights: Record<string, number>;
  };
  breakdown: {
    ensembleScore: number;
    tfScores: Array<{ tf: string; score: number }>;
    indicators: Array<{
      tf: string;
      id: string;
      dir: number;
      conf: number;
      qual: number;
      wInd: number;
    }>;
    stopBlend?: { chosen?: number; candidates: Array<{ tf: string; id: string; stop?: number }> };
  };
};
const QUALITY_DEFAULT = 0.9;
// =========================================================
// ===============  ENSEMBLE ADAPTATIVO  ===================
// =========================================================
export class EnsembleAdaptive {
  // ---------- Pesos baseline por indicador (como no seu DEFAULT_WEIGHTS) ----------
  private indicatorBase: Record<string, number> = {
    ema: 0.18,
    macd: 0.18,
    ichimoku: 0.14,
    rsi: 0.12,
    adx: 0.1,
    bollinger: 0.1,
    vwap: 0.08,
    alligator: 0.06,
    volume: 0.04,
  };

  // Banco de desempenho para auto-ajuste online
  private perf: PerformanceDB = {}; // preenchido via updateWithOutcome()

  // Hiperparâmetros do learner
  private alpha = 0.12; // suavização (EWMA)
  private maxBoost = 1.35; // boost máx. por performance
  private maxCut = 0.65; // penalidade máx. por performance
  private minWeight = 0.02; // piso por indicador pós-normalização

  // ---------- Utilitários ----------
  private clamp(x: number, a: number, b: number) {
    return Math.max(a, Math.min(b, x));
  }

  private normalizeWeights(w: Record<string, number>) {
    const sum = Object.values(w).reduce((a, b) => a + b, 0);
    if (sum <= 0) return w;
    const out: Record<string, number> = {};
    for (const k of Object.keys(w)) out[k] = Math.max(this.minWeight, w[k] / sum);
    // renormaliza após piso
    const sum2 = Object.values(out).reduce((a, b) => a + b, 0);
    for (const k of Object.keys(out)) out[k] = out[k] / sum2;
    return out;
  }

  // ---------- Adapta pesos por timeframe (igual sua ideia) ----------
  private adaptWeightsByInterval(interval: string, base: Record<string, number>) {
    const w = { ...base };
    const isIntra = /^(1|3|5|15|30)m$|^1h$/.test(interval);
    if (isIntra) {
      w.vwap += 0.03;
      w.volume += 0.02;
      w.ichimoku = Math.max(0, w.ichimoku - 0.03);
      w.alligator = Math.max(0, w.alligator - 0.02);
    } else {
      // HTF
      w.ema += 0.02;
      w.ichimoku += 0.02;
      w.vwap = Math.max(0, w.vwap - 0.02);
      w.volume = Math.max(0, w.volume - 0.02);
    }
    return this.normalizeWeights(w);
  }

  // ---------- Peso automático por TF (maiores TFs pesam mais) ----------
  private tfAutoWeight(label: string) {
    const L = label.toLowerCase();
    if (L.includes("1d") || L === "d" || L.includes("daily")) return 2.0;
    if (L.includes("4h")) return 1.6;
    if (L.includes("1h")) return 1.4;
    if (L.includes("30m")) return 1.2;
    if (L.includes("15m")) return 1.1;
    return 1.0; // 5m/3m/1m...
  }

  // ---------- Ajuste online de pesos por performance ----------
  // outcomePct: P&L relativo ao risco (ex.: +1.0 = atingiu 1R; -1.0 = -1R)
  // usedIndicators: ids dos indicadores que estavam contribuintes no momento da decisão
  updateWithOutcome(outcomePct: number, usedIndicators: string[]) {
    for (const id of usedIndicators) {
      const cur = this.perf[id] ?? { ewmaWin: 0.5, ewmaEdge: 0, n: 0 };
      const win = outcomePct > 0 ? 1 : 0;
      cur.ewmaWin = (1 - this.alpha) * cur.ewmaWin + this.alpha * win;
      cur.ewmaEdge = (1 - this.alpha) * cur.ewmaEdge + this.alpha * outcomePct;
      cur.n += 1;
      this.perf[id] = cur;
    }
  }

  // Converte performance -> multiplicador de peso
  private perfMultiplier(id: string) {
    const p = this.perf[id];
    if (!p) return 1.0;
    // edge/WinRate em 0.5 não ajusta; acima de 0.5 aumenta; abaixo reduz
    const winAdj = (p.ewmaWin - 0.5) * 2; // -1..+1
    const edgeAdj = this.clamp(p.ewmaEdge, -1.5, 1.5) / 1.5; // -1..+1 (cap)
    const mix = 0.6 * winAdj + 0.4 * edgeAdj; // -1..+1
    const mult =
      mix >= 0
        ? 1 + mix * (this.maxBoost - 1) // até +35%
        : 1 + mix * (1 - this.maxCut); // até -35%
    return this.clamp(mult, this.maxCut, this.maxBoost);
  }

  // Monta pesos por indicador considerando: baseline -> TF adaptation -> performance
  private buildIndicatorWeightsForTF(tfLabel: string) {
    // 1) baseline
    const base = { ...this.indicatorBase };
    // 2) adapta por intervalo
    const adapt = this.adaptWeightsByInterval(tfLabel, base);
    // 3) aplica multiplicadores de performance
    const perfAdj: Record<string, number> = {};
    for (const k of Object.keys(adapt)) perfAdj[k] = adapt[k] * this.perfMultiplier(k);
    // 4) normaliza
    return this.normalizeWeights(perfAdj);
  }

  // ---------- Main decision ----------
  decision({
    timeframes,
    confirmOnClose = true,
    buyThreshold = +0.15,
    sellThreshold = -0.15,
    basePositionPct = 0.25,
    maxPositionPct = 0.5,
    minStopATRMultiple = 1.0,
    maxStopATRMultiple = 3.0,
  }: EnsembleParams): DecisionOut {
    if (!timeframes?.length) {
      return {
        ok: true,
        direction: "none",
        entry: "no-trigger",
        score: { directional: 0, confidence: 0, quality: 0.5 },
        weightsUsed: { tfWeights: [], indicatorWeights: {} },
        breakdown: { ensembleScore: 0, tfScores: [], indicators: [] },
      };
    }

    const dirNum = (d: string) => (d === "buy" ? +1 : d === "sell" ? -1 : 0);
    const tfVotes: TFVote[] = [];
    const tfWeightView: Array<{ tf: string; weight: number }> = [];
    const indicatorWeightSnapshot: Record<string, number> = {}; // último TF “execução” para logging

    // 1) roda indicadores por TF
    for (const tf of timeframes) {
      const tfW = tf.weight ?? this.tfAutoWeight(tf.label);
      tfWeightView.push({ tf: tf.label, weight: tfW });

      const wInd = this.buildIndicatorWeightsForTF(tf.label);
      // guardar snapshot dos pesos (para debug; última iteração prevalece)
      Object.assign(indicatorWeightSnapshot, wInd);

      const { candles } = tf;
      const lastClose = candles.closes?.length
        ? candles.closes[confirmOnClose ? candles.closes.length - 2 : candles.closes.length - 1]
        : undefined;

      const votes: IndicatorVote[] = [];

      // EMA
      try {
        const res = EMAIndicator.decision({
          candles,
          confirmOnClose,
          period: tf.params?.ema?.period ?? 9,
          slopeWindow: tf.params?.ema?.slopeWindow ?? 3,
          atrPeriod: tf.params?.ema?.atrPeriod ?? 14,
          recentBars: tf.params?.ema?.recentBars ?? 3,
          atrStopMultiple: tf.params?.ema?.atrStopMultiple ?? 1.3,
          maxLookback: tf.params?.ema?.maxLookback ?? 20,
          barsSinceMode: tf.params?.ema?.barsSinceMode ?? "infinity",
          htf: tf.params?.ema?.htf,
        } as any);
        const d = res.data as any;
        votes.push({
          id: "ema",
          dir: dirNum(res.direction),
          conf: res.score.confidence,
          qual: res.score.quality,
          priceRef: lastClose,
          stopLong: d?.stopLong,
          stopShort: d?.stopShort,
          atr: d?.lastATR,
        });
      } catch {
        //
      }

      // MACD
      try {
        const res = MACDIndicator.decision({ candles, confirmOnClose } as any);
        votes.push({
          id: "macd",
          dir: dirNum(res.direction),
          conf: res.score.confidence,
          qual: res.score.quality,
        });
      } catch {
        //
      }

      // RSI
      try {
        const res = RSIIndicator.decision({
          candles: { closes: candles.closes, highs: candles.highs, lows: candles.lows },
          period: tf.params?.rsi?.period ?? 14,
          confirmOnClose,
          buyThreshold: 30,
          sellThreshold: 70,
          slopeWindow: 3,
          recentBars: 3,
          atrPeriod: 14,
        } as any);
        votes.push({
          id: "rsi",
          dir: dirNum(res.direction),
          conf: res.score.confidence,
          qual: res.score.quality,
        });
      } catch {
        //
      }

      // Ichimoku
      try {
        const res = IchimokuIndicator.decision({
          candles: { highs: candles.highs!, lows: candles.lows!, closes: candles.closes },
          confirmOnClose,
        } as any);
        votes.push({
          id: "ichimoku",
          dir: dirNum(res.direction),
          conf: res.score.confidence,
          qual: res.score.quality,
        });
      } catch {
        //
      }

      // Alligator
      try {
        const res = WilliamsAlligatorIndicator.decision({
          candles: { highs: candles.highs!, lows: candles.lows! },
          confirmOnClose,
        } as any);
        votes.push({
          id: "alligator",
          dir: dirNum(res.direction),
          conf: res.score.confidence,
          qual: res.score.quality,
        });
      } catch {
        //
      }

      // VWAP
      try {
        const res = VWAPIndicator.decision({
          candles: {
            highs: candles.highs!,
            lows: candles.lows!,
            closes: candles.closes,
            volumes: candles.volumes ?? [],
          },
          confirmOnClose,
        } as any);
        votes.push({
          id: "vwap",
          dir: dirNum(res.direction),
          conf: res.score.confidence,
          qual: res.score.quality,
        });
      } catch {
        //
      }

      // Bollinger
      try {
        const res = BollingerBandsIndicator.decision({
          candles: { closes: candles.closes },
          confirmOnClose,
        } as any);
        votes.push({
          id: "bollinger",
          dir: dirNum(res.direction),
          conf: res.score.confidence,
          qual: res.score.quality,
        });
      } catch {
        //
      }

      // ADX
      try {
        const res = ADXIndicator.decision({
          candles: { closes: candles.closes, highs: candles.highs!, lows: candles.lows! },
          confirmOnClose,
        } as any);
        votes.push({
          id: "adx",
          dir: dirNum(res.direction),
          conf: res.score.confidence,
          qual: res.score.quality,
        });
      } catch {
        //
      }

      // Volume
      try {
        const res = VolumeIndicator.decision({
          candles: {
            opens: candles.opens ?? candles.closes,
            closes: candles.closes,
            volumes: candles.volumes ?? [],
          },
          confirmOnClose,
        } as any);
        votes.push({
          id: "volume",
          dir: dirNum(res.direction),
          conf: res.score.confidence,
          qual: res.score.quality,
        });
      } catch {
        //
      }

      // agregado do TF: usa pesos por indicador (wInd)
      const num = votes.reduce(
        (a, v) => a + v.dir * v.conf * (v.qual ?? QUALITY_DEFAULT) * (wInd[v.id] ?? 0),
        0,
      );
      const den =
        votes.reduce(
          (a, v) => a + Math.abs(v.dir) * v.conf * (v.qual ?? QUALITY_DEFAULT) * (wInd[v.id] ?? 0),
          0,
        ) || 1;
      const tfScore = num / den;

      tfVotes.push({ tf: tf.label, weight: tfW, votes, tfScore });
    }

    // 2) agregação entre TFs
    const totalW = tfVotes.reduce((a, t) => a + t.weight, 0) || 1;
    const ensembleScore = tfVotes.reduce((a, t) => a + t.weight * t.tfScore, 0) / totalW;

    const finalDir: "buy" | "sell" | "none" =
      ensembleScore >= buyThreshold ? "buy" : ensembleScore <= sellThreshold ? "sell" : "none";

    // confiança e qualidade do ensemble
    const allVotes = tfVotes.flatMap((t) =>
      t.votes.map((v) => ({
        ...v,
        tfW: t.weight,
        wInd: this.buildIndicatorWeightsForTF(t.tf)[v.id] ?? 0,
      })),
    );
    const conf = (() => {
      const parts = allVotes.map(
        (v) => v.tfW * v.wInd * Math.abs(v.dir) * v.conf * (v.qual ?? QUALITY_DEFAULT),
      );
      const maxPoss = tfVotes.reduce((a, t) => a + t.weight, 0); // ~normalizador
      const raw = parts.reduce((a, x) => a + x, 0) / Math.max(1e-9, maxPoss);
      return this.clamp(0.5 * raw + 0.5 * Math.abs(ensembleScore), 0, 1);
    })();
    const qual = (() => {
      const hi = tfVotes.filter((t) => t.weight >= 1.4);
      const hiAgree = hi.length
        ? hi.every(
            (t) => Math.sign(t.tfScore) === Math.sign(ensembleScore) && Math.abs(t.tfScore) >= 0.25,
          )
        : false;
      let q = 0.85;
      if (Math.abs(ensembleScore) >= 0.4) q = Math.max(q, 0.95);
      if (hiAgree && Math.abs(ensembleScore) >= 0.6) q = 1.0;
      return q;
    })();

    // 3) stop-loss (mediana de candidatos + piso por ATR)
    let stopLoss: number | undefined;
    if (finalDir !== "none") {
      const candidates: Array<{ tf: string; id: string; stop?: number }> = [];
      for (const t of tfVotes) {
        for (const v of t.votes) {
          if (finalDir === "buy" && v.stopLong != null)
            candidates.push({ tf: t.tf, id: v.id, stop: v.stopLong });
          if (finalDir === "sell" && v.stopShort != null)
            candidates.push({ tf: t.tf, id: v.id, stop: v.stopShort });
        }
      }
      const stops = candidates
        .map((c) => c.stop!)
        .filter((s) => Number.isFinite(s))
        .sort((a, b) => a - b);
      if (stops.length) {
        const mid = Math.floor(stops.length / 2);
        stopLoss = stops.length % 2 ? stops[mid] : (stops[mid - 1] + stops[mid]) / 2;
      }

      const refClose =
        timeframes[0].candles.closes[
          confirmOnClose
            ? timeframes[0].candles.closes.length - 2
            : timeframes[0].candles.closes.length - 1
        ];
      const atrs = allVotes.map((v) => v.atr).filter((x) => typeof x === "number") as number[];
      if (Number.isFinite(refClose) && atrs.length) {
        const avgATR = atrs.reduce((a, b) => a + b, 0) / atrs.length;
        const minDist = this.clamp(minStopATRMultiple, 0.5, maxStopATRMultiple) * avgATR;
        if (stopLoss == null) {
          stopLoss = finalDir === "buy" ? refClose - minDist : refClose + minDist;
        } else {
          if (finalDir === "buy" && refClose - stopLoss < minDist) stopLoss = refClose - minDist;
          if (finalDir === "sell" && stopLoss - refClose < minDist) stopLoss = refClose + minDist;
        }
      }
    }

    // 4) sizing (% do limite diário)
    let positionPctOfDailyLimit = 0;
    if (finalDir !== "none") {
      const closesSample = timeframes
        .map((tf) => tf.candles.closes)
        .filter((c) => c?.length)
        .map((c) => c[confirmOnClose ? c.length - 2 : c.length - 1])
        .filter(Number.isFinite) as number[];
      const priceRef = closesSample[0];
      const atrs = allVotes.map((v) => v.atr).filter((x) => typeof x === "number") as number[];
      const atrPct =
        priceRef && atrs.length ? atrs.reduce((a, b) => a + b, 0) / atrs.length / priceRef : 0;
      const hi = tfVotes.filter((t) => t.weight >= 1.4);
      const hiAgree = hi.length
        ? hi.filter(
            (t) => Math.sign(t.tfScore) === Math.sign(ensembleScore) && Math.abs(t.tfScore) >= 0.2,
          ).length / hi.length
        : 0.5;

      const volFactor = atrPct > 0 ? this.clamp(0.02 / Math.max(0.005, atrPct), 0.5, 1.5) : 1;
      const raw = basePositionPct * conf * (0.5 + 0.5 * hiAgree) * volFactor;
      positionPctOfDailyLimit = this.clamp(raw, 0.05, maxPositionPct);
    }

    const finalDirectional = finalDir === "buy" ? +1 : finalDir === "sell" ? -1 : 0;

    return {
      ok: true,
      direction: finalDir,
      entry: finalDir !== "none" ? "triggered" : "no-trigger",
      score: { directional: finalDirectional, confidence: conf, quality: qual },
      sizing:
        finalDir === "none" ? undefined : { positionPctOfDailyLimit, stopLossPrice: stopLoss },
      weightsUsed: { tfWeights: tfWeightView, indicatorWeights: indicatorWeightSnapshot },
      breakdown: {
        ensembleScore,
        tfScores: tfVotes.map((t) => ({ tf: t.tf, score: t.tfScore })),
        indicators: tfVotes.flatMap((t) =>
          t.votes.map((v) => ({
            tf: t.tf,
            id: v.id,
            dir: v.dir,
            conf: v.conf,
            qual: v.qual ?? QUALITY_DEFAULT,
            wInd: this.buildIndicatorWeightsForTF(t.tf)[v.id] ?? 0,
          })),
        ),
        stopBlend:
          finalDir === "none"
            ? undefined
            : {
                chosen: stopLoss,
                candidates: tfVotes.flatMap((t) =>
                  t.votes
                    .filter(
                      (v) =>
                        (finalDir === "buy" && v.stopLong != null) ||
                        (finalDir === "sell" && v.stopShort != null),
                    )
                    .map((v) => ({
                      tf: t.tf,
                      id: v.id,
                      stop: finalDir === "buy" ? v.stopLong : v.stopShort,
                    })),
                ),
              },
      },
    };
  }

  // ---------- API para configurar baseline/manual ----------
  setBaselineWeights(next: Partial<Record<string, number>>) {
    const filtered = Object.fromEntries(
      Object.entries(next).filter(([, v]) => v !== undefined),
    ) as Record<string, number>;
    this.indicatorBase = this.normalizeWeights({ ...this.indicatorBase, ...filtered });
  }
  getBaselineWeights() {
    return { ...this.indicatorBase };
  }
  getPerformanceDB() {
    return JSON.parse(JSON.stringify(this.perf));
  }
}
