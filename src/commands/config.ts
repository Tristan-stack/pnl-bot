import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
  AttachmentBuilder,
} from 'discord.js'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import axios from 'axios'
import prisma from '../db/client'

const DATA_DIR = process.env.DATA_DIR ?? './data'
const BACKGROUNDS_DIR = join(DATA_DIR, 'backgrounds')
const MAX_IMAGE_SIZE = 8 * 1024 * 1024 // 8MB

export const data = new SlashCommandBuilder()
  .setName('config')
  .setDescription('Configure the PnL bot')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName('channel')
      .setDescription('Set the channel for auto-posting PnL cards')
      .addChannelOption((opt) =>
        opt
          .setName('channel')
          .setDescription('Target text channel')
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('background')
      .setDescription('Upload a custom background image for PnL cards')
      .addAttachmentOption((opt) =>
        opt.setName('image').setDescription('PNG or JPG image (max 8MB)').setRequired(true)
      )
  )

export const execute = async (interaction: ChatInputCommandInteraction) => {
  const guildId = interaction.guildId
  if (!guildId) {
    return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true })
  }

  const sub = interaction.options.getSubcommand()

  if (sub === 'channel') return handleChannel(interaction, guildId)
  if (sub === 'background') return handleBackground(interaction, guildId)
}

const handleChannel = async (interaction: ChatInputCommandInteraction, guildId: string) => {
  const channel = interaction.options.getChannel('channel', true)

  await prisma.guildConfig.upsert({
    where: { guildId },
    update: { channelId: channel.id },
    create: { guildId, channelId: channel.id },
  })

  return interaction.reply({ content: `PnL cards will be posted in <#${channel.id}>.` })
}

const handleBackground = async (interaction: ChatInputCommandInteraction, guildId: string) => {
  const attachment = interaction.options.getAttachment('image', true)

  if (!attachment.contentType?.startsWith('image/')) {
    return interaction.reply({ content: 'Please upload a valid image file (PNG or JPG).', ephemeral: true })
  }

  if (attachment.size > MAX_IMAGE_SIZE) {
    return interaction.reply({ content: 'Image must be under 8MB.', ephemeral: true })
  }

  await interaction.deferReply()

  const ext = attachment.contentType.includes('png') ? 'png' : 'jpg'
  const filename = `${guildId}.${ext}`
  const filePath = join(BACKGROUNDS_DIR, filename)

  await mkdir(BACKGROUNDS_DIR, { recursive: true })

  const response = await axios.get(attachment.url, { responseType: 'arraybuffer' })
  await writeFile(filePath, Buffer.from(response.data))

  await prisma.guildConfig.upsert({
    where: { guildId },
    update: { backgroundPath: filePath },
    create: { guildId, backgroundPath: filePath },
  })

  const preview = new AttachmentBuilder(Buffer.from(response.data), { name: `preview.${ext}` })

  return interaction.editReply({
    content: 'Background updated! Preview:',
    files: [preview],
  })
}
