import fs from "fs/promises";

export async function saveCandlesToCSV(
  opens: number[],
  closes: number[],
  highs: number[],
  lows: number[],
  volumes: number[],
  times: number[],
  options: { symbol: string; interval: string; filename?: string },
) {
  const { symbol, interval, filename } = options;

  const header = "open,high,low,close,volume,closeTime\n";
  const rows =
    opens
      .map((open, i) => `${open},${highs[i]},${lows[i]},${closes[i]},${volumes[i]},${times[i]}`)
      .join("\n") + "\n";

  const content = header + rows;
  const fileName = filename || `${symbol.toUpperCase().replace(/\s+/g, "")}_${interval}.csv`;

  await fs.writeFile(fileName, content);
  console.log(`Candles saved to ${fileName}`);
}
