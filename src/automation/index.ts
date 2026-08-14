import { TaskboardError } from '../domain/index.js'
import type { AutomationRule, TaskboardTask } from '../domain/index.js'
import type { TaskboardService } from '../service/index.js'

export type QuotaState = 'available' | 'uncertain'

export interface TaskboardAutomationWorker {
  start(rule: AutomationRule, task: TaskboardTask): Promise<void>
}

export interface TaskboardQuotaPolicy {
  state(rule: AutomationRule): Promise<QuotaState>
}

const DEFAULT_QUOTA: TaskboardQuotaPolicy = { state: () => Promise.resolve('available') }

/** Host-owned durable scheduler that starts work but never steals an existing claim. */
export class TaskboardAutomationCoordinator {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly inFlight = new Set<Promise<void>>()
  private readonly runningByProject = new Map<string, number>()
  private running = false
  private rescanQueued = false
  private unsubscribe: (() => void) | undefined

  constructor(
    private readonly taskboard: TaskboardService,
    private readonly worker: TaskboardAutomationWorker,
    private readonly quota: TaskboardQuotaPolicy = DEFAULT_QUOTA,
  ) {}

  start(): void {
    if (this.running) return
    this.running = true
    this.unsubscribe = this.taskboard.provider.subscribe(event => {
      // Task activities carry taskId. Generic revisions cover project,
      // workflow, and automation rows; coalesce them before re-projecting all
      // durable rules so newly enabled rules start without a Host restart.
      if (event.taskId === undefined) this.queueRescan()
    })
    this.rescan()
  }

  refresh(rule: AutomationRule): void {
    this.cancelTimer(rule.id)
    if (this.running) this.schedule(rule)
  }

  async runNow(ruleId: string): Promise<void> {
    await this.tick(ruleId)
  }

  async stop(): Promise<void> {
    this.running = false
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.rescanQueued = false
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    await Promise.allSettled([...this.inFlight])
  }

  private schedule(rule: AutomationRule): void {
    if (!this.running || rule.state !== 'enabled') return
    const at = rule.nextEligibleAt ?? Date.now()
    const delay = Math.min(Math.max(0, at - Date.now()), 2_147_483_647)
    const timer = setTimeout(() => {
      this.timers.delete(rule.id)
      void this.tick(rule.id)
    }, delay)
    this.timers.set(rule.id, timer)
  }

  private queueRescan(): void {
    if (!this.running || this.rescanQueued) return
    this.rescanQueued = true
    queueMicrotask(() => {
      this.rescanQueued = false
      if (this.running) this.rescan()
    })
  }

  private rescan(): void {
    const rules = this.taskboard.provider.listAutomations()
    const activeIds = new Set(rules.filter(rule => rule.state === 'enabled').map(rule => String(rule.id)))
    for (const id of this.timers.keys()) if (!activeIds.has(id)) this.cancelTimer(id)
    for (const rule of rules) this.refresh(rule)
  }

  private async tick(ruleId: string): Promise<void> {
    let rule = this.taskboard.provider.getAutomation(ruleId)
    if (!this.running && this.timers.size > 0) return
    if (rule.state !== 'enabled') return
    const quota = await this.quota.state(rule)
    if (quota === 'uncertain' && rule.config.quotaPolicy === 'pause-on-uncertain') {
      rule = this.taskboard.provider.recordAutomationDecision(rule.id, rule.version, {
        kind: 'quota-paused', message: 'quota state is uncertain; no new claims started', at: Date.now(),
      }, undefined, 'paused')
      this.refresh(rule)
      return
    }
    const globalAvailable = Math.max(0, this.taskboard.config.maxGlobalWorkers - this.inFlight.size)
    const projectRunning = this.runningByProject.get(rule.projectId) ?? 0
    const projectAvailable = Math.max(0, this.taskboard.config.maxProjectWorkers - projectRunning)
    const ruleAvailable = Math.max(0, rule.config.concurrencyLimit - projectRunning)
    const slots = Math.min(globalAvailable, projectAvailable, ruleAvailable)
    if (slots === 0) {
      rule = this.taskboard.provider.recordAutomationDecision(rule.id, rule.version, {
        kind: 'empty', message: 'worker concurrency is currently full', at: Date.now(),
      }, Date.now() + rule.config.intervalMs)
      this.schedule(rule)
      return
    }
    const candidates = this.taskboard.provider.listTasks({ projectId: rule.projectId, statuses: ['todo'], limit: 500 })
    if (candidates.length === 0) {
      const pause = rule.config.autoPauseOnEmpty
      rule = this.taskboard.provider.recordAutomationDecision(rule.id, rule.version, {
        kind: 'empty', message: 'no eligible todo tasks', at: Date.now(),
      }, pause ? undefined : Date.now() + rule.config.intervalMs, pause ? 'paused' : 'enabled')
      this.schedule(rule)
      return
    }
    let started = 0
    let dependencyBlocked = 0
    for (const task of candidates) {
      if (started >= slots) break
      try {
        this.startWorker(rule, task)
        started += 1
        rule = this.taskboard.provider.recordAutomationDecision(rule.id, rule.version, {
          kind: 'claimed', taskId: task.id, message: `worker started for ${task.identifier}`, at: Date.now(),
        }, Date.now() + rule.config.intervalMs)
      } catch (error) {
        if (error instanceof TaskboardError && error.code === 'TASK_DEPENDENCY_INCOMPLETE') dependencyBlocked += 1
        else throw error
      }
    }
    if (started === 0) {
      rule = this.taskboard.provider.recordAutomationDecision(rule.id, rule.version, {
        kind: dependencyBlocked > 0 ? 'dependency-blocked' : 'empty',
        message: dependencyBlocked > 0 ? 'todo tasks are waiting for dependencies' : 'no worker started',
        at: Date.now(),
      }, Date.now() + rule.config.intervalMs)
    }
    this.schedule(rule)
  }

  private startWorker(rule: AutomationRule, task: TaskboardTask): void {
    const projectId = String(rule.projectId)
    this.runningByProject.set(projectId, (this.runningByProject.get(projectId) ?? 0) + 1)
    let run: Promise<void>
    try {
      run = this.worker.start(rule, task)
    } catch (error) {
      this.decrement(projectId)
      throw error
    }
    const tracked = run.catch(async (error: unknown) => {
      const latest = this.taskboard.provider.getAutomation(rule.id)
      if (latest.state === 'enabled') {
        this.taskboard.provider.recordAutomationDecision(latest.id, latest.version, {
          kind: 'error', taskId: task.id, message: error instanceof Error ? error.message : String(error), at: Date.now(),
        }, Date.now() + latest.config.intervalMs)
      }
    }).finally(() => {
      this.inFlight.delete(tracked)
      this.decrement(projectId)
    })
    this.inFlight.add(tracked)
  }

  private decrement(projectId: string): void {
    const next = Math.max(0, (this.runningByProject.get(projectId) ?? 1) - 1)
    if (next === 0) this.runningByProject.delete(projectId)
    else this.runningByProject.set(projectId, next)
  }

  private cancelTimer(ruleId: string): void {
    const timer = this.timers.get(ruleId)
    if (timer !== undefined) clearTimeout(timer)
    this.timers.delete(ruleId)
  }
}
