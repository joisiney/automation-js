import fs from "fs";
import { EnsembleAdaptive } from "./utils/ensemble-multi-tf";

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

const buyOrSel = (candles1m) => {
  const ens = new EnsembleAdaptive();

  // (opcional) ajuste baseline
  ens.setBaselineWeights({ ema: 0.2, macd: 0.16 });

  // 2) decida com múltiplos TFs (ex.: 5m exec, 15m/1h confirmação, 1D regime)
  const out = ens.decision({
    timeframes: [
      { label: "1m", candles: candles1m },
      { label: "15m", candles: candles1m },
      // { label: "1h", candles: candles1h },
      // { label: "1D", candles: candles1D },
    ],
    confirmOnClose: true,
    buyThreshold: +0.15,
    sellThreshold: -0.15,
    basePositionPct: 0.25,
    maxPositionPct: 0.5,
  });

  return {
    direction: out.direction, // buy, sell, none
    positionPctOfDailyLimit: out.sizing?.positionPctOfDailyLimit, // 0.05 to 0.5
    stopLossPrice: out.sizing?.stopLossPrice, // stop loss price
  };
};

// ---------------- LÓGICA DO BACKTEST ----------------

function runBacktest() {
  // Carrega os dados do arquivo CSV
  const csvFilePath = `${process.env.SYMBOL}_${process.env.INTERVAL}.csv`;
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
    const result = buyOrSel(currentCloses);
    const currentCalnde = closes[i];

    // LÓGICA DE COMPRA 💡
    if (result.direction === "buy") {
      position = {
        entryPrice: currentCalnde,
        entryTime: new Date(ohlcv[i].timestamp).toISOString(),
      };
      // console.log(`COMPRA: ${position.entryPrice.toFixed(6)} em ${position.entryTime}`);
    }
    // LÓGICA DE VENDA 💰
    else if (position && result.direction === "sell") {
      const exitPrice = currentCalnde;
      const pnl = (exitPrice / position.entryPrice - 1) * 100 - config.feeRate * 200; // PnL % com taxas
      trades.push({
        entry: position.entryPrice,
        exit: exitPrice,
        pnl: pnl,
        result: pnl > 0 ? "WIN" : "LOSS",
        reason: result.direction,
        entryTime: position.entryTime,
        exitTime: new Date(ohlcv[i].timestamp).toISOString(),
      });
      console.log(`VENDA: ${exitPrice.toFixed(6)} | PnL: ${pnl.toFixed(2)}%`);
      position = null; // Fecha a posição
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
