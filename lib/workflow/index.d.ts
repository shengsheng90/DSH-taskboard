import type { WorkflowCatalogEntry, WorkflowDocument, WorkflowNode, WorkflowNodePosition, WorkflowNodeProvider } from '../domain/index.js';
export declare const WORKFLOW_PARITY_CATALOG: readonly Omit<WorkflowCatalogEntry, 'execution'>[];
/** Provider registry separating editable catalog nodes from executable capabilities. */
export declare class WorkflowNodeRegistry {
    private readonly providers;
    register(provider: WorkflowNodeProvider): () => void;
    get(kind: string): WorkflowNodeProvider | undefined;
    catalog(): WorkflowCatalogEntry[];
    validate(document: WorkflowDocument): void;
    private validateNode;
    private unique;
}
/** Produce deterministic editor coordinates from document order and branch nesting. */
export declare function layoutWorkflow(document: WorkflowDocument): WorkflowNodePosition[];
/** Remove one non-trigger node from any nested sequence. */
export declare function removeWorkflowNode(document: WorkflowDocument, nodeId: string): WorkflowDocument;
/** Move one non-trigger node within its current ordered sequence. */
export declare function moveWorkflowNode(document: WorkflowDocument, nodeId: string, offset: -1 | 1): WorkflowDocument;
/** Copy one node and its nested subtree immediately after the original. */
export declare function copyWorkflowNode(document: WorkflowDocument, nodeId: string, idFor: (sourceId: string) => string): WorkflowDocument;
/** Insert a node into a tab's root steps or one condition branch. */
export declare function insertWorkflowNode(document: WorkflowDocument, tabId: string, node: WorkflowNode, parentId?: string, branch?: 'steps' | 'trueBranch' | 'falseBranch'): WorkflowDocument;
/** Add one tab with its required trigger. */
export declare function addWorkflowTab(document: WorkflowDocument, tab: WorkflowDocument['tabs'][number]): WorkflowDocument;
/** Delete a tab while retaining the invariant that at least one remains. */
export declare function removeWorkflowTab(document: WorkflowDocument, tabId: string): WorkflowDocument;
//# sourceMappingURL=index.d.ts.map