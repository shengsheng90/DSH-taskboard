import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, ModelSelection, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type {
  AutomationActor, AutomationRule, TaskboardChangeEvent, TaskboardClaim, TaskboardTask,
} from '../domain/index.js'
import { TaskId, TaskboardError } from '../domain/index.js'
import type { TaskboardAutomationWorker } from '../automation/index.js'
import type { TaskboardService } from '../service/index.js'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    taskboard: {
      readonly kind: 'taskboard'
      readonly taskId: string
      readonly claimId: string
      readonly claimedRevision: number
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host default used when an automation rule does not name a modelRoute. */
    agentDefaultModel: {
      currentSelection(): ModelSelection
    }
  }
}

function route(value: string | undefined): { provider: string; model: string } | undefined {
  if (value === undefined) return undefined
  const at = value.includes(':') ? value.indexOf(':') : value.indexOf('/')
  if (at < 1 || at === value.length - 1) {
    throw new TaskboardError('automation modelRoute must be provider:model or provider/model', 'TASK_INVALID_INPUT')
  }
  return { provider: value.slice(0, at), model: value.slice(at + 1) }
}

function withReasoning(selection: ModelSelection, reasoning: string | undefined): ModelSelection {
  if (reasoning === undefined) return selection
  return { ...selection, reasoningEffort: ReasoningEffortId(reasoning) }
}

/** Resolve the model an automation worker must install before prompt assembly. */
export function resolveAutomationModel(ctx: Context, rule: AutomationRule): ModelSelection {
  const explicit = route(rule.config.modelRoute)
  if (explicit !== undefined) return withReasoning(explicit, rule.config.reasoning)
  const selected = ctx.get('agentDefaultModel')?.currentSelection()
  if (selected === undefined || selected.provider.length === 0 || selected.model.length === 0) {
    throw new TaskboardError(
      'automation modelRoute is empty and the Host default model is unavailable',
      'TASK_INVALID_INPUT',
    )
  }
  return withReasoning(selected, rule.config.reasoning)
}

function actor(rule: AutomationRule, claim: Pick<TaskboardClaim, 'sessionId' | 'agentId'>): AutomationActor {
  return {
    kind: 'automation',
    actorId: `automation:${rule.id}`,
    automationId: rule.id,
    sessionId: claim.sessionId,
    agentId: claim.agentId,
  }
}

/** Prefer a short review marker when a result comment already exists. */
export function completionResultComment(comments: readonly { readonly body: string }[]): string {
  return comments.some(item => item.body.trim() !== '') ? 'Ready for review.' : 'Work completed.'
}

/** Render the complete durable task instruction admitted to a worker Session. */
export function renderTaskInstruction(service: TaskboardService, taskId: string, claim: TaskboardClaim): string {
  const detail = service.provider.getTaskDetail(TaskId(taskId))
  const dependencyLines: string[] = []
  for (const relation of detail.relations) {
    const otherId = relation.sourceTaskId === detail.task.id ? relation.targetTaskId : relation.sourceTaskId
    const other = service.provider.getTask(otherId)
    const direction = relation.sourceTaskId === detail.task.id ? 'outgoing' : 'incoming'
    dependencyLines.push(`- ${relation.kind} (${direction}): ${other.identifier} [${other.status}] ${other.title}`)
  }
  const comments = detail.comments.length === 0
    ? '- None'
    : detail.comments.map(item => `- ${item.authorId}: ${item.body}`).join('\n')
  const attachments = detail.attachments.length === 0
    ? '- None'
    : detail.attachments.map(item => `- ${item.id}: ${item.filename} (${item.contentType}, ${item.byteSize} bytes)`).join('\n')
  const development = detail.task.developmentContext === undefined
    ? 'Project workspace'
    : detail.task.developmentContext.kind === 'branch'
      ? `Branch ${detail.task.developmentContext.branch}`
      : `Worktree ${detail.task.developmentContext.path}, branch ${detail.task.developmentContext.branch}`
  return [
    `Task ${detail.task.identifier}`,
    `Opaque task id: ${detail.task.id}`,
    `Claim id: ${claim.id}`,
    `Claimed task revision: ${claim.expectedTaskVersion}`,
    `Current task revision: ${detail.task.version}`,
    '',
    `Title: ${detail.task.title}`,
    '',
    'Description and acceptance details:',
    detail.task.description || '(No description supplied.)',
    '',
    'Current comments:',
    comments,
    '',
    'Relations and dependency state:',
    dependencyLines.length === 0 ? '- None' : dependencyLines.join('\n'),
    '',
    `Development context: ${development}`,
    '',
    'Attachment references:',
    attachments,
    '',
    'Read the task again before every write. Complete and verify the work, then record the final result with taskboard_comment or taskboard_submit_review. Never modify the task description. Only a human may accept it as done.',
  ].join('\n')
}

/** Native Agent/Session worker used by durable project automation. */
export class HarnessTaskboardWorker implements TaskboardAutomationWorker {
  private readonly handles = new Map<string, AgentHandle>()

  constructor(private readonly ctx: Context, private readonly taskboard: TaskboardService) {
    ctx.on('goal/changed', ({ agent: changedAgent, change }) => {
      if (change.goal !== undefined) this.onGoalChanged(changedAgent, change.goal)
    })
    ctx.effect(
      () => taskboard.provider.subscribe(event => { this.onTaskChanged(event) }),
      'taskboard: append committed requirement changes to owning Sessions',
    )
  }

  /** Claim synchronously so the scheduler never counts work that lost the transaction race. */
  start(rule: AutomationRule, task: TaskboardTask): Promise<void> {
    const sessionId = SessionId(`taskboard-${randomUUID()}`)
    const owner: AutomationActor = {
      kind: 'automation', actorId: `automation:${rule.id}`, automationId: rule.id,
      sessionId, agentId: sessionId,
    }
    const claimed = this.taskboard.provider.claim(task.id, {
      expectedVersion: task.version, sessionId, agentId: sessionId,
    }, owner)
    return this.launch(rule, claimed.task, claimed.claim, false)
  }

  /** Mark dead owners explicitly, then resume only claims owned by a still-enabled automation rule. */
  async reconcile(): Promise<void> {
    const live = new Set(this.ctx.agents.list().map(item => String(item.id)))
    this.taskboard.provider.markOrphanedClaims(live)
    for (const claim of this.taskboard.provider.listClaims(['orphaned'])) {
      if (claim.automationId === undefined) continue
      let rule: AutomationRule
      try { rule = this.taskboard.provider.getAutomation(claim.automationId) } catch (_deletedRule) { continue }
      if (rule.state !== 'enabled') continue
      const task = this.taskboard.provider.getTask(claim.taskId)
      try { await this.launch(rule, task, claim, true) } catch (_boundedResumeFailure) { /* claim remains visible as orphaned */ }
    }
  }

  async stop(): Promise<void> {
    const handles = [...this.handles.values()]
    this.handles.clear()
    await Promise.allSettled(handles.map(handle => handle.dispose()))
  }

  private async launch(rule: AutomationRule, task: TaskboardTask, initialClaim: TaskboardClaim, resume: boolean): Promise<void> {
    const owner = actor(rule, initialClaim)
    let handle: AgentHandle | undefined
    try {
      const project = this.taskboard.provider.getProject(task.projectId)
      const workspace = project.workspaceId === undefined
        ? undefined
        : this.ctx.workspaceRegistry.get(WorkspaceId(project.workspaceId))
      const cwd = task.developmentContext?.kind === 'worktree' ? task.developmentContext.path : workspace?.path
      const selection = resolveAutomationModel(this.ctx, rule)
      const agentOptions = { provider: selection.provider, model: selection.model }
      const setup = async (agentCtx: Context): Promise<void> => {
        const selected: ModelSelectionRef = { current: selection, assembled: undefined }
        agentCtx.effect(() => installModelSelection(agentCtx, selected), 'taskboard: automation model route')
        await this.ctx.agentPresets.mount(agentCtx, rule.config.agentPreset)
      }
      handle = resume
        ? await this.ctx.agents.resume({
          resumeSessionId: SessionId(initialClaim.sessionId),
          agentOptions,
          setup,
        })
        : await this.ctx.agents.create({
          sessionId: SessionId(initialClaim.sessionId),
          meta: { ...(cwd === undefined ? {} : { cwd }), agentPreset: rule.config.agentPreset },
          agentOptions,
          setup,
        })
      this.handles.set(initialClaim.sessionId, handle)
      if (workspace !== undefined) await workspace.attachSession(SessionId(initialClaim.sessionId))
      const claim = resume
        ? this.taskboard.provider.reclaimOrphanedClaim(task.id, this.taskboard.provider.getTask(task.id).version, owner).claim
        : initialClaim
      if (this.ctx.goals.get(handle.agent) === undefined) {
        this.ctx.goals.create(handle.agent, { objective: `Complete and verify ${task.identifier}: ${task.title}` })
      }
      const current = this.taskboard.provider.getTask(task.id)
      handle.agent.followup(createUserMessage({
        content: [{ type: 'text', text: renderTaskInstruction(this.taskboard, task.id, claim) }],
        source: { kind: 'taskboard', taskId: task.id, claimId: claim.id, claimedRevision: current.version },
      }))
      await handle.agent.whenIdle()
    } catch (error) {
      if (handle !== undefined) {
        this.handles.delete(initialClaim.sessionId)
        await handle.dispose().catch(() => undefined)
      }
      const latest = this.taskboard.provider.getTask(task.id)
      if (latest.status === 'in_progress') {
        try { this.taskboard.provider.releaseClaim(latest.id, latest.version, `worker startup failed: ${String(error)}`, owner) } catch (_preserveOriginal) { /* authoritative state remains inspectable */ }
      }
      throw error
    }
  }

  private onGoalChanged(changedAgent: Agent, goal: GoalView): void {
    const claim = this.taskboard.provider.listClaims(['active'])
      .find(item => item.sessionId === changedAgent.id && item.agentId === changedAgent.id && item.automationId !== undefined)
    if (claim?.automationId === undefined) return
    const task = this.taskboard.provider.getTask(claim.taskId)
    if (task.status !== 'in_progress') return
    const rule = this.taskboard.provider.getAutomation(claim.automationId)
    const owner = actor(rule, claim)
    if (goal.phase === 'complete') {
      this.taskboard.provider.submitReview(
        task.id, task.version,
        'Completed',
        completionResultComment(this.taskboard.provider.getTaskDetail(task.id).comments),
        owner,
      )
    } else if (goal.phase === 'blocked') {
      this.taskboard.provider.block(task.id, task.version, goal.blockedReason?.message ?? 'Harness Goal blocked', owner)
    }
  }

  private onTaskChanged(event: TaskboardChangeEvent): void {
    if (event.actorKind !== 'human' || event.taskId === undefined
      || (event.activityKind !== 'task.updated' && event.activityKind !== 'task.commented')) return
    const claim = this.taskboard.provider.listClaims(['active'])
      .find(item => item.taskId === event.taskId)
    if (claim === undefined) return
    const handle = this.handles.get(claim.sessionId)
    if (handle === undefined) return
    const task = this.taskboard.provider.getTask(event.taskId)
    if (task.status !== 'in_progress') return
    handle.agent.followup(createUserMessage({
      content: [{
        type: 'text',
        text: [
          `Task ${task.identifier} changed after your claim. Re-read this durable update before continuing.`,
          '',
          renderTaskInstruction(this.taskboard, task.id, claim),
        ].join('\n'),
      }],
      source: {
        kind: 'taskboard', taskId: task.id, claimId: claim.id,
        claimedRevision: event.taskVersion ?? task.version,
      },
    }))
  }
}
