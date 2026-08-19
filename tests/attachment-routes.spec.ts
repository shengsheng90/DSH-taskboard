import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import test from 'node:test'
import { SqliteTaskboardProvider } from '../src/index.js'
import { TaskboardAttachmentRoutes } from '../src/service/attachments.js'

function responseCapture() {
  let status = 0
  let headers: Record<string, string | number> = {}
  const chunks: Buffer[] = []
  const target = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      chunks.push(Buffer.from(chunk as Buffer))
      callback()
    },
  }) as Writable & {
    headersSent: boolean
    writeHead(status: number, headers: Record<string, string | number>): unknown
  }
  target.headersSent = false
  target.writeHead = (nextStatus, nextHeaders) => {
    status = nextStatus
    headers = nextHeaders
    target.headersSent = true
    return target
  }
  const response = target as unknown as ServerResponse
  return { response, read: () => ({ status, headers, body: Buffer.concat(chunks) }) }
}

function request(method: string, url: string, body?: Uint8Array): IncomingMessage {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(body)]) as IncomingMessage
  stream.method = method
  stream.url = url
  stream.headers = { ...(body === undefined ? {} : { 'content-length': String(body.byteLength) }) }
  return stream
}

test('attachment byte route uses expiring single-use upload and download capabilities', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-taskboard-route-'))
  const provider = new SqliteTaskboardProvider(join(directory, 'taskboard.sqlite'), {
    root: join(directory, 'attachments'), maxAttachmentBytes: 32, maxTaskAttachmentBytes: 64,
    allowedContentTypes: ['text/plain'], allowSharedWorktrees: false,
  })
  const human = { kind: 'human' as const, actorId: 'web-user' }
  let handler: ((request: IncomingMessage, response: ServerResponse) => void | Promise<void>) | undefined
  const routes = new TaskboardAttachmentRoutes(provider)
  routes.mount({ register(route: { handler: typeof handler }) { handler = route.handler; return () => undefined } } as never)
  try {
    const project = provider.createProject({ key: 'DSH', name: 'Harness' }, human)
    const task = provider.createTask({ projectId: project.id, title: 'Bytes', creator: human.actorId }, human)
    const upload = routes.issueUpload({
      taskId: task.id, expectedVersion: task.version, filename: 'proof.txt', contentType: 'text/plain',
    }, human)
    const uploadedResponse = responseCapture()
    await handler!(request('PUT', upload.url, new TextEncoder().encode('verified')), uploadedResponse.response)
    assert.equal(uploadedResponse.read().status, 201)
    const attachment = provider.listAttachments(task.id)[0]!
    assert.equal(attachment.filename, 'proof.txt')

    const replayResponse = responseCapture()
    await handler!(request('PUT', upload.url, new Uint8Array([1])), replayResponse.response)
    assert.equal(replayResponse.read().status, 404)

    const download = routes.issueDownload(attachment.id, 'attachment')
    const downloadedResponse = responseCapture()
    await handler!(request('GET', download.url), downloadedResponse.response)
    const downloaded = downloadedResponse.read()
    assert.equal(downloaded.status, 200)
    assert.equal(downloaded.body.toString(), 'verified')
    assert.equal(downloaded.headers['x-content-type-options'], 'nosniff')
    assert.match(String(downloaded.headers['content-disposition']), /^attachment;/)
  } finally {
    provider.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('a download ticket streams a larger attachment and refuses a corrupted stored file', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-taskboard-stream-'))
  const provider = new SqliteTaskboardProvider(join(directory, 'taskboard.sqlite'), {
    root: join(directory, 'attachments'), maxAttachmentBytes: 512 * 1024, maxTaskAttachmentBytes: 1024 * 1024,
    allowedContentTypes: ['application/octet-stream'], allowSharedWorktrees: false,
  })
  const human = { kind: 'human' as const, actorId: 'web-user' }
  let handler: ((request: IncomingMessage, response: ServerResponse) => void | Promise<void>) | undefined
  const routes = new TaskboardAttachmentRoutes(provider)
  routes.mount({ register(route: { handler: typeof handler }) { handler = route.handler; return () => undefined } } as never)
  try {
    const project = provider.createProject({ key: 'DSH', name: 'Harness' }, human)
    const task = provider.createTask({ projectId: project.id, title: 'Bytes', creator: human.actorId }, human)
    // Larger than one stream chunk, so the response is assembled from several writes.
    const bytes = new Uint8Array(200_000).fill(7)
    const created = provider.createAttachment(task.id, task.version, {
      filename: 'blob.bin', contentType: 'application/octet-stream', bytes,
    }, human)

    const download = routes.issueDownload(created.attachment.id, 'attachment')
    const captured = responseCapture()
    await handler!(request('GET', download.url), captured.response)
    const result = captured.read()
    assert.equal(result.status, 200)
    assert.equal(result.body.byteLength, bytes.byteLength)
    assert.equal(result.headers['content-length'], String(bytes.byteLength))
    assert.ok(result.body.every(value => value === 7))

    // A stored file that disagrees with the authority row must fail before any body is written.
    const storage = readdirSync(join(directory, 'attachments'), { recursive: true, withFileTypes: true })
      .find(entry => entry.isFile())!
    writeFileSync(join(storage.parentPath, storage.name), Buffer.from([1, 2, 3]))
    const corrupted = responseCapture()
    await handler!(request('GET', routes.issueDownload(created.attachment.id, 'attachment').url), corrupted.response)
    assert.equal(corrupted.read().status, 400)
    assert.match(corrupted.read().body.toString(), /ATTACHMENT_STORAGE_FAILURE/)
  } finally {
    provider.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('a wrong method is rejected without spending the one-time ticket', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-taskboard-method-'))
  const provider = new SqliteTaskboardProvider(join(directory, 'taskboard.sqlite'), {
    root: join(directory, 'attachments'), maxAttachmentBytes: 64, maxTaskAttachmentBytes: 128,
    allowedContentTypes: ['text/plain'], allowSharedWorktrees: false,
  })
  const human = { kind: 'human' as const, actorId: 'web-user' }
  let handler: ((request: IncomingMessage, response: ServerResponse) => void | Promise<void>) | undefined
  const routes = new TaskboardAttachmentRoutes(provider)
  routes.mount({ register(route: { handler: typeof handler }) { handler = route.handler; return () => undefined } } as never)
  try {
    const project = provider.createProject({ key: 'DSH', name: 'Harness' }, human)
    const task = provider.createTask({ projectId: project.id, title: 'Bytes', creator: human.actorId }, human)
    const upload = routes.issueUpload({
      taskId: task.id, expectedVersion: task.version, filename: 'proof.txt', contentType: 'text/plain',
    }, human)

    // A stray GET, or a preflight OPTIONS from a proxy, used to consume the capability before the
    // method was ever checked, so the client had to mint a new ticket against a newer version.
    const wrongMethod = responseCapture()
    await handler!(request('GET', upload.url), wrongMethod.response)
    assert.equal(wrongMethod.read().status, 405)
    const preflight = responseCapture()
    await handler!(request('OPTIONS', upload.url), preflight.response)
    assert.equal(preflight.read().status, 405)

    const accepted = responseCapture()
    await handler!(request('PUT', upload.url, new TextEncoder().encode('verified')), accepted.response)
    assert.equal(accepted.read().status, 201)
    assert.equal(provider.getTaskDetail(task.id).attachments.length, 1)

    // Still single use once it is actually spent.
    const replay = responseCapture()
    await handler!(request('PUT', upload.url, new TextEncoder().encode('again')), replay.response)
    assert.equal(replay.read().status, 404)

    const download = routes.issueDownload(provider.getTaskDetail(task.id).attachments[0]!.id, 'attachment')
    const wrongDownload = responseCapture()
    await handler!(request('POST', download.url), wrongDownload.response)
    assert.equal(wrongDownload.read().status, 405)
    const streamed = responseCapture()
    await handler!(request('GET', download.url), streamed.response)
    assert.equal(streamed.read().status, 200)
    assert.equal(streamed.read().body.toString(), 'verified')
  } finally {
    provider.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
