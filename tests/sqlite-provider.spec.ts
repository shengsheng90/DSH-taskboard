import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { SqliteTaskboardProvider, TaskboardError } from '../src/index.js'
import type { AgentActor, HumanActor, TaskboardTask } from '../src/index.js'

const human: HumanActor = { kind: 'human', actorId: 'user-1' }
const agent: AgentActor = { kind: 'agent', actorId: 'agent-1', sessionId: 'session-1', agentId: 'agent-1' }
const otherAgent: AgentActor = { kind: 'agent', actorId: 'agent-2', sessionId: 'session-2', agentId: 'agent-2' }

function memoryProvider(): SqliteTaskboardProvider {
  return new SqliteTaskboardProvider(':memory:')
}

function seed(provider: SqliteTaskboardProvider): TaskboardTask {
  const project = provider.createProject({ key: 'DSH', name: 'Harness' }, human)
  return provider.createTask({ projectId: project.id, title: 'Build taskboard', creator: human.actorId }, human)
}

function expectCode(code: TaskboardError['code']): (error: unknown) => boolean {
  return (error: unknown) => error instanceof TaskboardError && error.code === code
}

test('allocates stable human identifiers and preserves opaque ids', () => {
  const provider = memoryProvider()
  try {
    const first = seed(provider)
    const second = provider.createTask({ projectId: first.projectId, title: 'Second', creator: human.actorId }, human)
    assert.equal(first.identifier, 'DSH-1')
    assert.equal(second.identifier, 'DSH-2')
    assert.notEqual(first.id, first.identifier)
    assert.equal(provider.getTask(first.identifier).id, first.id)
    assert.equal(provider.getProject(first.projectId).nextIssueNumber, 3)
  } finally {
    provider.close()
  }
})

test('publishes detached task invalidations only after committed revisions', () => {
  const provider = memoryProvider()
  try {
    const task = seed(provider)
    const events: Parameters<Parameters<typeof provider.subscribe>[0]>[0][] = []
    const dispose = provider.subscribe(event => { events.push(event) })
    const updated = provider.updateTask(task.id, task.version, { title: 'Committed title' }, human)
    assert.equal(events.length, 1)
    assert.deepEqual(events[0], {
      type: 'taskboard/changed',
      globalRevision: provider.globalRevision(),
      taskId: task.id,
      taskVersion: updated.version,
      activityKind: 'task.updated',
      actorKind: 'human',
      actorId: human.actorId,
    })
    assert.throws(
      () => provider.updateTask(task.id, task.version, { title: 'Stale title' }, human),
      expectCode('TASK_STALE_VERSION'),
    )
    assert.equal(events.length, 1)
    dispose()
  } finally {
    provider.close()
  }
})

test('enforces claim, review, and explicit human acceptance', () => {
  const provider = memoryProvider()
  try {
    let task = seed(provider)
    task = provider.approve(task.id, task.version, human)
    const claimed = provider.claim(task.id, {
      expectedVersion: task.version,
      sessionId: agent.sessionId,
      agentId: agent.agentId,
    }, agent)
    assert.equal(claimed.task.status, 'in_progress')
    assert.equal(claimed.claim.state, 'active')

    assert.throws(
      () => provider.submitReview(claimed.task.id, claimed.task.version, 'pnpm test', 'Implemented', otherAgent),
      expectCode('TASK_FOREIGN_CLAIM'),
    )
    task = provider.submitReview(claimed.task.id, claimed.task.version, 'pnpm test passed', 'Implemented service', agent)
    assert.equal(task.status, 'in_review')
    assert.throws(() => provider.accept(task.id, task.version, agent), expectCode('TASK_HUMAN_AUTHORITY_REQUIRED'))
    task = provider.accept(task.id, task.version, human)
    assert.equal(task.status, 'done')

    const detail = provider.getTaskDetail(task.id)
    assert.equal(detail.comments.length, 1)
    assert.match(detail.comments[0]!.body, /Verification: pnpm test passed/)
    assert.deepEqual(detail.activities.map(activity => activity.kind), [
      'task.created', 'task.approved', 'task.claimed', 'task.review-submitted', 'task.accepted',
    ])
  } finally {
    provider.close()
  }
})

test('human resume releases a blocked owner before returning work to todo', () => {
  const provider = memoryProvider()
  try {
    let task = seed(provider)
    task = provider.approve(task.id, task.version, human)
    task = provider.claim(task.id, {
      expectedVersion: task.version, sessionId: agent.sessionId, agentId: agent.agentId,
    }, agent).task
    task = provider.block(task.id, task.version, 'Need repository approval', agent)
    assert.equal(provider.getTaskDetail(task.id).activeClaim?.sessionId, agent.sessionId)
    assert.throws(
      () => provider.resume(task.id, task.version, agent),
      expectCode('TASK_HUMAN_AUTHORITY_REQUIRED'),
    )

    task = provider.resume(task.id, task.version, human)
    assert.equal(task.status, 'todo')
    assert.equal(provider.getTaskDetail(task.id).activeClaim, undefined)
    assert.equal(provider.listClaims(['released'])[0]?.sessionId, agent.sessionId)
    assert.equal(provider.claim(task.id, {
      expectedVersion: task.version, sessionId: otherAgent.sessionId, agentId: otherAgent.agentId,
    }, otherAgent).task.status, 'in_progress')
  } finally {
    provider.close()
  }
})

test('direct rework and blocked resume establish fresh claims atomically', () => {
  const provider = memoryProvider()
  try {
    let task = seed(provider)
    task = provider.approve(task.id, task.version, human)
    task = provider.claim(task.id, {
      expectedVersion: task.version, sessionId: agent.sessionId, agentId: agent.agentId,
    }, agent).task
    task = provider.submitReview(task.id, task.version, 'verified', 'first pass', agent)
    assert.throws(
      () => provider.returnForRework(task.id, task.version, 'in_progress', 'Fix edge case', human),
      expectCode('TASK_INVALID_INPUT'),
    )
    assert.equal(provider.getTaskDetail(task.id).comments.length, 1)

    task = provider.returnForRework(
      task.id, task.version, 'in_progress', 'Fix edge case', human,
      { sessionId: otherAgent.sessionId, agentId: otherAgent.agentId },
    )
    assert.equal(task.status, 'in_progress')
    assert.equal(provider.getTaskDetail(task.id).activeClaim?.sessionId, otherAgent.sessionId)

    task = provider.block(task.id, task.version, 'Need a decision', otherAgent)
    task = provider.resume(
      task.id, task.version, human, 'in_progress',
      { sessionId: agent.sessionId, agentId: agent.agentId },
    )
    const detail = provider.getTaskDetail(task.id)
    assert.equal(task.status, 'in_progress')
    assert.equal(detail.activeClaim?.sessionId, agent.sessionId)
    assert.equal(detail.claims.filter(claim => claim.state === 'active').length, 1)
    assert.equal(detail.activities.at(-1)?.kind, 'task.resumed')
    assert.match(JSON.stringify(detail.activities.at(-1)?.after), /claim-/)
  } finally {
    provider.close()
  }
})

test('rejects stale writes and leaves committed state unchanged', () => {
  const provider = memoryProvider()
  try {
    const task = seed(provider)
    const updated = provider.updateTask(task.id, task.version, { description: 'fresh' }, human)
    assert.throws(() => provider.approve(task.id, task.version, human), expectCode('TASK_STALE_VERSION'))
    assert.equal(provider.getTask(task.id).description, 'fresh')
    assert.equal(provider.getTask(task.id).version, updated.version)
  } finally {
    provider.close()
  }
})

test('revalidates blocking relations inside the claim transaction', () => {
  const provider = memoryProvider()
  try {
    const dependency = seed(provider)
    const dependent = provider.createTask({ projectId: dependency.projectId, title: 'Dependent', creator: human.actorId }, human)
    provider.addRelation(dependency.id, dependency.version, dependent.id, 'blocks', human)
    const approved = provider.approve(dependent.id, dependent.version, human)
    assert.throws(() => provider.claim(approved.id, {
      expectedVersion: approved.version,
      sessionId: agent.sessionId,
      agentId: agent.agentId,
    }, agent), expectCode('TASK_DEPENDENCY_INCOMPLETE'))

    let readyDependency = provider.getTask(dependency.id)
    readyDependency = provider.approve(readyDependency.id, readyDependency.version, human)
    readyDependency = provider.claim(readyDependency.id, {
      expectedVersion: readyDependency.version,
      sessionId: agent.sessionId,
      agentId: agent.agentId,
    }, agent).task
    readyDependency = provider.submitReview(readyDependency.id, readyDependency.version, 'verified', 'done', agent)
    provider.accept(readyDependency.id, readyDependency.version, human)
    assert.equal(provider.claim(approved.id, {
      expectedVersion: approved.version,
      sessionId: otherAgent.sessionId,
      agentId: otherAgent.agentId,
    }, otherAgent).task.status, 'in_progress')
  } finally {
    provider.close()
  }
})

test('normalizes symmetric relations and rejects parent cycles', () => {
  const provider = memoryProvider()
  try {
    const first = seed(provider)
    const second = provider.createTask({ projectId: first.projectId, title: 'Second', creator: human.actorId }, human)
    const third = provider.createTask({ projectId: first.projectId, title: 'Third', creator: human.actorId }, human)
    provider.addRelation(second.id, second.version, first.id, 'related', human)
    assert.throws(() => provider.addRelation(first.id, first.version, second.id, 'related', human), expectCode('TASK_RELATION_INVALID'))

    provider.addRelation(first.id, first.version, second.id, 'parent', human)
    const currentSecond = provider.getTask(second.id)
    provider.addRelation(second.id, currentSecond.version, third.id, 'parent', human)
    assert.throws(() => provider.addRelation(third.id, third.version, first.id, 'parent', human), expectCode('TASK_PARENT_CYCLE'))
  } finally {
    provider.close()
  }
})

test('keeps orphaned claims visible and prevents silent stealing', () => {
  const provider = memoryProvider()
  try {
    let task = seed(provider)
    task = provider.approve(task.id, task.version, human)
    task = provider.claim(task.id, {
      expectedVersion: task.version,
      sessionId: agent.sessionId,
      agentId: agent.agentId,
    }, agent).task
    assert.equal(provider.markOrphanedClaims(new Set()), 1)
    assert.equal(provider.getTaskDetail(task.id).activeClaim?.state, 'orphaned')
    assert.throws(() => provider.claim(task.id, {
      expectedVersion: task.version,
      sessionId: otherAgent.sessionId,
      agentId: otherAgent.agentId,
    }, otherAgent), expectCode('TASK_INVALID_TRANSITION'))
  } finally {
    provider.close()
  }
})

test('records human project edits and explicit force takeover with optimistic versions', () => {
  const provider = memoryProvider()
  try {
    const task = seed(provider)
    const project = provider.getProject(task.projectId)
    const updatedProject = provider.updateProject(project.id, project.version, {
      name: 'Harness local', workspaceId: 'workspace-1', labels: ['local'],
    }, human)
    assert.equal(updatedProject.workspaceId, 'workspace-1')
    assert.deepEqual(updatedProject.labels, ['local'])
    let approved = provider.approve(task.id, task.version, human)
    approved = provider.claim(approved.id, {
      expectedVersion: approved.version, sessionId: agent.sessionId, agentId: agent.agentId,
    }, agent).task
    const released = provider.forceTakeover(approved.id, approved.version, 'owner is no longer available', human)
    assert.equal(released.status, 'todo')
    assert.equal(provider.getTaskDetail(released.id).claims.at(-1)?.state, 'released')
    assert.match(provider.getTaskDetail(released.id).comments.at(-1)?.body ?? '', /Force takeover/)
  } finally {
    provider.close()
  }
})

test('archives independently and deletes only archived unclaimed tasks', () => {
  const provider = memoryProvider()
  try {
    let task = seed(provider)
    assert.throws(() => provider.deleteTask(task.id, task.version, human), expectCode('TASK_NOT_ARCHIVED'))
    task = provider.archive(task.id, task.version, human)
    assert.ok(task.archivedAt !== undefined)
    assert.throws(() => provider.comment(task.id, task.version, 'late', human), expectCode('TASK_ARCHIVED'))
    provider.deleteTask(task.id, task.version, human)
    assert.throws(() => provider.getTask(task.id), expectCode('TASK_NOT_FOUND'))
  } finally {
    provider.close()
  }
})

test('round-trips authoritative state across restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-taskboard-'))
  const path = join(directory, 'taskboard.sqlite')
  try {
    const first = new SqliteTaskboardProvider(path)
    const task = seed(first)
    const revision = first.globalRevision()
    first.close()

    const second = new SqliteTaskboardProvider(path)
    try {
      assert.equal(second.getTask(task.identifier).title, task.title)
      assert.equal(second.globalRevision(), revision)
    } finally {
      second.close()
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('validates and round-trips recurrence while exposing bounded storage health', () => {
  const provider = memoryProvider()
  try {
    const project = provider.createProject({ key: 'DSH', name: 'Harness' }, human)
    const task = provider.createTask({
      projectId: project.id, title: 'Recurring', creator: human.actorId,
      startDate: '2026-08-14', dueDate: '2026-08-21',
      recurrence: { frequency: 'weekly', interval: 2, until: '2026-12-31' },
    }, human)
    assert.deepEqual(provider.getTask(task.id).recurrence, { frequency: 'weekly', interval: 2, until: '2026-12-31' })
    assert.deepEqual(provider.storageHealth(), {
      status: 'ok', integrity: 'ok', schemaVersion: 3, globalRevision: 2,
      projectCount: 1, taskCount: 1, attachmentCount: 0, attachmentBytes: 0,
      cleanupPending: 0, orphanedClaims: 0,
    })
    assert.throws(() => provider.updateTask(task.id, task.version, {
      recurrence: { frequency: 'weekly', interval: 0 },
    }, human), expectCode('TASK_INVALID_INPUT'))
    assert.throws(() => provider.updateTask(task.id, task.version, { dueDate: '2026-02-30' }, human), expectCode('TASK_INVALID_INPUT'))
  } finally {
    provider.close()
  }
})

test('persists attachment bytes before metadata and applies safe download policy', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-taskboard-attachments-'))
  const attachmentRoot = join(directory, 'bytes')
  const provider = new SqliteTaskboardProvider(join(directory, 'taskboard.sqlite'), {
    root: attachmentRoot,
    maxAttachmentBytes: 16,
    maxTaskAttachmentBytes: 24,
    allowedContentTypes: ['image/png', 'text/plain'],
  })
  try {
    const original = seed(provider)
    const created = provider.createAttachment(original.id, original.version, {
      filename: '../proof.png',
      contentType: 'image/png',
      bytes: new Uint8Array([1, 2, 3, 4]),
    }, human)
    assert.equal(created.attachment.filename, '.._proof.png')
    assert.equal(created.task.version, original.version + 1)
    assert.equal(provider.getTaskDetail(original.id).attachments.length, 1)
    const read = provider.readAttachment(created.attachment.id, 'inline')
    assert.deepEqual([...read.bytes], [1, 2, 3, 4])
    assert.match(read.headers['content-disposition']!, /^inline;/)
    assert.equal(read.headers['x-content-type-options'], 'nosniff')

    assert.throws(() => provider.createAttachment(created.task.id, created.task.version, {
      filename: 'active.html', contentType: 'text/html', bytes: new Uint8Array([1]),
    }, human), expectCode('ATTACHMENT_TYPE_NOT_ALLOWED'))
    assert.throws(() => provider.createAttachment(created.task.id, created.task.version, {
      filename: 'large.txt', contentType: 'text/plain', bytes: new Uint8Array(17),
    }, human), expectCode('ATTACHMENT_SIZE_EXCEEDED'))

    const deleted = provider.deleteAttachment(created.task.id, created.attachment.id, created.task.version, human)
    assert.equal(provider.listAttachments(deleted.id).length, 0)
    assert.equal(provider.retryAttachmentCleanup().pending, 0)
  } finally {
    provider.close()
    rmSync(directory, { recursive: true, force: true })
  }
  assert.equal(existsSync(attachmentRoot) && readdirSync(attachmentRoot, { recursive: true }).some(value => String(value).endsWith('.blob')), false)
})

test('queues task-owned attachment bytes for recoverable cleanup on permanent deletion', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-taskboard-delete-'))
  const provider = new SqliteTaskboardProvider(join(directory, 'taskboard.sqlite'), {
    root: join(directory, 'bytes'),
    maxAttachmentBytes: 16,
    maxTaskAttachmentBytes: 32,
    allowedContentTypes: ['text/plain'],
  })
  try {
    let task = seed(provider)
    task = provider.createAttachment(task.id, task.version, {
      filename: 'note.txt', contentType: 'text/plain', bytes: new TextEncoder().encode('durable'),
    }, human).task
    task = provider.archive(task.id, task.version, human)
    provider.deleteTask(task.id, task.version, human)
    assert.equal(provider.retryAttachmentCleanup().pending, 0)
    assert.throws(() => provider.getTask(task.id), expectCode('TASK_NOT_FOUND'))
  } finally {
    provider.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('human status move can change any column and releases an in-progress claim', () => {
  const provider = memoryProvider()
  try {
    let task = seed(provider)
    task = provider.approve(task.id, task.version, human)
    task = provider.claim(task.id, {
      expectedVersion: task.version, sessionId: agent.sessionId, agentId: agent.agentId,
    }, agent).task
    assert.throws(() => provider.moveStatus(task.id, task.version, 'in_review', agent), expectCode('TASK_HUMAN_AUTHORITY_REQUIRED'))
    task = provider.moveStatus(task.id, task.version, 'in_review', human, 12.5)
    assert.equal(task.status, 'in_review')
    assert.equal(task.sortOrder, 12.5)
    assert.equal(provider.getTaskDetail(task.id).activeClaim, undefined)
    assert.equal(provider.getTaskDetail(task.id).activities.at(-1)?.kind, 'task.status-moved')
    task = provider.moveStatus(task.id, task.version, 'done', human)
    assert.equal(task.status, 'done')
  } finally {
    provider.close()
  }
})

test('records automation run history when a scheduler decision is persisted', () => {
  const provider = memoryProvider()
  try {
    const project = provider.createProject({ key: 'DSH', name: 'Harness' }, human)
    let rule = provider.createAutomation(project.id, {
      intervalMs: 30_000, agentPreset: 'coding', concurrencyLimit: 1, quotaPolicy: 'ignore', autoPauseOnEmpty: false,
    }, human)
    rule = provider.recordAutomationDecision(rule.id, rule.version, {
      kind: 'empty', message: 'no eligible todo tasks', at: 10,
    }, 40)
    rule = provider.recordAutomationDecision(rule.id, rule.version, {
      kind: 'claimed', taskId: 'task-one', message: 'worker started for DSH-1', at: 20,
    }, 50)
    const runs = provider.listAutomationRuns(project.id)
    assert.equal(runs.length, 2)
    assert.equal(runs[0]?.decision.kind, 'claimed')
    assert.equal(runs[1]?.decision.kind, 'empty')
  } finally {
    provider.close()
  }
})
