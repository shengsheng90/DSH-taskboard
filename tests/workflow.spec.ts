import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { TaskboardService } from '../src/service/index.js'
import {
  addWorkflowTab, copyWorkflowNode, insertWorkflowNode, layoutWorkflow, moveWorkflowNode,
  removeWorkflowNode, removeWorkflowTab, WorkflowNodeRegistry,
} from '../src/workflow/index.js'
import type { HumanActor, WorkflowDocument } from '../src/domain/index.js'

const human: HumanActor = { kind: 'human', actorId: 'user-1' }

function document(): WorkflowDocument {
  return {
    tabs: [{
      id: 'tab-main',
      name: 'Main',
      trigger: { id: 'trigger', kind: 'issue-trigger', execution: 'design-only', config: {} },
      steps: [{
        id: 'condition', kind: 'condition', execution: 'design-only', config: {},
        trueBranch: [{ id: 'tests', kind: 'tests', execution: 'design-only', config: {} }],
        falseBranch: [{ id: 'result', kind: 'result', execution: 'design-only', config: {} }],
      }],
    }],
  }
}

test('workflow registry distinguishes catalog design nodes from executable providers', () => {
  const registry = new WorkflowNodeRegistry()
  assert.equal(registry.catalog().find(entry => entry.kind === 'tests')?.execution, 'design-only')
  const dispose = registry.register({
    kind: 'tests', category: 'development', schema: {}, validate: () => [],
    execute: (_config, input) => Promise.resolve(input),
  })
  assert.equal(registry.catalog().find(entry => entry.kind === 'tests')?.execution, 'executable')
  dispose()
})

test('workflow validation and layout are deterministic across nested branches', () => {
  const registry = new WorkflowNodeRegistry()
  const workflow = document()
  registry.validate(workflow)
  const first = layoutWorkflow(workflow)
  assert.deepEqual(layoutWorkflow(workflow), first)
  assert.deepEqual(first.map(position => [position.id, position.branch]), [
    ['trigger', 'main'], ['condition', 'main'], ['tests', 'true'], ['result', 'false'],
  ])
})

test('workflow structural edits preserve ordering, nested branches, unique copies, and tab invariants', () => {
  const registry = new WorkflowNodeRegistry()
  let workflow = document()
  workflow = insertWorkflowNode(workflow, 'tab-main', {
    id: 'review', kind: 'review', execution: 'design-only', config: {},
  }, 'condition', 'trueBranch')
  workflow = moveWorkflowNode(workflow, 'review', -1)
  assert.deepEqual(workflow.tabs[0]?.steps[0]?.trueBranch?.map(node => node.id), ['review', 'tests'])
  workflow = copyWorkflowNode(workflow, 'condition', source => `copy-${source}`)
  assert.deepEqual(workflow.tabs[0]?.steps.map(node => node.id), ['condition', 'copy-condition'])
  assert.deepEqual(workflow.tabs[0]?.steps[1]?.trueBranch?.map(node => node.id), ['copy-review', 'copy-tests'])
  workflow = removeWorkflowNode(workflow, 'result')
  assert.deepEqual(workflow.tabs[0]?.steps[0]?.falseBranch, [])
  workflow = addWorkflowTab(workflow, {
    id: 'secondary', name: 'Secondary',
    trigger: { id: 'secondary-trigger', kind: 'rss-trigger', execution: 'design-only', config: {} },
    steps: [],
  })
  registry.validate(workflow)
  workflow = removeWorkflowTab(workflow, 'secondary')
  registry.validate(workflow)
  assert.throws(() => removeWorkflowTab(workflow, 'tab-main'), /at least one tab/)
  assert.throws(() => removeWorkflowNode(workflow, 'trigger'), /triggers cannot/)
})

test('saved workflow documents use optimistic versions and restart-safe SQLite JSON', () => {
  const service = new TaskboardService(new Context(), { databasePath: ':memory:', attachmentRoot: '.dsh/test' })
  try {
    const project = service.provider.createProject({ key: 'DSH', name: 'Harness' }, human)
    const created = service.dispatchHumanRpc('workflow.create', {
      projectId: project.id, name: 'Delivery', document: document(),
    }, human)
    assert.equal(created.ok, true)
    if (!created.ok) return
    const workflow = created.value as { id: string; version: number }
    const updated = service.dispatchHumanRpc('workflow.update', {
      workflowId: workflow.id, expectedVersion: workflow.version, name: 'Delivery v2', document: document(),
    }, human)
    assert.equal(updated.ok, true)
    assert.equal(service.provider.listWorkflows(project.id)[0]?.version, 2)
    const stale = service.dispatchHumanRpc('workflow.update', {
      workflowId: workflow.id, expectedVersion: 1, name: 'stale', document: document(),
    }, human)
    assert.equal(stale.ok, false)
    if (!stale.ok) assert.match(stale.error.message, /TASK_STALE_VERSION/)
  } finally {
    service.provider.close()
  }
})
