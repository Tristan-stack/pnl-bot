import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import type { CardData } from '../types'
import { formatUsd, formatPercent, formatTimestamp, formatVolume } from '../utils/format'

const WIDTH = 1200
const HEIGHT = 630

const COLORS = {
  profit: '#00E676',
  loss: '#FF1744',
  bg: '#0d1117',
  text: '#ffffff',
  textMuted: '#8b949e',
  overlay: 'rgba(13, 17, 23, 0.45)',
}

const drawRoundedRect = (
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) => {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

export const generatePnlCard = async (
  cardData: CardData,
  backgroundPath?: string | null
): Promise<Buffer> => {
  if (cardData.variant === 'daily') {
    return generateDailyCard(cardData, backgroundPath)
  }
  return generateSingleTradeCard(cardData, backgroundPath)
}

const generateDailyCard = async (
  cardData: Extract<CardData, { variant: 'daily' }>,
  backgroundPath?: string | null
): Promise<Buffer> => {
  const canvas = createCanvas(WIDTH, HEIGHT)
  const ctx = canvas.getContext('2d')
  const isProfit = cardData.totalPnlUsd >= 0
  const accentColor = isProfit ? COLORS.profit : COLORS.loss

  await drawBackground(ctx, backgroundPath, accentColor)

  const gradient = ctx.createLinearGradient(0, 0, WIDTH, 0)
  gradient.addColorStop(0, accentColor)
  gradient.addColorStop(1, isProfit ? '#00C853' : '#D50000')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, WIDTH, 4)

  ctx.fillStyle = COLORS.textMuted
  ctx.font = '500 22px sans-serif'
  ctx.fillText(cardData.walletName, 60, 58)

  ctx.fillStyle = COLORS.text
  ctx.font = 'bold 36px sans-serif'
  ctx.fillText("Today's realized PnL", 60, 108)

  ctx.fillStyle = COLORS.textMuted
  ctx.font = '400 22px sans-serif'
  const dayLine = cardData.dayLabel
  ctx.fillText(dayLine, 60, 148)

  const headerBottom = 160
  const footerTop = HEIGHT - 70
  const contentHeight = 88 + 20 + 36 + 20 + 22
  const centerY = headerBottom + (footerTop - headerBottom - contentHeight) / 2

  ctx.fillStyle = accentColor
  ctx.font = 'bold 88px sans-serif'
  const pnlText = formatUsd(cardData.totalPnlUsd)
  const pnlMetrics = ctx.measureText(pnlText)
  ctx.fillText(pnlText, (WIDTH - pnlMetrics.width) / 2, centerY + 88)

  ctx.font = 'bold 36px sans-serif'
  const pctText = formatPercent(cardData.blendedPnlPercent)
  const pctMetrics = ctx.measureText(pctText)
  ctx.fillText(pctText, (WIDTH - pctMetrics.width) / 2, centerY + 88 + 20 + 36)

  ctx.fillStyle = COLORS.textMuted
  ctx.font = '400 22px sans-serif'
  const statsLine = `${cardData.sellCount} sell${cardData.sellCount !== 1 ? 's' : ''} · ${cardData.uniqueTokenCount} token${cardData.uniqueTokenCount !== 1 ? 's' : ''} · Win ${cardData.winRatePercent.toFixed(0)}%`
  const statsW = ctx.measureText(statsLine).width
  ctx.fillText(statsLine, (WIDTH - statsW) / 2, centerY + 88 + 20 + 36 + 20 + 22)

  ctx.font = '400 20px sans-serif'
  const volText = `Volume ${formatVolume(cardData.volumeUsd)}`
  const timeText = formatTimestamp(cardData.timestamp)
  const poweredText = 'powered by GMGN'

  ctx.fillText(volText, 60, HEIGHT - 50)
  ctx.fillText(timeText, (WIDTH - ctx.measureText(timeText).width) / 2, HEIGHT - 50)
  ctx.globalAlpha = 0.6
  ctx.fillText(poweredText, WIDTH - ctx.measureText(poweredText).width - 60, HEIGHT - 50)
  ctx.globalAlpha = 1

  return canvas.toBuffer('image/png')
}

const generateSingleTradeCard = async (
  cardData: Extract<CardData, { variant: 'single' }>,
  backgroundPath?: string | null
): Promise<Buffer> => {
  const canvas = createCanvas(WIDTH, HEIGHT)
  const ctx = canvas.getContext('2d')
  const isProfit = cardData.pnlUsd >= 0
  const accentColor = isProfit ? COLORS.profit : COLORS.loss

  await drawBackground(ctx, backgroundPath, accentColor)

  const gradient = ctx.createLinearGradient(0, 0, WIDTH, 0)
  gradient.addColorStop(0, accentColor)
  gradient.addColorStop(1, isProfit ? '#00C853' : '#D50000')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, WIDTH, 4)

  ctx.fillStyle = COLORS.textMuted
  ctx.font = '500 22px sans-serif'
  ctx.fillText(cardData.walletName, 60, 70)

  const headerBottom = 90
  const footerTop = HEIGHT - 70
  const contentHeight = 42 + 30 + 96 + 20 + 40
  const centerY = headerBottom + (footerTop - headerBottom - contentHeight) / 2

  ctx.fillStyle = COLORS.text
  ctx.font = 'bold 42px sans-serif'
  const tokenText = `$${cardData.tokenSymbol}`
  const tokenMetrics = ctx.measureText(tokenText)
  const tokenX = (WIDTH - tokenMetrics.width - 100) / 2
  const tokenY = centerY + 42
  ctx.fillText(tokenText, tokenX, tokenY)

  const badgeText = cardData.tradeType.toUpperCase()
  const badgeX = tokenX + tokenMetrics.width + 16
  const badgeY = tokenY - 20
  ctx.font = 'bold 18px sans-serif'
  const badgeMetrics = ctx.measureText(badgeText)
  const badgePadX = 12
  const badgePadY = 6

  drawRoundedRect(
    ctx,
    badgeX,
    badgeY - 14 - badgePadY,
    badgeMetrics.width + badgePadX * 2,
    22 + badgePadY * 2,
    6
  )
  ctx.fillStyle = accentColor
  ctx.globalAlpha = 0.2
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.fillStyle = accentColor
  ctx.fillText(badgeText, badgeX + badgePadX, badgeY)

  ctx.fillStyle = accentColor
  ctx.font = 'bold 96px sans-serif'
  const pnlText = formatUsd(cardData.pnlUsd)
  const pnlMetrics = ctx.measureText(pnlText)
  ctx.fillText(pnlText, (WIDTH - pnlMetrics.width) / 2, tokenY + 30 + 96)

  ctx.font = 'bold 40px sans-serif'
  const pctText = formatPercent(cardData.pnlPercent)
  const pctMetrics = ctx.measureText(pctText)
  ctx.fillText(pctText, (WIDTH - pctMetrics.width) / 2, tokenY + 30 + 96 + 20 + 40)

  ctx.fillStyle = COLORS.textMuted
  ctx.font = '400 20px sans-serif'
  const amountText = `Swapped $${Math.abs(cardData.amountUsd).toFixed(2)}`
  const timeText = formatTimestamp(cardData.timestamp)
  const poweredText = 'powered by GMGN'

  ctx.fillText(amountText, 60, HEIGHT - 50)
  ctx.fillText(timeText, (WIDTH - ctx.measureText(timeText).width) / 2, HEIGHT - 50)

  ctx.globalAlpha = 0.6
  ctx.fillText(poweredText, WIDTH - ctx.measureText(poweredText).width - 60, HEIGHT - 50)
  ctx.globalAlpha = 1

  return canvas.toBuffer('image/png')
}

const drawBackground = async (
  ctx: SKRSContext2D,
  backgroundPath: string | null | undefined,
  accentColor: string
): Promise<void> => {
  if (backgroundPath && existsSync(backgroundPath)) {
    try {
      const imgBuffer = await readFile(backgroundPath)
      const img = await loadImage(imgBuffer)

      const imgW = img.width
      const imgH = img.height
      const imgRatio = imgW / imgH
      const canvasRatio = WIDTH / HEIGHT

      let sx = 0
      let sy = 0
      let sw = imgW
      let sh = imgH

      if (imgRatio > canvasRatio) {
        sw = imgH * canvasRatio
        sx = (imgW - sw) / 2
      } else {
        sh = imgW / canvasRatio
        sy = (imgH - sh) / 2
      }

      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, WIDTH, HEIGHT)
      ctx.fillStyle = COLORS.overlay
      ctx.fillRect(0, 0, WIDTH, HEIGHT)
    } catch {
      fillDefaultBackground(ctx, accentColor)
    }
  } else {
    fillDefaultBackground(ctx, accentColor)
  }
}

const fillDefaultBackground = (ctx: SKRSContext2D, accentColor: string) => {
  ctx.fillStyle = COLORS.bg
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  const glow = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, 100, WIDTH / 2, HEIGHT / 2, 500)
  glow.addColorStop(0, accentColor.replace(')', ', 0.08)').replace('rgb', 'rgba'))
  glow.addColorStop(1, 'transparent')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
}
