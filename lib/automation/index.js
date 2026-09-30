import { TaskboardError } from '../domain/index.js';
// Harness does not currently publish a proactive quota signal. Unknown must stay unknown instead
// of silently disabling `pause-on-uncertain`; operators can explicitly select `ignore`.
const DEFAULT_QUOTA = { state: () => Promise.resolve('uncertain') };
export const AUTOMATION_CANDIDATE_PAGE_SIZE = 500;
/** Claim failures that only mean "this candidate is taken", so the drain must try the next one.
 *  Treating them as fatal used to abandon the rest of the queue for the whole round. */
const CONTENDED_CLAIM_CODES = new Set([
    'TASK_INVALID_TRANSITION', 'TASK_ALREADY_CLAIMED', 'TASK_STALE_VERSION', 'TASK_DEVELOPMENT_CONTEXT_BUSY',
]);
/** Host-owned durable scheduler that starts work but never steals an existing claim. */
export class TaskboardAutomationCoordinator {
    taskboard;
    worker;
    quota;
    timers = new Map();
    inFlight = new Set();
    inFlightByRule = new Map();
    draining = new Set();
    runningByProject = new Map();
    running = false;
    rescanQueued = false;
    unsubscribe;
    constructor(taskboard, worker, quota = DEFAULT_QUOTA) {
        this.taskboard = taskboard;
        this.worker = worker;
        this.quota = quota;
    }
    start() {
        if (this.running)
            return;
        this.running = true;
        this.unsubscribe = this.taskboard.provider.subscribe(event => {
            // Task activities carry taskId. Generic revisions cover project,
            // workflow, and automation rows; coalesce them before re-projecting all
            // durable rules so newly enabled rules start without a Host restart.
            if (event.taskId === undefined)
                this.queueRescan();
        });
        this.rescan();
    }
    refresh(rule) {
        this.cancelTimer(rule.id);
        if (this.running)
            this.schedule(rule);
    }
    async runNow(ruleId) {
        await this.tick(ruleId);
    }
    /** Extra drain that starts eligible work now without moving the durable schedule. */
    async runImmediate(ruleId) {
        if (this.draining.has(ruleId))
            return;
        const scheduledAt = this.taskboard.provider.getAutomation(ruleId).nextEligibleAt;
        this.draining.add(ruleId);
        try {
            await this.drain(ruleId, this.running, {
                preserveSchedule: true,
                ...(scheduledAt === undefined ? {} : { scheduledAt }),
            });
        }
        finally {
            this.draining.delete(ruleId);
            if (this.running) {
                const latest = this.taskboard.provider.getAutomation(ruleId);
                this.schedule(scheduledAt === undefined ? latest : { ...latest, nextEligibleAt: scheduledAt });
            }
        }
    }
    async stop() {
        this.running = false;
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.rescanQueued = false;
        this.draining.clear();
        for (const timer of this.timers.values())
            clearTimeout(timer);
        this.timers.clear();
        await Promise.allSettled([...this.inFlight]);
    }
    schedule(rule) {
        if (!this.running || rule.state !== 'enabled' || this.draining.has(rule.id))
            return;
        const at = rule.nextEligibleAt ?? Date.now();
        const delay = Math.min(Math.max(0, at - Date.now()), 2_147_483_647);
        const timer = setTimeout(() => {
            this.timers.delete(rule.id);
            void this.tick(rule.id);
        }, delay);
        this.timers.set(rule.id, timer);
    }
    queueRescan() {
        if (!this.running || this.rescanQueued)
            return;
        this.rescanQueued = true;
        queueMicrotask(() => {
            this.rescanQueued = false;
            if (this.running)
                this.rescan();
        });
    }
    rescan() {
        const rules = this.taskboard.provider.listAutomations();
        const activeIds = new Set(rules.filter(rule => rule.state === 'enabled').map(rule => String(rule.id)));
        for (const id of this.timers.keys())
            if (!activeIds.has(id))
                this.cancelTimer(id);
        for (const rule of rules)
            this.refresh(rule);
    }
    async tick(ruleId) {
        if (this.draining.has(ruleId))
            return;
        this.draining.add(ruleId);
        this.cancelTimer(ruleId);
        const coordinatorActive = this.running;
        let failure;
        try {
            await this.drain(ruleId, coordinatorActive);
        }
        catch (error) {
            failure = error;
        }
        finally {
            this.draining.delete(ruleId);
        }
        // The timer was cancelled on entry, so a thrown drain used to leave the rule with no timer at
        // all: it stopped being scheduled until an unrelated rescan or a Host restart. Record the
        // failure and re-arm instead.
        if (failure !== undefined)
            this.reschedule(ruleId, failure);
    }
    reschedule(ruleId, failure) {
        if (!this.running)
            return;
        try {
            const latest = this.taskboard.provider.getAutomation(ruleId);
            if (latest.state !== 'enabled')
                return;
            this.schedule(this.record(ruleId, {
                kind: 'error',
                message: failure instanceof Error ? failure.message : String(failure),
                at: Date.now(),
            }, Date.now() + latest.config.intervalMs));
        }
        catch (_ruleUnavailable) {
            // The rule was deleted or disabled while draining; there is nothing left to schedule.
        }
    }
    async drain(ruleId, coordinatorActive, options = {}) {
        const preserve = options.preserveSchedule === true;
        const kept = options.scheduledAt;
        while (this.draining.has(ruleId)) {
            if (coordinatorActive && !this.running)
                return;
            let rule = this.taskboard.provider.getAutomation(ruleId);
            if (!preserve && rule.state !== 'enabled')
                return;
            const quota = await this.quota.state(rule);
            if (quota === 'uncertain' && rule.config.quotaPolicy === 'pause-on-uncertain') {
                rule = this.record(ruleId, {
                    kind: 'quota-paused', message: 'quota state is uncertain; no new claims started', at: Date.now(),
                }, preserve ? kept : undefined, preserve ? undefined : 'paused');
                if (!preserve)
                    this.refresh(rule);
                return;
            }
            const inFlight = this.ruleInFlight(ruleId);
            const slots = this.availableSlots(rule);
            if (slots === 0) {
                if (inFlight.size === 0) {
                    rule = this.record(ruleId, {
                        kind: 'empty', message: 'worker concurrency is currently full', at: Date.now(),
                    }, preserve ? kept : Date.now() + rule.config.intervalMs);
                    if (!preserve)
                        this.schedule(rule);
                    return;
                }
                await Promise.race(inFlight);
                continue;
            }
            let candidateOffset = 0;
            let candidates = this.taskboard.provider.listTasks({
                projectId: rule.projectId, statuses: ['todo'], limit: AUTOMATION_CANDIDATE_PAGE_SIZE, offset: candidateOffset,
            });
            if (candidates.length === 0) {
                if (inFlight.size > 0) {
                    await Promise.allSettled([...inFlight]);
                    continue;
                }
                const pause = !preserve && rule.config.autoPauseOnEmpty;
                rule = this.record(ruleId, {
                    kind: 'empty', message: 'no eligible todo tasks', at: Date.now(),
                }, preserve ? kept : (pause ? undefined : Date.now() + rule.config.intervalMs), pause ? 'paused' : preserve ? undefined : 'enabled');
                if (!preserve)
                    this.schedule(rule);
                return;
            }
            let started = 0;
            let dependencyBlocked = 0;
            let contended = 0;
            while (candidates.length > 0 && started === 0) {
                for (const task of candidates) {
                    if (started >= slots)
                        break;
                    try {
                        this.startWorker(rule, task);
                        started += 1;
                        rule = this.record(ruleId, {
                            kind: 'claimed', taskId: task.id, message: `worker started for ${task.identifier}`, at: Date.now(),
                        }, preserve ? kept : undefined);
                    }
                    catch (error) {
                        if (!(error instanceof TaskboardError))
                            throw error;
                        // Losing a candidate to a dependency, to another owner, or to a busy development context
                        // says nothing about the rest of the queue. Only a genuine fault ends the round.
                        if (error.code === 'TASK_DEPENDENCY_INCOMPLETE')
                            dependencyBlocked += 1;
                        else if (CONTENDED_CLAIM_CODES.has(error.code))
                            contended += 1;
                        else
                            throw error;
                    }
                }
                if (started > 0 || candidates.length < AUTOMATION_CANDIDATE_PAGE_SIZE)
                    break;
                candidateOffset += candidates.length;
                candidates = this.taskboard.provider.listTasks({
                    projectId: rule.projectId, statuses: ['todo'], limit: AUTOMATION_CANDIDATE_PAGE_SIZE, offset: candidateOffset,
                });
            }
            if (started > 0)
                continue;
            if (inFlight.size > 0) {
                await Promise.race(inFlight);
                continue;
            }
            rule = this.record(ruleId, {
                kind: dependencyBlocked > 0 ? 'dependency-blocked' : 'empty',
                message: dependencyBlocked > 0
                    ? 'todo tasks are waiting for dependencies'
                    : contended > 0 ? 'every eligible todo is already owned elsewhere' : 'no worker started',
                at: Date.now(),
            }, preserve ? kept : Date.now() + rule.config.intervalMs);
            if (!preserve)
                this.schedule(rule);
            return;
        }
    }
    availableSlots(rule) {
        const globalAvailable = Math.max(0, this.taskboard.config.maxGlobalWorkers - this.inFlight.size);
        const projectRunning = this.runningByProject.get(rule.projectId) ?? 0;
        const projectAvailable = Math.max(0, this.taskboard.config.maxProjectWorkers - projectRunning);
        // The rule's own limit counts the rule's own workers. Measuring it against the project total
        // let a sibling rule in the same project silently consume this rule's budget.
        const ruleAvailable = Math.max(0, rule.config.concurrencyLimit - this.ruleInFlight(String(rule.id)).size);
        return Math.min(globalAvailable, projectAvailable, ruleAvailable);
    }
    ruleInFlight(ruleId) {
        const existing = this.inFlightByRule.get(ruleId);
        if (existing !== undefined)
            return existing;
        const created = new Set();
        this.inFlightByRule.set(ruleId, created);
        return created;
    }
    startWorker(rule, task) {
        const projectId = String(rule.projectId);
        const ruleId = String(rule.id);
        this.runningByProject.set(projectId, (this.runningByProject.get(projectId) ?? 0) + 1);
        let run;
        try {
            run = this.worker.start(rule, task);
        }
        catch (error) {
            this.decrement(projectId);
            throw error;
        }
        const ruleTracking = this.ruleInFlight(ruleId);
        const tracked = run.catch((error) => {
            try {
                const latest = this.taskboard.provider.getAutomation(rule.id);
                if (latest.state === 'enabled') {
                    this.record(ruleId, {
                        kind: 'error', taskId: task.id, message: error instanceof Error ? error.message : String(error), at: Date.now(),
                    }, latest.nextEligibleAt);
                }
            }
            catch (_bookkeepingFailed) {
                // `drain()` awaits this promise. Letting the error log's own failure reject it turned one
                // worker launch failure into a dead round for the whole rule.
            }
        }).finally(() => {
            this.inFlight.delete(tracked);
            ruleTracking.delete(tracked);
            // Drop the per-rule bucket once it empties so a deleted rule leaves nothing behind.
            if (ruleTracking.size === 0)
                this.inFlightByRule.delete(ruleId);
            this.decrement(projectId);
        });
        this.inFlight.add(tracked);
        ruleTracking.add(tracked);
    }
    /** Record a decision against the row's current version.
     *  Workers settle while `drain()` awaits, so the version it read before an await is routinely
     *  stale by the time it writes; a compare-and-set on that stale value threw out of the round. */
    record(ruleId, decision, nextEligibleAt, state) {
        const latest = this.taskboard.provider.getAutomation(ruleId);
        return this.taskboard.provider.recordAutomationDecision(latest.id, latest.version, decision, nextEligibleAt, state);
    }
    decrement(projectId) {
        const next = Math.max(0, (this.runningByProject.get(projectId) ?? 1) - 1);
        if (next === 0)
            this.runningByProject.delete(projectId);
        else
            this.runningByProject.set(projectId, next);
    }
    cancelTimer(ruleId) {
        const timer = this.timers.get(ruleId);
        if (timer !== undefined)
            clearTimeout(timer);
        this.timers.delete(ruleId);
    }
}
//# sourceMappingURL=index.js.map