import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { TaskboardAutomationCoordinator } from '../src/automation/index.js'
import { TaskboardService } from '../src/service/index.js'
import type { AutomationRuleConfig, HumanActor } from '../src/domain/index.js'

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
    assert.equal(service.provider.getAutomation(rule.id).lastDecision?.kind, 'claimed')
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

test('rule concurrency bounds the number of workers started in one dispatch', async () => {
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
    await coordinator.runNow(rule.id)
    assert.equal(started.length, 2)
    assert.equal(service.provider.listTasks({ projectId: project.id, statuses: ['todo'] }).length, 1)
    release()
    await coordinator.stop()
  } finally {
    service.provider.close()
  }
})
