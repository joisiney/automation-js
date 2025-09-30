import { getEnv } from "./env";
import { getCandles } from "./get-candles";
import { ADXIndicator } from "./indicators/adx";
import { BollingerBandsIndicator } from "./indicators/bollinger-bands";
import { EMAIndicator } from "./indicators/ema";
import { IchimokuIndicator } from "./indicators/Ichimoku";
import { MACDIndicator } from "./indicators/macd";
import { RSIIndicator } from "./indicators/rsi";
import { VolumeIndicator } from "./indicators/volume";
import { VWAPIndicator } from "./indicators/vwap";
import { WilliamsAlligatorIndicator } from "./indicators/williams";
import { ensembleDecision } from "./utils/ensemble-decision";

const boot = async () => {
  const envs = getEnv();
  const candles = await getCandles(
    envs.SYMBOL,
    envs.INTERVAL,
    envs.LIMIT,
    envs.STRATEGY_KLINE as any,
    envs.MARKET as any,
  );
  const ema = EMAIndicator.decision({
    period: 21,
    longPeriod: 200,
    candles, // { closes, highs, lows }
    maxExtensionPct: 0.015, // não entrar se preço estiver >1.5% da EMA
    slopeMinPct: 0.0002, // exige inclinação mínima
    recentBars: 3, // cruzamento nos últimos 3 candles
    atrPeriod: 14,
    atrStopMultiple: 1.5,
  });

  const rsi = RSIIndicator.decision({
    period: 14,
    candles,
  });

  const macd = MACDIndicator.decision({
    candles,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
  });

  const bollinger = BollingerBandsIndicator.decision({ candles, period: 20, stdDev: 2 });

  const adx = ADXIndicator.decision({ candles, period: 14 });

  const williams = WilliamsAlligatorIndicator.decision({ candles });

  const ichimoku = IchimokuIndicator.decision({ candles });

  const vwap = VWAPIndicator.decision({ candles });

  const volume = VolumeIndicator.decision({ candles });

  // o segundo parâmetro é o peso de cada indicador. A soma dos pesos deve ser 1.
  const ensemble = ensembleDecision(
    [ema, rsi, macd, bollinger, adx, williams, volume, ichimoku, vwap],
    {
      ema: 0.1,
      rsi14: 0.1,
      macd: 0.1,
      bollinger: 0.1,
      adx: 0.1,
      williams: 0.1,
      volume: 0.2,
      ichimoku: 0.1,
      vwap: 0.1,
    },
  );

  console.log(ensemble);
  console.log("Booting up...");
};

(async () => {
  try {
    await boot();
  } catch (err) {
    console.error("Fatal:", err instanceof Error ? err.stack : err);
    process.exit(1);
  }
})();
