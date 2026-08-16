import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { TaskboardAutomationCoordinator } from '../src/automation/index.js'
import { TaskboardService } from '../src/service/index.js'
import type { AutomationRule, AutomationRuleConfig, HumanActor, TaskboardTask } from '../src/domain/index.js'

const human: HumanActor = { kind: 'human', actorId: 'user-1' }
const config: AutomationRuleConfig = {
  intervalMs: 30_000,
  agentPreset: 'coding',
  concurrencyLimit: 1,
  quotaPolicy: 'pause-on-uncertain',
  autoPauseOnEmpty: false,
}

test('automation starts one stable eligible task through an owning worker', async () => {
  const service = new TaskboardService(new Context(), { databasePath: ':memory:', attachmentRoot: '.dsh/test' })
  try {
    const project = service.provider.createProject({ key: 'DSH', name: 'Harness' }, human)
    let task = service.provider.createTask({ projectId: project.id, title: 'Automatic', creator: human.actorId }, human)
    task = service.provider.approve(task.id, task.version, human)
    let rule = service.provider.createAutomation(project.id, config, human)
    rule = service.provider.updateAutomation(rule.id, rule.version, { state: 'enabled' }, human)
    const started: string[] = []
    const coordinator = new TaskboardAutomationCoordinator(service, {
      start(activeRule, candidate) {
        const sessionId = `automation-${candidate.id}`
        service.provider.claim(candidate.id, {
          expectedVersion: candidate.version, sessionId, agentId: sessionId,
        }, { kind: 'automation', actorId: sessionId, automationId: activeRule.id, sessionId, agentId: sessionId })
        started.push(candidate.id)
        return Promise.resolve()
      },
    })
    await coordinator.runNow(rule.id)
    assert.deepEqual(started, [task.id])
    assert.equal(service.provider.getTask(task.id).status, 'in_progress')
    assert.ok(service.provider.listAutomationRuns(project.id).some(run => run.decision.kind === 'claimed' && run.decision.taskId === task.id))
    assert.equal(service.snapshot(project.id).automationRuns.some(run => run.decision.kind === 'claimed'), true)
    await coordinator.stop()
  } finally {
    service.provider.close()
  }
})

test('quota uncertainty pauses new claims without touching todo work', async () => {
  const service = new TaskboardService(new Context(), { databasePath: ':memory:', attachmentRoot: '.dsh/test' })
  try {
    const project = service.provider.createProject({ key: 'DSH', name: 'Harness' }, human)
    const task = service.provider.createTask({ projectId: project.id, title: 'Wait', creator: human.actorId, status: 'todo' }, human)
    let rule = service.provider.createAutomation(project.id, config, human)
    rule = service.provider.updateAutomation(rule.id, rule.version, { state: 'enabled' }, human)
    const coordinator = new TaskboardAutomationCoordinator(service, { start: () => Promise.reject(new Error('must not start')) }, { state: () => Promise.resolve('uncertain') })
    await coordinator.runNow(rule.id)
    const paused = service.provider.getAutomation(rule.id)
    assert.equal(paused.state, 'paused')
    assert.equal(paused.lastDecision?.kind, 'quota-paused')
    assert.equal(service.provider.getTask(task.id).status, 'todo')
    await coordinator.stop()
  } finally {
    service.provider.close()
  }
})

test('scheduler discovers a rule enabled after startup and claims it once', async () => {
  const service = new TaskboardService(new Context(), { databasePath: ':memory:', attachmentRoot: '.dsh/test' })
  try {
    const project = service.provider.createProject({ key: 'DSH', name: 'Harness' }, human)
    const task = service.provider.createTask({ projectId: project.id, title: 'Dynamic rule', creator: human.actorId, status: 'todo' }, human)
    const started: string[] = []
    const coordinator = new TaskboardAutomationCoordinator(service, {
      start(activeRule, candidate) {
        const sessionId = `automation-${candidate.id}`
        service.provider.claim(candidate.id, {
          expectedVersion: candidate.version, sessionId, agentId: sessionId,
        }, { kind: 'automation', actorId: sessionId, automationId: activeRule.id, sessionId, agentId: sessionId })
        started.push(candidate.id)
        return Promise.resolve()
      },
    })
    coordinator.start()
    let rule = service.provider.createAutomation(project.id, config, human)
    rule = service.provider.updateAutomation(rule.id, rule.version, { state: 'enabled' }, human)
    await new Promise(resolve => { setTimeout(resolve, 20) })
    assert.deepEqual(started, [task.id])
    assert.equal(service.provider.getTask(task.id).status, 'in_progress')
    await coordinator.stop()
  } finally {
    service.provider.close()
  }
})

test('empty policy pauses only a genuinely empty queue while dependency-blocked work stays enabled', async () => {
  const service = new TaskboardService(new Context(), { databasePath: ':memory:', attachmentRoot: '.dsh/test' })
  try {
    const project = service.provider.createProject({ key: 'DSH', name: 'Harness' }, human)
    let emptyRule = service.provider.createAutomation(project.id, { ...config, autoPauseOnEmpty: true }, human)
    emptyRule = service.provider.updateAutomation(emptyRule.id, emptyRule.version, { state: 'enabled' }, human)
    const coordinator = new TaskboardAutomationCoordinator(service, {
      start(activeRule, task) {
        const sessionId = `automation-${task.id}`
        service.provider.claim(task.id, { expectedVersion: task.version, sessionId, agentId: sessionId }, {
          kind: 'automation', actorId: sessionId, automationId: activeRule.id, sessionId, agentId: sessionId,
        })
        return Promise.resolve()
      },
    })
    await coordinator.runNow(emptyRule.id)
    assert.equal(service.provider.getAutomation(emptyRule.id).state, 'paused')

    const prerequisite = service.provider.createTask({ projectId: project.id, title: 'Prerequisite', creator: human.actorId }, human)
    let dependent = service.provider.createTask({ projectId: project.id, title: 'Dependent', creator: human.actorId }, human)
    dependent = service.provider.approve(dependent.id, dependent.version, human)
    service.provider.addRelation(prerequisite.id, prerequisite.version, dependent.id, 'blocks', human)
    let blockedRule = service.provider.createAutomation(project.id, { ...config, autoPauseOnEmpty: true }, human)
    blockedRule = service.provider.updateAutomation(blockedRule.id, blockedRule.version, { state: 'enabled' }, human)
    await coordinator.runNow(blockedRule.id)
    const after = service.provider.getAutomation(blockedRule.id)
    assert.equal(after.state, 'enabled')
    assert.equal(after.lastDecision?.kind, 'dependency-blocked')
    assert.equal(service.provider.getTask(dependent.id).status, 'todo')
    await coordinator.stop()
  } finally {
    service.provider.close()
  }
})

test('rule concurrency bounds parallel workers then drains remaining todos in the same run', async () => {
  const service = new TaskboardService(new Context(), {
    databasePath: ':memory:', attachmentRoot: '.dsh/test', maxGlobalWorkers: 5, maxProjectWorkers: 5,
  })
  try {
    const project = service.provider.createProject({ key: 'DSH', name: 'Harness' }, human)
    for (const title of ['One', 'Two', 'Three']) service.provider.createTask({ projectId: project.id, title, creator: human.actorId, status: 'todo' }, human)
    let rule = service.provider.createAutomation(project.id, { ...config, concurrencyLimit: 2 }, human)
    rule = service.provider.updateAutomation(rule.id, rule.version, { state: 'enabled' }, human)
    const started: string[] = []
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const coordinator = new TaskboardAutomationCoordinator(service, {
      start(activeRule, task) {
        const sessionId = `automation-${task.id}`
        service.provider.claim(task.id, { expectedVersion: task.version, sessionId, agentId: sessionId }, {
          kind: 'automation', actorId: sessionId, automationId: activeRule.id, sessionId, agentId: sessionId,
        })
        started.push(task.id)
        return pending
      },
    })
    const drained = coordinator.runNow(rule.id)
    await new Promise(resolve => { setTimeout(resolve, 20) })
    assert.equal(started.length, 2)
    assert.equal(service.provider.listTasks({ projectId: project.id, statuses: ['todo'] }).length, 1)
    release()
    await drained
    assert.equal(started.length, 3)
    assert.equal(service.provider.listTasks({ projectId: project.id, statuses: ['todo'] }).length, 0)
    await coordinator.stop()
  } finally {
    service.provider.close()
  }
})

test('one scheduled run claims every eligible todo before it ends', async () => {
  const service = new TaskboardService(new Context(), { databasePath: ':memory:', attachmentRoot: '.dsh/test' })
  try {
    const project = service.provider.createProject({ key: 'DSH', name: 'Harness' }, human)
    const titles = ['Alpha', 'Beta', 'Gamma']
    for (const title of titles) service.provider.createTask({ projectId: project.id, title, creator: human.actorId, status: 'todo' }, human)
    let rule = service.provider.createAutomation(project.id, config, human)
    rule = service.provider.updateAutomation(rule.id, rule.version, { state: 'enabled' }, human)
    const started: string[] = []
    const coordinator = new TaskboardAutomationCoordinator(service, {
      start(activeRule, candidate) {
        const sessionId = `automation-${candidate.id}`
        service.provider.claim(candidate.id, {
          expectedVersion: candidate.version, sessionId, agentId: sessionId,
        }, { kind: 'automation', actorId: sessionId, automationId: activeRule.id, sessionId, agentId: sessionId })
        started.push(candidate.identifier)
        return Promise.resolve()
      },
    })
    await coordinator.runNow(rule.id)
    assert.equal(started.length, 3)
    assert.equal(service.provider.listTasks({ projectId: project.id, statuses: ['todo'] }).length, 0)
    assert.equal(service.provider.listTasks({ projectId: project.id, statuses: ['in_progress'] }).length, 3)
    await coordinator.stop()
  } finally {
    service.provider.close()
  }
})

function owningWorker(service: TaskboardService, started: string[]) {
  return {
    start(activeRule: AutomationRule, candidate: TaskboardTask) {
      const sessionId = `automation-${candidate.id}`
      service.provider.claim(candidate.id, {
        expectedVersion: candidate.version, sessionId, agentId: sessionId,
      }, { kind: 'automation', actorId: sessionId, automationId: activeRule.id, sessionId, agentId: sessionId })
      started.push(candidate.id)
      return Promise.resolve()
    },
  }
}

test('immediate run claims eligible work without moving the scheduled nextEligibleAt', async () => {
  const service = new TaskboardService(new Context(), { databasePath: ':memory:', attachmentRoot: '.dsh/test' })
  try {
    const project = service.provider.createProject({ key: 'DSH', name: 'Harness' }, human)
    const task = service.provider.createTask({ projectId: project.id, title: 'Now', creator: human.actorId, status: 'todo' }, human)
    let rule = service.provider.createAutomation(project.id, config, human)
    rule = service.provider.updateAutomation(rule.id, rule.version, { state: 'enabled' }, human)
    const scheduledAt = Date.now() + 60_000
    rule = service.provider.recordAutomationDecision(rule.id, rule.version, {
      kind: 'empty', message: 'parked for later', at: Date.now(),
    }, scheduledAt)
    const started: string[] = []
    const coordinator = new TaskboardAutomationCoordinator(service, owningWorker(service, started))
    coordinator.start()
    await coordinator.runImmediate(rule.id)
    const after = service.provider.getAutomation(rule.id)
    assert.deepEqual(started, [task.id])
    assert.equal(service.provider.getTask(task.id).status, 'in_progress')
    assert.equal(after.state, 'enabled')
    assert.equal(after.nextEligibleAt, scheduledAt)
    await coordinator.stop()
  } finally {
    service.provider.close()
  }
})

test('immediate run does not pause an empty auto-pause rule or move its schedule', async () => {
  const service = new TaskboardService(new Context(), { databasePath: ':memory:', attachmentRoot: '.dsh/test' })
  try {
    const project = service.provider.createProject({ key: 'DSH', name: 'Harness' }, human)
    let rule = service.provider.createAutomation(project.id, { ...config, autoPauseOnEmpty: true }, human)
    rule = service.provider.updateAutomation(rule.id, rule.version, { state: 'enabled' }, human)
    const scheduledAt = Date.now() + 45_000
    rule = service.provider.recordAutomationDecision(rule.id, rule.version, {
      kind: 'empty', message: 'parked for later', at: Date.now(),
    }, scheduledAt)
    const coordinator = new TaskboardAutomationCoordinator(service, { start: () => Promise.reject(new Error('must not start')) })
    await coordinator.runImmediate(rule.id)
    const after = service.provider.getAutomation(rule.id)
    assert.equal(after.state, 'enabled')
    assert.equal(after.nextEligibleAt, scheduledAt)
    assert.equal(after.lastDecision?.kind, 'empty')
    await coordinator.stop()
  } finally {
    service.provider.close()
  }
})

test('immediate run does not pause on uncertain quota or move the schedule', async () => {
  const service = new TaskboardService(new Context(), { databasePath: ':memory:', attachmentRoot: '.dsh/test' })
  try {
    const project = service.provider.createProject({ key: 'DSH', name: 'Harness' }, human)
    service.provider.createTask({ projectId: project.id, title: 'Wait', creator: human.actorId, status: 'todo' }, human)
    let rule = service.provider.createAutomation(project.id, config, human)
    rule = service.provider.updateAutomation(rule.id, rule.version, { state: 'enabled' }, human)
    const scheduledAt = Date.now() + 30_000
    rule = service.provider.recordAutomationDecision(rule.id, rule.version, {
      kind: 'empty', message: 'parked for later', at: Date.now(),
    }, scheduledAt)
    const coordinator = new TaskboardAutomationCoordinator(
      service,
      { start: () => Promise.reject(new Error('must not start')) },
      { state: () => Promise.resolve('uncertain') },
    )
    await coordinator.runImmediate(rule.id)
    const after = service.provider.getAutomation(rule.id)
    assert.equal(after.state, 'enabled')
    assert.equal(after.nextEligibleAt, scheduledAt)
    assert.equal(after.lastDecision?.kind, 'quota-paused')
    assert.equal(service.provider.listTasks({ projectId: project.id, statuses: ['todo'] }).length, 1)
    await coordinator.stop()
  } finally {
    service.provider.close()
  }
})

test('immediate run can start a paused rule once without enabling its schedule', async () => {
  const service = new TaskboardService(new Context(), { databasePath: ':memory:', attachmentRoot: '.dsh/test' })
  try {
    const project = service.provider.createProject({ key: 'DSH', name: 'Harness' }, human)
    const task = service.provider.createTask({ projectId: project.id, title: 'Once', creator: human.actorId, status: 'todo' }, human)
    const rule = service.provider.createAutomation(project.id, config, human)
    const started: string[] = []
    const coordinator = new TaskboardAutomationCoordinator(service, owningWorker(service, started))
    coordinator.start()
    await coordinator.runImmediate(rule.id)
    const after = service.provider.getAutomation(rule.id)
    assert.deepEqual(started, [task.id])
    assert.equal(after.state, 'paused')
    assert.equal(after.nextEligibleAt, undefined)
    await coordinator.stop()
  } finally {
    service.provider.close()
  }
})

test('immediate run keeps the original timer so the scheduled tick still fires', async () => {
  const service = new TaskboardService(new Context(), { databasePath: ':memory:', attachmentRoot: '.dsh/test' })
  try {
    const project = service.provider.createProject({ key: 'DSH', name: 'Harness' }, human)
    const first = service.provider.createTask({ projectId: project.id, title: 'First', creator: human.actorId, status: 'todo' }, human)
    let rule = service.provider.createAutomation(project.id, config, human)
    rule = service.provider.updateAutomation(rule.id, rule.version, { state: 'enabled' }, human)
    const scheduledAt = Date.now() + 250
    rule = service.provider.recordAutomationDecision(rule.id, rule.version, {
      kind: 'empty', message: 'parked for later', at: Date.now(),
    }, scheduledAt)
    const started: string[] = []
    const coordinator = new TaskboardAutomationCoordinator(service, owningWorker(service, started))
    coordinator.start()
    await coordinator.runImmediate(rule.id)
    assert.deepEqual(started, [first.id])
    assert.equal(service.provider.getAutomation(rule.id).nextEligibleAt, scheduledAt)
    const second = service.provider.createTask({ projectId: project.id, title: 'Second', creator: human.actorId, status: 'todo' }, human)
    await new Promise(resolve => { setTimeout(resolve, Math.max(50, scheduledAt - Date.now() + 80)) })
    assert.deepEqual(started, [first.id, second.id])
    assert.equal(service.provider.getTask(second.id).status, 'in_progress')
    await coordinator.stop()
  } finally {
    service.provider.close()
  }
})
