// Node >= 18
import fs from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

// ---------- CONFIG ----------
const SYMBOL = "BTCUSDT";
const INTERVAL = "1m";
// Range: [START, END) (END é exclusivo)
const START_UTC = Date.UTC(2025, 7, 1, 0, 0, 0); // 01/08/2025 00:00:00 UTC  (mês 7 = Agosto)
const END_UTC = Date.UTC(2025, 7, 31, 0, 0, 0); // 31/08/2025 00:00:00 UTC (exclusivo)
const OUT_FILE = "BTCUSDT_1m_2025-08-01_2025-08-30.csv";

// Afinando limites / rate-limit
const BASE_URL = "https://api.binance.com/api/v3/klines";
const LIMIT = 1000; // máx. por request
const PAUSE_MS = 300; // pausa leve entre calls
const MAX_RETRIES = 5; // backoff p/ 429/5xx

// ---------- HELPERS ----------
const toCsvTime = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);

async function fetchKlines(params: Record<string, string | number>) {
  const url = new URL(BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  let attempt = 0;
  while (true) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20_000);
      const r = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (r.status === 429) throw new Error("429 rate limit");
      if (!r.ok) throw new Error(`HTTP ${r.status} ${await r.text()}`);
      return await r.json();
    } catch (err) {
      attempt++;
      if (attempt > MAX_RETRIES) throw err;
      const wait = Math.min(2000 * attempt, 8000);
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.warn(`retry ${attempt}/${MAX_RETRIES} in ${wait}ms ->`, errorMessage);
      await sleep(wait);
    }
  }
}

// ---------- MAIN ----------
async function run() {
  console.log(
    `Baixando ${SYMBOL} ${INTERVAL} de ${new Date(START_UTC).toISOString()} até ${new Date(END_UTC).toISOString()} (END exclusivo)`,
  );
  const out = fs.createWriteStream(OUT_FILE, { encoding: "utf8" });
  out.write("TIME,OPEN,HIGH,LOW,CLOSE\n");

  let start = START_UTC;
  let total = 0;

  while (start < END_UTC) {
    const data = await fetchKlines({
      symbol: SYMBOL,
      interval: INTERVAL,
      startTime: start,
      endTime: END_UTC,
      limit: LIMIT,
    });

    if (!Array.isArray(data) || data.length === 0) break;

    for (const k of data) {
      // kline: [openTime, open, high, low, close, volume, closeTime, ...]
      const openTime = k[0];
      if (openTime >= END_UTC) break;

      const line = [
        toCsvTime(openTime),
        k[1], // open
        k[2], // high
        k[3], // low
        k[4], // close
      ].join(",");

      out.write(line + "\n");
      total++;
      // Próximo start será (último closeTime + 1ms) após sair do loop
    }

    // Avança a janela: closeTime da última vela retornada + 1ms
    const lastCloseTime = data[data.length - 1][6];
    const nextStart = lastCloseTime + 1;

    if (nextStart <= start) {
      // Proteção contra loop travado (raro)
      console.warn("nextStart não avançou; encerrando.");
      break;
    }

    start = nextStart;
    await sleep(PAUSE_MS);
  }

  out.end();
  console.log(`OK -> ${OUT_FILE} | linhas: ${total}`);
}

run().catch((e) => {
  console.error("Falhou:", e);
  process.exit(1);
});
