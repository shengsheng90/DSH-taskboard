import { TaskboardError } from '../domain/index.js'
import type {
  WorkflowCatalogEntry, WorkflowDocument, WorkflowNode, WorkflowNodePosition, WorkflowNodeProvider,
} from '../domain/index.js'

const TRIGGER_KINDS = new Set(['issue-trigger', 'rss-trigger', 'pull-request-trigger', 'repository-issue-trigger', 'git-status-trigger'])

export const WORKFLOW_PARITY_CATALOG: readonly Omit<WorkflowCatalogEntry, 'execution'>[] = [
  { kind: 'issue-trigger', category: 'trigger' },
  { kind: 'rss-trigger', category: 'trigger' },
  { kind: 'pull-request-trigger', category: 'trigger' },
  { kind: 'repository-issue-trigger', category: 'trigger' },
  { kind: 'git-status-trigger', category: 'trigger' },
  { kind: 'condition', category: 'control' },
  { kind: 'skill', category: 'capability' },
  { kind: 'mcp', category: 'capability' },
  { kind: 'api', category: 'integration' },
  { kind: 'third-party', category: 'integration' },
  { kind: 'git', category: 'development' },
  { kind: 'custom-code', category: 'development' },
  { kind: 'tests', category: 'development' },
  { kind: 'planning', category: 'development' },
  { kind: 'issue-mutation', category: 'taskboard' },
  { kind: 'review', category: 'taskboard' },
  { kind: 'deployment', category: 'delivery' },
  { kind: 'result', category: 'delivery' },
] as const

/** Provider registry separating editable catalog nodes from executable capabilities. */
export class WorkflowNodeRegistry {
  private readonly providers = new Map<string, WorkflowNodeProvider>()

  register(provider: WorkflowNodeProvider): () => void {
    if (this.providers.has(provider.kind)) throw new Error(`workflow node provider ${provider.kind} is already registered`)
    this.providers.set(provider.kind, provider)
    return () => { this.providers.delete(provider.kind) }
  }

  get(kind: string): WorkflowNodeProvider | undefined {
    return this.providers.get(kind)
  }

  catalog(): WorkflowCatalogEntry[] {
    return WORKFLOW_PARITY_CATALOG.map(entry => ({
      ...entry,
      execution: this.providers.get(entry.kind)?.execute === undefined ? 'design-only' : 'executable',
    }))
  }

  validate(document: WorkflowDocument): void {
    if (!Array.isArray(document.tabs) || document.tabs.length === 0) {
      throw new TaskboardError('workflow requires at least one tab', 'TASK_INVALID_INPUT')
    }
    const ids = new Set<string>()
    for (const tab of document.tabs) {
      this.unique(ids, tab.id, 'workflow tab')
      if (!TRIGGER_KINDS.has(tab.trigger.kind)) {
        throw new TaskboardError(`tab ${tab.id} root must be one trigger`, 'TASK_INVALID_INPUT')
      }
      this.validateNode(tab.trigger, ids)
      for (const node of tab.steps) this.validateNode(node, ids)
    }
  }

  private validateNode(node: WorkflowNode, ids: Set<string>): void {
    this.unique(ids, node.id, 'workflow node')
    const provider = this.providers.get(node.kind)
    const expected = provider?.execute === undefined ? 'design-only' : 'executable'
    if (node.execution !== expected) {
      throw new TaskboardError(`node ${node.id} execution marker must be ${expected}`, 'TASK_INVALID_INPUT')
    }
    const errors = provider?.validate(node.config) ?? []
    if (errors.length > 0) throw new TaskboardError(`node ${node.id} is invalid: ${errors.join('; ')}`, 'TASK_INVALID_INPUT')
    for (const child of node.steps ?? []) this.validateNode(child, ids)
    for (const child of node.trueBranch ?? []) this.validateNode(child, ids)
    for (const child of node.falseBranch ?? []) this.validateNode(child, ids)
  }

  private unique(ids: Set<string>, id: string, subject: string): void {
    if (id.trim().length === 0 || ids.has(id)) throw new TaskboardError(`${subject} id is empty or duplicated: ${id}`, 'TASK_INVALID_INPUT')
    ids.add(id)
  }
}

/** Produce deterministic editor coordinates from document order and branch nesting. */
export function layoutWorkflow(document: WorkflowDocument): WorkflowNodePosition[] {
  const result: WorkflowNodePosition[] = []
  for (const [tabIndex, tab] of document.tabs.entries()) {
    let row = 0
    const visit = (node: WorkflowNode, depth: number, branch: WorkflowNodePosition['branch']): void => {
      result.push({ id: node.id, tabId: tab.id, x: (tabIndex * 960) + (depth * 240), y: row * 120, branch })
      row += 1
      for (const child of node.steps ?? []) visit(child, depth + 1, branch)
      for (const child of node.trueBranch ?? []) visit(child, depth + 1, 'true')
      for (const child of node.falseBranch ?? []) visit(child, depth + 1, 'false')
    }
    visit(tab.trigger, 0, 'main')
    for (const node of tab.steps) visit(node, 1, 'main')
  }
  return result
}

function transformList(
  list: readonly WorkflowNode[],
  targetId: string,
  operation: (items: readonly WorkflowNode[], index: number) => readonly WorkflowNode[],
): { readonly nodes: readonly WorkflowNode[]; readonly changed: boolean } {
  const direct = list.findIndex(node => node.id === targetId)
  if (direct >= 0) return { nodes: operation(list, direct), changed: true }
  for (const [index, node] of list.entries()) {
    for (const branch of ['steps', 'trueBranch', 'falseBranch'] as const) {
      const children = node[branch]
      if (children === undefined) continue
      const transformed = transformList(children, targetId, operation)
      if (!transformed.changed) continue
      const copy = [...list]
      copy[index] = { ...node, [branch]: transformed.nodes }
      return { nodes: copy, changed: true }
    }
  }
  return { nodes: list, changed: false }
}

function transformDocumentList(
  document: WorkflowDocument,
  nodeId: string,
  operation: (items: readonly WorkflowNode[], index: number) => readonly WorkflowNode[],
): WorkflowDocument {
  for (const [tabIndex, tab] of document.tabs.entries()) {
    if (tab.trigger.id === nodeId) throw new TaskboardError('workflow triggers cannot be moved, copied, or deleted', 'TASK_INVALID_INPUT')
    const transformed = transformList(tab.steps, nodeId, operation)
    if (!transformed.changed) continue
    const tabs = [...document.tabs]
    tabs[tabIndex] = { ...tab, steps: transformed.nodes }
    return { tabs }
  }
  throw new TaskboardError(`workflow node ${nodeId} was not found`, 'TASK_INVALID_INPUT')
}

/** Remove one non-trigger node from any nested sequence. */
export function removeWorkflowNode(document: WorkflowDocument, nodeId: string): WorkflowDocument {
  return transformDocumentList(document, nodeId, (items, index) => items.filter((_item, itemIndex) => itemIndex !== index))
}

/** Move one non-trigger node within its current ordered sequence. */
export function moveWorkflowNode(document: WorkflowDocument, nodeId: string, offset: -1 | 1): WorkflowDocument {
  return transformDocumentList(document, nodeId, (items, index) => {
    const destination = index + offset
    if (destination < 0 || destination >= items.length) return items
    const copy = [...items]
    const [node] = copy.splice(index, 1)
    if (node !== undefined) copy.splice(destination, 0, node)
    return copy
  })
}

function cloneNode(node: WorkflowNode, idFor: (sourceId: string) => string): WorkflowNode {
  return {
    ...node,
    id: idFor(node.id),
    ...(node.steps === undefined ? {} : { steps: node.steps.map(child => cloneNode(child, idFor)) }),
    ...(node.trueBranch === undefined ? {} : { trueBranch: node.trueBranch.map(child => cloneNode(child, idFor)) }),
    ...(node.falseBranch === undefined ? {} : { falseBranch: node.falseBranch.map(child => cloneNode(child, idFor)) }),
  }
}

/** Copy one node and its nested subtree immediately after the original. */
export function copyWorkflowNode(
  document: WorkflowDocument,
  nodeId: string,
  idFor: (sourceId: string) => string,
): WorkflowDocument {
  return transformDocumentList(document, nodeId, (items, index) => {
    const source = items[index]
    if (source === undefined) return items
    const copy = [...items]
    copy.splice(index + 1, 0, cloneNode(source, idFor))
    return copy
  })
}

/** Insert a node into a tab's root steps or one condition branch. */
export function insertWorkflowNode(
  document: WorkflowDocument,
  tabId: string,
  node: WorkflowNode,
  parentId?: string,
  branch: 'steps' | 'trueBranch' | 'falseBranch' = 'steps',
): WorkflowDocument {
  const tabIndex = document.tabs.findIndex(tab => tab.id === tabId)
  const tab = document.tabs[tabIndex]
  if (tab === undefined) throw new TaskboardError(`workflow tab ${tabId} was not found`, 'TASK_INVALID_INPUT')
  const tabs = [...document.tabs]
  if (parentId === undefined) {
    tabs[tabIndex] = { ...tab, steps: [...tab.steps, node] }
    return { tabs }
  }
  const update = (candidate: WorkflowNode): WorkflowNode => {
    if (candidate.id === parentId) return { ...candidate, [branch]: [...(candidate[branch] ?? []), node] }
    return {
      ...candidate,
      ...(candidate.steps === undefined ? {} : { steps: candidate.steps.map(update) }),
      ...(candidate.trueBranch === undefined ? {} : { trueBranch: candidate.trueBranch.map(update) }),
      ...(candidate.falseBranch === undefined ? {} : { falseBranch: candidate.falseBranch.map(update) }),
    }
  }
  const changed = tab.steps.some(candidate => containsNode(candidate, parentId))
  if (!changed) throw new TaskboardError(`workflow parent ${parentId} was not found`, 'TASK_INVALID_INPUT')
  tabs[tabIndex] = { ...tab, steps: tab.steps.map(update) }
  return { tabs }
}

function containsNode(node: WorkflowNode, id: string): boolean {
  return node.id === id || [...(node.steps ?? []), ...(node.trueBranch ?? []), ...(node.falseBranch ?? [])].some(child => containsNode(child, id))
}

/** Add one tab with its required trigger. */
export function addWorkflowTab(document: WorkflowDocument, tab: WorkflowDocument['tabs'][number]): WorkflowDocument {
  if (document.tabs.some(item => item.id === tab.id)) throw new TaskboardError(`workflow tab ${tab.id} already exists`, 'TASK_INVALID_INPUT')
  return { tabs: [...document.tabs, tab] }
}

/** Delete a tab while retaining the invariant that at least one remains. */
export function removeWorkflowTab(document: WorkflowDocument, tabId: string): WorkflowDocument {
  if (document.tabs.length <= 1) throw new TaskboardError('workflow requires at least one tab', 'TASK_INVALID_INPUT')
  if (!document.tabs.some(tab => tab.id === tabId)) throw new TaskboardError(`workflow tab ${tabId} was not found`, 'TASK_INVALID_INPUT')
  return { tabs: document.tabs.filter(tab => tab.id !== tabId) }
}
