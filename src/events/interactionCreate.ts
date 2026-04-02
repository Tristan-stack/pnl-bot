import { Interaction } from 'discord.js'
import * as walletCmd from '../commands/wallet'
import * as pnlCmd from '../commands/pnl'
import * as configCmd from '../commands/config'

const commandHandlers: Record<string, {
  execute: (interaction: any) => Promise<any>
  autocomplete?: (interaction: any) => Promise<any>
}> = {
  wallet: walletCmd,
  pnl: pnlCmd,
  config: configCmd,
}

export const handleInteraction = async (interaction: Interaction) => {
  if (interaction.isAutocomplete()) {
    const handler = commandHandlers[interaction.commandName]
    if (handler?.autocomplete) {
      try {
        await handler.autocomplete(interaction)
      } catch (err) {
        console.error(`[Autocomplete] Error in /${interaction.commandName}:`, err)
        try {
          await interaction.respond([])
        } catch {
          /* interaction expirée ou déjà répondue */
        }
      }
    } else {
      try {
        await interaction.respond([])
      } catch {
        /* ignore */
      }
    }
    return
  }

  if (interaction.isChatInputCommand()) {
    const handler = commandHandlers[interaction.commandName]
    if (!handler) return

    try {
      await handler.execute(interaction)
    } catch (err) {
      console.error(`[Command] Error in /${interaction.commandName}:`, err)
      const reply = { content: 'An error occurred while executing this command.', ephemeral: true }

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(reply)
      } else {
        await interaction.reply(reply)
      }
    }
  }
}
