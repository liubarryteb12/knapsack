/**
 * v4 单向依赖门禁。
 *
 * 运行：npm run audit:modules
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const srcRoot = path.join(root, 'src')
const failures: string[] = []
const warnings: string[] = []

function walk(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name)
    const stat = statSync(full)
    if (stat.isDirectory()) return walk(full)
    return /\.(ts|vue)$/.test(name) ? [full] : []
  })
}

function importSpecifiers(file: string): string[] {
  let text = readFileSync(file, 'utf8')
  if (file.endsWith('.vue')) {
    const script = text.match(/<script[^>]*>([\s\S]*?)<\/script>/)
    text = script?.[1] ?? ''
  }
  const matches = [
    ...text.matchAll(/(?:import|export)\s+(?:type\s+)?[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/g),
    ...text.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
  ]
  return matches.map((match) => match[1]!).filter((specifier) => specifier.startsWith('.'))
}

function resolveImport(file: string, specifier: string): string {
  return path.resolve(path.dirname(file), specifier).replaceAll('\\', '/')
}

function moduleOf(file: string): string | null {
  const normalized = file.replaceAll('\\', '/')
  return normalized.match(/\/src\/mods\/(mod-[^/]+)\//)?.[1] ?? null
}

function relative(file: string): string {
  return path.relative(root, file).replaceAll('\\', '/')
}

const files = walk(srcRoot)
const hostFiles = files.filter((file) => {
  const rel = relative(file)
  return rel.startsWith('src/core/') || rel.startsWith('src/engines/')
})

for (const file of hostFiles) {
  const rel = relative(file)
  for (const specifier of importSpecifiers(file)) {
    const resolved = resolveImport(file, specifier)
    if (!resolved.includes('/src/mods/')) continue
    const isGeneratedModuleEntry = rel === 'src/core/bootMods.ts' &&
      resolved.endsWith('/src/mods/manifest-index')
    if (!isGeneratedModuleEntry) {
      failures.push(`${rel} 直接导入业务模块：${specifier}`)
    }
  }
}

const moduleFiles = files.filter((file) => moduleOf(file) !== null)
for (const file of moduleFiles) {
  const owner = moduleOf(file)!
  const rel = relative(file)
  for (const specifier of importSpecifiers(file)) {
    const resolved = resolveImport(file, specifier)
    const targetModule = moduleOf(resolved)
    if (targetModule && targetModule !== owner) {
      failures.push(`${rel} 横向导入兄弟模块 ${targetModule}：${specifier}`)
    }
    if (
      owner === 'mod-trip' &&
      /\/src\/(schema\/trip|utils\/(settle|tripFile|aiDraft|weather)|stores\/trips|views\/Trip|views\/Trips|components\/(icons|itemMeta|QrScanner|BudgetTab|NotesTab|PackingTab|TimelineTab|WeatherStrip|AiDraftModal|LanSessionModal))/.test(resolved)
    ) {
      warnings.push(`${rel} 仍依赖旅行 facade：${specifier}`)
    }
  }
}

const generatedIndex = path.join(srcRoot, 'mods', 'manifest-index.ts')
if (!existsSync(generatedIndex)) failures.push('缺少 src/mods/manifest-index.ts')
else if (!readFileSync(generatedIndex, 'utf8').includes('AUTO-GENERATED')) {
  failures.push('src/mods/manifest-index.ts 不是自动生成文件')
}

console.log(`host_files=${hostFiles.length}`)
console.log(`module_files=${moduleFiles.length}`)
for (const warning of warnings) console.log(`WARN ${warning}`)
for (const failure of failures) console.error(`FAIL ${failure}`)
console.log(failures.length === 0 ? '模块边界审计通过' : `模块边界审计失败：${failures.length} 项`)
if (failures.length > 0) process.exit(1)
