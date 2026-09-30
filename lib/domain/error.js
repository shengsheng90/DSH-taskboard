/** Stable domain error returned across CLI, tool, and RPC boundaries. */
export class TaskboardError extends Error {
    code;
    details;
    constructor(message, code, details) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = 'TaskboardError';
    }
}
//# sourceMappingURL=error.js.map