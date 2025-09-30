export type TDirection = "buy" | "sell" | "none"; // decisão do indicador
export type TEntryState = "triggered" | "no-trigger";

export interface IIndicatorDecisionMin<TData = undefined> {
  id: string; // ex.: "ema21", "rsi14"
  direction: TDirection; // buy/sell/none
  entry: TEntryState; // triggered/no-trigger

  // voto normalizado do indicador
  score: {
    directional: number; // [-1..+1]  (+1=compra forte, -1=venda forte)
    confidence: number; // [0..1]    (certeza/robustez do próprio sinal)
    quality?: number; // [0..1]    (opcional, “limpeza” do setup)
  };

  health: { isValid: boolean }; // dados ok?
  data?: TData; // dados do indicador (opcional)
}
export type Candles = {
  highs: number[];
  lows: number[];
  closes?: number[];
  opens?: number[];
  volumes?: number[];
};
