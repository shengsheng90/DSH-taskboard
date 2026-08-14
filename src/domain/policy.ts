import { TaskboardError } from './error.js'
import type { TaskStatus, TaskboardActor } from './types.js'

const HUMAN_ONLY = new Set(['approve', 'return', 'accept', 'resume', 'cancel', 'reopen', 'archive', 'restore', 'delete', 'force-reclaim'])

/** Assert that an operation carries direct human authority. */
export function requireHuman(actor: TaskboardActor, operation: string): asserts actor is Extract<TaskboardActor, { kind: 'human' }> {
  if (actor.kind !== 'human') {
    throw new TaskboardError(`${operation} requires human authority`, 'TASK_HUMAN_AUTHORITY_REQUIRED', { operation })
  }
}

/** Validate a source status for one intent-specific transition. */
export function requireStatus(current: TaskStatus, allowed: readonly TaskStatus[], operation: string): void {
  if (!allowed.includes(current)) {
    throw new TaskboardError(
      `${operation} cannot move a task from ${current}`,
      'TASK_INVALID_TRANSITION',
      { operation, current, allowed },
    )
  }
}

/** Return whether an operation is reserved for humans. */
export function isHumanOnlyOperation(operation: string): boolean {
  return HUMAN_ONLY.has(operation)
}
