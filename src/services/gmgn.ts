import axios from 'axios'
import { randomUUID } from 'crypto'
import dns from 'dns'
import { z } from 'zod'
import type { TradeData } from '../types'

dns.setDefaultResultOrder('ipv4first')

const BASE_URL = process.env.GMGN_HOST ?? 'https://openapi.gmgn.ai'
const DEFAULT_CHAIN = 'sol'

const getApiKey = (): string => {
  const key = process.env.GMGN_API_KEY
  if (!key) throw new Error('GMGN_API_KEY is required')
  return key
}

const buildAuthQuery = (): { timestamp: number; client_id: string } => ({
  timestamp: Math.floor(Date.now() / 1000),
  client_id: randomUUID(),
})

const GmgnTokenSchema = z.object({
  address: z.string().nullable().optional(),
  token_address: z.string().nullable().optional(),
  symbol: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  logo: z.string().nullable().optional(),
  total_supply: z.string().nullable().optional(),
})

const GmgnActivitySchema = z.object({
  tx_hash: z.string(),
  timestamp: z.number(),
  event_type: z.enum(['buy', 'sell', 'transfer']),
  token_amount: z.string().nullable().optional(),
  quote_amount: z.string().nullable().optional(),
  cost_usd: z.string().nullable().optional(),
  buy_cost_usd: z.string().nullable().optional(),
  price_usd: z.string().nullable().optional(),
  price: z.string().nullable().optional(),
  is_open_or_close: z.number().nullable().optional(),
  quote_address: z.string().nullable().optional(),
  from_address: z.string().nullable().optional(),
  to_address: z.string().nullable().optional(),
  gas_native: z.string().nullable().optional(),
  gas_usd: z.string().nullable().optional(),
  dex_native: z.string().nullable().optional(),
  dex_usd: z.string().nullable().optional(),
  priority_fee: z.string().nullable().optional(),
  tip_fee: z.string().nullable().optional(),
  launchpad: z.string().nullable().optional(),
  token: GmgnTokenSchema.nullable().optional(),
  quote_token: z.object({
    token_address: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    symbol: z.string().nullable().optional(),
    decimals: z.number().nullable().optional(),
    logo: z.string().nullable().optional(),
  }).nullable().optional(),
})

const GmgnActivityResponseSchema = z.object({
  code: z.union([z.number(), z.string()]),
  data: z.object({
    activities: z.array(GmgnActivitySchema).default([]),
    next: z.string().nullable().optional(),
  }).optional(),
  message: z.string().optional(),
  error: z.string().optional(),
})

export type GmgnActivity = z.infer<typeof GmgnActivitySchema>

const parseFloat0 = (val: string | undefined | null): number => {
  if (!val) return 0
  const n = parseFloat(val)
  return Number.isFinite(n) ? n : 0
}

const mapActivityToTrade = (activity: GmgnActivity): TradeData | null => {
  if (activity.event_type === 'transfer') return null

  const tokenAddress = activity.token?.address ?? activity.token?.token_address ?? ''
  if (!tokenAddress) return null

  const tokenSymbol = activity.token?.symbol ?? tokenAddress.slice(0, 6)
  const costUsd = parseFloat0(activity.cost_usd)

  return {
    txHash: activity.tx_hash,
    tradeType: activity.event_type as 'buy' | 'sell',
    tokenSymbol,
    tokenAddress,
    amountUsd: costUsd,
    pnlUsd: null,
    pnlPercent: null,
    timestamp: new Date(activity.timestamp * 1000),
  }
}

export const getWalletActivity = async (
  walletAddress: string,
  options: { chain?: string; limit?: number; types?: string[] } = {}
): Promise<TradeData[]> => {
  const apiKey = getApiKey()
  const chain = options.chain ?? DEFAULT_CHAIN
  const limit = options.limit ?? 50
  const types = options.types ?? ['buy', 'sell']

  const allTrades: TradeData[] = []
  let cursor: string | null = null
  let pages = 0
  const maxPages = 5

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  try {
    while (pages < maxPages) {
      const { timestamp, client_id } = buildAuthQuery()

      const params: Record<string, string | number> = {
        chain,
        wallet_address: walletAddress,
        limit,
        timestamp,
        client_id,
      }

      if (cursor) {
        params.cursor = cursor
      }

      if (pages > 0) {
        await sleep(500)
      }

      console.log(`[GMGN] Fetching ${walletAddress.slice(0, 8)}... page ${pages + 1}`)

      const { data } = await axios.get(`${BASE_URL}/v1/user/wallet_activity`, {
        params,
        paramsSerializer: (p) => {
          const qs = new URLSearchParams()
          for (const [k, v] of Object.entries(p)) {
            if (Array.isArray(v)) {
              v.forEach((item) => qs.append(k, String(item)))
            } else {
              qs.set(k, String(v))
            }
          }
          for (const t of types) {
            qs.append('type', t)
          }
          return qs.toString()
        },
        headers: {
          'X-APIKEY': apiKey,
          'Content-Type': 'application/json',
        },
        timeout: 15_000,
      })

      console.log(`[GMGN] Raw response for ${walletAddress.slice(0, 8)}...:`, JSON.stringify(data).slice(0, 500))

      const parsed = GmgnActivityResponseSchema.safeParse(data)

      if (!parsed.success) {
        console.error(`[GMGN] Validation failed for ${walletAddress}:`, parsed.error.message)
        break
      }

      const code = typeof parsed.data.code === 'string' ? parseInt(parsed.data.code, 10) : parsed.data.code
      if (code !== 0) {
        console.error(`[GMGN] API error for ${walletAddress}: code=${parsed.data.code} error=${parsed.data.error} message=${parsed.data.message}`)
        break
      }

      const activities = parsed.data.data?.activities ?? []
      console.log(`[GMGN] Got ${activities.length} activities for ${walletAddress.slice(0, 8)}...`)
      for (const activity of activities) {
        const trade = mapActivityToTrade(activity)
        if (trade) {
          allTrades.push(trade)
        }
      }

      pages++
      cursor = parsed.data.data?.next ?? null
      if (!cursor) break
    }

    const buyN = allTrades.filter((t) => t.tradeType === 'buy').length
    const sellN = allTrades.filter((t) => t.tradeType === 'sell').length
    console.log(`[GMGN] ${walletAddress.slice(0, 8)}... → ${allTrades.length} trades (${pages} page(s)): ${buyN} buys, ${sellN} sells`)

    return allTrades
  } catch (err) {
    const axiosErr = err as { response?: { status?: number; data?: unknown }; message?: string }
    const status = axiosErr.response?.status
    
    if (status === 429) {
      console.warn(`[GMGN] Rate limited for ${walletAddress.slice(0, 8)}..., waiting 5s...`)
      await sleep(5000)
      return getWalletActivity(walletAddress, options)
    }
    
    console.error(`[GMGN] Request failed for ${walletAddress}: status=${status} message=${axiosErr.message}`)
    return []
  }
}
