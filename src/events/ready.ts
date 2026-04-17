import { Client, REST, Routes } from 'discord.js'
import * as walletCmd from '../commands/wallet'
import * as pnlCmd from '../commands/pnl'
import * as configCmd from '../commands/config'
import { startMonitoring } from '../services/monitor'
import { runAppMigrations } from '../db/migrations'

const commands = [walletCmd.data.toJSON(), pnlCmd.data.toJSON(), configCmd.data.toJSON()]

export const handleReady = async (client: Client) => {
  console.log(`[Bot] Logged in as ${client.user?.tag}`)

  const clientId = process.env.DISCORD_CLIENT_ID
  if (!clientId) {
    console.error('[Bot] DISCORD_CLIENT_ID not set')
    process.exit(1)
  }

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!)

  try {
    console.log('[Bot] Registering slash commands...')
    await rest.put(Routes.applicationCommands(clientId), { body: commands })
    console.log(`[Bot] ${commands.length} commands registered`)
  } catch (err) {
    console.error('[Bot] Failed to register commands:', err)
  }

  try {
    await runAppMigrations()
  } catch (err) {
    console.error('[Bot] App migrations failed:', err)
  }

  startMonitoring(client)
}
