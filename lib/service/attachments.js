import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { CommentId, TaskId, TaskboardError } from '../domain/index.js';
/** Dedicated byte transport guarded by short-lived capabilities minted over authenticated RPC. */
export class TaskboardAttachmentRoutes {
    provider;
    ttlMs;
    tickets = new Map();
    mounted = false;
    constructor(provider, ttlMs = 60_000) {
        this.provider = provider;
        this.ttlMs = ttlMs;
    }
    mount(webServer) {
        this.mounted = true;
        const dispose = webServer.register({
            kind: 'prefix',
            path: '/taskboard/attachments',
            handler: (request, response) => this.handle(request, response),
        });
        return () => {
            this.mounted = false;
            this.tickets.clear();
            dispose();
        };
    }
    issueUpload(input, actor) {
        this.assertMounted();
        const token = randomUUID();
        const expiresAt = Date.now() + this.ttlMs;
        this.sweep();
        this.tickets.set(token, { kind: 'upload', ...input, actor, expiresAt });
        return { url: `/taskboard/attachments/upload/${token}`, method: 'PUT', expiresAt };
    }
    issueDownload(attachmentId, disposition) {
        this.assertMounted();
        this.provider.getAttachment(attachmentId);
        const token = randomUUID();
        const expiresAt = Date.now() + this.ttlMs;
        this.sweep();
        this.tickets.set(token, { kind: 'download', attachmentId, disposition, expiresAt });
        return { url: `/taskboard/attachments/download/${token}`, expiresAt };
    }
    async handle(request, response) {
        const path = new URL(request.url ?? '/', 'http://taskboard.invalid').pathname.split('/').filter(Boolean);
        const operation = path[2];
        const token = path[3];
        if (token === undefined || (operation !== 'upload' && operation !== 'download')) {
            this.reply(response, 404, { error: 'not found' });
            return;
        }
        // Check the method before spending the capability. Consuming first meant a stray GET on an
        // upload URL, a preflight OPTIONS, or a retry with the wrong verb burned the single-use ticket
        // and forced the client to mint a new one against a possibly newer task version.
        const method = operation === 'upload' ? 'PUT' : 'GET';
        if (request.method !== method) {
            this.reply(response, 405, { error: `method must be ${method}` });
            return;
        }
        const ticket = this.consume(token);
        if (ticket === undefined || ticket.kind !== operation) {
            this.reply(response, 404, { error: 'ticket is invalid or expired' });
            return;
        }
        try {
            if (ticket.kind === 'upload')
                await this.upload(request, response, ticket);
            else
                await this.download(request, response, ticket);
        }
        catch (error) {
            const status = error instanceof TaskboardError && error.code === 'ATTACHMENT_SIZE_EXCEEDED' ? 413 : 400;
            this.reply(response, status, {
                error: error instanceof TaskboardError
                    ? { code: error.code, message: error.message, details: error.details ?? {} }
                    : { code: 'ATTACHMENT_STORAGE_FAILURE', message: error instanceof Error ? error.message : String(error) },
            });
        }
    }
    async upload(request, response, ticket) {
        const declared = Number(request.headers['content-length'] ?? 0);
        const limit = this.provider.attachmentOptions.maxAttachmentBytes;
        if (Number.isFinite(declared) && declared > limit) {
            throw new TaskboardError('attachment exceeds the configured per-file limit', 'ATTACHMENT_SIZE_EXCEEDED', { actual: declared, limit });
        }
        const chunks = [];
        let total = 0;
        for await (const raw of request) {
            const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
            total += chunk.byteLength;
            if (total > limit)
                throw new TaskboardError('attachment exceeds the configured per-file limit', 'ATTACHMENT_SIZE_EXCEEDED', { actual: total, limit });
            chunks.push(chunk);
        }
        const created = this.provider.createAttachment(TaskId(ticket.taskId), ticket.expectedVersion, {
            filename: ticket.filename,
            contentType: ticket.contentType,
            bytes: Buffer.concat(chunks, total),
            ...(ticket.commentId === undefined ? {} : { commentId: CommentId(ticket.commentId) }),
        }, ticket.actor);
        this.reply(response, 201, created);
    }
    async download(_request, response, ticket) {
        // Resolve and validate before writing the head, then stream: a 25MB attachment should not be
        // held in memory in full just to be handed to the socket.
        const opened = this.provider.openAttachment(ticket.attachmentId, ticket.disposition);
        response.writeHead(200, { ...opened.headers, 'cache-control': 'private, no-store' });
        const stream = createReadStream(opened.path);
        try {
            await pipeline(stream, response);
        }
        catch (cause) {
            // The head is already sent, so destroy the socket rather than emit a misleading body.
            response.destroy(cause instanceof Error ? cause : new Error(String(cause)));
        }
    }
    consume(token) {
        const ticket = this.tickets.get(token);
        this.tickets.delete(token);
        return ticket === undefined || ticket.expiresAt < Date.now() ? undefined : ticket;
    }
    sweep() {
        const timestamp = Date.now();
        for (const [token, ticket] of this.tickets)
            if (ticket.expiresAt < timestamp)
                this.tickets.delete(token);
    }
    assertMounted() {
        if (!this.mounted)
            throw new TaskboardError('attachment byte route is unavailable', 'ATTACHMENT_STORAGE_FAILURE');
    }
    reply(response, status, value) {
        if (response.headersSent)
            return;
        response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        response.end(JSON.stringify(value));
    }
}
//# sourceMappingURL=attachments.js.map