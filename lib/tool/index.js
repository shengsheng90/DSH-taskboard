import { defineTool } from '@deepseek-ai/dsh-tools';
import { ProjectId, TaskId, TaskboardError } from '../domain/index.js';
const JSON_OUTPUT = {
    schema: { type: 'json' },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
};
function actor(exec) {
    const agent = exec.agent;
    if (agent === undefined)
        throw new TaskboardError('Taskboard tools require a live root Agent', 'TASK_FOREIGN_CLAIM');
    const owner = String(agent.id);
    return { kind: 'agent', actorId: owner, sessionId: owner, agentId: owner };
}
function present(title, rawInput) {
    return { card: 'generic', title, kind: 'other', ...(rawInput === undefined ? {} : { rawInput }) };
}
function asJson(value) {
    return JSON.parse(JSON.stringify(value));
}
/** Build the narrow model-facing tool set. It intentionally contains no accept or generic status mutation. */
export function taskboardToolDefinitions(service) {
    return [
        defineTool({
            name: 'taskboard_list',
            description: 'List bounded current tasks for one exact project. Read before selecting or mutating work. The result reports the matching total; pass offset to read past one page.',
            parameters: {
                project_id: { type: 'string', required: true },
                statuses: {
                    type: 'array',
                    items: { type: 'string', enum: ['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'canceled'] },
                },
                include_archived: { type: 'boolean' },
                search: { type: 'string' },
                offset: { type: 'integer' },
            },
            output: JSON_OUTPUT,
            execute(args) {
                const filter = {
                    projectId: ProjectId(args.project_id),
                    ...(args.statuses === undefined ? {} : { statuses: args.statuses }),
                    ...(args.include_archived === undefined ? {} : { includeArchived: args.include_archived }),
                    ...(args.search === undefined ? {} : { search: args.search }),
                };
                const offset = Math.max(0, args.offset ?? 0);
                const tasks = service.provider.listTasks({ ...filter, limit: service.config.pageSize, offset });
                return Promise.resolve(asJson({
                    tasks,
                    offset,
                    total: service.provider.countTasks(filter),
                }));
            },
            presentCall: args => present('List Taskboard issues', args.project_id),
        }),
        defineTool({
            name: 'taskboard_get',
            description: 'Read the current task, exact optimistic version, comments, activity, relations, dependencies, and active claim before any write.',
            parameters: { task_id: { type: 'string', required: true } },
            output: JSON_OUTPUT,
            execute(args) {
                return Promise.resolve(asJson(service.provider.getTaskDetail(service.provider.getTask(args.task_id).id)));
            },
            presentCall: args => present('Read Taskboard issue', args.task_id),
        }),
        defineTool({
            name: 'taskboard_claim',
            description: 'Atomically claim one eligible todo after reading it. Pass the exact current version. The service rechecks dependencies and exclusive ownership in the same transaction.',
            parameters: {
                task_id: { type: 'string', required: true },
                expected_version: { type: 'integer', required: true },
            },
            output: JSON_OUTPUT,
            execute(args, exec) {
                const owner = actor(exec);
                return Promise.resolve(asJson(service.provider.claim(TaskId(args.task_id), {
                    expectedVersion: args.expected_version,
                    sessionId: owner.sessionId,
                    agentId: owner.agentId,
                }, owner)));
            },
            presentCall: args => present('Claim Taskboard issue', args.task_id),
        }),
        defineTool({
            name: 'taskboard_comment',
            description: 'Append a durable Markdown comment after rereading the task. Pass its exact current version; the write increments that version.',
            parameters: {
                task_id: { type: 'string', required: true },
                expected_version: { type: 'integer', required: true },
                body: { type: 'string', required: true },
            },
            output: JSON_OUTPUT,
            execute(args, exec) {
                return Promise.resolve(asJson(service.provider.comment(TaskId(args.task_id), args.expected_version, args.body, actor(exec))));
            },
            presentCall: args => present('Comment on Taskboard issue', args.task_id),
        }),
        defineTool({
            name: 'taskboard_submit_review',
            description: 'Submit the owning in-progress claim for human review only after verification. Requires a result comment, verification evidence, and the exact current task version. This never accepts the task as done.',
            parameters: {
                task_id: { type: 'string', required: true },
                expected_version: { type: 'integer', required: true },
                verification: { type: 'string', required: true },
                result_comment: { type: 'string', required: true },
            },
            output: JSON_OUTPUT,
            execute(args, exec) {
                return Promise.resolve(asJson(service.provider.submitReview(TaskId(args.task_id), args.expected_version, args.verification, args.result_comment, actor(exec))));
            },
            presentCall: args => present('Submit Taskboard issue for review', args.task_id),
        }),
        defineTool({
            name: 'taskboard_block',
            description: 'Block the in-progress task this Session owns, with a concrete non-empty reason and exact current version. A todo you have not claimed can only be blocked by a human.',
            parameters: {
                task_id: { type: 'string', required: true },
                expected_version: { type: 'integer', required: true },
                reason: { type: 'string', required: true },
            },
            output: JSON_OUTPUT,
            execute(args, exec) {
                return Promise.resolve(asJson(service.provider.block(TaskId(args.task_id), args.expected_version, args.reason, actor(exec))));
            },
            presentCall: args => present('Block Taskboard issue', args.task_id),
        }),
        defineTool({
            name: 'taskboard_release_claim',
            description: 'Release only the current Agent Session claim, recording a reason. Read the task first and pass its exact current version.',
            parameters: {
                task_id: { type: 'string', required: true },
                expected_version: { type: 'integer', required: true },
                reason: { type: 'string', required: true },
            },
            output: JSON_OUTPUT,
            execute(args, exec) {
                return Promise.resolve(asJson(service.provider.releaseClaim(TaskId(args.task_id), args.expected_version, args.reason, actor(exec))));
            },
            presentCall: args => present('Release Taskboard claim', args.task_id),
        }),
        defineTool({
            name: 'taskboard_relate',
            description: 'Add one validated same-project parent, blocks, or related relation after reading both tasks. Pass the exact current source-task version.',
            parameters: {
                source_task_id: { type: 'string', required: true },
                expected_source_version: { type: 'integer', required: true },
                target_task_id: { type: 'string', required: true },
                kind: { type: 'string', required: true, enum: ['parent', 'blocks', 'related'] },
            },
            output: JSON_OUTPUT,
            execute(args, exec) {
                return Promise.resolve(asJson(service.provider.addRelation(TaskId(args.source_task_id), args.expected_source_version, TaskId(args.target_task_id), args.kind, actor(exec))));
            },
            presentCall: args => present('Relate Taskboard issues', args.source_task_id),
        }),
    ];
}
/** Register Taskboard tools into the active Harness tool runtime. */
export function registerTaskboardTools(ctx, service) {
    for (const definition of taskboardToolDefinitions(service))
        ctx.tools.register(definition);
}
//# sourceMappingURL=index.js.map