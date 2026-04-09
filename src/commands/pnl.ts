import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  EmbedBuilder,
  AttachmentBuilder,
} from 'discord.js'
import { addDays } from 'date-fns'
import { fromZonedTime } from 'date-fns-tz'
import prisma from '../db/client'
import { generatePnlCard } from '../services/card'
import { truncateAddress, formatUsd, formatVolume, formatPercent } from '../utils/format'
import { respondWalletAutocomplete } from '../utils/wallet-autocomplete'
import { getTodayStartInTimeZone } from '../utils/day-boundary'
import type { CardData } from '../types'

export const data = new SlashCommandBuilder()
  .setName('pnl')
  .setDescription('View PnL stats')
  .addSubcommand((sub) =>
    sub.setName('today').setDescription('Total realized PnL today across all wallets')
  )
  .addSubcommand((sub) =>
    sub
      .setName('show')
      .setDescription('Show realized PnL for a specific date across all wallets')
      .addStringOption((opt) =>
        opt.setName('date').setDescription('Date format: YYYY-MM-DD').setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('wallet')
      .setDescription('Daily PnL breakdown for one wallet')
      .addStringOption((opt) =>
        opt.setName('address').setDescription('Wallet address').setRequired(true).setAutocomplete(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('card')
      .setDescription('Generate a PnL image for today realized sells (wallet)')
      .addStringOption((opt) =>
        opt.setName('address').setDescription('Wallet address').setRequired(true).setAutocomplete(true)
      )
  )
  .addSubcommand((sub) =>
    sub.setName('card-today').setDescription('Generate a PnL card for today across ALL wallets')
  )
  .addSubcommand((sub) =>
    sub.setName('card-all').setDescription('Generate a PnL card for ALL TIME across ALL wallets')
  )

export const autocomplete = async (interaction: AutocompleteInteraction) => {
  const guildId = interaction.guildId
  if (!guildId) {
    try {
      await interaction.respond([])
    } catch {
      /* ignore */
    }
    return
  }

  await respondWalletAutocomplete(interaction, guildId)
}

export const execute = async (interaction: ChatInputCommandInteraction) => {
  const guildId = interaction.guildId
  if (!guildId) {
    return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true })
  }

  const sub = interaction.options.getSubcommand()

  if (sub === 'today') return handleToday(interaction, guildId)
  if (sub === 'show') return handleShow(interaction, guildId)
  if (sub === 'wallet') return handleWallet(interaction, guildId)
  if (sub === 'card') return handleCard(interaction, guildId)
  if (sub === 'card-today') return handleCardToday(interaction, guildId)
  if (sub === 'card-all') return handleCardAll(interaction, guildId)
}

const getTodayStart = () => {
  const tz = process.env.PNL_DAYTIMEZONE ?? 'Europe/Paris'
  return getTodayStartInTimeZone(tz)
}

const handleToday = async (interaction: ChatInputCommandInteraction, guildId: string) => {
  const todayStart = getTodayStart()

  const wallets = await prisma.wallet.findMany({ where: { guildId } })
  if (wallets.length === 0) {
    return interaction.reply({ content: 'No wallets monitored yet.', ephemeral: true })
  }

  const walletIds = wallets.map((w) => w.id)

  const sells = await prisma.trade.findMany({
    where: {
      walletId: { in: walletIds },
      tradeType: 'sell',
      timestamp: { gte: todayStart },
    },
  })

  const totalPnl = sells.reduce((sum, t) => sum + (t.pnlUsd ?? 0), 0)
  const totalVolume = sells.reduce((sum, t) => sum + t.amountUsd, 0)
  const winCount = sells.filter((t) => (t.pnlUsd ?? 0) > 0).length
  const winRate = sells.length > 0 ? (winCount / sells.length) * 100 : 0

  const embed = new EmbedBuilder()
    .setTitle("Today's PnL")
    .setColor(totalPnl >= 0 ? 0x00e676 : 0xff1744)
    .addFields(
      { name: 'Total PnL', value: formatUsd(totalPnl), inline: true },
      { name: 'Trades', value: `${sells.length} sells`, inline: true },
      { name: 'Win Rate', value: `${winRate.toFixed(0)}%`, inline: true },
      { name: 'Volume', value: formatVolume(totalVolume), inline: true },
    )
    .setFooter({ text: `Across ${wallets.length} wallet${wallets.length > 1 ? 's' : ''}` })
    .setTimestamp()

  return interaction.reply({ embeds: [embed] })
}

const parseRequestedDateRange = (
  dateInput: string,
  timeZone: string
): { start: Date; end: Date; label: string } | null => {
  const trimmed = dateInput.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null

  const [yearStr, monthStr, dayStr] = trimmed.split('-')
  const year = parseInt(yearStr, 10)
  const month = parseInt(monthStr, 10)
  const day = parseInt(dayStr, 10)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  const localStart = new Date(year, month - 1, day, 0, 0, 0, 0)
  if (
    localStart.getFullYear() !== year ||
    localStart.getMonth() !== month - 1 ||
    localStart.getDate() !== day
  ) {
    return null
  }

  const localEnd = addDays(localStart, 1)
  const start = fromZonedTime(localStart, timeZone)
  const end = fromZonedTime(localEnd, timeZone)
  return { start, end, label: trimmed }
}

const handleShow = async (interaction: ChatInputCommandInteraction, guildId: string) => {
  const wallets = await prisma.wallet.findMany({ where: { guildId } })
  if (wallets.length === 0) {
    return interaction.reply({ content: 'No wallets monitored yet.', ephemeral: true })
  }

  const tz = process.env.PNL_DAYTIMEZONE ?? 'Europe/Paris'
  const dateInput = interaction.options.getString('date', true)
  const range = parseRequestedDateRange(dateInput, tz)
  if (!range) {
    return interaction.reply({
      content: 'Invalid date format. Use `YYYY-MM-DD` (example: `2026-04-09`).',
      ephemeral: true,
    })
  }

  const walletIds = wallets.map((w) => w.id)
  const sells = await prisma.trade.findMany({
    where: {
      walletId: { in: walletIds },
      tradeType: 'sell',
      timestamp: { gte: range.start, lt: range.end },
    },
  })

  const totalPnl = sells.reduce((sum, t) => sum + (t.pnlUsd ?? 0), 0)
  const totalVolume = sells.reduce((sum, t) => sum + t.amountUsd, 0)
  const winCount = sells.filter((t) => (t.pnlUsd ?? 0) > 0).length
  const winRate = sells.length > 0 ? (winCount / sells.length) * 100 : 0

  const embed = new EmbedBuilder()
    .setTitle(`PnL for ${range.label}`)
    .setColor(totalPnl >= 0 ? 0x00e676 : 0xff1744)
    .addFields(
      { name: 'Total PnL', value: formatUsd(totalPnl), inline: true },
      { name: 'Trades', value: `${sells.length} sells`, inline: true },
      { name: 'Win Rate', value: `${winRate.toFixed(0)}%`, inline: true },
      { name: 'Volume', value: formatVolume(totalVolume), inline: true },
    )
    .setFooter({
      text: `Across ${wallets.length} wallet${wallets.length > 1 ? 's' : ''} • Timezone ${tz}`,
    })
    .setTimestamp()

  return interaction.reply({ embeds: [embed] })
}

const handleWallet = async (interaction: ChatInputCommandInteraction, guildId: string) => {
  const address = interaction.options.getString('address', true).trim()
  const todayStart = getTodayStart()

  const wallet = await prisma.wallet.findUnique({
    where: { address_guildId: { address, guildId } },
  })

  if (!wallet) {
    return interaction.reply({ content: `Wallet \`${truncateAddress(address)}\` not found.`, ephemeral: true })
  }

  const sells = await prisma.trade.findMany({
    where: {
      walletId: wallet.id,
      tradeType: 'sell',
      timestamp: { gte: todayStart },
    },
    orderBy: { timestamp: 'desc' },
  })

  const totalPnl = sells.reduce((sum, t) => sum + (t.pnlUsd ?? 0), 0)
  const displayName = wallet.name ?? truncateAddress(wallet.address, 6)

  const tradeLines = sells.length > 0
    ? sells
        .slice(0, 15)
        .map(
          (t) =>
            `\`${t.tokenSymbol}\` ${formatUsd(t.pnlUsd ?? 0)} (${formatPercent(t.pnlPercent ?? 0)})`
        )
        .join('\n')
    : 'No sells today.'

  const embed = new EmbedBuilder()
    .setTitle(`${displayName} — Today's PnL`)
    .setColor(totalPnl >= 0 ? 0x00e676 : 0xff1744)
    .setDescription(tradeLines)
    .addFields({ name: 'Total PnL', value: formatUsd(totalPnl), inline: true })
    .setFooter({ text: `${sells.length} sell${sells.length !== 1 ? 's' : ''} today` })
    .setTimestamp()

  return interaction.reply({ embeds: [embed] })
}

const resolveSellPnlUsd = (row: { pnlUsd: number | null }): number => {
  return row.pnlUsd ?? 0
}

const handleCard = async (interaction: ChatInputCommandInteraction, guildId: string) => {
  const address = interaction.options.getString('address', true).trim()

  const wallet = await prisma.wallet.findUnique({
    where: { address_guildId: { address, guildId } },
  })

  if (!wallet) {
    return interaction.reply({ content: `Wallet \`${truncateAddress(address)}\` not found.`, ephemeral: true })
  }

  const tz = process.env.PNL_DAYTIMEZONE ?? 'Europe/Paris'
  const todayStart = getTodayStartInTimeZone(tz)

  const sellsToday = await prisma.trade.findMany({
    where: {
      walletId: wallet.id,
      tradeType: 'sell',
      timestamp: { gte: todayStart },
    },
    orderBy: { timestamp: 'desc' },
  })

  if (sellsToday.length === 0) {
    return interaction.reply({
      content: 'No sell trades recorded for **today** for this wallet.',
      ephemeral: true,
    })
  }

  await interaction.deferReply()

  const config = await prisma.guildConfig.findUnique({
    where: { guildId },
  })

  const pnlBySell = sellsToday.map((row) => resolveSellPnlUsd(row))

  const totalPnlUsd = pnlBySell.reduce((s, p) => s + p, 0)
  const volumeUsd = sellsToday.reduce((s, t) => s + t.amountUsd, 0)
  const totalCostBasis = sellsToday.reduce((s, t, i) => s + (t.amountUsd - pnlBySell[i]), 0)
  const blendedPnlPercent = totalCostBasis > 0 ? (totalPnlUsd / totalCostBasis) * 100 : 0
  const wins = pnlBySell.filter((p) => p > 0).length
  const winRatePercent = sellsToday.length > 0 ? (wins / sellsToday.length) * 100 : 0
  const uniqueTokenCount = new Set(sellsToday.map((t) => t.tokenAddress)).size

  const dayLabel = todayStart.toLocaleDateString('en-GB', {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const cardData: CardData = {
    variant: 'daily',
    walletName: wallet.name ?? truncateAddress(wallet.address),
    dayLabel,
    totalPnlUsd,
    blendedPnlPercent,
    volumeUsd,
    sellCount: sellsToday.length,
    winRatePercent,
    uniqueTokenCount,
    timestamp: new Date(),
  }

  const imageBuffer = await generatePnlCard(cardData, config?.backgroundPath)
  const attachment = new AttachmentBuilder(imageBuffer, { name: 'pnl-card.png' })

  return interaction.editReply({ files: [attachment] })
}

const handleCardToday = async (interaction: ChatInputCommandInteraction, guildId: string) => {
  const wallets = await prisma.wallet.findMany({ where: { guildId } })
  if (wallets.length === 0) {
    return interaction.reply({ content: 'No wallets monitored yet.', ephemeral: true })
  }

  const tz = process.env.PNL_DAYTIMEZONE ?? 'Europe/Paris'
  const todayStart = getTodayStartInTimeZone(tz)
  const walletIds = wallets.map((w) => w.id)

  const sellsToday = await prisma.trade.findMany({
    where: {
      walletId: { in: walletIds },
      tradeType: 'sell',
      timestamp: { gte: todayStart },
    },
    orderBy: { timestamp: 'desc' },
  })

  if (sellsToday.length === 0) {
    return interaction.reply({
      content: 'No sell trades recorded for **today** across all wallets.',
      ephemeral: true,
    })
  }

  await interaction.deferReply()

  const config = await prisma.guildConfig.findUnique({
    where: { guildId },
  })

  const totalPnlUsd = sellsToday.reduce((s, t) => s + (t.pnlUsd ?? 0), 0)
  const volumeUsd = sellsToday.reduce((s, t) => s + t.amountUsd, 0)
  const totalCostBasis = sellsToday.reduce((s, t) => s + (t.amountUsd - (t.pnlUsd ?? 0)), 0)
  const blendedPnlPercent = totalCostBasis > 0 ? (totalPnlUsd / totalCostBasis) * 100 : 0
  const wins = sellsToday.filter((t) => (t.pnlUsd ?? 0) > 0).length
  const winRatePercent = sellsToday.length > 0 ? (wins / sellsToday.length) * 100 : 0
  const uniqueTokenCount = new Set(sellsToday.map((t) => t.tokenAddress)).size

  const dayLabel = todayStart.toLocaleDateString('en-GB', {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const cardData: CardData = {
    variant: 'daily',
    walletName: `All Wallets (${wallets.length})`,
    dayLabel,
    totalPnlUsd,
    blendedPnlPercent,
    volumeUsd,
    sellCount: sellsToday.length,
    winRatePercent,
    uniqueTokenCount,
    timestamp: new Date(),
  }

  const imageBuffer = await generatePnlCard(cardData, config?.backgroundPath)
  const attachment = new AttachmentBuilder(imageBuffer, { name: 'pnl-card-today.png' })

  return interaction.editReply({ files: [attachment] })
}

const handleCardAll = async (interaction: ChatInputCommandInteraction, guildId: string) => {
  const wallets = await prisma.wallet.findMany({ where: { guildId } })
  if (wallets.length === 0) {
    return interaction.reply({ content: 'No wallets monitored yet.', ephemeral: true })
  }

  const walletIds = wallets.map((w) => w.id)

  const allSells = await prisma.trade.findMany({
    where: {
      walletId: { in: walletIds },
      tradeType: 'sell',
    },
    orderBy: { timestamp: 'asc' },
  })

  if (allSells.length === 0) {
    return interaction.reply({
      content: 'No sell trades recorded across all wallets.',
      ephemeral: true,
    })
  }

  await interaction.deferReply()

  const config = await prisma.guildConfig.findUnique({
    where: { guildId },
  })

  const totalPnlUsd = allSells.reduce((s, t) => s + (t.pnlUsd ?? 0), 0)
  const volumeUsd = allSells.reduce((s, t) => s + t.amountUsd, 0)
  const totalCostBasis = allSells.reduce((s, t) => s + (t.amountUsd - (t.pnlUsd ?? 0)), 0)
  const blendedPnlPercent = totalCostBasis > 0 ? (totalPnlUsd / totalCostBasis) * 100 : 0
  const wins = allSells.filter((t) => (t.pnlUsd ?? 0) > 0).length
  const winRatePercent = allSells.length > 0 ? (wins / allSells.length) * 100 : 0
  const uniqueTokenCount = new Set(allSells.map((t) => t.tokenAddress)).size

  const firstTrade = allSells[0]
  const lastTrade = allSells[allSells.length - 1]
  const tz = process.env.PNL_DAYTIMEZONE ?? 'Europe/Paris'

  const startDate = firstTrade.timestamp.toLocaleDateString('en-GB', {
    timeZone: tz,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  const endDate = lastTrade.timestamp.toLocaleDateString('en-GB', {
    timeZone: tz,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  const dayLabel = startDate === endDate ? startDate : `${startDate} - ${endDate}`

  const cardData: CardData = {
    variant: 'daily',
    walletName: `All Wallets (${wallets.length})`,
    dayLabel: `All Time: ${dayLabel}`,
    totalPnlUsd,
    blendedPnlPercent,
    volumeUsd,
    sellCount: allSells.length,
    winRatePercent,
    uniqueTokenCount,
    timestamp: new Date(),
  }

  const imageBuffer = await generatePnlCard(cardData, config?.backgroundPath)
  const attachment = new AttachmentBuilder(imageBuffer, { name: 'pnl-card-all.png' })

  return interaction.editReply({ files: [attachment] })
}
