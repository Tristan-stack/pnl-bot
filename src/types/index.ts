export interface TradeData {
  txHash: string
  tradeType: 'buy' | 'sell'
  tokenSymbol: string
  tokenAddress: string
  amountUsd: number
  pnlUsd: number | null
  pnlPercent: number | null
  timestamp: Date
}

/** Single-trade card (legacy / future use). */
export interface CardDataSingle {
  variant: 'single'
  walletName: string
  tokenSymbol: string
  tradeType: 'buy' | 'sell'
  amountUsd: number
  pnlUsd: number
  pnlPercent: number
  timestamp: Date
}

/** Aggregated realized PnL for the current calendar day (PNL_DAYTIMEZONE). */
export interface CardDataDaily {
  variant: 'daily'
  walletName: string
  /** Human-readable day in the configured timezone */
  dayLabel: string
  totalPnlUsd: number
  /** Realized return vs total cost basis for the day’s sells */
  blendedPnlPercent: number
  volumeUsd: number
  sellCount: number
  winRatePercent: number
  uniqueTokenCount: number
  timestamp: Date
}

export type CardData = CardDataSingle | CardDataDaily

export const SOL_MINT = 'So11111111111111111111111111111111111111112'
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
export const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
