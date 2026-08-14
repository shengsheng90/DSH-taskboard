import type { TaskboardWorkflowId } from './ids.js'

export type WorkflowNodeExecution = 'executable' | 'design-only'

export interface WorkflowNode {
  readonly id: string
  readonly kind: string
  readonly execution: WorkflowNodeExecution
  readonly config: Readonly<Record<string, unknown>>
  readonly steps?: readonly WorkflowNode[]
  readonly trueBranch?: readonly WorkflowNode[]
  readonly falseBranch?: readonly WorkflowNode[]
}

export interface WorkflowTab {
  readonly id: string
  readonly name: string
  readonly trigger: WorkflowNode
  readonly steps: readonly WorkflowNode[]
}

export interface WorkflowDocument {
  readonly tabs: readonly WorkflowTab[]
}

export interface SavedWorkflow {
  readonly id: TaskboardWorkflowId
  readonly projectId: import('./ids.js').TaskboardProjectId
  readonly name: string
  readonly document: WorkflowDocument
  readonly version: number
  readonly createdAt: number
  readonly updatedAt: number
}

export interface WorkflowNodeProvider {
  readonly kind: string
  readonly category: string
  readonly schema: Readonly<Record<string, unknown>>
  validate(config: Readonly<Record<string, unknown>>): readonly string[]
  execute?(config: Readonly<Record<string, unknown>>, input: unknown, signal: AbortSignal): Promise<unknown>
}

export interface WorkflowCatalogEntry {
  readonly kind: string
  readonly category: string
  readonly execution: WorkflowNodeExecution
}

export interface WorkflowNodePosition {
  readonly id: string
  readonly tabId: string
  readonly x: number
  readonly y: number
  readonly branch: 'main' | 'true' | 'false'
}
