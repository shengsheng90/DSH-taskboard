var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { AutomationId, ProjectId, TaskId, TaskboardError, parseTaskStatus, } from '../domain/index.js';
import { resolveTaskboardStorage, SqliteTaskboardProvider, taskboardStorageLog, writeTaskboardStorageIgnore, } from '../sqlite/index.js';
import { WorkflowNodeRegistry } from '../workflow/index.js';
import { TaskboardAttachmentRoutes } from './attachments.js';
/** Archived rows a snapshot carries for the dashboard's history section, budgeted separately from
 *  the live board so one cannot starve the other. */
const ARCHIVED_SNAPSHOT_LIMIT = 200;
/** Largest `/taskboard` request envelope the channel reads before giving up on it. The board
 *  sends small JSON payloads; attachment bytes travel through the capability-ticket route. */
const MAX_RPC_BODY_BYTES = 8 * 1024 * 1024;
/** Keep the domain code intact so a version conflict, a validation error, and a real fault stay
 *  distinguishable. The Host's own `RpcError.code` union is closed and has no Taskboard member, so
 *  only the Typert protocol below can report the code as a code. */
function taskboardFailure(error) {
    if (error instanceof TaskboardError) {
        return { code: error.code, message: error.message, details: error.details ?? {} };
    }
    return { code: 'internal', message: error instanceof Error ? error.message : String(error), details: {} };
}
function record(value, label) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TaskboardError(`${label} must be an object`, 'TASK_INVALID_INPUT');
    }
    return value;
}
function string(value, label) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new TaskboardError(`${label} must be a non-empty string`, 'TASK_INVALID_INPUT');
    }
    return value;
}
function integer(value, label) {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new TaskboardError(`${label} must be a positive integer`, 'TASK_INVALID_INPUT');
    }
    return value;
}
function finiteNumber(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TaskboardError(`${label} must be a finite number`, 'TASK_INVALID_INPUT');
    }
    return value;
}
function nonNegativeInteger(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new TaskboardError(`${label} must be a non-negative integer`, 'TASK_INVALID_INPUT');
    }
    return value;
}
function human(actorId) {
    return { kind: 'human', actorId };
}
/** Read the Host's current model/reasoning so automation forms can prefill them. */
export function hostAutomationDefaults(ctx) {
    try {
        const selected = ctx.get('agentDefaultModel');
        const current = selected?.currentSelection();
        const provider = typeof current?.provider === 'string' ? current.provider.trim() : '';
        const model = typeof current?.model === 'string' ? current.model.trim() : '';
        const reasoning = current?.reasoningEffort;
        return {
            ...(provider.length > 0 && model.length > 0 ? { modelRoute: `${provider}:${model}` } : {}),
            ...(typeof reasoning === 'string' && reasoning.trim() !== '' ? { reasoning: reasoning.trim() } : {}),
        };
    }
    catch {
        return {};
    }
}
function resolveAutomationDefaults(config, host) {
    const modelRoute = config.defaultModelRoute ?? host.modelRoute;
    return {
        agentPreset: config.defaultAgentPreset,
        minIntervalMs: config.minAutomationIntervalMs,
        ...(modelRoute === undefined ? {} : { modelRoute }),
        ...(host.reasoning === undefined ? {} : { reasoning: host.reasoning }),
    };
}
function logStorageResolution(ctx, layout) {
    for (const line of taskboardStorageLog(layout))
        ctx.logger.info(line);
}
function resolved(config, databasePath, attachmentRoot) {
    const maxAttachmentBytes = config.maxAttachmentBytes ?? 25 * 1024 * 1024;
    const maxTaskAttachmentBytes = config.maxTaskAttachmentBytes ?? 100 * 1024 * 1024;
    if (maxTaskAttachmentBytes < maxAttachmentBytes) {
        throw new Error('taskboard maxTaskAttachmentBytes must be at least maxAttachmentBytes');
    }
    const defaultAgentPreset = (config.defaultAgentPreset ?? 'standard').trim();
    if (defaultAgentPreset.length === 0)
        throw new Error('taskboard defaultAgentPreset must be non-empty');
    if (config.defaultModelRoute !== undefined && !/^[^:/\s]+[:/][^:/\s]+$/.test(config.defaultModelRoute)) {
        throw new Error('taskboard defaultModelRoute must be provider:model or provider/model');
    }
    return {
        databasePath,
        attachmentRoot,
        pageSize: config.pageSize ?? 100,
        snapshotTaskLimit: config.snapshotTaskLimit ?? 1_000,
        maxAttachmentBytes,
        maxTaskAttachmentBytes,
        allowedAttachmentTypes: config.allowedAttachmentTypes ?? [
            'application/json', 'application/octet-stream', 'application/pdf', 'application/zip',
            'image/gif', 'image/jpeg', 'image/png', 'image/webp', 'text/markdown', 'text/plain',
        ],
        minAutomationIntervalMs: config.minAutomationIntervalMs ?? 30_000,
        maxProjectWorkers: config.maxProjectWorkers ?? 2,
        maxGlobalWorkers: config.maxGlobalWorkers ?? 4,
        allowSharedWorktrees: config.allowSharedWorktrees ?? false,
        clientRefreshIntervalMs: config.clientRefreshIntervalMs ?? 15_000,
        maxChangeWaiters: config.maxChangeWaiters ?? 128,
        maxChangeWatchMs: config.maxChangeWatchMs ?? 30_000,
        defaultAgentPreset,
        ...(config.defaultModelRoute === undefined ? {} : { defaultModelRoute: config.defaultModelRoute }),
    };
}
/** Harness service facade around the SQLite provider and local Client RPC. */
let TaskboardService = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _remoteSnapshot_decorators;
    let _remoteTaskDetail_decorators;
    let _remoteMutate_decorators;
    return class TaskboardService extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _remoteSnapshot_decorators = [Remote('snapshot')];
            _remoteTaskDetail_decorators = [Remote('taskDetail')];
            _remoteMutate_decorators = [Remote('mutate')];
            __esDecorate(this, null, _remoteSnapshot_decorators, { kind: "method", name: "remoteSnapshot", static: false, private: false, access: { has: obj => "remoteSnapshot" in obj, get: obj => obj.remoteSnapshot }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteTaskDetail_decorators, { kind: "method", name: "remoteTaskDetail", static: false, private: false, access: { has: obj => "remoteTaskDetail" in obj, get: obj => obj.remoteTaskDetail }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteMutate_decorators, { kind: "method", name: "remoteMutate", static: false, private: false, access: { has: obj => "remoteMutate" in obj, get: obj => obj.remoteMutate }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        hostCtx = __runInitializers(this, _instanceExtraInitializers);
        config;
        provider;
        /** Annotated although TypeScript infers it: the Typert generator reads declaration text into
         *  `TYPERT.model`, and an inferred member emits a signature the Host catalog cannot resolve. */
        workflowNodes = new WorkflowNodeRegistry();
        attachmentRoutes;
        workflowSkills = [];
        workflowMcpTools = [];
        skillDiscoveryComplete = false;
        changeWaiters = new Set();
        lastRevision = 0;
        acceptingChangeWatches = true;
        automationHost;
        constructor(ctx, config) {
            super(ctx, 'taskboard');
            this.hostCtx = ctx;
            const storage = resolveTaskboardStorage(config.databasePath, config.attachmentRoot);
            this.config = resolved(config, storage.database.path, storage.attachments.path);
            this.provider = new SqliteTaskboardProvider(this.config.databasePath, {
                root: this.config.attachmentRoot,
                maxAttachmentBytes: this.config.maxAttachmentBytes,
                maxTaskAttachmentBytes: this.config.maxTaskAttachmentBytes,
                allowedContentTypes: this.config.allowedAttachmentTypes,
                allowSharedWorktrees: this.config.allowSharedWorktrees,
            });
            // Report the store only once it is actually open: a log line must never claim a database
            // that failed to initialize.
            logStorageResolution(ctx, storage);
            writeTaskboardStorageIgnore(storage);
            this.lastRevision = this.provider.globalRevision();
            this.attachmentRoutes = new TaskboardAttachmentRoutes(this.provider);
            ctx.effect(() => () => { this.provider.close(); }, 'taskboard: close SQLite authority');
            ctx.effect(() => {
                const dispose = this.provider.subscribe(event => {
                    this.lastRevision = event.globalRevision;
                    this.settleChangeWaiters(event.globalRevision, true);
                });
                return () => {
                    this.acceptingChangeWatches = false;
                    dispose();
                    this.settleChangeWaiters(this.lastRevision, false);
                };
            }, 'taskboard: revision long-poll lifecycle');
            // `Connection.rpc.handle()` no longer mounts a channel on DSH 0.2.0-rc.2: it registers
            // its route through a context that cannot resolve `webServer`, so the call throws
            // `cannot get property "webServer" without inject` and `/taskboard` is never served.
            // The board still loads — reads travel the Typert carrier — but every mutation fails
            // silently, because the client half already POSTs to `/taskboard/<endpoint>` and simply
            // finds no route. Mount that same channel on the web server directly, and keep
            // Connection authoritative by asking it for the rejection verdict instead of
            // re-deriving an authority this plugin deliberately does not carry.
            ctx.inject(['connection', 'webServer'], (channelCtx) => {
                const handler = (endpoint, payload) => endpoint === 'automation.run-now'
                    ? this.dispatchAutomationRunNow(payload)
                    : Promise.resolve(this.dispatchHumanRpc(endpoint, payload, human('human:web-client')));
                const connection = channelCtx.connection;
                const webServer = channelCtx.webServer;
                const send = (res, status, body) => {
                    const text = JSON.stringify(body);
                    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
                    res.end(text);
                };
                /** Read one bounded JSON envelope; an oversize or unparsable body yields undefined. */
                const readEnvelope = (req) => new Promise(resolve => {
                    const chunks = [];
                    let size = 0;
                    req.on('data', (chunk) => {
                        size += chunk.length;
                        if (size > MAX_RPC_BODY_BYTES) {
                            resolve(undefined);
                            req.destroy();
                            return;
                        }
                        chunks.push(chunk);
                    });
                    req.on('end', () => {
                        try {
                            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                        }
                        catch {
                            resolve(undefined);
                        }
                    });
                    req.on('error', () => { resolve(undefined); });
                });
                channelCtx.effect(() => webServer.register({
                    kind: 'prefix',
                    path: '/taskboard',
                    handler: async (req, res) => {
                        const rejection = connection.requestRejection(req);
                        if (rejection !== undefined) {
                            res.writeHead(rejection);
                            res.end(rejection === 401 ? 'unauthorized' : 'forbidden');
                            return;
                        }
                        const pathname = (req.url ?? '').split('?')[0] ?? '';
                        if (req.method !== 'POST' || !pathname.startsWith('/taskboard/')) {
                            send(res, 404, { error: 'not found' });
                            return;
                        }
                        const endpoint = decodeURIComponent(pathname.slice('/taskboard/'.length));
                        const message = await readEnvelope(req);
                        if (message === null || typeof message !== 'object') {
                            send(res, 400, { error: 'body is not a request envelope' });
                            return;
                        }
                        const envelope = message;
                        if (envelope.type !== 'client-request' || typeof envelope.method !== 'string') {
                            send(res, 400, { error: 'body is not a request envelope' });
                            return;
                        }
                        const rpcId = typeof envelope.rpcId === 'string' ? envelope.rpcId : '';
                        if (envelope.method !== endpoint) {
                            send(res, 200, {
                                type: 'server-response',
                                rpcId,
                                result: {
                                    ok: false,
                                    error: {
                                        code: 'gateway/bad-request',
                                        message: `method ${JSON.stringify(envelope.method)} does not match endpoint ${JSON.stringify(endpoint)}`,
                                        details: {},
                                    },
                                },
                            });
                            return;
                        }
                        // A client that walks away must not leave the handler holding a slot.
                        const abort = new AbortController();
                        res.on('close', () => { abort.abort(); });
                        let result;
                        try {
                            result = await handler(endpoint, envelope.payload, abort.signal);
                        }
                        catch (error) {
                            result = {
                                ok: false,
                                error: {
                                    code: error instanceof TaskboardError ? error.code : 'internal',
                                    message: error instanceof Error ? error.message : String(error),
                                    details: {},
                                },
                            };
                        }
                        send(res, 200, { type: 'server-response', rpcId, result });
                    },
                }), 'taskboard: Client RPC');
            });
            ctx.inject(['webServer'], (webCtx) => {
                webCtx.effect(() => this.attachmentRoutes.mount(webCtx.webServer), 'taskboard: attachment byte route');
            });
            ctx.inject(['skills'], (skillCtx) => {
                const skills = skillCtx.skills;
                const refresh = () => {
                    void skills.snapshot().then(result => {
                        this.workflowSkills = result.skills.map(skill => ({ name: skill.name, description: skill.description }));
                        this.skillDiscoveryComplete = result.complete;
                    }, () => { this.skillDiscoveryComplete = false; });
                };
                refresh();
                skillCtx.on('skills/change', refresh);
            });
            ctx.inject(['tools'], (toolCtx) => {
                const refresh = () => {
                    this.workflowMcpTools = toolCtx.tools.schemas()
                        .filter(schema => schema.name.startsWith('mcp__'))
                        .map(schema => ({ name: schema.name, description: schema.description }));
                };
                refresh();
                toolCtx.on('tools/change', refresh);
            });
        }
        bindAutomation(host) {
            this.automationHost = host;
        }
        async runAutomationNow(automationId) {
            this.provider.getAutomation(automationId);
            if (this.automationHost === undefined) {
                throw new TaskboardError('automation coordinator is not running', 'TASK_INVALID_INPUT');
            }
            await this.automationHost.runImmediate(automationId);
            return this.provider.getAutomation(automationId);
        }
        taskDetail(taskId) {
            // The native page renders no activity timeline, and the log grows without bound per task.
            // Shipping it on every detail open and every refresh was pure transfer cost; activityTotal
            // still reports how much history exists. Raise this when the page renders one.
            const detail = this.provider.getTaskDetail(taskId, { activityLimit: 0 });
            const agents = this.hostCtx.get('agents');
            const sessionRuntime = detail.claims.map(claim => {
                const agent = agents?.get(claim.sessionId);
                const todoEvent = agent?.session.events.findLast(event => event.type === 'todo/write');
                const todos = todoEvent === undefined
                    ? []
                    : (todoEvent.data.todos ?? []);
                const status = agent?.status ?? 'offline';
                return {
                    sessionId: claim.sessionId,
                    status,
                    current: detail.activeClaim?.id === claim.id,
                    todos,
                };
            });
            return { ...detail, sessionRuntime };
        }
        snapshot(projectId) {
            const projects = this.provider.listProjects();
            // A projectId that no longer exists (deleted elsewhere, or a stale deep link) must not fail
            // the whole snapshot -- fall back to the first project so the page stays usable.
            const requested = projectId !== undefined && projects.some(project => project.id === projectId) ? projectId : undefined;
            const selected = requested ?? projects[0]?.id;
            // Live and archived work are paged apart. Sharing one budget let a large archive push the
            // board's own cards out of the snapshot and leave nothing but a truncation notice.
            const live = selected === undefined
                ? []
                : this.provider.listTasks({ projectId: selected, limit: this.config.snapshotTaskLimit });
            const archived = selected === undefined
                ? []
                : this.provider.listTasks({ projectId: selected, archivedOnly: true, limit: ARCHIVED_SNAPSHOT_LIMIT });
            const liveTotal = selected === undefined ? 0 : this.provider.countTasks({ projectId: selected });
            const archivedTotal = selected === undefined ? 0 : this.provider.countTasks({ projectId: selected, archivedOnly: true });
            const tasks = [...live, ...archived];
            return {
                schemaVersion: 1,
                globalRevision: this.provider.globalRevision(),
                projects,
                tasks,
                taskTotal: liveTotal + archivedTotal,
                tasksTruncated: live.length < liveTotal || archived.length < archivedTotal,
                workflows: selected === undefined ? [] : this.provider.listWorkflows(selected),
                automations: selected === undefined ? [] : this.provider.listAutomations(selected),
                automationRuns: selected === undefined ? [] : this.provider.listAutomationRuns(selected),
                workflowCatalog: this.workflowNodes.catalog(),
                workflowCapabilities: {
                    skills: this.workflowSkills,
                    mcpTools: this.workflowMcpTools,
                    skillDiscoveryComplete: this.skillDiscoveryComplete,
                },
                refreshIntervalMs: this.config.clientRefreshIntervalMs,
                automationDefaults: resolveAutomationDefaults(this.config, hostAutomationDefaults(this.hostCtx)),
                storageHealth: this.provider.storageHealth(),
            };
        }
        remoteSnapshot(projectId) {
            return JSON.stringify(this.snapshot(projectId === undefined ? undefined : ProjectId(projectId)));
        }
        remoteTaskDetail(taskId) {
            return JSON.stringify(this.taskDetail(TaskId(taskId)));
        }
        async remoteMutate(request) {
            let payload;
            try {
                payload = JSON.parse(request.payloadJson);
            }
            catch (_invalidJson) {
                return { ok: false, errorCode: 'invalid-json', errorMessage: 'payloadJson must contain one JSON object' };
            }
            if (request.endpoint === 'changes.watch') {
                try {
                    const input = record(payload, 'RPC payload');
                    const result = await this.watchChanges(nonNegativeInteger(input['afterRevision'], 'afterRevision'), integer(input['timeoutMs'], 'timeoutMs'), input['watcherId'] === undefined ? undefined : string(input['watcherId'], 'watcherId'));
                    return { ok: true, valueJson: JSON.stringify(result) };
                }
                catch (error) {
                    const message = error instanceof TaskboardError ? error.message : error instanceof Error ? error.message : String(error);
                    return { ok: false, errorCode: error instanceof TaskboardError ? error.code : 'internal', errorMessage: message };
                }
            }
            // Typert Remotes are reachable through any authenticated browser transport. Keep this
            // carrier read-only: every human mutation, attachment ticket, and immediate automation
            // run must cross the dedicated `/taskboard` Connection RPC channel above. Connection
            // owns browserAuth / trustedHosts; this plugin no longer passes a per-channel authority.
            return {
                ok: false,
                errorCode: 'loopback-required',
                errorMessage: `Taskboard endpoint ${request.endpoint} requires a loopback connection`,
            };
        }
        /** Wait for a committed revision change without requiring a Harness event extension.
         *  `watcherId` identifies one long-poll loop. A client abort cannot reach the Host, so the
         *  abandoned waiter used to hold its slot for the full timeout; a fresh watch from the same
         *  watcher now settles the one it replaces. */
        watchChanges(afterRevision, timeoutMs, watcherId) {
            const boundedTimeout = Math.min(Math.max(timeoutMs, 1), this.config.maxChangeWatchMs);
            const current = this.provider.globalRevision();
            this.lastRevision = current;
            if (watcherId !== undefined)
                this.settleReplacedWatcher(watcherId, current);
            if (!this.acceptingChangeWatches || current !== afterRevision) {
                return Promise.resolve({ globalRevision: current, changed: current !== afterRevision });
            }
            if (this.changeWaiters.size >= this.config.maxChangeWaiters) {
                throw new TaskboardError('too many concurrent Taskboard change watches', 'TASK_INVALID_INPUT');
            }
            return new Promise(resolve => {
                const waiter = {
                    afterRevision,
                    timer: setTimeout(() => {
                        this.changeWaiters.delete(waiter);
                        const globalRevision = this.provider.globalRevision();
                        this.lastRevision = globalRevision;
                        resolve({ globalRevision, changed: globalRevision !== afterRevision });
                    }, boundedTimeout),
                    resolve,
                    ...(watcherId === undefined ? {} : { watcherId }),
                };
                this.changeWaiters.add(waiter);
            });
        }
        settleReplacedWatcher(watcherId, globalRevision) {
            for (const waiter of [...this.changeWaiters]) {
                if (waiter.watcherId !== watcherId)
                    continue;
                this.changeWaiters.delete(waiter);
                clearTimeout(waiter.timer);
                waiter.resolve({ globalRevision, changed: false });
            }
        }
        /** Dispatch a loopback-authenticated direct UI intent.
         *  The Host error union cannot name a Taskboard code, so it rides in the message on this path. */
        dispatchHumanRpc(endpoint, payload, actor) {
            const result = this.dispatchHumanFailable(endpoint, payload, actor);
            if (result.ok)
                return { ok: true, value: result.value };
            return { ok: false, error: { code: 'internal', message: `${result.failure.code}: ${result.failure.message}`, details: {} } };
        }
        dispatchHumanFailable(endpoint, payload, actor) {
            try {
                const input = record(payload, 'RPC payload');
                return { ok: true, value: this.dispatchHuman(endpoint, input, actor) };
            }
            catch (error) {
                return { ok: false, failure: taskboardFailure(error) };
            }
        }
        async dispatchAutomationRunNow(payload) {
            const result = await this.dispatchAutomationRunNowFailable(payload);
            if (result.ok)
                return { ok: true, value: result.value };
            return { ok: false, error: { code: 'internal', message: `${result.failure.code}: ${result.failure.message}`, details: {} } };
        }
        async dispatchAutomationRunNowFailable(payload) {
            try {
                const input = record(payload, 'RPC payload');
                return { ok: true, value: await this.runAutomationNow(string(input['automationId'], 'automationId')) };
            }
            catch (error) {
                return { ok: false, failure: taskboardFailure(error) };
            }
        }
        dispatchHuman(endpoint, input, actor) {
            switch (endpoint) {
                case 'snapshot':
                    return this.snapshot(input['projectId'] === undefined ? undefined : ProjectId(string(input['projectId'], 'projectId')));
                case 'project.create':
                    return this.provider.createProject(record(input['request'], 'request'), actor);
                case 'project.update':
                    return this.provider.updateProject(ProjectId(string(input['projectId'], 'projectId')), this.version(input), record(input['request'], 'request'), actor);
                case 'project.delete':
                    return this.provider.deleteProject(ProjectId(string(input['projectId'], 'projectId')), integer(input['expectedVersion'], 'expectedVersion'), actor);
                case 'task.create':
                    return this.provider.createTask(record(input['request'], 'request'), actor);
                case 'task.detail':
                    return this.taskDetail(this.taskId(input));
                case 'task.search':
                    // The board filters the snapshot in memory, which cannot see past its own limit.
                    return this.provider.listTasks({
                        projectId: ProjectId(string(input['projectId'], 'projectId')),
                        search: string(input['search'], 'search'),
                        includeArchived: true,
                        limit: this.config.snapshotTaskLimit,
                    });
                case 'task.update':
                    return this.provider.updateTask(TaskId(string(input['taskId'], 'taskId')), integer(input['expectedVersion'], 'expectedVersion'), record(input['request'], 'request'), actor);
                case 'task.approve':
                    return this.provider.approve(this.taskId(input), this.version(input), actor);
                case 'task.bind-session':
                    return this.provider.bindHumanSession(this.taskId(input), this.version(input), {
                        sessionId: string(input['sessionId'], 'sessionId'),
                        agentId: string(input['agentId'], 'agentId'),
                    }, actor);
                case 'task.accept':
                    return this.provider.accept(this.taskId(input), this.version(input), actor);
                case 'task.move':
                    return this.provider.moveStatus(this.taskId(input), this.version(input), parseTaskStatus(string(input['status'], 'status')), actor, input['sortOrder'] === undefined ? undefined : finiteNumber(input['sortOrder'], 'sortOrder'));
                case 'task.return':
                    return this.provider.returnForRework(this.taskId(input), this.version(input), this.workTarget(input), string(input['comment'], 'comment'), actor, this.freshClaim(input));
                case 'task.block':
                    return this.provider.block(this.taskId(input), this.version(input), string(input['reason'], 'reason'), actor);
                case 'task.resume':
                    return this.provider.resume(this.taskId(input), this.version(input), actor, this.workTarget(input), this.freshClaim(input));
                case 'task.cancel':
                    return this.provider.cancel(this.taskId(input), this.version(input), actor);
                case 'task.reopen':
                    return this.provider.reopen(this.taskId(input), this.version(input), string(input['reason'], 'reason'), actor);
                case 'task.archive':
                    return this.provider.archive(this.taskId(input), this.version(input), actor);
                case 'task.restore':
                    return this.provider.restore(this.taskId(input), this.version(input), actor);
                case 'task.force-takeover':
                    return this.provider.forceTakeover(this.taskId(input), this.version(input), string(input['reason'], 'reason'), actor);
                case 'task.delete':
                    return this.provider.deleteTask(this.taskId(input), this.version(input), actor);
                case 'task.comment':
                    return this.provider.comment(this.taskId(input), this.version(input), string(input['body'], 'body'), actor);
                case 'comment.update':
                    return this.provider.updateComment(this.taskId(input), this.version(input), string(input['commentId'], 'commentId'), string(input['body'], 'body'), actor);
                case 'comment.delete':
                    return this.provider.deleteComment(this.taskId(input), this.version(input), string(input['commentId'], 'commentId'), actor);
                case 'project.rename-label':
                    return this.provider.renameProjectLabel(ProjectId(string(input['projectId'], 'projectId')), this.version(input), string(input['from'], 'from'), string(input['to'], 'to'), actor);
                case 'project.remove-label':
                    return this.provider.removeProjectLabel(ProjectId(string(input['projectId'], 'projectId')), this.version(input), string(input['label'], 'label'), actor);
                case 'task.relation':
                    return this.provider.addRelation(this.taskId(input), this.version(input), TaskId(string(input['targetTaskId'], 'targetTaskId')), string(input['kind'], 'kind'), actor);
                case 'relation.delete':
                    return this.provider.removeRelation(string(input['relationId'], 'relationId'), this.version(input), actor);
                case 'attachment.delete':
                    return this.provider.deleteAttachment(this.taskId(input), string(input['attachmentId'], 'attachmentId'), this.version(input), actor);
                case 'attachment.upload-ticket':
                    return this.attachmentRoutes.issueUpload({
                        taskId: string(input['taskId'], 'taskId'),
                        expectedVersion: integer(input['expectedVersion'], 'expectedVersion'),
                        filename: string(input['filename'], 'filename'),
                        contentType: string(input['contentType'], 'contentType'),
                        ...(input['commentId'] === undefined ? {} : { commentId: string(input['commentId'], 'commentId') }),
                    }, actor);
                case 'attachment.download-ticket': {
                    const disposition = input['disposition'] === 'inline' ? 'inline' : 'attachment';
                    return this.attachmentRoutes.issueDownload(string(input['attachmentId'], 'attachmentId'), disposition);
                }
                case 'workflow.create': {
                    const document = record(input['document'], 'document');
                    this.workflowNodes.validate(document);
                    return this.provider.createWorkflow(ProjectId(string(input['projectId'], 'projectId')), string(input['name'], 'name'), document, actor);
                }
                case 'workflow.update': {
                    const document = record(input['document'], 'document');
                    this.workflowNodes.validate(document);
                    return this.provider.updateWorkflow(string(input['workflowId'], 'workflowId'), this.version(input), string(input['name'], 'name'), document, actor);
                }
                case 'workflow.delete':
                    return this.provider.deleteWorkflow(string(input['workflowId'], 'workflowId'), this.version(input), actor);
                case 'automation.create': {
                    const config = record(input['config'], 'config');
                    this.validateAutomation(config);
                    return this.provider.createAutomation(ProjectId(string(input['projectId'], 'projectId')), config, actor);
                }
                case 'storage.check-integrity':
                    // The full-page scan is explicit: it must never ride along on the snapshot path.
                    this.provider.refreshIntegrity();
                    return this.provider.storageHealth();
                case 'automation.update': {
                    const update = record(input['update'], 'update');
                    if (update.config !== undefined)
                        this.validateAutomation(update.config);
                    return this.provider.updateAutomation(AutomationId(string(input['automationId'], 'automationId')), this.version(input), update, actor);
                }
                default:
                    throw new TaskboardError(`unknown Taskboard endpoint ${endpoint}`, 'TASK_INVALID_INPUT');
            }
        }
        taskId(input) {
            return TaskId(string(input['taskId'], 'taskId'));
        }
        version(input) {
            return integer(input['expectedVersion'], 'expectedVersion');
        }
        workTarget(input) {
            const target = input['target'] ?? 'todo';
            if (target !== 'todo' && target !== 'in_progress') {
                throw new TaskboardError('target must be todo or in_progress', 'TASK_INVALID_INPUT');
            }
            return target;
        }
        freshClaim(input) {
            if (input['freshClaim'] === undefined)
                return undefined;
            const claim = record(input['freshClaim'], 'freshClaim');
            return {
                sessionId: string(claim['sessionId'], 'freshClaim.sessionId'),
                agentId: string(claim['agentId'], 'freshClaim.agentId'),
            };
        }
        validateAutomation(config) {
            if (config.intervalMs < this.config.minAutomationIntervalMs) {
                throw new TaskboardError(`automation interval must be at least ${this.config.minAutomationIntervalMs}ms`, 'TASK_INVALID_INPUT');
            }
        }
        settleChangeWaiters(globalRevision, changed) {
            for (const waiter of [...this.changeWaiters]) {
                if (changed && waiter.afterRevision === globalRevision)
                    continue;
                this.changeWaiters.delete(waiter);
                clearTimeout(waiter.timer);
                waiter.resolve({ globalRevision, changed: changed && waiter.afterRevision !== globalRevision });
            }
        }
    };
})();
export { TaskboardService };
//# sourceMappingURL=index.js.map