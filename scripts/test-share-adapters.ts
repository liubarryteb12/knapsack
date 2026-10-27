/**
 * 跨模块分享适配器契约。
 *
 * 运行：node --import ./scripts/lib/tsx-preload.mjs --import tsx scripts/test-share-adapters.ts
 */
import 'fake-indexeddb/auto'
import { db } from '../src/db'
import {
  SHAREABLE_PACKAGE_EXPORT_TOPIC,
  SHAREABLE_PACKAGE_IMPORT_TOPIC,
  type ShareablePackage,
  type ShareablePackageDraft,
} from '../src/core/types/shareable-package.schema'
import { signShareablePackage } from '../src/engines/lan-share-engine/digest-signer'
import tripManifest from '../src/mods/mod-trip/manifest'
import promptsManifest from '../src/mods/mod-prompts/manifest'
import dailyManifest from '../src/mods/mod-daily/manifest'
import {
  TRIP_SHARE_PACKAGE_TYPE,
  exportShareablePackages as exportTrips,
  importShareablePackage as importTrip,
  type TripSharePayload,
} from '../src/mods/mod-trip/services/shareAdapter'
import {
  PROMPT_SHARE_FORMAT,
  PROMPT_SHARE_PACKAGE_TYPE,
  exportShareablePackages as exportPrompts,
  importShareablePackage as importPrompt,
  type PromptSharePayload,
} from '../src/mods/mod-prompts/services/shareAdapter'
import {
  DAILY_SHARE_PACKAGE_TYPE,
  exportShareablePackages as exportDaily,
  importShareablePackage as importDaily,
  type DailySharePayload,
} from '../src/mods/mod-daily/services/shareAdapter'
import { tripSchema, type Trip } from '../src/mods/mod-trip/schema'
import { settleExpenses } from '../src/mods/mod-trip/settle'
import {
  promptItemSchema,
  promptSnippetSchema,
  type PromptItem,
  type PromptSnippet,
} from '../src/mods/mod-prompts/schema'
import { dailyDaySchema, type DailyDay } from '../src/mods/mod-daily/schema'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value))
  }
}

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: new MemoryStorage(),
})

let failed = 0
let sharedDeviceId = ''
function check(name: string, condition: boolean): void {
  if (condition) console.log(`  ok  ${name}`)
  else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

function withoutDigest<T>(value: ShareablePackage<T>): ShareablePackageDraft<T> {
  const { digest: _digest, protocolVersion: _protocolVersion, ...draft } = value
  return draft
}

const promptSnippet: PromptSnippet = promptSnippetSchema.parse({
  id: 'snippet-cinematic',
  category: 'LIGHTING',
  labelZh: '电影光',
  labelEn: 'cinematic lighting',
  textEn: 'cinematic lighting',
  defaultWeight: 1,
  usageCount: 2,
  createdAt: 100,
  updatedAt: 100,
})

const promptItems: PromptItem[] = [
  promptItemSchema.parse({
    id: 'prompt-work',
    title: '架构评审模板',
    modality: 'WORK_LLM',
    facets: {
      targetTool: ['Claude'],
      domainTheme: ['架构设计'],
      styleTechnique: ['Few-Shot'],
    },
    isFavorite: true,
    usageCount: 5,
    version: 3,
    history: [{ version: 2, updatedAt: 90, summary: '初版' }],
    createdAt: 10,
    updatedAt: 100,
    payload: {
      systemRole: '资深架构师',
      templateBody: '评审 {{主题}}',
      fewShotExamples: [{ input: '方案 A', output: '约束清晰' }],
      outputFormat: 'MARKDOWN',
    },
  }),
  promptItemSchema.parse({
    id: 'prompt-image',
    title: '海报生图模板',
    modality: 'IMAGE_GEN',
    facets: {
      targetTool: ['Midjourney'],
      domainTheme: ['海报'],
      styleTechnique: ['Lighting'],
    },
    isFavorite: false,
    usageCount: 2,
    version: 1,
    history: [],
    createdAt: 20,
    updatedAt: 200,
    payload: {
      positivePrompt: 'editorial poster, glass typography',
      positivePromptZh: '编辑感海报，玻璃字体',
      negativePrompt: 'blurry',
      activeSnippets: [{ snippetId: promptSnippet.id, enabled: true, weight: 1.2 }],
      imageParams: {
        aspectRatio: '4:3',
        targetModel: 'Midjourney',
        styleRef: 'sref-1',
        chaos: 20,
        stylize: 300,
        seed: '42',
      },
    },
  }),
  promptItemSchema.parse({
    id: 'prompt-video',
    title: '雨夜长镜头',
    modality: 'VIDEO_GEN',
    facets: {
      targetTool: ['Veo'],
      domainTheme: ['城市'],
      styleTechnique: ['Tracking'],
    },
    isFavorite: false,
    usageCount: 1,
    version: 1,
    history: [],
    createdAt: 30,
    updatedAt: 300,
    payload: {
      subjectAndScene: '雨夜霓虹街道',
      motionDynamics: '镜头缓慢跟随行人',
      cameraMovement: ['PAN_LEFT', 'DOLLY_OUT'],
      atmosphereAndLighting: '湿润反光',
      videoParams: {
        durationSec: 10,
        aspectRatio: '16:9',
        fps: 24,
        requiresStartEndFrame: false,
        frameNotes: '',
      },
    },
  }),
]

const trip: Trip = tripSchema.parse({
  format: 'trip.v1',
  id: 'trip-share-1',
  name: '苏州两日',
  startDate: '2026-11-01',
  endDate: '2026-11-02',
  destType: 'city',
  destCity: '苏州',
  totalBudgetFen: 200000,
  categoryBudgetsFen: { food: 60000 },
  members: [
    { id: 'member-a', name: '阿青', role: 'owner' },
    { id: 'member-b', name: '小周', role: 'member' },
  ],
  days: [
    {
      date: '2026-11-01',
      items: [
        {
          id: 'item-1',
          time: '09:00',
          type: 'play',
          title: '拙政园',
          note: '',
          linkedExpenseId: 'expense-1',
          done: false,
        },
      ],
    },
    { date: '2026-11-02', items: [] },
  ],
  expenses: [
    {
      id: 'expense-1',
      date: '2026-11-01',
      category: 'food',
      title: '午饭',
      amountFen: 10001,
      payerId: 'member-a',
      split: { mode: 'equal', memberIds: ['member-a', 'member-b'] },
    },
  ],
  packing: [],
  notes: '带伞',
  enabledModules: { expenses: true, notes: true },
})

const daily: DailyDay = dailyDaySchema.parse({
  format: 'daily-day.v1',
  date: '2026-11-01',
  tasks: [
    {
      id: 'task-1',
      title: '整理行程',
      startTime: '09:00',
      endTime: '10:00',
      startMinute: 540,
      endMinute: 600,
      done: false,
      status: 'TODO',
      originTaskId: null,
      rolloverCount: 0,
      note: '共享包测试',
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  memo: '带身份证',
  review: { wins: '完成导出', blockers: '', tomorrow: '导入验证' },
  createdAt: 1,
  updatedAt: 1,
})

async function clearAll(): Promise<void> {
  for (const key of [...Array(localStorage.length).keys()].map((index) => localStorage.key(index))) {
    if (key?.startsWith('knapsack.share.lineage.v1.')) localStorage.removeItem(key)
  }
  await Promise.all([
    db.trips.clear(),
    db.dailyDays.clear(),
    db.table('mod_prompts_items').clear(),
    db.table('mod_prompts_snippets').clear(),
    db.table('mod_prompts_media').clear(),
  ])
}

async function testManifestTopics(): Promise<void> {
  for (const manifest of [tripManifest, promptsManifest, dailyManifest]) {
    check(
      `${manifest.id} 注册导出能力`,
      manifest.providesCapabilities?.[SHAREABLE_PACKAGE_EXPORT_TOPIC] !== undefined,
    )
    check(
      `${manifest.id} 注册导入能力`,
      manifest.providesCapabilities?.[SHAREABLE_PACKAGE_IMPORT_TOPIC] !== undefined,
    )
  }
}

async function testTripRoundTrip(): Promise<void> {
  await clearAll()
  await db.trips.put(trip)
  const emptySelection = await exportTrips({
    sourceModId: 'mod-trip',
    packageType: TRIP_SHARE_PACKAGE_TYPE,
    itemIds: [],
  })
  check('空 itemIds 不触发全量导出', emptySelection.length === 0)
  const packages = await exportTrips({
    sourceModId: 'mod-trip',
    packageType: TRIP_SHARE_PACKAGE_TYPE,
    itemIds: [trip.id],
  })
  check('trip 导出单包', packages.length === 1)
  const sharePackage = packages[0]!
  const payload = sharePackage.payload as TripSharePayload
  check('trip 包包含完整行程', payload.trip.name === trip.name)
  check('trip 包包含分摊明细', payload.settlement.totalExpenseFen === 10001)
  check(
    'trip 分摊债权债务已冻结',
    payload.settlement.debts.length === 1 &&
      payload.settlement.debts[0]?.amountFen === 5000,
  )
  check('trip 作者是本机 HOST', sharePackage.author.role === 'HOST' && sharePackage.author.deviceId.length > 0)
  check('trip 作者昵称为本机用户', sharePackage.author.nickname === '本机用户')
  sharedDeviceId = sharePackage.author.deviceId

  await db.trips.clear()
  const imported = await importTrip({ package: sharePackage, approvedByHost: true })
  const stored = await db.trips.get(trip.id)
  check('trip 验证后落沙箱表', imported.accepted && stored?.name === trip.name)
  check(
    'trip 落库分摊结果与包一致',
    JSON.stringify({ tripId: (stored as Trip).id, ...settleExpenses(stored as Trip) }) ===
      JSON.stringify(payload.settlement),
  )

  const sameRevisionConflict = await signShareablePackage({
    ...withoutDigest(sharePackage),
    payload: {
      ...(sharePackage.payload as TripSharePayload),
      trip: { ...trip, name: '同版本冲突内容' },
    },
  })
  const rejectedConflict = await importTrip({
    package: sameRevisionConflict,
    approvedByHost: true,
  })
  check('同版本异内容拒绝覆盖', !rejectedConflict.accepted)

  const crossPackage = await signShareablePackage({
    ...withoutDigest(sharePackage),
    packageId: 'trip-other-lineage',
    payload: {
      ...(sharePackage.payload as TripSharePayload),
      trip: { ...trip, name: '另一条包链' },
    },
  })
  const rejectedCrossPackage = await importTrip({
    package: crossPackage,
    approvedByHost: true,
  })
  check('不同包链的同主键数据拒绝覆盖', !rejectedCrossPackage.accepted)

  const revised = await exportTrips({
    sourceModId: 'mod-trip',
    packageType: TRIP_SHARE_PACKAGE_TYPE,
    itemIds: [trip.id],
  })
  check(
    'trip 导入后再次导出沿用版本链',
    revised[0]?.packageId === sharePackage.packageId && revised[0]?.revision === 2,
  )

  const importedRevision = await importTrip({
    package: revised[0]!,
    approvedByHost: true,
  })
  const rejectedStale = await importTrip({
    package: sharePackage,
    approvedByHost: true,
  })
  check(
    '高版本已经落地后旧版本拒绝回退',
    importedRevision.accepted && !rejectedStale.accepted,
  )
  for (const key of [...Array(localStorage.length).keys()].map((index) => localStorage.key(index))) {
    if (key?.startsWith('knapsack.share.lineage.v1.')) localStorage.removeItem(key)
  }
  const rejectedWithoutLineage = await importTrip({
    package: sharePackage,
    approvedByHost: true,
  })
  check('版本台账缺失时拒绝覆盖已有同主键记录', !rejectedWithoutLineage.accepted)
}

async function testPromptRoundTrip(): Promise<void> {
  await clearAll()
  for (const item of promptItems) await db.table('mod_prompts_items').put(item)
  await db.table('mod_prompts_snippets').put(promptSnippet)

  const packages = await exportPrompts({
    sourceModId: 'mod-prompts',
    packageType: PROMPT_SHARE_PACKAGE_TYPE,
    itemIds: promptItems.map((item) => item.id),
  })
  check('prompts 导出单包', packages.length === 1)
  const sharePackage = packages[0]!
  const payload = sharePackage.payload as PromptSharePayload
  check('prompts 包完整保留三态', new Set(payload.items.map((item) => item.modality)).size === 3)
  check('prompts 包保留引用词块', payload.snippets.some((item) => item.id === promptSnippet.id))
  check('跨模块复用稳定 deviceId', sharePackage.author.deviceId === sharedDeviceId)

  await db.table('mod_prompts_items').clear()
  await db.table('mod_prompts_snippets').clear()
  const imported = await importPrompt({ package: sharePackage, approvedByHost: true })
  const stored = await db.table<PromptItem>('mod_prompts_items').toArray()
  check('prompts 验证后落沙箱表', imported.accepted && stored.length === 3)
  check(
    'prompts 三态载荷无损',
    stored.some((item) => item.modality === 'WORK_LLM') &&
      stored.some((item) => item.modality === 'IMAGE_GEN') &&
      stored.some((item) => item.modality === 'VIDEO_GEN'),
  )
  const revised = await exportPrompts({
    sourceModId: 'mod-prompts',
    packageType: PROMPT_SHARE_PACKAGE_TYPE,
    itemIds: promptItems.map((item) => item.id),
  })
  check(
    'prompts 导入后再次导出沿用版本链',
    revised[0]?.packageId === sharePackage.packageId && revised[0]?.revision === 2,
  )
  const readOnly = await exportPrompts({
    sourceModId: 'mod-prompts',
    packageType: PROMPT_SHARE_PACKAGE_TYPE,
    itemIds: promptItems.map((item) => item.id),
    permissionMode: 'READ_ONLY',
  })
  check(
    'prompts 导出请求可生成只读包',
    readOnly[0]?.permissionMode === 'READ_ONLY' &&
      readOnly[0]?.packageId === sharePackage.packageId &&
      readOnly[0]?.revision === 3,
  )
  const localCopy = await importPrompt({
    package: readOnly[0]!,
    approvedByHost: true,
    mode: 'LOCAL_COPY',
  })
  const copiedItems = await db.table<PromptItem>('mod_prompts_items').toArray()
  check(
    '提示词只读包生成新 ID 副本',
    localCopy.accepted &&
      copiedItems.length === 6 &&
      copiedItems.filter((item) => promptItems.some((source) => source.id === item.id)).length === 3,
  )

  await clearAll()
  const danglingItem = JSON.parse(JSON.stringify(promptItems[1])) as PromptItem
  danglingItem.id = 'prompt-dangling-snippet'
  if (danglingItem.modality === 'IMAGE_GEN') {
    danglingItem.payload.activeSnippets = [{ snippetId: 'missing-snippet', enabled: true, weight: 1 }]
  }
  const danglingPackage = await signShareablePackage({
    packageId: 'prompts-dangling',
    createdAt: new Date().toISOString(),
    sourceModId: 'mod-prompts',
    packageType: PROMPT_SHARE_PACKAGE_TYPE,
    title: '悬挂词块包',
    releaseNote: '',
    permissionMode: 'COLLABORATIVE',
    revision: 1,
    author: { deviceId: 'device-a', nickname: '团长', role: 'HOST' },
    payload: {
      format: PROMPT_SHARE_FORMAT,
      items: [danglingItem],
      snippets: [],
    } satisfies PromptSharePayload,
  })
  const rejectedDangling = await importPrompt({
    package: danglingPackage,
    approvedByHost: true,
  })
  check(
    '提示词引用缺失词块时拒绝导入',
    !rejectedDangling.accepted &&
      (await db.table<PromptItem>('mod_prompts_items').count()) === 0,
  )
}

async function testDailyRoundTrip(): Promise<void> {
  await clearAll()
  await db.dailyDays.put(daily)
  const packages = await exportDaily({
    sourceModId: 'mod-daily',
    packageType: DAILY_SHARE_PACKAGE_TYPE,
    itemIds: [daily.date],
  })
  check('daily 导出单包', packages.length === 1)
  const sharePackage = packages[0]!
  const payload = sharePackage.payload as DailySharePayload
  check('daily 包包含任务备忘复盘', payload.days[0]?.memo === daily.memo && payload.days[0]?.review.tomorrow === daily.review.tomorrow)
  check('每日包同样使用本机 HOST 身份', sharePackage.author.deviceId === sharedDeviceId && sharePackage.author.role === 'HOST')

  await db.dailyDays.clear()
  const imported = await importDaily({ package: sharePackage, approvedByHost: true })
  const stored = await db.dailyDays.get(daily.date)
  check('daily 验证后落沙箱表', imported.accepted && stored?.tasks.length === 1)
  const revised = await exportDaily({
    sourceModId: 'mod-daily',
    packageType: DAILY_SHARE_PACKAGE_TYPE,
    itemIds: [daily.date],
  })
  check(
    'daily 导入后再次导出沿用版本链',
    revised[0]?.packageId === sharePackage.packageId && revised[0]?.revision === 2,
  )
  const readOnly = await exportDaily({
    sourceModId: 'mod-daily',
    packageType: DAILY_SHARE_PACKAGE_TYPE,
    itemIds: [daily.date],
    permissionMode: 'READ_ONLY',
  })
  const localCopy = await importDaily({
    package: readOnly[0]!,
    approvedByHost: true,
    mode: 'LOCAL_COPY',
  })
  const copiedDays = await db.dailyDays.toArray()
  check(
    '每日计划只读包写入新日期和任务副本',
    localCopy.accepted &&
      copiedDays.length === 2 &&
      copiedDays.some((day) => day.date !== daily.date && day.tasks[0]?.id !== daily.tasks[0]?.id),
  )
}

async function testRejections(): Promise<void> {
  await clearAll()
  await db.trips.put(trip)
  const [source] = await exportTrips({
    sourceModId: 'mod-trip',
    packageType: TRIP_SHARE_PACKAGE_TYPE,
    itemIds: [trip.id],
  })
  const readOnly = await signShareablePackage({
    ...withoutDigest(source!),
    packageId: 'trip-read-only',
    permissionMode: 'READ_ONLY',
    payload: {
      ...(source!.payload as TripSharePayload),
      trip: { ...trip, id: 'trip-read-only', name: '只读行程' },
      settlement: {
        tripId: 'trip-read-only',
        ...settleExpenses({ ...trip, id: 'trip-read-only', name: '只读行程' }),
      },
    },
  })
  const rejectedReadOnly = await importTrip({ package: readOnly, approvedByHost: true })
  check('只读包拒绝写入', !rejectedReadOnly.accepted && !(await db.trips.get('trip-read-only')))
  const localCopy = await importTrip({
    package: readOnly,
    approvedByHost: true,
    mode: 'LOCAL_COPY',
  })
  const copiedTrips = await db.trips.toArray()
  check(
    '旅行只读包生成新行程副本',
    localCopy.accepted && copiedTrips.some((item) => item.id !== 'trip-read-only'),
  )

  const tampered = {
    ...source!,
    payload: {
      ...(source!.payload as TripSharePayload),
      trip: { ...(source!.payload as TripSharePayload).trip, name: '被篡改的行程' },
    },
  } satisfies ShareablePackage
  const rejectedTampered = await importTrip({ package: tampered, approvedByHost: true })
  check('篡改摘要拒绝写入', !rejectedTampered.accepted)

  const invalidPayload = await signShareablePackage({
    ...withoutDigest(source!),
    packageId: 'trip-invalid-schema',
    payload: {
      format: 'trip-share.v1',
      trip: { id: 'trip-invalid-schema' },
      settlement: settleExpenses(trip),
    },
  })
  const rejectedInvalidSchema = await importTrip({
    package: invalidPayload,
    approvedByHost: true,
  })
  check(
    '载荷 schema 不合法拒绝写入',
    !rejectedInvalidSchema.accepted && !(await db.trips.get('trip-invalid-schema')),
  )

  const notApproved = await importTrip({ package: source!, approvedByHost: false })
  check('未获团长批准拒绝写入', !notApproved.accepted)
}

async function main(): Promise<void> {
  await testManifestTopics()
  await testTripRoundTrip()
  await testPromptRoundTrip()
  await testDailyRoundTrip()
  await testRejections()
  await clearAll()

  console.log(failed > 0 ? `\n${failed} 项失败` : '\n全部通过')
  if (failed > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
