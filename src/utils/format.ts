export const truncateAddress = (address: string, chars = 4): string =>
  `${address.slice(0, chars)}...${address.slice(-chars)}`

export const formatUsd = (amount: number): string => {
  const abs = Math.abs(amount)
  const prefix = amount >= 0 ? '+' : '-'

  if (abs >= 1_000_000) return `${prefix}$${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${prefix}$${(abs / 1_000).toFixed(2)}K`
  return `${prefix}$${abs.toFixed(2)}`
}

export const formatVolume = (amount: number): string => {
  const abs = Math.abs(amount)
  if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `$${(abs / 1_000).toFixed(2)}K`
  return `$${abs.toFixed(2)}`
}

export const formatPercent = (percent: number): string => {
  const prefix = percent >= 0 ? '+' : ''
  return `${prefix}${percent.toFixed(1)}%`
}

export const formatTimestamp = (date: Date): string =>
  date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
