import type { TradeData } from '../types'

const pnlDebug = () => process.env.PNL_DEBUG_LOG === '1'

const FEE_PER_TRANSACTION_USD = 1

export const computePnl = async (
  walletId: string,
  trade: TradeData
): Promise<{ pnlUsd: number; pnlPercent: number; buyCount: number }> => {
  if (trade.tradeType !== 'sell') return { pnlUsd: 0, pnlPercent: 0, buyCount: 0 }

  const { default: prisma } = await import('../db/client')

  const buys = await prisma.trade.findMany({
    where: {
      walletId,
      tokenAddress: trade.tokenAddress,
      tradeType: 'buy',
    },
    orderBy: { timestamp: 'asc' },
  })

  if (pnlDebug()) {
    console.log(`[PnL] Sell $${trade.tokenSymbol} (${trade.tokenAddress.slice(0, 8)}...): sellAmount=$${trade.amountUsd.toFixed(2)}, found ${buys.length} buys`)
  }

  if (buys.length === 0) {
    if (pnlDebug()) {
      console.log(`[PnL] No buys found for token ${trade.tokenAddress.slice(0, 8)}...`)
    }
    return { pnlUsd: 0, pnlPercent: 0, buyCount: 0 }
  }

  const totalCostUsd = buys.reduce((sum: number, b: { amountUsd: number }) => sum + b.amountUsd, 0)

  if (pnlDebug()) {
    buys.forEach((b: { amountUsd: number; txHash: string }, i: number) => {
      console.log(`[PnL]   Buy #${i + 1}: $${b.amountUsd.toFixed(2)} (${b.txHash.slice(0, 12)}...)`)
    })
  }

  const totalFees = (buys.length + 1) * FEE_PER_TRANSACTION_USD
  const pnlUsd = trade.amountUsd - totalCostUsd - totalFees
  const pnlPercent = totalCostUsd > 0 ? (pnlUsd / totalCostUsd) * 100 : 0

  if (pnlDebug()) {
    console.log(`[PnL]   Total cost=$${totalCostUsd.toFixed(2)}, fees=$${totalFees.toFixed(2)} → PnL=$${pnlUsd.toFixed(2)} (${pnlPercent.toFixed(1)}%)`)
  }

  return { pnlUsd, pnlPercent, buyCount: buys.length }
}
