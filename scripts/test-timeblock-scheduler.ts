/**
 * 单日分钟轴时间块冲突检测。
 *
 * 运行：node --import ./scripts/lib/tsx-preload.mjs --import tsx scripts/test-timeblock-scheduler.ts
 */
import {
  findTimeBlockConflicts,
  sortTimeBlocks,
  type TimeBlock,
} from '../src/engines/timeline-engine/timeblock-scheduler'

let failed = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failed++
    console.error(`FAIL  ${name}`)
  }
}

const blocks: TimeBlock[] = [
  { id: 'late', startMinute: 1410, endMinute: 1530 },
  { id: 'work', startMinute: 540, endMinute: 720 },
  { id: 'overlap', startMinute: 690, endMinute: 780 },
  { id: 'touch', startMinute: 720, endMinute: 750 },
]

const sorted = sortTimeBlocks(blocks)
check('时间块按开始分钟排序', sorted.map((block) => block.id).join(',') === 'work,overlap,touch,late')

const conflicts = findTimeBlockConflicts(blocks)
check('检测真实重叠', conflicts.some((item) => item.leftId === 'work' && item.rightId === 'overlap'))
check('端点相接不算冲突', !conflicts.some((item) => item.leftId === 'work' && item.rightId === 'touch'))
check('跨零点时间块不误报', !conflicts.some((item) => item.leftId === 'late'))
check('冲突包含重叠区间', conflicts[0]?.overlapStart === 690 && conflicts[0]?.overlapEnd === 720)

let rejected = false
try {
  findTimeBlockConflicts([{ id: 'bad', startMinute: 100, endMinute: 90 }])
} catch {
  rejected = true
}
check('结束不晚于开始被拒', rejected)

let tooLate = false
try {
  findTimeBlockConflicts([{ id: 'bad', startMinute: 1500, endMinute: 1630 }])
} catch {
  tooLate = true
}
check('超过次日 03:00 被拒', tooLate)

console.log(failed > 0 ? `\n${failed} 项失败` : '\n全部通过')
if (failed > 0) process.exit(1)
