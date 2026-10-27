import { db } from '../../../db'
import type { SpecialExpenseLedgerEntry } from '../../../core/capabilityContracts'
import type { Trip } from '../schema'
import { splitExpenseFen } from '../settle'

/**
 * Finance receives only the owner's final split share. Reimbursed teammate
 * advances remain inside the trip ledger and never inflate personal spending.
 */
export async function listSpecialExpenseLedger(): Promise<SpecialExpenseLedgerEntry[]> {
  const trips = (await db.trips.toArray()) as Trip[]
  const output: SpecialExpenseLedgerEntry[] = []
  for (const trip of trips) {
    const self = trip.members.find((member) => member.role === 'owner') ?? trip.members[0]
    if (!self) continue
    for (const expense of trip.expenses) {
      const personalNetFen = splitExpenseFen(expense).get(self.id) ?? 0
      if (personalNetFen <= 0) continue
      output.push({
        tripId: trip.id,
        tripName: trip.name,
        expenseId: expense.id,
        date: expense.date,
        category: expense.category,
        title: expense.title,
        personalNetFen,
      })
    }
  }
  return output.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title))
}
