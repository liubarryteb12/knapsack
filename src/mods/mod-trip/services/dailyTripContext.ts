import { db } from '../../../db'
import type { DailyTripContext } from '../../../core/capabilityContracts'
import type { Trip } from '../schema'

export async function getDailyTripContext(logicalDate: string): Promise<DailyTripContext | null> {
  const trips = (await db.trips.where('startDate').belowOrEqual(logicalDate).toArray()) as Trip[]
  const active = trips
    .filter((trip) => trip.startDate <= logicalDate && trip.endDate >= logicalDate)
    .sort((a, b) => b.startDate.localeCompare(a.startDate))[0]
  if (!active) return null
  const day = active.days.find((row) => row.date === logicalDate)
  return {
    tripId: active.id,
    tripName: active.name,
    startDate: active.startDate,
    endDate: active.endDate,
    destCity: active.destCity,
    dayTitle: day?.items.map((item) => item.title).filter(Boolean).join(' · ') ?? '',
  }
}
