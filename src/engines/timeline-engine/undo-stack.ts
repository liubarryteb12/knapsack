const MAX_UNDO_STEPS = 50

/**
 * Snapshot history with a fixed 50-step undo window.
 *
 * Callers pass their current snapshot to undo or redo so the stack does not
 * need to own external application state.
 */
export class UndoStack<T> {
  private readonly undoSnapshots: T[] = []
  private readonly redoSnapshots: T[] = []

  canUndo(): boolean {
    return this.undoSnapshots.length > 0
  }

  canRedo(): boolean {
    return this.redoSnapshots.length > 0
  }

  push(snapshot: T): void {
    this.undoSnapshots.push(snapshot)
    if (this.undoSnapshots.length > MAX_UNDO_STEPS) {
      this.undoSnapshots.shift()
    }
    this.redoSnapshots.length = 0
  }

  undo(current: T): T | undefined {
    if (this.undoSnapshots.length === 0) return undefined

    const previous = this.undoSnapshots.pop()!
    this.redoSnapshots.push(current)
    return previous
  }

  redo(current: T): T | undefined {
    if (this.redoSnapshots.length === 0) return undefined

    const next = this.redoSnapshots.pop()!
    this.undoSnapshots.push(current)
    if (this.undoSnapshots.length > MAX_UNDO_STEPS) {
      this.undoSnapshots.shift()
    }
    return next
  }

  clear(): void {
    this.undoSnapshots.length = 0
    this.redoSnapshots.length = 0
  }
}
