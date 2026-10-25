import type { EnabledModules, Trip } from '../schema/trip'

/** 旅行列表只需要展示字段，不应把 days/expenses/notes 等完整聚合根常驻内存。 */
export interface TripSummary {
  id: string
  name: string
  startDate: string
  endDate: string
  destType: Trip['destType']
  destCity: string
  totalBudgetFen: number
  usedFen: number
  enabledModules: EnabledModules
}

export function toTripSummary(trip: Trip): TripSummary {
  return {
    id: trip.id,
    name: trip.name,
    startDate: trip.startDate,
    endDate: trip.endDate,
    destType: trip.destType,
    destCity: trip.destCity,
    totalBudgetFen: trip.totalBudgetFen,
    usedFen: trip.expenses.reduce((sum, expense) => sum + expense.amountFen, 0),
    enabledModules: { ...trip.enabledModules },
  }
}
