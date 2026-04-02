import type { AutocompleteInteraction } from 'discord.js'
import prisma from '../db/client'
import { truncateAddress } from './format'

/** Discord application command choice `name` max length */
const MAX_CHOICE_NAME = 100

/**
 * Shared wallet list for slash autocomplete (same guild).
 * Truncates display names so Discord never rejects choices (>100 chars).
 */
export const respondWalletAutocomplete = async (
  interaction: AutocompleteInteraction,
  guildId: string
): Promise<void> => {
  let query = ''
  try {
    const raw = interaction.options.getFocused(false)
    query = typeof raw === 'string' ? raw.toLowerCase() : ''
  } catch {
    await safeRespondEmpty(interaction)
    return
  }

  try {
    const wallets = await prisma.wallet.findMany({ where: { guildId } })

    const filtered = wallets
      .filter(
        (w) =>
          w.address.toLowerCase().includes(query) ||
          (w.name && w.name.toLowerCase().includes(query))
      )
      .slice(0, 25)

    const choices = filtered.map((w) => {
      const displayName = w.name?.trim() || 'Unnamed'
      let name = `${displayName} — ${truncateAddress(w.address)}`
      if (name.length > MAX_CHOICE_NAME) {
        name = `${name.slice(0, MAX_CHOICE_NAME - 1)}…`
      }
      return { name, value: w.address }
    })

    await interaction.respond(choices)
  } catch (err) {
    console.error('[Autocomplete] Failed to load wallets:', err)
    await safeRespondEmpty(interaction)
  }
}

const safeRespondEmpty = async (interaction: AutocompleteInteraction) => {
  try {
    await interaction.respond([])
  } catch {
    // Interaction expirée ou déjà répondue
  }
}
