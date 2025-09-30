import { getCandles } from "./get-candles.js";
import { ema } from "./indicators/ema.js";
import { getEnv } from "./env.js";




const boot = async () => {
    const envs = getEnv();
    const candles = await getCandles(envs.SYMBOL, envs.INTERVAL, envs.LIMIT, envs.STRATEGY_KLINE, envs.MARKET);
    const ema9 = ema(9, candles);
    console.log(ema9);
    console.log(envs)
    console.log("Booting up...");
}
boot();