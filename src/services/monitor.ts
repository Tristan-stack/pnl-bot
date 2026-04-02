import cron from 'node-cron'
import { Client, AttachmentBuilder, TextChannel } from 'discord.js'
import prisma from '../db/client'
import { getWalletActivity } from './gmgn'
import { generatePnlCard } from './card'
import { truncateAddress } from '../utils/format'
import type { CardData } from '../types'

const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000

const processWallet = async (
  client: Client,
  wallet: { id: string; address: string; name: string | null; guildId: string }
) => {
  const walletLabel = wallet.name ?? truncateAddress(wallet.address)
  const activities = await getWalletActivity(wallet.address)

  if (activities.length > 0) {
    const existingTrades = await prisma.trade.findMany({
      where: { walletId: wallet.id },
      select: { txHash: true },
    })
    const existingHashes = new Set(existingTrades.map((t: { txHash: string }) => t.txHash))
    const isFirstRun = existingTrades.length === 0

    const newTrades = activities.filter((a) => !existingHashes.has(a.txHash))

    if (newTrades.length > 0) {
      newTrades.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())

      if (isFirstRun) {
        console.log(`[Monitor] First run for ${walletLabel}: saving ${newTrades.length} trades silently`)
      }

      for (const trade of newTrades) {
        await prisma.trade.create({
          data: {
            walletId: wallet.id,
            txHash: trade.txHash,
            tradeType: trade.tradeType,
            tokenSymbol: trade.tokenSymbol,
            tokenAddress: trade.tokenAddress,
            amountUsd: trade.amountUsd,
            pnlUsd: trade.pnlUsd,
            pnlPercent: trade.pnlPercent,
            timestamp: trade.timestamp,
          },
        })
      }

      const sells = newTrades.filter((t) => t.tradeType === 'sell')

      for (const sell of sells) {
        if (process.env.PNL_DEBUG_LOG === '1') {
          console.log(`[Monitor] ${walletLabel} SELL $${sell.tokenSymbol}: amount=$${sell.amountUsd.toFixed(2)} pnl=$${(sell.pnlUsd ?? 0).toFixed(2)} (${(sell.pnlPercent ?? 0).toFixed(1)}%)`)
        }

        if (!isFirstRun && sell.pnlUsd !== null) {
          await sendPnlCard(client, wallet, {
            ...sell,
            pnlUsd: sell.pnlUsd,
            pnlPercent: sell.pnlPercent ?? 0,
          })
        }
      }
    }
  }
}

const sendPnlCard = async (
  client: Client,
  wallet: { address: string; name: string | null; guildId: string },
  trade: { tokenSymbol: string; tradeType: 'buy' | 'sell'; amountUsd: number; pnlUsd: number; pnlPercent: number; timestamp: Date }
) => {
  const config = await prisma.guildConfig.findUnique({
    where: { guildId: wallet.guildId },
  })

  if (!config?.channelId) return

  const channel = await client.channels.fetch(config.channelId).catch(() => null)
  if (!channel || !(channel instanceof TextChannel)) return

  const cardData: CardData = {
    variant: 'single',
    walletName: wallet.name ?? truncateAddress(wallet.address),
    tokenSymbol: trade.tokenSymbol,
    tradeType: trade.tradeType,
    amountUsd: trade.amountUsd,
    pnlUsd: trade.pnlUsd,
    pnlPercent: trade.pnlPercent,
    timestamp: trade.timestamp,
  }

  const imageBuffer = await generatePnlCard(cardData, config.backgroundPath)
  const attachment = new AttachmentBuilder(imageBuffer, { name: 'pnl-card.png' })

  await channel.send({ files: [attachment] })
}

const runCleanup = async () => {
  const cutoff = new Date(Date.now() - FIFTEEN_DAYS_MS)
  const result = await prisma.trade.deleteMany({
    where: { createdAt: { lt: cutoff } },
  })
  if (result.count > 0) {
    console.log(`[Cleanup] Deleted ${result.count} trades older than 15 days`)
  }
}

export const pollAllWallets = async (client: Client) => {
  const wallets = await prisma.wallet.findMany()
  for (const wallet of wallets) {
    await processWallet(client, wallet)
  }
}

export const startMonitoring = (client: Client) => {
  const intervalSeconds = parseInt(process.env.POLL_INTERVAL_SECONDS ?? '30', 10)

  void pollAllWallets(client).catch((err) => {
    console.error('[Monitor] Initial poll error:', err)
  })

  cron.schedule(`*/${intervalSeconds} * * * * *`, async () => {
    try {
      await pollAllWallets(client)
    } catch (err) {
      console.error('[Monitor] Polling error:', err)
    }
  })

  cron.schedule('0 3 * * *', async () => {
    try {
      await runCleanup()
    } catch (err) {
      console.error('[Cleanup] Error:', err)
    }
  })

  console.log(`[Monitor] Started polling every ${intervalSeconds}s`)
  console.log('[Monitor] Daily cleanup scheduled at 03:00')
}
