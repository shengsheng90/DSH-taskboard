import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { Message } from '@deepseek-ai/dsh-llm'
import type { HumanActor } from '../src/domain/index.js'
import { HarnessTaskboardWorker } from '../src/execution/index.js'
import { TaskboardService } from '../src/service/index.js'

const human: HumanActor = { kind: 'human', actorId: 'user-1' }

test('native worker binds workspace, persists task input, follows human changes, and maps Goal completion to review', async () => {
  const ctx = new Context()
  const service = new TaskboardService(ctx, { databasePath: ':memory:', attachmentRoot: '.dsh/test' })
  const messages: Message[] = []
  const createdGoals: unknown[] = []
  const attachedSessions: string[] = []
  const createOptions: Array<Record<string, unknown>> = []
  let activeAgent: {
    id: string
    followup(message: Message): void
    whenIdle(): Promise<void>
  } | undefined

  ctx.provide('agentPresets', { mount: async () => undefined } as never)
  ctx.provide('workspaceRegistry', {
    get: () => ({ path: '/workspace/project', attachSession: async (id: string) => { attachedSessions.push(id) } }),
  } as never)
  ctx.provide('goals', {
    get: () => undefined,
    create: (_agent: unknown, request: unknown) => { createdGoals.push(request); return { id: 'goal-1' } },
  } as never)
  ctx.provide('agents', {
    list: () => activeAgent === undefined ? [] : [{ id: activeAgent.id }],
    create: async (options: Record<string, unknown> & { sessionId: string; setup(context: Context): Promise<void> }) => {
      createOptions.push(options)
      await options.setup(new Context())
      activeAgent = {
        id: options.sessionId,
        followup: message => { messages.push(message) },
        whenIdle: () => Promise.resolve(),
      }
      return { agent: activeAgent, dispose: () => Promise.resolve() }
    },
    resume: async () => { throw new Error('unexpected resume') },
  } as never)

  try {
    const project = service.provider.createProject({ key: 'DSH', name: 'Harness', workspaceId: 'workspace-1' }, human)
    let task = service.provider.createTask({
      projectId: project.id,
      title: 'Native worker',
      description: 'Implement and verify the execution path.',
      creator: human.actorId,
      developmentContext: { kind: 'worktree', path: '/workspace/project/.worktrees/task', branch: 'task/native-worker' },
    }, human)
    task = service.provider.approve(task.id, task.version, human)
    const rule = service.provider.createAutomation(project.id, {
      intervalMs: 30_000,
      agentPreset: 'coding',
      concurrencyLimit: 1,
      quotaPolicy: 'pause-on-uncertain',
      autoPauseOnEmpty: false,
    }, human)

    const worker = new HarnessTaskboardWorker(ctx, service)
    await worker.start(rule, task)

    assert.equal(service.provider.getTask(task.id).status, 'in_progress')
    assert.equal(createOptions.length, 1)
    assert.deepEqual((createOptions[0]?.['meta'] as { cwd?: string; agentPreset?: string }), {
      cwd: '/workspace/project/.worktrees/task',
      agentPreset: 'coding',
    })
    assert.equal(attachedSessions.length, 1)
    assert.deepEqual(createdGoals, [{ objective: 'Complete and verify DSH-1: Native worker' }])
    assert.equal(messages.length, 1)
    const activeClaim = service.provider.getTaskDetail(task.id).activeClaim
    assert.ok(activeClaim)
    assert.deepEqual(messages[0]?.source, {
      kind: 'taskboard', taskId: task.id, claimId: activeClaim.id,
      claimedRevision: service.provider.getTask(task.id).version,
    })
    assert.match(messages[0]?.content[0]?.type === 'text' ? messages[0].content[0].text : '', /Only a human may accept it as done/)

    const inProgress = service.provider.getTask(task.id)
    service.provider.updateTask(inProgress.id, inProgress.version, { description: 'New durable requirement.' }, human)
    assert.equal(messages.length, 2)
    assert.deepEqual(messages[1]?.source, {
      kind: 'taskboard', taskId: task.id, claimId: activeClaim.id,
      claimedRevision: service.provider.getTask(task.id).version,
    })
    assert.match(messages[1]?.content[0]?.type === 'text' ? messages[1].content[0].text : '', /changed after your claim/)
    assert.match(messages[1]?.content[0]?.type === 'text' ? messages[1].content[0].text : '', /New durable requirement/)

    assert.ok(activeAgent)
    ;(worker as unknown as { onGoalChanged(agent: unknown, goal: unknown): void }).onGoalChanged(activeAgent, {
      id: 'goal-1', phase: 'complete', objective: 'complete task', createdAt: 1, updatedAt: 2,
    })
    const reviewed = service.provider.getTask(task.id)
    assert.equal(reviewed.status, 'in_review')
    assert.match(service.provider.getTaskDetail(task.id).comments.at(-1)?.body ?? '', /Harness Goal completed/)

    await worker.stop()
  } finally {
    service.provider.close()
  }
})

test('startup reconciliation resumes the original orphaned Session and maps a blocked Goal without task theft', async () => {
  const ctx = new Context()
  const service = new TaskboardService(ctx, { databasePath: ':memory:', attachmentRoot: '.dsh/test' })
  const resumed: string[] = []
  const messages: Message[] = []
  let resumedAgent: { id: string; followup(message: Message): void; whenIdle(): Promise<void> } | undefined
  ctx.provide('agentPresets', { mount: async () => undefined } as never)
  ctx.provide('workspaceRegistry', { get: () => undefined } as never)
  ctx.provide('goals', {
    get: () => undefined,
    create: () => ({ id: 'goal-resumed' }),
  } as never)
  ctx.provide('agents', {
    list: () => [],
    create: async () => { throw new Error('reconciliation must not create a replacement Session') },
    resume: async (options: { resumeSessionId: string; setup(context: Context): Promise<void> }) => {
      resumed.push(options.resumeSessionId)
      await options.setup(new Context())
      resumedAgent = {
        id: options.resumeSessionId,
        followup: message => { messages.push(message) },
        whenIdle: () => Promise.resolve(),
      }
      return { agent: resumedAgent, dispose: () => Promise.resolve() }
    },
  } as never)
  try {
    const project = service.provider.createProject({ key: 'DSH', name: 'Harness' }, human)
    let task = service.provider.createTask({ projectId: project.id, title: 'Resume me', creator: human.actorId, status: 'todo' }, human)
    let rule = service.provider.createAutomation(project.id, {
      intervalMs: 30_000, agentPreset: 'coding', concurrencyLimit: 1,
      quotaPolicy: 'pause-on-uncertain', autoPauseOnEmpty: false,
    }, human)
    rule = service.provider.updateAutomation(rule.id, rule.version, { state: 'enabled' }, human)
    const sessionId = 'taskboard-existing-session'
    task = service.provider.claim(task.id, { expectedVersion: task.version, sessionId, agentId: sessionId }, {
      kind: 'automation', actorId: `automation:${rule.id}`, automationId: rule.id, sessionId, agentId: sessionId,
    }).task

    const worker = new HarnessTaskboardWorker(ctx, service)
    await worker.reconcile()
    assert.deepEqual(resumed, [sessionId])
    assert.equal(service.provider.getTaskDetail(task.id).activeClaim?.sessionId, sessionId)
    assert.equal(service.provider.getTaskDetail(task.id).activeClaim?.state, 'active')
    assert.equal(messages[0]?.source.kind, 'taskboard')

    assert.ok(resumedAgent)
    ;(worker as unknown as { onGoalChanged(agent: unknown, goal: unknown): void }).onGoalChanged(resumedAgent, {
      id: 'goal-resumed', phase: 'blocked', objective: 'resume task', createdAt: 1, updatedAt: 2,
      blockedReason: { message: 'Repository permission requires human approval.' },
    })
    assert.equal(service.provider.getTask(task.id).status, 'blocked')
    assert.deepEqual(service.provider.getTaskDetail(task.id).activities.at(-1)?.after, {
      status: 'blocked', reason: 'Repository permission requires human approval.',
    })
    await worker.stop()
  } finally {
    service.provider.close()
  }
})
