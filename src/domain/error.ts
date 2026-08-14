export type TaskboardErrorCode =
  | 'TASK_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'TASK_STALE_VERSION'
  | 'TASK_INVALID_TRANSITION'
  | 'TASK_DEPENDENCY_INCOMPLETE'
  | 'TASK_ALREADY_CLAIMED'
  | 'TASK_FOREIGN_CLAIM'
  | 'TASK_ARCHIVED'
  | 'TASK_HUMAN_AUTHORITY_REQUIRED'
  | 'TASK_INVALID_INPUT'
  | 'TASK_RELATION_INVALID'
  | 'TASK_PARENT_CYCLE'
  | 'TASK_ACTIVE_CLAIM'
  | 'TASK_DEVELOPMENT_CONTEXT_BUSY'
  | 'TASK_NOT_ARCHIVED'
  | 'PROJECT_NOT_EMPTY'
  | 'STORAGE_SCHEMA_UNSUPPORTED'
  | 'ATTACHMENT_NOT_FOUND'
  | 'ATTACHMENT_TYPE_NOT_ALLOWED'
  | 'ATTACHMENT_SIZE_EXCEEDED'
  | 'ATTACHMENT_STORAGE_FAILURE'

/** Stable domain error returned across CLI, tool, and RPC boundaries. */
export class TaskboardError extends Error {
  constructor(message: string, readonly code: TaskboardErrorCode, readonly details?: Readonly<Record<string, unknown>>) {
    super(message)
    this.name = 'TaskboardError'
  }
}
