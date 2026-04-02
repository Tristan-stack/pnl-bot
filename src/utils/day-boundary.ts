import { startOfDay } from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'

/**
 * Start of the current calendar day in the given IANA timezone (e.g. Europe/Paris),
 * returned as a UTC Date for comparisons with DB timestamps.
 */
export function getTodayStartInTimeZone(timeZone: string): Date {
  const now = new Date()
  const zoned = toZonedTime(now, timeZone)
  const startLocal = startOfDay(zoned)
  return fromZonedTime(startLocal, timeZone)
}
