import fs from "fs";
import { BollingerBands, EMA, MACD, RSI } from "technicalindicators";

// ---------------- CONFIG ----------------
// Configuração idêntica à do seu bot para garantir a precisão do backtest.
const config = {
    timeframe: "5m",
    emaFastPeriod: 6,
    emaSlowPeriod: 14,
    rsiPeriod: 14,
    rsiOverbought: 65,
    feeRate: 0.001, // Taxa de 0.1% por operação
    risk: { stopLossPct: 0.03, takeProfitPct: 0.04 },
};

// ---------------- JOISINEY FUNÇAO ----------------
function computeIndicators(closes) {
    const emaFast = EMA.calculate({ period: config.emaFastPeriod, values: closes });
    const emaSlow = EMA.calculate({ period: config.emaSlowPeriod, values: closes });
    const rsi = RSI.calculate({ period: config.rsiPeriod, values: closes });
    const macd = MACD.calculate({
        values: closes,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false,
    });
    const bb = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
    return { emaFast, emaSlow, rsi, macd, bb };
}

// ---------------- LÓGICA DO BACKTEST ----------------

function runBacktest() {
    // Carrega os dados do arquivo CSV
    const csvFilePath = "COAI_1m.csv";
    let ohlcv;
    try {
        const csvData = fs.readFileSync(csvFilePath, "utf8");
        const lines = csvData.trim().split("\n").slice(1); // Ignora o cabeçalho
        ohlcv = lines.map((line) => {
            const [open, high, low, close, volume, closeTime] = line.split(",");
            return {
                open: parseFloat(open),
                high: parseFloat(high),
                low: parseFloat(low),
                close: parseFloat(close),
                volume: parseFloat(volume),
                timestamp: parseInt(closeTime, 10),
            };
        });
    } catch (err) {
        console.error(`Erro ao ler ou processar o arquivo ${csvFilePath}:`, err.message);
        process.exit(1); // Encerra o script se o arquivo não for encontrado ou mal formatado
    }

    if (!ohlcv || ohlcv.length < 35) {
        console.error(
            "Seguindo Orientação. São necessários pelo menos 35 candles pq senão não conseguimos simular o backtest.",
        );
        return;
    }

    const closes = ohlcv.map((c) => c.close);
    const trades = [];
    let position = null; // null | { entryPrice: number, entryTime: string }

    // Itera por cada candle para simular a passagem do tempo
    for (let i = 35; i < closes.length; i++) {
        // Começa após ter dados suficientes para os indicadores
        const currentCloses = closes.slice(0, i + 1);
        const { emaFast, emaSlow, macd, rsi, bb } = computeIndicators(currentCloses);

        const lastClose = currentCloses.at(-1);

        // Pega os valores mais recentes dos indicadores
        const curEmaFast = emaFast.at(-1);
        const curEmaSlow = emaSlow.at(-1);
        const curMacd = macd.at(-1);
        const prevMacd = macd.at(-2);
        const curRsi = rsi.at(-1);
        const curBb = bb.at(-1);

        // Condições de Tendência e Gatilho
        const isUptrend = curEmaFast > curEmaSlow;
        const isDowntrend = curEmaFast < curEmaSlow;
        const macdCrossUp = prevMacd.MACD <= prevMacd.signal && curMacd.MACD > curMacd.signal;
        const macdCrossDown = prevMacd.MACD >= prevMacd.signal && curMacd.MACD < curMacd.signal;

        // --- LÓGICA DE SINAL ---

        // LÓGICA DE COMPRA 💡
        if (
            !position &&
            isUptrend &&
            macdCrossUp &&
            curRsi < config.rsiOverbought &&
            lastClose < curBb.upper
        ) {
            position = {
                entryPrice: lastClose,
                entryTime: new Date(ohlcv[i].timestamp).toISOString(),
            };
            // console.log(`COMPRA: ${position.entryPrice.toFixed(6)} em ${position.entryTime}`);
        }
        // LÓGICA DE VENDA 💰
        else if (position) {
            const stopPrice = position.entryPrice * (1 - config.risk.stopLossPct);
            const takePrice = position.entryPrice * (1 + config.risk.takeProfitPct);
            let exitReason = null;

            if (lastClose <= stopPrice) {
                exitReason = "Stop Loss";
            } else if (lastClose >= takePrice) {
                exitReason = "Take Profit";
            } else if (isDowntrend && macdCrossDown) {
                exitReason = "Reversão de Tendência";
            }

            if (exitReason) {
                const exitPrice = lastClose;
                const pnl = (exitPrice / position.entryPrice - 1) * 100 - config.feeRate * 200; // PnL % com taxas
                trades.push({
                    entry: position.entryPrice,
                    exit: exitPrice,
                    pnl: pnl,
                    result: pnl > 0 ? "WIN" : "LOSS",
                    reason: exitReason,
                    entryTime: position.entryTime,
                    exitTime: new Date(ohlcv[i].timestamp).toISOString(),
                });
                console.log(
                    `VENDA: ${exitPrice.toFixed(6)} | PnL: ${pnl.toFixed(2)}% | Razão: ${exitReason}`,
                );
                position = null; // Fecha a posição
            }
        }
    }

    // --- ANÁLISE DOS RESULTADOS ---
    console.log("--- Backtest Concluído ---");

    if (trades.length === 0) {
        console.log("Nenhuma operação foi executada durante o período.");
        return;
    }

    const wins = trades.filter((t) => t.result === "WIN").length;
    const losses = trades.filter((t) => t.result === "LOSS").length;
    const totalTrades = trades.length;
    const hitRate = (wins / totalTrades) * 100;
    const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
    const avgPnl = totalPnl / totalTrades;

    console.log("\n📊 ESTATÍSTICAS GERAIS:");
    console.log(`Total de Operações: ${totalTrades}`);
    console.log(`Vitórias: ${wins}`);
    console.log(`Derrotas: ${losses}`);
    console.log(`✅ Taxa de Acerto (Hit Rate): ${hitRate.toFixed(2)}%`);
    console.log(`Resultado Total (PnL %): ${totalPnl.toFixed(2)}%`);
    console.log(`Média por Operação (PnL %): ${avgPnl.toFixed(2)}%`);

    console.log("\n📋 DETALHES DAS OPERAÇÕES:");
    trades.forEach((trade, index) => {
        console.log(
            `#${index + 1} | ${trade.result.padEnd(4)} | PnL: ${trade.pnl.toFixed(2).padStart(6, " ")}% | Saída por: ${trade.reason}`,
        );
    });
}

// Inicia o backtest
runBacktest();
