import { z } from 'zod'
import { shareablePackageSchema } from '../../../core/types/shareable-package.schema'

export const TEAM_PACKAGE_RECORD_FORMAT = 'team-package-record.v1'

export const teamPackageDirectionSchema = z.enum(['SENT', 'RECEIVED'])
export const teamPackageStatusSchema = z.enum([
  'READY',
  'PENDING_REVIEW',
  'ACCEPTED',
  'REJECTED',
])

export const teamPackageRecordSchema = z.object({
  format: z.literal(TEAM_PACKAGE_RECORD_FORMAT),
  recordId: z.string().min(1),
  groupId: z.string().min(1).nullable().default(null),
  packageId: z.string().min(1),
  direction: teamPackageDirectionSchema,
  status: teamPackageStatusSchema,
  package: shareablePackageSchema,
  previousPackage: shareablePackageSchema.nullable().default(null),
  createdAt: z.number().int().min(0),
  updatedAt: z.number().int().min(0),
})

export type TeamPackageDirection = z.infer<typeof teamPackageDirectionSchema>
export type TeamPackageStatus = z.infer<typeof teamPackageStatusSchema>
export type TeamPackageRecord = z.infer<typeof teamPackageRecordSchema>
