/**
 * 全平台共享数据包契约。
 *
 * 运行：node --import ./scripts/lib/tsx-preload.mjs --import tsx scripts/test-shareable-package.ts
 */
import {
  parseShareablePackage,
  shareablePackageSchema,
} from '../src/core/types/shareable-package.schema'

let failed = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

const fixture = {
  protocolVersion: '1.0',
  packageId: 'pkg-001',
  createdAt: '2026-10-27T10:00:00+08:00',
  sourceModId: 'mod-prompts',
  packageType: 'PROMPT_COLLECTION',
  title: '三张架构提示词',
  releaseNote: '可直接导入',
  permissionMode: 'READ_ONLY',
  revision: 1,
  author: {
    deviceId: 'device-a',
    nickname: '测试用户',
    role: 'HOST',
  },
  payload: {
    items: [
      { id: 'p1', title: '架构评审' },
      { id: 'p2', title: '故障定位' },
    ],
  },
  digest: 'a'.repeat(64),
}

function main() {
  check('合法共享包可解析', parseShareablePackage(fixture).payload !== null)
  check('释放说明默认值可补全', shareablePackageSchema.parse({ ...fixture, releaseNote: undefined }).releaseNote === '')
  check('非法模块 ID 被拒', !shareablePackageSchema.safeParse({ ...fixture, sourceModId: 'prompts' }).success)
  check('非法权限模式被拒', !shareablePackageSchema.safeParse({ ...fixture, permissionMode: 'PUBLIC' }).success)
  check('非 JSON payload 被拒', !shareablePackageSchema.safeParse({ ...fixture, payload: new Date() }).success)
  check('循环 payload 被拒', (() => {
    const loop: Record<string, unknown> = {}
    loop.self = loop
    return !shareablePackageSchema.safeParse({ ...fixture, payload: loop }).success
  })())
  check('对象可选字段 undefined 按 JSON 语义省略', (() => {
    const parsed = shareablePackageSchema.safeParse({
      ...fixture,
      payload: {
        title: '含可选字段的提示词',
        optionalText: undefined,
        nested: { optionalNumber: undefined, required: 1 },
        list: [undefined, '保留'],
      },
    })
    return (
      parsed.success &&
      !('optionalText' in (parsed.data.payload as Record<string, unknown>)) &&
      JSON.stringify(parsed.data.payload) ===
        JSON.stringify({
          title: '含可选字段的提示词',
          nested: { required: 1 },
          list: [null, '保留'],
        })
    )
  })())
  check('函数与 Symbol 即使位于对象字段也被拒', (() => {
    const withSymbol = {
      ...fixture,
      payload: {
        callback: () => undefined,
        token: Symbol('token'),
      },
    }
    return !shareablePackageSchema.safeParse(withSymbol).success
  })())
  check('摘要必须是 64 位小写十六进制', !shareablePackageSchema.safeParse({ ...fixture, digest: 'ABC' }).success)

  console.log(failed > 0 ? `\n${failed} 项失败` : '\n全部通过')
  if (failed > 0) process.exit(1)
}

main()
