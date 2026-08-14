/** A string branded for a single durable identity domain. */
export type Branded<T, Brand extends string> = T & { readonly __brand: Brand }

export type TaskboardProjectId = Branded<string, 'TaskboardProjectId'>
export type TaskboardTaskId = Branded<string, 'TaskboardTaskId'>
export type TaskboardCommentId = Branded<string, 'TaskboardCommentId'>
export type TaskboardRelationId = Branded<string, 'TaskboardRelationId'>
export type TaskboardClaimId = Branded<string, 'TaskboardClaimId'>
export type TaskboardActivityId = Branded<string, 'TaskboardActivityId'>
export type TaskboardAttachmentId = Branded<string, 'TaskboardAttachmentId'>
export type TaskboardWorkflowId = Branded<string, 'TaskboardWorkflowId'>
export type TaskboardAutomationId = Branded<string, 'TaskboardAutomationId'>

function nonEmpty(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`)
  }
  return value
}

export const ProjectId = (value: string): TaskboardProjectId => nonEmpty(value, 'project id') as TaskboardProjectId
export const TaskId = (value: string): TaskboardTaskId => nonEmpty(value, 'task id') as TaskboardTaskId
export const CommentId = (value: string): TaskboardCommentId => nonEmpty(value, 'comment id') as TaskboardCommentId
export const RelationId = (value: string): TaskboardRelationId => nonEmpty(value, 'relation id') as TaskboardRelationId
export const ClaimId = (value: string): TaskboardClaimId => nonEmpty(value, 'claim id') as TaskboardClaimId
export const ActivityId = (value: string): TaskboardActivityId => nonEmpty(value, 'activity id') as TaskboardActivityId
export const AttachmentId = (value: string): TaskboardAttachmentId => nonEmpty(value, 'attachment id') as TaskboardAttachmentId
export const WorkflowId = (value: string): TaskboardWorkflowId => nonEmpty(value, 'workflow id') as TaskboardWorkflowId
export const AutomationId = (value: string): TaskboardAutomationId => nonEmpty(value, 'automation id') as TaskboardAutomationId
