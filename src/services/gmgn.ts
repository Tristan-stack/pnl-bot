import axios from 'axios'
import { randomUUID } from 'crypto'
import dns from 'dns'
import { z } from 'zod'
import { SOL_MINT, type TradeData } from '../types'

dns.setDefaultResultOrder('ipv4first')

const BASE_URL = process.env.GMGN_HOST ?? 'https://openapi.gmgn.ai'
const DEFAULT_CHAIN = 'sol'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const getMinRequestGapMs = (): number => {
  const raw = process.env.GMGN_MIN_REQUEST_INTERVAL_MS
  if (raw) {
    const n = parseInt(raw, 10)
    if (Number.isFinite(n) && n >= 500) return n
  }
  return 1000
}

const getMax429RetriesPerPage = (): number => {
  const raw = process.env.GMGN_MAX_429_RETRIES_PER_PAGE
  if (raw) {
    const n = parseInt(raw, 10)
    if (Number.isFinite(n) && n >= 1 && n <= 20) return n
  }
  return 8
}

let gmgnRequestChain: Promise<unknown> = Promise.resolve()
let lastGmgnRequestStart = 0
let globalPauseUntil = 0

const runGmgnHttp = async <T>(fn: () => Promise<T>): Promise<T> => {
  const job = gmgnRequestChain.then(async () => {
    const now0 = Date.now()
    if (now0 < globalPauseUntil) {
      await sleep(globalPauseUntil - now0)
    }
    const gap = getMinRequestGapMs()
    const now = Date.now()
    const wait = Math.max(0, lastGmgnRequestStart + gap - now)
    if (wait > 0) await sleep(wait)
    lastGmgnRequestStart = Date.now()
    return fn()
  })
  gmgnRequestChain = job.then(
    () => undefined,
    () => undefined
  )
  return job as Promise<T>
}

const queueGmgnBackoff = (ms: number): Promise<void> => {
  const job = gmgnRequestChain.then(() => sleep(ms))
  gmgnRequestChain = job.then(
    () => undefined,
    () => undefined
  )
  return job
}

const readRetryAfterMs = (headers: unknown): number => {
  if (!headers || typeof headers !== 'object') return NaN
  const h = headers as {
    get?: (key: string) => string | undefined
    'retry-after'?: string
  }
  const v = h.get?.('retry-after') ?? h['retry-after']
  if (!v) return NaN
  const sec = parseInt(String(v), 10)
  return Number.isFinite(sec) ? Math.max(sec * 1000, 1000) : NaN
}

const backoffMsFor429 = (attemptIndex: number, headerMs: number): number => {
  const fromHeader = Number.isFinite(headerMs) ? headerMs : 0
  const exponential = 2000 * 2 ** attemptIndex
  const capped = Math.min(exponential, 60_000)
  return Math.max(fromHeader, capped, 3000)
}

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

const GmgnTokenInfoResponseSchema = z.object({
  code: z.union([z.number(), z.string()]),
  data: z
    .object({
      price: z.union([z.number(), z.string()]).optional(),
    })
    .passthrough()
    .optional(),
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
  const buyCostUsd = parseFloat0(activity.buy_cost_usd)

  let pnlUsd: number | null = null
  let pnlPercent: number | null = null

  if (activity.event_type === 'sell' && buyCostUsd > 0) {
    pnlUsd = costUsd - buyCostUsd
    pnlPercent = (pnlUsd / buyCostUsd) * 100
  }

  return {
    txHash: activity.tx_hash,
    tradeType: activity.event_type as 'buy' | 'sell',
    tokenSymbol,
    tokenAddress,
    amountUsd: costUsd,
    pnlUsd,
    pnlPercent,
    timestamp: new Date(activity.timestamp * 1000),
  }
}

const parseTokenInfoUsdPrice = (data: unknown): number | null => {
  const parsed = GmgnTokenInfoResponseSchema.safeParse(data)
  if (!parsed.success) return null
  const code = typeof parsed.data.code === 'string' ? parseInt(parsed.data.code, 10) : parsed.data.code
  if (code !== 0) return null
  const raw = parsed.data.data?.price
  if (raw === undefined || raw === null) return null
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Spot price in USD for a mint (same OpenAPI as wallet_activity). */
export const getTokenUsdPriceGmgn = async (
  tokenAddress: string,
  chain: string = DEFAULT_CHAIN
): Promise<number | null> => {
  let apiKey: string
  try {
    apiKey = getApiKey()
  } catch {
    return null
  }

  const { timestamp, client_id } = buildAuthQuery()
  const max429PerPage = getMax429RetriesPerPage()

  for (let attempt = 0; attempt < max429PerPage; attempt++) {
    try {
      const response = await runGmgnHttp(() =>
        axios.get(`${BASE_URL}/v1/token/info`, {
          params: {
            chain,
            address: tokenAddress,
            timestamp,
            client_id,
          },
          headers: {
            'X-APIKEY': apiKey,
            'Content-Type': 'application/json',
          },
          timeout: 15_000,
          validateStatus: () => true,
        })
      )

      if (response.status === 429) {
        const headerWait = readRetryAfterMs(response.headers)
        const waitMs = backoffMsFor429(attempt, headerWait)
        globalPauseUntil = Math.max(globalPauseUntil, Date.now() + waitMs)
        console.warn(
          `[GMGN] token/info 429 ${tokenAddress.slice(0, 8)}... (try ${attempt + 1}/${max429PerPage}), backoff ${waitMs}ms`
        )
        await queueGmgnBackoff(waitMs)
        continue
      }

      if (response.status !== 200) {
        const body =
          typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
        console.warn(
          `[GMGN] token/info HTTP ${response.status} for ${tokenAddress.slice(0, 8)}...: ${body.slice(0, 200)}`
        )
        return null
      }

      const price = parseTokenInfoUsdPrice(response.data)
      if (price !== null) return price
      console.warn('[GMGN] token/info: missing or invalid price in response')
      return null
    } catch (err) {
      const axiosErr = err as { message?: string }
      console.warn('[GMGN] token/info failed:', axiosErr.message)
      return null
    }
  }

  return null
}

/** Native SOL / USD from GMGN token info (wrapped SOL mint). */
export const getSolUsdPriceGmgn = (): Promise<number | null> => getTokenUsdPriceGmgn(SOL_MINT)

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
  const maxPages = 10
  const max429PerPage = getMax429RetriesPerPage()

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

    console.log(`[GMGN] Fetching ${walletAddress.slice(0, 8)}... page ${pages + 1}`)

    let data: unknown = null
    let pageOk = false

    for (let attempt = 0; attempt < max429PerPage; attempt++) {
      try {
        const response = await runGmgnHttp(() =>
          axios.get(`${BASE_URL}/v1/user/wallet_activity`, {
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
            validateStatus: () => true,
          })
        )

        if (response.status === 429) {
          const headerWait = readRetryAfterMs(response.headers)
          const waitMs = backoffMsFor429(attempt, headerWait)
          globalPauseUntil = Math.max(globalPauseUntil, Date.now() + waitMs)
          console.warn(
            `[GMGN] 429 ${walletAddress.slice(0, 8)}... page ${pages + 1} (try ${attempt + 1}/${max429PerPage}), backoff ${waitMs}ms`
          )
          await queueGmgnBackoff(waitMs)
          continue
        }

        if (response.status === 403) {
          const body = typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
          console.error(`[GMGN] 403 for ${walletAddress}: ${body.slice(0, 200)}`)
          return allTrades
        }

        if (response.status !== 200) {
          console.error(
            `[GMGN] HTTP ${response.status} for ${walletAddress}: ${JSON.stringify(response.data).slice(0, 200)}`
          )
          return allTrades
        }

        data = response.data
        pageOk = true
        break
      } catch (err) {
        const axiosErr = err as { response?: { status?: number }; message?: string }
        const st = axiosErr.response?.status
        console.error(`[GMGN] Request failed for ${walletAddress}: status=${st} message=${axiosErr.message}`)
        return allTrades
      }
    }

    if (!pageOk) {
      console.error(
        `[GMGN] Giving up on ${walletAddress.slice(0, 8)}... page ${pages + 1} after ${max429PerPage} 429 retries (keeping ${allTrades.length} trades)`
      )
      break
    }

    if (process.env.PNL_DEBUG_LOG === '1' || process.env.GMGN_DEBUG_LOG === '1') {
      console.log(`[GMGN] Raw response for ${walletAddress.slice(0, 8)}...:`, JSON.stringify(data).slice(0, 500))
    }

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
}
