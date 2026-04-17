import { createCanvas, loadImage, GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'
import type { CardData } from '../types'
import { formatUsd, formatPercent, formatTimestamp, formatVolume } from '../utils/format'
import { formatSolFromUsd, getSolUsdPrice } from '../utils/sol-price'

const SOL_LOGO_PATH = join(process.cwd(), 'data/backgrounds/images-removebg-preview.png')

type CanvasImage = Awaited<ReturnType<typeof loadImage>>

let solLogoLoadPromise: Promise<CanvasImage | null> | null = null

const getSolLogo = (): Promise<CanvasImage | null> => {
  if (!solLogoLoadPromise) {
    solLogoLoadPromise = (async () => {
      try {
        if (!existsSync(SOL_LOGO_PATH)) return null
        const buf = await readFile(SOL_LOGO_PATH)
        return await loadImage(buf)
      } catch {
        return null
      }
    })()
  }
  return solLogoLoadPromise
}

const WIDTH = 1200
const HEIGHT = 630

const COLORS = {
  profit: '#00E676',
  loss: '#FF1744',
  bg: '#0d1117',
  text: '#ffffff',
  textMuted: 'rgba(255, 255, 255, 0.7)',
}

const LEFT_PANEL_WIDTH = 450

const FONT_FAMILY = 'Inter'
let fontsRegistered = false

const registerFonts = async () => {
  if (fontsRegistered) return
  
  try {
    const fontsDir = join(process.cwd(), 'fonts')
    const regularPath = join(fontsDir, 'Inter-Regular.ttf')
    const boldPath = join(fontsDir, 'Inter-Bold.ttf')
    const mediumPath = join(fontsDir, 'Inter-Medium.ttf')
    
    if (existsSync(regularPath)) {
      GlobalFonts.registerFromPath(regularPath, 'Inter')
    }
    if (existsSync(boldPath)) {
      GlobalFonts.registerFromPath(boldPath, 'Inter')
    }
    if (existsSync(mediumPath)) {
      GlobalFonts.registerFromPath(mediumPath, 'Inter')
    }
    
    fontsRegistered = true
    console.log('[Card] Fonts registered successfully')
  } catch (err) {
    console.warn('[Card] Could not register fonts, using system fallback:', err)
  }
}

const drawPnlUsdWithSolRow = async (
  ctx: SKRSContext2D,
  opts: {
    leftX: number
    panelRight: number
    pnlUsd: number
    accentColor: string
    pnlBaselineY: number
  }
): Promise<{ pctBaselineY: number }> => {
  const { leftX, panelRight, pnlUsd, accentColor, pnlBaselineY } = opts
  const solUsd = await getSolUsdPrice()

  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'

  ctx.fillStyle = accentColor
  ctx.font = 'bold 72px Inter, sans-serif'
  const pnlText = formatUsd(pnlUsd)
  let pnlFontSize = 72
  while (ctx.measureText(pnlText).width > panelRight - leftX && pnlFontSize > 36) {
    pnlFontSize -= 4
    ctx.font = `bold ${pnlFontSize}px Inter, sans-serif`
  }
  ctx.fillText(pnlText, leftX, pnlBaselineY)

  const marginBelowPnl = Math.max(24, Math.round(pnlFontSize * 0.3))
  const solLineBaseline = pnlBaselineY + Math.round(pnlFontSize * 0.72) + marginBelowPnl

  const solText = `≈ ${formatSolFromUsd(pnlUsd, solUsd)}`
  ctx.fillStyle = COLORS.textMuted
  ctx.font = '500 22px Inter, sans-serif'

  const logo = await getSolLogo()
  const iconH = 32
  let textX = leftX
  if (logo) {
    const iconW = (logo.width / logo.height) * iconH
    const iconY = solLineBaseline - iconH * 0.78
    ctx.drawImage(logo, leftX, iconY, iconW, iconH)
    textX = leftX + iconW + 14
  }
  ctx.fillText(solText, textX, solLineBaseline)

  const marginBelowSol = 22
  const pctBaselineY = solLineBaseline + marginBelowSol + 18

  return { pctBaselineY }
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
  await registerFonts()
  
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

  const gradient = ctx.createLinearGradient(0, 0, LEFT_PANEL_WIDTH, 0)
  gradient.addColorStop(0, accentColor)
  gradient.addColorStop(1, isProfit ? '#00C853' : '#D50000')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, LEFT_PANEL_WIDTH, 4)

  const leftX = 40
  const panelRight = LEFT_PANEL_WIDTH - 24

  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'

  ctx.fillStyle = COLORS.textMuted
  ctx.font = '500 18px Inter, sans-serif'
  ctx.fillText(cardData.walletName, leftX, 50)

  ctx.fillStyle = COLORS.text
  ctx.font = 'bold 24px Inter, sans-serif'
  ctx.fillText("Today's PnL", leftX, 85)

  ctx.fillStyle = COLORS.textMuted
  ctx.font = '400 16px Inter, sans-serif'
  ctx.fillText(cardData.dayLabel, leftX, 115)

  const pnlBaselineY = 208
  const { pctBaselineY } = await drawPnlUsdWithSolRow(ctx, {
    leftX,
    panelRight,
    pnlUsd: cardData.totalPnlUsd,
    accentColor,
    pnlBaselineY,
  })

  ctx.fillStyle = accentColor
  ctx.font = 'bold 32px Inter, sans-serif'
  const pctText = formatPercent(cardData.blendedPnlPercent)
  let pctFontSize = 32
  while (ctx.measureText(pctText).width > panelRight - leftX && pctFontSize > 18) {
    pctFontSize -= 2
    ctx.font = `bold ${pctFontSize}px Inter, sans-serif`
  }
  ctx.fillText(pctText, leftX, pctBaselineY)

  ctx.fillStyle = COLORS.text
  ctx.font = '400 18px Inter, sans-serif'

  const stats = [
    { label: 'Sells', value: cardData.sellCount.toString() },
    { label: 'Tokens', value: cardData.uniqueTokenCount.toString() },
    { label: 'Win Rate', value: `${cardData.winRatePercent.toFixed(0)}%` },
    { label: 'Volume', value: formatVolume(cardData.volumeUsd) },
  ]

  const statsStartY = pctBaselineY + 52
  const statsGap = 50

  stats.forEach((stat, i) => {
    const y = statsStartY + i * statsGap
    ctx.fillStyle = COLORS.textMuted
    ctx.font = '400 16px Inter, sans-serif'
    ctx.fillText(stat.label, leftX, y)
    
    ctx.fillStyle = COLORS.text
    ctx.font = 'bold 20px Inter, sans-serif'
    ctx.fillText(stat.value, leftX, y + 24)
  })

  ctx.fillStyle = COLORS.textMuted
  ctx.font = '400 14px Inter, sans-serif'
  const timeText = formatTimestamp(cardData.timestamp)
  ctx.fillText(timeText, leftX, HEIGHT - 40)
  
  ctx.globalAlpha = 0.5
  ctx.fillText('powered by GMGN', leftX, HEIGHT - 20)
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

  const gradient = ctx.createLinearGradient(0, 0, LEFT_PANEL_WIDTH, 0)
  gradient.addColorStop(0, accentColor)
  gradient.addColorStop(1, isProfit ? '#00C853' : '#D50000')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, LEFT_PANEL_WIDTH, 4)

  const leftX = 40
  const panelRight = LEFT_PANEL_WIDTH - 24

  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'

  ctx.fillStyle = COLORS.textMuted
  ctx.font = '500 18px Inter, sans-serif'
  ctx.fillText(cardData.walletName, leftX, 50)

  ctx.fillStyle = COLORS.text
  ctx.font = 'bold 28px Inter, sans-serif'
  const tokenText = `$${cardData.tokenSymbol}`
  ctx.fillText(tokenText, leftX, 90)

  const badgeText = cardData.tradeType.toUpperCase()
  ctx.font = 'bold 14px Inter, sans-serif'
  const badgeMetrics = ctx.measureText(badgeText)
  const tokenMetrics = ctx.measureText(tokenText)
  ctx.font = 'bold 28px Inter, sans-serif'
  
  const badgeX = leftX + tokenMetrics.width + 12
  const badgeY = 90 - 8
  const badgePadX = 8
  const badgePadY = 4

  drawRoundedRect(
    ctx,
    badgeX,
    badgeY - 14 - badgePadY,
    badgeMetrics.width + badgePadX * 2,
    18 + badgePadY * 2,
    4
  )
  ctx.fillStyle = accentColor
  ctx.globalAlpha = 0.25
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.fillStyle = accentColor
  ctx.font = 'bold 14px Inter, sans-serif'
  ctx.fillText(badgeText, badgeX + badgePadX, badgeY)

  const pnlBaselineY = 218
  const { pctBaselineY } = await drawPnlUsdWithSolRow(ctx, {
    leftX,
    panelRight,
    pnlUsd: cardData.pnlUsd,
    accentColor,
    pnlBaselineY,
  })

  ctx.fillStyle = accentColor
  ctx.font = 'bold 32px Inter, sans-serif'
  const pctText = formatPercent(cardData.pnlPercent)
  let pctFontSizeSingle = 32
  while (ctx.measureText(pctText).width > panelRight - leftX && pctFontSizeSingle > 18) {
    pctFontSizeSingle -= 2
    ctx.font = `bold ${pctFontSizeSingle}px Inter, sans-serif`
  }
  ctx.fillText(pctText, leftX, pctBaselineY)

  ctx.fillStyle = COLORS.text
  ctx.font = '400 18px Inter, sans-serif'

  const statsStartY = pctBaselineY + 72
  const statsGap = 50

  ctx.fillStyle = COLORS.textMuted
  ctx.font = '400 16px Inter, sans-serif'
  ctx.fillText('Swapped', leftX, statsStartY)
  ctx.fillStyle = COLORS.text
  ctx.font = 'bold 20px Inter, sans-serif'
  ctx.fillText(`$${Math.abs(cardData.amountUsd).toFixed(2)}`, leftX, statsStartY + 24)

  ctx.fillStyle = COLORS.textMuted
  ctx.font = '400 14px Inter, sans-serif'
  const timeText = formatTimestamp(cardData.timestamp)
  ctx.fillText(timeText, leftX, HEIGHT - 40)

  ctx.globalAlpha = 0.5
  ctx.fillText('powered by GMGN', leftX, HEIGHT - 20)
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
      
      drawLeftPanelBlur(ctx)
    } catch {
      fillDefaultBackground(ctx, accentColor)
    }
  } else {
    fillDefaultBackground(ctx, accentColor)
  }
}

const drawLeftPanelBlur = (ctx: SKRSContext2D) => {
  const blurGradient = ctx.createLinearGradient(0, 0, LEFT_PANEL_WIDTH + 80, 0)
  blurGradient.addColorStop(0, 'rgba(13, 17, 23, 0.85)')
  blurGradient.addColorStop(0.7, 'rgba(13, 17, 23, 0.75)')
  blurGradient.addColorStop(1, 'rgba(13, 17, 23, 0)')
  
  ctx.fillStyle = blurGradient
  ctx.fillRect(0, 0, LEFT_PANEL_WIDTH + 80, HEIGHT)
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
