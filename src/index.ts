import 'dotenv/config'
import { Client, GatewayIntentBits } from 'discord.js'
import { handleReady } from './events/ready'
import { handleInteraction } from './events/interactionCreate'

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
})

client.once('clientReady', () => handleReady(client))
client.on('interactionCreate', handleInteraction)

const token = process.env.DISCORD_TOKEN
if (!token) {
  console.error('[Bot] DISCORD_TOKEN is required. Set it in .env')
  process.exit(1)
}

client.login(token)
