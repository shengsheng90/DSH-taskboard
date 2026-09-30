import type { WebServer } from '@deepseek-ai/dsh-host-webserver';
import type { HumanActor } from '../domain/index.js';
import type { SqliteTaskboardProvider } from '../sqlite/index.js';
/** Dedicated byte transport guarded by short-lived capabilities minted over authenticated RPC. */
export declare class TaskboardAttachmentRoutes {
    private readonly provider;
    private readonly ttlMs;
    private readonly tickets;
    private mounted;
    constructor(provider: SqliteTaskboardProvider, ttlMs?: number);
    mount(webServer: WebServer): () => void;
    issueUpload(input: {
        readonly taskId: string;
        readonly expectedVersion: number;
        readonly filename: string;
        readonly contentType: string;
        readonly commentId?: string;
    }, actor: HumanActor): {
        readonly url: string;
        readonly method: 'PUT';
        readonly expiresAt: number;
    };
    issueDownload(attachmentId: string, disposition: 'attachment' | 'inline'): {
        readonly url: string;
        readonly expiresAt: number;
    };
    private handle;
    private upload;
    private download;
    private consume;
    private sweep;
    private assertMounted;
    private reply;
}
//# sourceMappingURL=attachments.d.ts.map