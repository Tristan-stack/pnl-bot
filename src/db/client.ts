import { PrismaClient } from '../../generated/prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

const databaseUrl = process.env.DATABASE_URL ?? 'file:./dev.db'

const adapter = new PrismaBetterSqlite3({ url: databaseUrl })

const prisma = new PrismaClient({ adapter })

export default prisma
