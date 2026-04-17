import axios from 'axios'
import { getSolUsdPriceGmgn } from '../services/gmgn'

let cached: { priceUsd: number; fetchedAtMs: number } | null = null

const CACHE_MS = 60_000
const FALLBACK_SOL_USD = 140

export const formatSolFromUsd = (usd: number, solUsd: number): string => {
  if (!Number.isFinite(solUsd) || solUsd <= 0) return '— SOL'
  const sol = usd / solUsd
  const abs = Math.abs(sol)
  const prefix = sol >= 0 ? '+' : '-'
  const decimals = abs >= 100 ? 2 : abs >= 10 ? 3 : 4
  return `${prefix}${abs.toFixed(decimals)} SOL`
}

export const getSolUsdPrice = async (): Promise<number> => {
  const raw = process.env.SOL_PRICE_USD
  if (raw) {
    const n = parseFloat(raw)
    if (Number.isFinite(n) && n > 0) return n
  }

  const now = Date.now()
  if (cached && now - cached.fetchedAtMs < CACHE_MS) return cached.priceUsd

  const gmgnPrice = await getSolUsdPriceGmgn()
  if (gmgnPrice !== null) {
    cached = { priceUsd: gmgnPrice, fetchedAtMs: now }
    return gmgnPrice
  }

  try {
    const res = await axios.get<{ solana?: { usd?: number } }>(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
      { timeout: 4000, validateStatus: () => true }
    )
    if (res.status === 200) {
      const price = Number(res.data?.solana?.usd)
      if (Number.isFinite(price) && price > 0) {
        cached = { priceUsd: price, fetchedAtMs: now }
        return price
      }
    }
  } catch {
    /* ignore */
  }

  return cached?.priceUsd ?? FALLBACK_SOL_USD
}
