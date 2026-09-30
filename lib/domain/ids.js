function nonEmpty(value, label) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new TypeError(`${label} must be a non-empty string`);
    }
    return value;
}
export const ProjectId = (value) => nonEmpty(value, 'project id');
export const TaskId = (value) => nonEmpty(value, 'task id');
export const CommentId = (value) => nonEmpty(value, 'comment id');
export const RelationId = (value) => nonEmpty(value, 'relation id');
export const ClaimId = (value) => nonEmpty(value, 'claim id');
export const ActivityId = (value) => nonEmpty(value, 'activity id');
export const AttachmentId = (value) => nonEmpty(value, 'attachment id');
export const WorkflowId = (value) => nonEmpty(value, 'workflow id');
export const AutomationId = (value) => nonEmpty(value, 'automation id');
//# sourceMappingURL=ids.js.map