import axios from "axios";

const BRAPI_BASE = "https://brapi.dev/api";

const INTERVAL_MAP: Record<string, string> = {
  "1m": "1m",
  "2m": "2m",
  "3m": "5m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
  "2h": "60m",
  "4h": "60m",
  "1d": "1d",
  "3d": "1d",
  "1w": "1wk",
  "1M": "1mo",
};

function pickRange(interval: string, limit: number): string {
  const i = interval.toLowerCase();
  if (i.endsWith("m") || i.endsWith("h")) {
    if (limit <= 7000) return "5d";
    return "1mo";
  }
  if (i === "1d") {
    if (limit <= 5) return "5d";
    if (limit <= 22) return "1mo";
    if (limit <= 66) return "3mo";
    if (limit <= 132) return "6mo";
    if (limit <= 264) return "1y";
    if (limit <= 528) return "2y";
    if (limit <= 1320) return "5y";
    return "max";
  }
  if (i === "1w" || i === "1wk") {
    if (limit <= 52) return "1y";
    if (limit <= 104) return "2y";
    if (limit <= 260) return "5y";
    return "max";
  }
  if (i === "1m" || i === "1mo") {
    if (limit <= 12) return "1y";
    if (limit <= 24) return "2y";
    if (limit <= 60) return "5y";
    return "max";
  }
  return "max";
}

function intervalMs(binanceInterval: string): number {
  const m = binanceInterval.toLowerCase();
  const num = parseInt(m, 10);
  if (m.endsWith("m")) return num * 60_000;
  if (m.endsWith("h")) return num * 60 * 60_000;
  if (m === "1d") return 24 * 60 * 60_000;
  if (m === "3d") return 3 * 24 * 60 * 60_000;
  if (m === "1w") return 7 * 24 * 60 * 60_000;
  if (m === "1m" || m === "1mo") return 30 * 24 * 60 * 60_000;
  return 24 * 60 * 60_000;
}

type Row = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
};

export async function getKlines(
  symbol: string,
  interval: string,
  limit = 500,
  token?: string,
): Promise<Row[]> {
  const mapped = INTERVAL_MAP[interval];
  if (!mapped) {
    throw new Error(`Intervalo não suportado: ${interval}`);
  }
  const range = pickRange(interval, limit);

  const url = `${BRAPI_BASE}/quote/${encodeURIComponent(symbol)}?range=${range}&interval=${mapped}`;

  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const { data } = await axios.get<any>(url, { headers });

  const res = (data?.results && data.results[0]) || {};
  const hist: any[] = Array.isArray(res.historicalDataPrice) ? res.historicalDataPrice : [];

  const dur = intervalMs(interval);

  const rows: Row[] = hist.slice(-limit).map((k) => {
    const openTime = (k.date ?? 0) * 1000;
    return {
      openTime,
      open: Number(k.open),
      high: Number(k.high),
      low: Number(k.low),
      close: Number(k.close),
      volume: Number(k.volume ?? 0),
      closeTime: openTime + dur,
    } as Row;
  });

  return rows;
}
