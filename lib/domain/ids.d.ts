/** A string branded for a single durable identity domain. */
export type Branded<T, Brand extends string> = T & {
    readonly __brand: Brand;
};
export type TaskboardProjectId = Branded<string, 'TaskboardProjectId'>;
export type TaskboardTaskId = Branded<string, 'TaskboardTaskId'>;
export type TaskboardCommentId = Branded<string, 'TaskboardCommentId'>;
export type TaskboardRelationId = Branded<string, 'TaskboardRelationId'>;
export type TaskboardClaimId = Branded<string, 'TaskboardClaimId'>;
export type TaskboardActivityId = Branded<string, 'TaskboardActivityId'>;
export type TaskboardAttachmentId = Branded<string, 'TaskboardAttachmentId'>;
export type TaskboardWorkflowId = Branded<string, 'TaskboardWorkflowId'>;
export type TaskboardAutomationId = Branded<string, 'TaskboardAutomationId'>;
export declare const ProjectId: (value: string) => TaskboardProjectId;
export declare const TaskId: (value: string) => TaskboardTaskId;
export declare const CommentId: (value: string) => TaskboardCommentId;
export declare const RelationId: (value: string) => TaskboardRelationId;
export declare const ClaimId: (value: string) => TaskboardClaimId;
export declare const ActivityId: (value: string) => TaskboardActivityId;
export declare const AttachmentId: (value: string) => TaskboardAttachmentId;
export declare const WorkflowId: (value: string) => TaskboardWorkflowId;
export declare const AutomationId: (value: string) => TaskboardAutomationId;
//# sourceMappingURL=ids.d.ts.map