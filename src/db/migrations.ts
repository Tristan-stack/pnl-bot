import prisma from './client'
import { FEE_PER_TOKEN_USD } from '../utils/fees'

const MIGRATION_NAME = 'fee-fix-2026-04'

export const runAppMigrations = async (): Promise<void> => {
  const existing = await prisma.migration.findUnique({
    where: { name: MIGRATION_NAME },
  })
  if (existing) return

  const updated = await prisma.trade.updateMany({
    where: { tradeType: 'sell', pnlUsd: { not: null } },
    data: { pnlUsd: { increment: FEE_PER_TOKEN_USD } },
  })
  await prisma.migration.create({ data: { name: MIGRATION_NAME } })
  console.log(
    `[Migrations] ${MIGRATION_NAME}: ${updated.count} sells gross-ified (+$${FEE_PER_TOKEN_USD})`
  )
}
