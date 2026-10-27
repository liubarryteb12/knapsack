/**
 * Timeline undo/redo stack public interface contract.
 *
 * Run:
 * node --import ./scripts/lib/tsx-preload.mjs --import tsx scripts/test-timeline-undo-stack.ts
 */
import assert from 'node:assert/strict'
import { UndoStack } from '../src/engines/timeline-engine/undo-stack'

function testEmptyStack() {
  const stack = new UndoStack<number>()

  assert.equal(stack.canUndo(), false)
  assert.equal(stack.canRedo(), false)
  assert.equal(stack.undo(0), undefined)
  assert.equal(stack.redo(0), undefined)
}

function testFiftyStepBoundary() {
  const stack = new UndoStack<number>()

  for (let snapshot = 1; snapshot <= 51; snapshot++) {
    stack.push(snapshot)
  }

  let current = 52
  const restored: number[] = []
  while (stack.canUndo()) {
    const previous = stack.undo(current)
    assert.notEqual(previous, undefined)
    current = previous!
    restored.push(current)
  }

  assert.deepEqual(restored, Array.from({ length: 50 }, (_, index) => 51 - index))
  assert.equal(restored.at(-1), 2)
  assert.equal(stack.canUndo(), false)
  assert.equal(stack.canRedo(), true)
}

function testPushClearsRedoBranch() {
  const stack = new UndoStack<number>()
  stack.push(1)
  stack.push(2)

  assert.equal(stack.undo(3), 2)
  assert.equal(stack.canRedo(), true)

  stack.push(10)

  assert.equal(stack.canRedo(), false)
  assert.equal(stack.redo(11), undefined)
  assert.equal(stack.undo(11), 10)
}

function testContinuousUndoRedo() {
  type Snapshot = { revision: number; title: string }

  const stack = new UndoStack<Snapshot>()
  const first = { revision: 1, title: 'first' }
  const second = { revision: 2, title: 'second' }
  const current = { revision: 3, title: 'current' }
  stack.push(first)
  stack.push(second)

  const afterFirstUndo = stack.undo(current)
  assert.deepEqual(afterFirstUndo, second)
  const afterSecondUndo = stack.undo(afterFirstUndo!)
  assert.deepEqual(afterSecondUndo, first)
  assert.equal(stack.canUndo(), false)

  const afterFirstRedo = stack.redo(afterSecondUndo!)
  assert.deepEqual(afterFirstRedo, second)
  const afterSecondRedo = stack.redo(afterFirstRedo!)
  assert.deepEqual(afterSecondRedo, current)
  assert.equal(stack.canRedo(), false)
  assert.equal(stack.canUndo(), true)

  stack.clear()
  assert.equal(stack.canUndo(), false)
  assert.equal(stack.canRedo(), false)
}

testEmptyStack()
testFiftyStepBoundary()
testPushClearsRedoBranch()
testContinuousUndoRedo()

console.log('test-timeline-undo-stack: all checks passed')
