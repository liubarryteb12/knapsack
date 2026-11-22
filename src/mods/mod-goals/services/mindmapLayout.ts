/**
 * 思维导图布局（纯函数，改编自 dsh-mindmap 的 mapLayout）。
 *
 * 两种布局：
 * - right：根在左，所有分支向右生长；
 * - both：一级分支按子树高度贪心分到左右两侧（默认）。
 *
 * 布局只依赖树、折叠集合与文字测量回调，不碰 DOM 状态；每趟遍历都用显式栈，
 * 深树不会爆调用栈。SVG 渲染由组件负责，这里只给出坐标与连线路径。
 */
import type { MindNode } from './mindmapTree'

export const LINE_H = 20
export const ROOT_LINE_H = 24
export const FONT_SIZE = 14
export const ROOT_FONT_SIZE = 17
export const PAD_X = 12
export const PAD_Y = 7
export const MAX_TEXT_W = 260
export const MAX_LINES = 6
export const GAP_X = 56
export const GAP_Y = 12
/** 勾选框占位宽度 */
export const CHECK_W = 18
/** 折叠徽标圆心距节点边缘的距离与半径 */
export const TOGGLE_OFF = 10
export const TOGGLE_R = 8
/** 有徽标的节点，子连线从徽标外侧开始 */
export const STUB = TOGGLE_OFF + TOGGLE_R

export type MindmapMode = 'both' | 'right'
export type Side = -1 | 1
export type Measure = (text: string, bold: boolean, size?: number) => number

export interface MindmapLayoutNode {
  id: string
  text: string
  depth: number
  x: number
  y: number
  w: number
  h: number
  /** 换行后的显示文本 */
  lines: string[]
  /** 完整纯文本（tooltip） */
  full: string
  clipped: boolean
  parent: string | null
  /** 可见子节点 id */
  kids: string[]
  hasKids: boolean
  collapsed: boolean
  /** 折叠时被隐藏的后代数量 */
  hidden: number
  checked: boolean | null
  /** -1 = 根左侧，1 = 根右侧（根自身为 1） */
  side: Side
  /** 一级分支序号，用于配色 */
  branch: number
  fs: number
  lh: number
}

export interface MindmapLayout {
  nodes: MindmapLayoutNode[]
  byId: Map<string, MindmapLayoutNode>
  width: number
  height: number
  mode: MindmapMode
}

export interface LayoutOptions {
  mode?: MindmapMode
  /** 折叠的节点 id（仅视图态，不改数据） */
  collapsed?: ReadonlySet<string>
}

const TOKEN_RE = /[⺀-鿿가-힯＀-￯]|[^\s⺀-鿿가-힯＀-￯]+|\s+/g

/** 按 MAX_TEXT_W 折行。 */
export function wrap(text: string, measure: Measure, bold: boolean, size = FONT_SIZE): string[] {
  const out: string[] = []
  const m = (s: string): number => measure(s, bold, size)
  for (const para of text.split('\n')) {
    if (m(para) <= MAX_TEXT_W) {
      out.push(para)
      continue
    }
    let line = ''
    for (let token of para.match(TOKEN_RE) ?? []) {
      if (line.length > 0 && m(line + token) > MAX_TEXT_W) {
        out.push(line.trimEnd())
        line = ''
        token = token.trimStart()
      }
      if (m(line + token) <= MAX_TEXT_W) {
        line += token
        continue
      }
      // 超长无空格 token（URL 等）按字符切
      for (const ch of token) {
        if (m(line + ch) > MAX_TEXT_W && line.length > 0) {
          out.push(line)
          line = ''
        }
        line += ch
      }
    }
    out.push(line)
  }
  return out.length === 0 ? [''] : out
}

/** 最多保留 max 行，末行加省略号（tooltip 仍显示全文）。 */
export function ellipsize(
  lines: string[],
  measure: Measure,
  bold: boolean,
  size = FONT_SIZE,
  max = MAX_LINES,
): { lines: string[]; clipped: boolean } {
  if (lines.length <= max) return { lines, clipped: false }
  const kept = lines.slice(0, max)
  const chars = Array.from(kept[max - 1]!.trimEnd())
  while (chars.length > 0 && measure(chars.join('') + '…', bold, size) > MAX_TEXT_W) chars.pop()
  kept[max - 1] = chars.join('') + '…'
  return { lines: kept, clipped: true }
}

function countDescendants(node: MindNode): number {
  let count = 0
  const stack = [...node.children]
  while (stack.length > 0) {
    const child = stack.pop()!
    count++
    for (const grand of child.children) stack.push(grand)
  }
  return count
}

/** 计算整棵树的布局。 */
export function layoutMindmap(
  tree: MindNode,
  measure: Measure,
  options: LayoutOptions = {},
): MindmapLayout {
  const mode: MindmapMode = options.mode ?? 'both'
  const collapsedSet = options.collapsed ?? null
  const nodes: MindmapLayoutNode[] = []
  const byId = new Map<string, MindmapLayoutNode>()
  const kidIdx: number[][] = []
  const parentIdx: number[] = []

  // 1. 先序建节点（显式栈）：父节点索引一定小于子节点
  const stack: Array<{ node: MindNode; depth: number; parent: number }> = [
    { node: tree, depth: 0, parent: -1 },
  ]
  while (stack.length > 0) {
    const item = stack.pop()!
    if (byId.has(item.node.id)) continue
    const isRoot = item.depth === 0
    const fs = isRoot ? ROOT_FONT_SIZE : FONT_SIZE
    const lh = isRoot ? ROOT_LINE_H : LINE_H
    const label = item.node.text.length > 0 ? item.node.text : ' '
    const wrapped = ellipsize(wrap(label, measure, isRoot, fs), measure, isRoot, fs)
    const checked =
      !isRoot && typeof item.node.checked === 'boolean' ? item.node.checked : null
    let textW = 24
    for (const line of wrapped.lines) textW = Math.max(textW, measure(line, isRoot, fs))
    const w = Math.ceil(textW) + PAD_X * 2 + (checked !== null ? CHECK_W : 0)
    const h = wrapped.lines.length * lh + PAD_Y * 2
    const collapsed =
      !isRoot && item.node.children.length > 0 && collapsedSet !== null && collapsedSet.has(item.node.id)
    const index = nodes.length
    const node: MindmapLayoutNode = {
      id: item.node.id,
      text: item.node.text,
      depth: item.depth,
      x: 0,
      y: 0,
      w,
      h,
      lines: wrapped.lines,
      full: item.node.text,
      clipped: wrapped.clipped,
      parent: item.parent >= 0 ? nodes[item.parent]!.id : null,
      kids: [],
      hasKids: item.node.children.length > 0,
      collapsed,
      hidden: 0,
      checked,
      side: 1,
      branch: -1,
      fs,
      lh,
    }
    nodes.push(node)
    byId.set(node.id, node)
    kidIdx.push([])
    parentIdx.push(item.parent)
    if (item.parent >= 0) {
      kidIdx[item.parent]!.push(index)
      nodes[item.parent]!.kids.push(node.id)
    }
    if (collapsed) node.hidden = countDescendants(item.node)
    else {
      for (let i = item.node.children.length - 1; i >= 0; i--) {
        const child = item.node.children[i]!
        if (!byId.has(child.id)) stack.push({ node: child, depth: item.depth + 1, parent: index })
      }
    }
  }

  const total = nodes.length
  if (total === 0) return { nodes, byId, width: 0, height: 0, mode }

  // 2. 自底向上算子树跨度（后序 = 逆索引）
  const span = new Float64Array(total)
  const relTop = new Float64Array(total)
  const offsets: number[][] = new Array<number[]>(total)
  const block = (kids: number[]): { o: number[]; K: number; c: number } => {
    const o: number[] = []
    let cursor = 0
    for (const j of kids) {
      o.push(cursor)
      cursor += span[j]! + GAP_Y
    }
    if (kids.length === 0) return { o, K: 0, c: 0 }
    const first = kids[0]!
    const last = kids[kids.length - 1]!
    const cf = o[0]! + relTop[first]! + nodes[first]!.h / 2
    const cl = o[o.length - 1]! + relTop[last]! + nodes[last]!.h / 2
    return { o, K: cursor - GAP_Y, c: (cf + cl) / 2 }
  }
  for (let i = total - 1; i >= 0; i--) {
    if (i === 0 && mode === 'both') continue
    const kids = kidIdx[i]!
    const h = nodes[i]!.h
    if (kids.length === 0) {
      span[i] = h
      relTop[i] = 0
      offsets[i] = []
      continue
    }
    const b = block(kids)
    let top = b.c - h / 2
    let shift = 0
    if (top < 0) {
      shift = -top
      top = 0
    }
    offsets[i] = shift === 0 ? b.o : b.o.map((v) => v + shift)
    relTop[i] = top
    span[i] = Math.max(top + h, shift + b.K)
  }

  // 3. 自顶向下定位（先序 = 索引序）
  const subTop = new Float64Array(total)
  const root = nodes[0]!
  const rootKids = kidIdx[0]!
  rootKids.forEach((j, i) => {
    nodes[j]!.branch = i
  })
  if (mode === 'both') {
    // 按子树高度从大到小贪心分到较轻的一侧；每侧保持文档顺序
    const order = rootKids.slice().sort((a, b) => span[b]! - span[a]!)
    let rightHeight = 0
    let leftHeight = 0
    for (const j of order) {
      if (rightHeight <= leftHeight) {
        nodes[j]!.side = 1
        rightHeight += span[j]! + GAP_Y
      } else {
        nodes[j]!.side = -1
        leftHeight += span[j]! + GAP_Y
      }
    }
    for (const side of [1, -1] as const) {
      const kids = rootKids.filter((j) => nodes[j]!.side === side)
      if (kids.length === 0) continue
      const b = block(kids)
      kids.forEach((j, i) => {
        subTop[j] = b.o[i]! - b.c
      })
    }
    root.y = -root.h / 2
  } else {
    root.y = relTop[0]!
    const o = offsets[0]!
    rootKids.forEach((j, i) => {
      subTop[j] = o[i]!
    })
  }
  for (let i = 1; i < total; i++) {
    const node = nodes[i]!
    const parent = nodes[parentIdx[i]!]!
    if (node.depth > 1) {
      node.side = parent.side
      node.branch = parent.branch
    } else if (mode === 'right') node.side = 1
    node.y = subTop[i]! + relTop[i]!
    node.x = node.side > 0 ? parent.x + parent.w + GAP_X : parent.x - GAP_X - node.w
    const kids = kidIdx[i]!
    const o = offsets[i]!
    for (let j = 0; j < kids.length; j++) subTop[kids[j]!] = subTop[i]! + o[j]!
  }

  // 4. 归一化到 (0,0) 原点，把折叠徽标也算进包围盒
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    let x0 = node.x
    let x1 = node.x + node.w
    if (node.depth > 0 && node.hasKids) {
      if (node.side > 0) x1 += STUB
      else x0 -= STUB
    }
    if (x0 < minX) minX = x0
    if (x1 > maxX) maxX = x1
    if (node.y < minY) minY = node.y
    if (node.y + node.h > maxY) maxY = node.y + node.h
  }
  for (const node of nodes) {
    node.x -= minX
    node.y -= minY
  }
  return { nodes, byId, width: maxX - minX, height: maxY - minY, mode }
}

/** 节点在 `side` 一侧与子节点连线的边缘 x。 */
function borderX(node: MindmapLayoutNode, side: Side): number {
  return side > 0 ? node.x + node.w : node.x
}

/** 细连线（三次贝塞尔），从父节点徽标外侧出发。 */
export function edgePath(parent: MindmapLayoutNode, child: MindmapLayoutNode): string {
  const side = child.side
  const y1 = parent.y + parent.h / 2
  const y2 = child.y + child.h / 2
  const xb = borderX(parent, side)
  const x1 = parent.depth > 0 ? xb + side * STUB : xb
  const x2 = side > 0 ? child.x : child.x + child.w
  const mx = (x1 + x2) / 2
  return (
    (x1 !== xb ? `M${xb},${y1} H${x1}` : `M${x1},${y1}`) +
    ` C${mx},${y1} ${mx},${y2} ${x2},${y2}`
  )
}

/** 根 → 一级分支的锥形连线：根部宽、子端窄。 */
export function taperPath(
  parent: MindmapLayoutNode,
  child: MindmapLayoutNode,
  w0 = 4,
  w1 = 1,
): string {
  const side = child.side
  const x1 = borderX(parent, side) - side * 2
  const y1 = parent.y + parent.h / 2
  const x2 = side > 0 ? child.x : child.x + child.w
  const y2 = child.y + child.h / 2
  const mx = (x1 + x2) / 2
  const f = (v: number): string => String(Math.round(v * 100) / 100)
  return (
    `M${f(x1)},${f(y1 - w0)} C${f(mx)},${f(y1 - w0)} ${f(mx)},${f(y2 - w1)} ${f(x2)},${f(y2 - w1)}` +
    ` L${f(x2)},${f(y2 + w1)} C${f(mx)},${f(y2 + w1)} ${f(mx)},${f(y1 + w0)} ${f(x1)},${f(y1 + w0)} Z`
  )
}

/** 一级分支用锥形，其余用细线。 */
export function edgeFor(parent: MindmapLayoutNode, child: MindmapLayoutNode): string {
  return child.depth === 1 ? taperPath(parent, child) : edgePath(parent, child)
}

export function togglePos(node: MindmapLayoutNode): { cx: number; cy: number } {
  return {
    cx: node.side > 0 ? node.x + node.w + TOGGLE_OFF : node.x - TOGGLE_OFF,
    cy: node.y + node.h / 2,
  }
}

export function checkPos(node: MindmapLayoutNode): { x: number; y: number } {
  return { x: node.x + PAD_X, y: node.y + PAD_Y + node.lh / 2 - 6 }
}

export function textPos(node: MindmapLayoutNode, lineIndex: number): { x: number; y: number } {
  return {
    x: node.x + PAD_X + (node.checked !== null ? CHECK_W : 0),
    y: node.y + PAD_Y + node.lh * lineIndex + node.lh / 2,
  }
}

export function tickPath(x: number, y: number): string {
  return `M${x + 2.5},${y + 6.2} L${x + 5},${y + 8.7} L${x + 9.5},${y + 3.5}`
}

// ---------- 配色 ----------

export const BRANCH_LIGHT = [
  '#3964fe',
  '#f08c00',
  '#0ca678',
  '#e64980',
  '#7048e8',
  '#1098ad',
  '#e03131',
  '#66a80f',
] as const

export const BRANCH_DARK = [
  '#7b9bff',
  '#ffc078',
  '#38d9a9',
  '#f783ac',
  '#9775fa',
  '#3bc9db',
  '#ff8787',
  '#a9e34b',
] as const

export function branchColor(branch: number, dark: boolean): string {
  const palette = dark ? BRANCH_DARK : BRANCH_LIGHT
  return palette[((branch % palette.length) + palette.length) % palette.length]!
}

/** #rrggbb + alpha → rgba() */
export function rgba(hex: string, alpha: number): string {
  const value = parseInt(hex.slice(1), 16)
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`
}

// ---------- SVG 导出 ----------

export interface MindmapColors {
  text: string
  sub: string
  card: string
  bg: string
  accent: string
  dark: boolean
  font: string
}

const escapeXml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const EXPORT_PAD = 24

/**
 * 把布局序列化为自包含 SVG（颜色全部内联，不依赖 CSS 变量），
 * 供「导出 SVG」与预览脚本共用。
 */
export function mindmapToSvg(
  layout: MindmapLayout,
  colors: MindmapColors,
): { svg: string; width: number; height: number } {
  const width = Math.ceil(layout.width + EXPORT_PAD * 2)
  const height = Math.ceil(layout.height + EXPORT_PAD * 2)
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${escapeXml(colors.font)}" font-size="14">`,
    `<rect width="100%" height="100%" fill="${escapeXml(colors.bg)}"/>`,
    `<g transform="translate(${EXPORT_PAD},${EXPORT_PAD})">`,
  ]

  for (const node of layout.nodes) {
    if (!node.parent) continue
    const parent = layout.byId.get(node.parent)
    if (!parent) continue
    const color = branchColor(node.branch, colors.dark)
    if (node.depth === 1) parts.push(`<path d="${taperPath(parent, node)}" fill="${color}"/>`)
    else
      parts.push(
        `<path d="${edgePath(parent, node)}" fill="none" stroke="${color}" stroke-width="1.5"/>`,
      )
  }

  for (const node of layout.nodes) {
    const root = node.depth === 0
    const color = root ? colors.accent : branchColor(node.branch, colors.dark)
    const fill = root
      ? colors.accent
      : node.depth === 1
        ? rgba(color, colors.dark ? 0.2 : 0.1)
        : colors.card
    const textFill = root ? '#ffffff' : node.checked === true ? colors.sub : colors.text
    parts.push('<g>')
    parts.push(`<title>${escapeXml(node.full)}</title>`)
    parts.push(
      `<rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="${root ? 8 : 6}" fill="${fill}"` +
        (root
          ? ' stroke="none"'
          : ` stroke="${color}" stroke-width="${node.depth === 1 ? 1.5 : 1}" stroke-opacity="${node.depth === 1 ? 1 : 0.55}"`) +
        '/>',
    )
    if (node.checked !== null) {
      const box = checkPos(node)
      if (node.checked) {
        parts.push(
          `<rect x="${box.x}" y="${box.y}" width="12" height="12" rx="3" fill="${color}"/>`,
          `<path d="${tickPath(box.x, box.y)}" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
        )
      } else {
        parts.push(
          `<rect x="${box.x + 0.5}" y="${box.y + 0.5}" width="11" height="11" rx="3" fill="none" stroke="${colors.sub}"/>`,
        )
      }
    }
    node.lines.forEach((line, index) => {
      const pos = textPos(node, index)
      parts.push(
        `<text x="${pos.x}" y="${pos.y}" font-size="${node.fs}" dominant-baseline="central" fill="${textFill}"` +
          (root ? ' font-weight="600"' : '') +
          (node.checked === true ? ' text-decoration="line-through"' : '') +
          ` xml:space="preserve">${escapeXml(line)}</text>`,
      )
    })
    if (node.collapsed) {
      const badge = togglePos(node)
      parts.push(
        `<circle cx="${badge.cx}" cy="${badge.cy}" r="${TOGGLE_R}" fill="${colors.card}" stroke="${color}"/>`,
        `<text x="${badge.cx}" y="${badge.cy}" font-size="10" text-anchor="middle" dominant-baseline="central" fill="${colors.sub}">${node.hidden > 99 ? '99+' : node.hidden}</text>`,
      )
    }
    parts.push('</g>')
  }

  parts.push('</g></svg>')
  return { svg: parts.join(''), width, height }
}

// ---------- PNG 光栅化 ----------

export const MAX_CANVAS_SIDE = 16384
export const MAX_CANVAS_AREA = 120_000_000

/** 在给定缩放下是否还在浏览器 canvas 限制内。 */
export function pngFits(width: number, height: number, scale = 2): boolean {
  const W = Math.ceil(width * scale)
  const H = Math.ceil(height * scale)
  return W <= MAX_CANVAS_SIDE && H <= MAX_CANVAS_SIDE && W * H <= MAX_CANVAS_AREA
}

export class MindmapTooLargeError extends Error {
  readonly width: number
  readonly height: number
  constructor(width: number, height: number) {
    super(`导图过大（${width}×${height}），无法导出 PNG，请改用 SVG`)
    this.name = 'MindmapTooLargeError'
    this.width = width
    this.height = height
  }
}

/** 把 SVG 字符串栅格化为 PNG Blob；超出画布上限时抛 MindmapTooLargeError。 */
export async function svgToPngBlob(
  svg: string,
  width: number,
  height: number,
  scale = 2,
): Promise<Blob> {
  if (!pngFits(width, height, scale)) {
    throw new MindmapTooLargeError(Math.ceil(width * scale), Math.ceil(height * scale))
  }
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('图片渲染失败'))
      image.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil(width * scale))
    canvas.height = Math.max(1, Math.ceil(height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建画布')
    ctx.scale(scale, scale)
    ctx.drawImage(image, 0, 0, width, height)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('PNG 编码失败'))),
        'image/png',
      ),
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}
