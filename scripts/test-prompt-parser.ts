/**
 * mod-prompts 模板变量解析与渲染契约。
 *
 * 运行：node --import ./scripts/lib/tsx-preload.mjs --import tsx scripts/test-prompt-parser.ts
 */
import { isDeepStrictEqual } from 'node:util'
import {
  parseTemplateVariables,
  renderTemplate,
} from '../src/mods/mod-prompts/domain/templateParser'

let failed = 0

function exact(name: string, actual: unknown, expected: unknown) {
  if (isDeepStrictEqual(actual, expected)) {
    console.log(`  ok  ${name}`)
    return
  }

  failed++
  console.error(`FAIL  ${name}`)
  console.error(`  expected: ${JSON.stringify(expected)}`)
  console.error(`  actual:   ${JSON.stringify(actual)}`)
}

function main() {
  exact(
    '解析基础、默认值和枚举选项',
    parseTemplateVariables(
      '你好，{{ 主题 }}！请用 {{语气:严谨专业}} 写一篇关于 {{语言:中文|English|日本語}} 的说明。',
    ),
    {
      variables: [
        { name: '主题' },
        { name: '语气', defaultValue: '严谨专业' },
        { name: '语言', options: ['中文', 'English', '日本語'] },
      ],
      conflicts: [],
    },
  )

  exact(
    '同名变量按首次出现顺序合并且不重复',
    parseTemplateVariables(
      '{{主题}} / {{主题:周报}} / {{主题:周报}} / {{语气:A|B}} / {{语气:A|B}}',
    ),
    {
      variables: [
        { name: '主题', defaultValue: '周报' },
        { name: '语气', options: ['A', 'B'] },
      ],
      conflicts: [],
    },
  )

  exact(
    '同名默认值与选项定义冲突返回变体',
    parseTemplateVariables(
      '{{语气:严谨}} {{语气:幽默}} {{格式:A|B}} {{格式:A|C}} {{模式:简短}} {{模式:快速|详尽}}',
    ),
    {
      variables: [
        { name: '语气', defaultValue: '严谨' },
        { name: '格式', options: ['A', 'B'] },
        { name: '模式', defaultValue: '简短' },
      ],
      conflicts: [
        {
          name: '语气',
          variants: [{ defaultValue: '严谨' }, { defaultValue: '幽默' }],
        },
        {
          name: '格式',
          variants: [{ options: ['A', 'B'] }, { options: ['A', 'C'] }],
        },
        {
          name: '模式',
          variants: [{ defaultValue: '简短' }, { options: ['快速', '详尽'] }],
        },
      ],
    },
  )

  exact(
    '默认值可包含嵌套大括号和冒号',
    parseTemplateVariables('{{片段:外层 { 内层: A|B } 尾部}}'),
    {
      variables: [{ name: '片段', defaultValue: '外层 { 内层: A|B } 尾部' }],
      conflicts: [],
    },
  )

  exact(
    '特殊字符、中英和 Emoji 原样保留',
    parseTemplateVariables(
      '{{代码风格:C++ & C# / (functional: on) "safe" <ok> [核心]}} {{情绪😊:开心😄|平静🙂|English & 中文}}',
    ),
    {
      variables: [
        {
          name: '代码风格',
          defaultValue: 'C++ & C# / (functional: on) "safe" <ok> [核心]',
        },
        { name: '情绪😊', options: ['开心😄', '平静🙂', 'English & 中文'] },
      ],
      conflicts: [],
    },
  )

  exact(
    '选项两侧空白会被规范化',
    parseTemplateVariables('{{语言: 中文 | English | 日本語 }}'),
    {
      variables: [{ name: '语言', options: ['中文', 'English', '日本語'] }],
      conflicts: [],
    },
  )

  exact(
    '未闭合占位符保持普通文本',
    parseTemplateVariables('前 {{主题:周报 后'),
    {
      variables: [],
      conflicts: [],
    },
  )

  exact(
    '渲染填充值、默认值并保留未填枚举原文',
    renderTemplate(
      '给 {{主题}}：{{语气:友好}}。目标读者：{{受众}}。语言：{{语言:中文|English}}。备注 {{主题}}。',
      { 主题: '季度复盘' },
    ),
    {
      text: '给 季度复盘：友好。目标读者：{{受众}}。语言：{{语言:中文|English}}。备注 季度复盘。',
      missingVariables: ['受众', '语言'],
    },
  )

  exact(
    '多个同名缺失变量去重且保留各自原始占位符',
    renderTemplate('{{主题}} / {{ 主题 }} / {{语言:中文|English}} / {{语言:中文|English}}'),
    {
      text: '{{主题}} / {{ 主题 }} / {{语言:中文|English}} / {{语言:中文|English}}',
      missingVariables: ['主题', '语言'],
    },
  )

  exact(
    '空字符串视为未填并回退默认值',
    renderTemplate('{{语气:严谨}} {{主题}}', {
      语气: '',
      主题: 'AI & Emoji 😊',
    }),
    {
      text: '严谨 AI & Emoji 😊',
      missingVariables: [],
    },
  )

  exact(
    '填充值中的替换控制字符按字面量输出',
    renderTemplate('主题：{{主题}}', { 主题: '价格 $& $1 100%' }),
    {
      text: '主题：价格 $& $1 100%',
      missingVariables: [],
    },
  )

  if (failed > 0) {
    console.error(`\n${failed} 项失败`)
    process.exitCode = 1
    return
  }

  console.log('\n全部通过')
}

main()
