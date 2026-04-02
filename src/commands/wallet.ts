import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  EmbedBuilder,
} from 'discord.js'
import prisma from '../db/client'
import { truncateAddress } from '../utils/format'
import { respondWalletAutocomplete } from '../utils/wallet-autocomplete'

export const data = new SlashCommandBuilder()
  .setName('wallet')
  .setDescription('Manage monitored wallets')
  .addSubcommand((sub) =>
    sub
      .setName('add')
      .setDescription('Add a Solana wallet to monitoring')
      .addStringOption((opt) =>
        opt.setName('address').setDescription('Solana wallet address').setRequired(true)
      )
      .addStringOption((opt) =>
        opt.setName('name').setDescription('Display name for this wallet').setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('remove')
      .setDescription('Remove a wallet from monitoring')
      .addStringOption((opt) =>
        opt.setName('address').setDescription('Wallet address').setRequired(true).setAutocomplete(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('rename')
      .setDescription('Rename a monitored wallet')
      .addStringOption((opt) =>
        opt.setName('address').setDescription('Wallet address').setRequired(true).setAutocomplete(true)
      )
      .addStringOption((opt) =>
        opt.setName('name').setDescription('New display name').setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub.setName('list').setDescription('List all monitored wallets')
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

  if (sub === 'add') return handleAdd(interaction, guildId)
  if (sub === 'remove') return handleRemove(interaction, guildId)
  if (sub === 'rename') return handleRename(interaction, guildId)
  if (sub === 'list') return handleList(interaction, guildId)
}

const handleAdd = async (interaction: ChatInputCommandInteraction, guildId: string) => {
  const address = interaction.options.getString('address', true).trim()
  const name = interaction.options.getString('name')?.trim() ?? null

  if (address.length < 32 || address.length > 44) {
    return interaction.reply({ content: 'Invalid Solana address.', ephemeral: true })
  }

  const existing = await prisma.wallet.findUnique({
    where: { address_guildId: { address, guildId } },
  })

  if (existing) {
    return interaction.reply({ content: `Wallet \`${truncateAddress(address)}\` is already monitored.`, ephemeral: true })
  }

  await prisma.wallet.create({ data: { address, name, guildId } })

  const displayName = name ? `**${name}** (\`${truncateAddress(address)}\`)` : `\`${truncateAddress(address)}\``
  return interaction.reply({ content: `Wallet ${displayName} added to monitoring.` })
}

const handleRemove = async (interaction: ChatInputCommandInteraction, guildId: string) => {
  const address = interaction.options.getString('address', true).trim()

  const wallet = await prisma.wallet.findUnique({
    where: { address_guildId: { address, guildId } },
  })

  if (!wallet) {
    return interaction.reply({ content: `Wallet \`${truncateAddress(address)}\` not found.`, ephemeral: true })
  }

  await prisma.wallet.delete({ where: { id: wallet.id } })

  return interaction.reply({ content: `Wallet \`${truncateAddress(address)}\` removed.` })
}

const handleRename = async (interaction: ChatInputCommandInteraction, guildId: string) => {
  const address = interaction.options.getString('address', true).trim()
  const name = interaction.options.getString('name', true).trim()

  const wallet = await prisma.wallet.findUnique({
    where: { address_guildId: { address, guildId } },
  })

  if (!wallet) {
    return interaction.reply({ content: `Wallet \`${truncateAddress(address)}\` not found.`, ephemeral: true })
  }

  await prisma.wallet.update({ where: { id: wallet.id }, data: { name } })

  return interaction.reply({ content: `Wallet \`${truncateAddress(address)}\` renamed to **${name}**.` })
}

const handleList = async (interaction: ChatInputCommandInteraction, guildId: string) => {
  const wallets = await prisma.wallet.findMany({ where: { guildId } })

  if (wallets.length === 0) {
    return interaction.reply({ content: 'No wallets are being monitored.', ephemeral: true })
  }

  const embed = new EmbedBuilder()
    .setTitle('Monitored Wallets')
    .setColor(0x5865f2)
    .setDescription(
      wallets
        .map(
          (w, i) =>
            `**${i + 1}.** ${w.name ? `${w.name} — ` : ''}\`${truncateAddress(w.address, 6)}\``
        )
        .join('\n')
    )
    .setFooter({ text: `${wallets.length} wallet${wallets.length > 1 ? 's' : ''} monitored` })

  return interaction.reply({ embeds: [embed] })
}
