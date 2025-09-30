import { writeFileSync } from "node:fs";
import * as TI from "technicalindicators";
import { getKlines as getKlinesB3 } from "./b3.js";
import { getKlines as getKlinesBinance } from "./binance.js";

const getKlines = {
  binance: getKlinesBinance,
  b3: getKlinesB3,
} as const;
const { EMA, RSI, MACD, BollingerBands, ADX, ATR } = TI;

const STRATEGY_KLINE = process.env.INTERVAL || process.argv[2];
const SYMBOL = process.env.SYMBOL || process.argv[3];
const INTERVAL = process.env.INTERVAL || process.argv[4];
const MARKET = (process.env.MARKET || process.argv[5]) as "spot" | "futures" | undefined;
const LIMIT = Number(process.argv[6] || 1000);
const VWAP_THRESHOLD = Number(process.env.VWAP_THRESHOLD || 1);

function computeVWAP(candles: any[]) {
  const out: number[] = [];
  let cumPV = 0;
  let cumVol = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    cumPV += tp * c.volume;
    cumVol += c.volume;
    out.push(cumPV / (cumVol || 1));
  }
  return out;
}

function padLeft<T>(fullLen: number, arr: Array<T | null | undefined>): Array<T | null> {
  const pad = Array(Math.max(0, fullLen - arr.length)).fill(null);
  return pad.concat(arr as Array<T | null>);
}

function last<T>(arr: Array<T | null | undefined>): T | undefined {
  return arr.filter((x) => x !== null && x !== undefined).slice(-1)[0] as T | undefined;
}

function pct(a: number, b: number) {
  return ((a - b) / b) * 100;
}

function intervalToTimeframe(interval: string) {
  const raw = String(interval);
  const s = raw.toLowerCase();
  if (["1m", "3m", "5m", "15m"].includes(s)) return "short";
  if (["30m", "1h", "2h", "4h", "6h"].includes(s)) return "medium";
  if (["8h", "12h", "1d", "3d", "1w"].includes(s) || raw === "1M") return "long";
  return "short";
}

function lastNum(arr: Array<number | null | undefined>): number {
  const v = arr.filter((x) => x !== null && x !== undefined).slice(-1)[0] as number | undefined;
  return v ?? 0;
}

(async () => {
  try {
    const candles = await (getKlines as any)[STRATEGY_KLINE!](SYMBOL, INTERVAL, LIMIT, {
      market: MARKET,
    });
    if (!candles.length) throw new Error("Nenhum candle retornado.");

    const opens = candles.map((c: any) => c.open);
    const closes = candles.map((c: any) => c.close);
    const highs = candles.map((c: any) => c.high);
    const lows = candles.map((c: any) => c.low);
    const volumes = candles.map((c: any) => c.volume);
    const times = candles.map((c: any) => c.closeTime);

    const ema9: number[] = EMA.calculate({ period: 9, values: closes as number[] });
    const ema21: number[] = EMA.calculate({ period: 21, values: closes as number[] });
    const ema99: number[] = EMA.calculate({ period: 99, values: closes as number[] });
    const ema200: number[] = EMA.calculate({ period: 200, values: closes as number[] });
    const rsi9: number[] = RSI.calculate({ period: 9, values: closes as number[] });
    const macd = MACD.calculate({
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
      values: closes as number[],
    });
    const bb = BollingerBands.calculate({ period: 20, values: closes as number[], stdDev: 2 });
    const adx14 = ADX.calculate({
      period: 14,
      high: highs as number[],
      low: lows as number[],
      close: closes as number[],
    });
    const atr14: number[] = ATR.calculate({
      period: 14,
      high: highs as number[],
      low: lows as number[],
      close: closes as number[],
    });
    const vwap = computeVWAP(candles);

    const len = candles.length;
    type Aligned = {
      ema9: Array<number | null>;
      ema21: Array<number | null>;
      ema99: Array<number | null>;
      ema200: Array<number | null>;
      rsi9: Array<number | null>;
      macd: Array<number | null>;
      macdSignal: Array<number | null>;
      macdHist: Array<number | null>;
      bbLower: Array<number | null>;
      bbMiddle: Array<number | null>;
      bbUpper: Array<number | null>;
      adx: Array<number | null>;
      plusDI: Array<number | null>;
      minusDI: Array<number | null>;
      atr14: Array<number | null>;
      vwap: number[];
      open: number[];
      close: number[];
      volume: number[];
      time: number[];
    };
    const aligned: Aligned = {
      ema9: padLeft(len, ema9),
      ema21: padLeft(len, ema21),
      ema99: padLeft(len, ema99),
      ema200: padLeft(len, ema200),
      rsi9: padLeft(len, rsi9),
      macd: padLeft(
        len,
        macd.map((m) => m.MACD),
      ),
      macdSignal: padLeft(
        len,
        macd.map((m) => m.signal),
      ),
      macdHist: padLeft(
        len,
        macd.map((m) => m.histogram),
      ),
      bbLower: padLeft(
        len,
        bb.map((b) => b.lower),
      ),
      bbMiddle: padLeft(
        len,
        bb.map((b) => b.middle),
      ),
      bbUpper: padLeft(
        len,
        bb.map((b) => b.upper),
      ),
      adx: padLeft(
        len,
        adx14.map((x) => x.adx),
      ),
      plusDI: padLeft(
        len,
        adx14.map((x) => x.pdi),
      ),
      minusDI: padLeft(
        len,
        adx14.map((x) => x.mdi),
      ),
      atr14: padLeft(len, atr14),
      vwap,
      open: opens,
      close: closes,
      volume: volumes,
      time: times,
    };

    const price = lastNum(aligned.close);
    const lastOpen = lastNum(aligned.open);
    const lastVol = lastNum(aligned.volume);
    const lastPlusDI = lastNum(aligned.plusDI);
    const lastMinusDI = lastNum(aligned.minusDI);
    const lastADX = lastNum(aligned.adx);
    let adxOperator: "neutral" | "buy" | "sell" = "neutral";
    if (lastPlusDI > lastMinusDI) adxOperator = "buy";
    else if (lastMinusDI > lastPlusDI) adxOperator = "sell";

    const lastEMA9 = lastNum(aligned.ema9);
    const lastEMA21 = lastNum(aligned.ema21);
    const lastEMA99 = lastNum(aligned.ema99);
    const lastEMA200 = lastNum(aligned.ema200);
    const lastRSI9 = lastNum(aligned.rsi9);
    const lastMACD = lastNum(aligned.macd);
    const lastMACDSignal = lastNum(aligned.macdSignal);
    const lastMACDHist = lastNum(aligned.macdHist);
    const lastBBLower = lastNum(aligned.bbLower);
    const lastBBMiddle = lastNum(aligned.bbMiddle);
    const lastBBUpper = lastNum(aligned.bbUpper);
    const lastATR = lastNum(aligned.atr14);
    const lastVWAP = aligned.vwap[aligned.vwap.length - 1] as number;
    const vwapDiffPct = pct(price, lastVWAP);

    const emaVotes = [
      price > lastEMA9 ? "buy" : "sell",
      price > lastEMA21 ? "buy" : "sell",
      price > lastEMA99 ? "buy" : "sell",
      price > lastEMA200 ? "buy" : "sell",
    ];
    const emaBuyCount = emaVotes.filter((v) => v === "buy").length;
    const emaSellCount = emaVotes.length - emaBuyCount;
    const emaOperator =
      emaBuyCount > emaSellCount ? "buy" : emaSellCount > emaBuyCount ? "sell" : "neutral";
    const emaConclusion =
      emaOperator === "buy"
        ? "Curto prazo comprador; preço acima da maioria das EMAs."
        : emaOperator === "sell"
          ? "Médio/longos vendedores; preço abaixo da maioria das EMAs."
          : "Curto prazo comprador; médio/longos ainda vendedor (sinal misto).";

    let rsiOperator: "neutral" | "buy" | "sell" = "neutral";
    let rsiNote = "Entre 30 e 70 → neutro (viés levemente comprador se > 50).";
    if (lastRSI9 > 70) {
      rsiOperator = "sell";
      rsiNote = "RSI > 70 → sobrecompra → venda.";
    } else if (lastRSI9 < 30) {
      rsiOperator = "buy";
      rsiNote = "RSI < 30 → sobrevenda → compra.";
    }

    const vwapThreshold = (VWAP_THRESHOLD as number) / 100;
    let vwapOperator: "neutral" | "buy" | "sell" = "neutral";
    let vwapNote = "Preço abaixo do VWAP mas não atingiu o critério de 1%.";
    if (price >= lastVWAP * (1 + vwapThreshold)) {
      vwapOperator = "buy";
      vwapNote = `Preço ≥ VWAP + ${VWAP_THRESHOLD}% → compra.`;
    } else if (price <= lastVWAP * (1 - vwapThreshold)) {
      vwapOperator = "sell";
      vwapNote = `Preço ≤ VWAP - ${VWAP_THRESHOLD}% → venda.`;
    }

    let bollingerPosition: "inside" | "touch_upper" | "touch_lower" = "inside";
    let bollingerOperator: "neutral" | "buy" | "sell" = "neutral";
    let bollingerNote = "Preço dentro das bandas (próximo da superior mas sem toque).";
    if (price >= lastBBUpper) {
      bollingerPosition = "touch_upper";
      bollingerOperator = "sell";
      bollingerNote = "Tocou/ultrapassou banda superior → venda.";
    } else if (price <= lastBBLower) {
      bollingerPosition = "touch_lower";
      bollingerOperator = "buy";
      bollingerNote = "Tocou/ultrapassou banda inferior → compra.";
    }

    let macdOperator: "neutral" | "buy" | "sell" = "neutral";
    let macdNote =
      "Condições mistas. Preferência: MACD acima da Signal + hist > 0 → compra; abaixo + hist < 0 → venda.";
    if (lastMACD > lastMACDSignal && lastMACDHist > 0) {
      macdOperator = "buy";
      macdNote = "MACD acima da Signal e histograma positivo → compra.";
    } else if (lastMACD < lastMACDSignal && lastMACDHist < 0) {
      macdOperator = "sell";
      macdNote = "MACD abaixo da Signal e histograma negativo → venda.";
    }

    const atrPctOfPrice = (lastATR / price) * 100;
    const atrOperator = "neutral" as const;
    const atrNote =
      "ATR baixo/modesto; sem série para afirmar direção (subindo/caindo). Operar com cautela.";

    const volumeOperator = price > lastOpen ? "buy" : price < lastOpen ? "sell" : "neutral";

    const detailed = {
      price,
      ema: {
        ema9: {
          value: lastEMA9,
          diffPct: Number(pct(price, lastEMA9).toFixed(2)),
          operator: price > lastEMA9 ? "buy" : "sell",
        },
        ema21: {
          value: lastEMA21,
          diffPct: Number(pct(price, lastEMA21).toFixed(2)),
          operator: price > lastEMA21 ? "buy" : "sell",
        },
        ema99: {
          value: lastEMA99,
          diffPct: Number(pct(price, lastEMA99).toFixed(2)),
          operator: price > lastEMA99 ? "buy" : "sell",
        },
        ema200: {
          value: lastEMA200,
          diffPct: Number(pct(price, lastEMA200).toFixed(2)),
          operator: price > lastEMA200 ? "buy" : "sell",
        },
        conclusion: emaConclusion,
        operator: emaOperator,
      },
      rsi: {
        value: lastRSI9,
        zone: lastRSI9 > 70 ? ">70" : lastRSI9 < 30 ? "<30" : "30-70",
        operator: rsiOperator,
        note: rsiNote,
      },
      volume: { value: lastVol, operator: volumeOperator, note: "Sem média comparativa..." },
      vwap: {
        value: lastVWAP,
        diffPct: Number(vwapDiffPct.toFixed(2)),
        thresholdPct: VWAP_THRESHOLD,
        operator: vwapOperator,
        note: vwapNote,
      },
      adx: {
        adx: lastADX,
        plusDI: lastPlusDI,
        minusDI: lastMinusDI,
        operator: adxOperator,
        note: "ADX > 25 ...",
      },
      bollinger: {
        lower: lastBBLower,
        middle: lastBBMiddle,
        upper: lastBBUpper,
        position: bollingerPosition,
        operator: bollingerOperator,
        note: bollingerNote,
      },
      macd: {
        macd: lastMACD,
        signal: lastMACDSignal,
        hist: lastMACDHist,
        operator: macdOperator,
        note: macdNote,
      },
      atr: {
        value: lastATR,
        pctOfPrice: Number(atrPctOfPrice.toFixed(2)),
        operator: atrOperator,
        note: atrNote,
      },
    };

    const indicatorOps = [
      detailed.ema.operator,
      detailed.rsi.operator,
      detailed.volume.operator,
      detailed.vwap.operator,
      detailed.adx.operator,
      detailed.bollinger.operator,
      detailed.macd.operator,
      detailed.atr.operator,
    ];
    const votes = {
      buy: indicatorOps.filter((v) => v === "buy").length,
      sell: indicatorOps.filter((v) => v === "sell").length,
      neutral: indicatorOps.filter((v) => v === "neutral").length,
    };

    let atrVolatility: "low" | "medium" | "high" = "low";
    if (atrPctOfPrice >= 1.5) atrVolatility = "high";
    else if (atrPctOfPrice >= 0.5) atrVolatility = "medium";
    const bollingerWidthPct = Number(
      (((lastBBUpper - lastBBLower) / lastBBMiddle) * 100).toFixed(2),
    );
    let riskConclusion = "Risco baixo, volatilidade modesta";
    if (atrVolatility === "medium" || bollingerWidthPct >= 2)
      riskConclusion = "Risco moderado, volatilidade em aumento";
    if (atrVolatility === "high" || bollingerWidthPct >= 4)
      riskConclusion = "Risco alto, volatilidade elevada";

    const signal = {
      ema: detailed.ema.operator,
      rsi: detailed.rsi.operator,
      volume: detailed.volume.operator,
      vwap: detailed.vwap.operator,
      adx: detailed.adx.operator,
      bollinger: detailed.bollinger.operator,
      macd: detailed.macd.operator,
      atr: detailed.atr.operator,
      ema9: detailed.ema.ema9.operator,
      ema21: detailed.ema.ema21.operator,
      ema99: detailed.ema.ema99.operator,
      ema200: detailed.ema.ema200.operator,
    } as const;

    const weights = {
      macd: 2.0,
      adx: 2.0,
      emaShort: 2.0,
      emaLong: 1.0,
      vwap: 1.0,
      volume: 1.0,
      rsi: 0.5,
      bollinger: 0.5,
    };
    const dir = (op: string) => (op === "buy" ? 1 : op === "sell" ? -1 : 0);
    const emaShortOpSum = dir(signal.ema9) + dir(signal.ema21);
    const emaShortOp = emaShortOpSum > 0 ? "buy" : emaShortOpSum < 0 ? "sell" : "neutral";
    const emaLongOpSum = dir(signal.ema99) + dir(signal.ema200);
    const emaLongOp = emaLongOpSum > 0 ? "buy" : emaLongOpSum < 0 ? "sell" : "neutral";
    const score =
      dir(signal.macd) * weights.macd +
      dir(signal.adx) * weights.adx +
      dir(emaShortOp) * weights.emaShort +
      dir(emaLongOp) * weights.emaLong +
      dir(signal.vwap) * weights.vwap +
      dir(signal.volume) * weights.volume +
      dir(signal.rsi) * weights.rsi +
      dir(signal.bollinger) * weights.bollinger;
    const maxScore =
      weights.macd +
      weights.adx +
      weights.emaShort +
      weights.emaLong +
      weights.vwap +
      weights.volume +
      weights.rsi +
      weights.bollinger;
    const confidence = Math.abs(score) / maxScore;
    const deadZone = 0.2;
    let stance: "neutral" | "buy" | "sell" = "neutral";
    if (score > maxScore * deadZone) stance = "buy";
    else if (score < -maxScore * deadZone) stance = "sell";

    const nodes = [
      {
        id: "short-term",
        stance: emaShortOp === "neutral" && signal.macd === "sell" ? "sell" : emaShortOp,
        weight: 0.6,
        drivers: ["ema9", "ema21", "macd", "adx"],
        notes: "Pressão vendedora/leituras de curto prazo (EMAs curtas + momentum)",
      },
      {
        id: "flow",
        stance:
          signal.vwap === "buy" || signal.volume === "buy"
            ? "buy"
            : signal.vwap === "sell" || signal.volume === "sell"
              ? "sell"
              : "neutral",
        weight: 0.3,
        drivers: ["vwap", "volume"],
        notes: "Fluxo/VWAP intraday",
      },
      {
        id: "trend-structure",
        stance: emaLongOp,
        weight: 0.1,
        drivers: ["ema99", "ema200"],
        notes: "Estrutura de médio/longo (tendência de fundo)",
      },
    ];

    const rationale: string[] = [];
    if (signal.macd === "sell" || signal.adx === "sell")
      rationale.push("Momentum (MACD/ADX) vendedor no curto prazo");
    if (emaShortOp === "sell") rationale.push("EMAs curtas (9/21) apontam baixa");
    if (emaLongOp === "buy")
      rationale.push("Estrutura de médio/longo (EMA99/200) ainda compradora");
    if (signal.vwap === "buy" || signal.volume === "buy")
      rationale.push("Fluxo (VWAP/Volume) sustentou preço");
    if (rationale.length === 0) rationale.push("Sinais mistos/sem gatilho claro");

    const timeframeStr = intervalToTimeframe(INTERVAL!);
    const atrMultipleStop = ((atrVolatility: "low" | "medium" | "high", timeframe: string) => {
      let mult = atrVolatility === "low" ? 1.0 : atrVolatility === "medium" ? 1.3 : 1.8;
      if (timeframe === "short") mult *= 0.9;
      else if (timeframe === "long") mult *= 1.1;
      return Number(mult.toFixed(2));
    })(atrVolatility, timeframeStr);

    let suggestedStopPrice: number | null = null;
    if (stance === "buy")
      suggestedStopPrice = Number((price - (lastATR as number) * atrMultipleStop).toFixed(2));
    else if (stance === "sell")
      suggestedStopPrice = Number((price + (lastATR as number) * atrMultipleStop).toFixed(2));

    let positionSizingHint = "Risco baixo: usar 75%–100% do tamanho padrão";
    if (atrVolatility === "medium") {
      positionSizingHint =
        confidence >= 0.6
          ? "Risco moderado: usar 50%–100% do tamanho padrão"
          : "Risco moderado: usar 33%–50% do tamanho padrão";
    } else if (atrVolatility === "high") {
      positionSizingHint = "Risco alto: usar 25%–50% do tamanho padrão";
    } else if (atrVolatility === "low") {
      positionSizingHint =
        confidence >= 0.6
          ? "Risco baixo: usar 75%–100% do tamanho padrão"
          : "Risco baixo: usar 50%–75% do tamanho padrão";
    }

    const result = {
      ...detailed,
      votes,
      risk: {
        atrVolatility,
        bollingerWidthPct,
        conclusion: riskConclusion,
        atrMultipleStop,
        suggestedStopPrice,
        positionSizingHint,
      },
      signal,
      decision: {
        stance,
        confidence: Number(confidence.toFixed(2)),
        timeframe: timeframeStr,
        rationale,
        triggers: {
          buy: [
            "MACD > Signal + histograma > 0",
            "Preço acima de EMA9 e EMA21",
            "VWAP = buy com volume >= 150% da média",
          ],
          sell: [
            "Preço perder VWAP e fechar abaixo de EMA9/21",
            "ADX com -DI > +DI e ADX >= 25",
            "MACD < Signal + histograma < 0",
          ],
        },
        risk: { atrMultipleStop, positionSizingHint },
      },
      nodes,
      meta: { symbol: SYMBOL, interval: INTERVAL, market: MARKET, time: last(aligned.time) },
    };

    writeFileSync("output.json", JSON.stringify(aligned, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } catch (err: any) {
    console.error("Erro:", err.message);
    process.exit(1);
  }
})();
