import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { SqliteTaskboardProvider } from '../src/index.js'
import { TaskboardAttachmentRoutes } from '../src/service/attachments.js'

function responseCapture() {
  let status = 0
  let headers: Record<string, string | number> = {}
  let body = Buffer.alloc(0)
  const target = {
    headersSent: false,
    writeHead(nextStatus: number, nextHeaders: Record<string, string | number>) {
      status = nextStatus
      headers = nextHeaders
      target.headersSent = true
      return target
    },
    end(value?: string | Uint8Array) {
      body = value === undefined ? Buffer.alloc(0) : Buffer.from(value)
      return target
    },
  }
  const response = target as unknown as ServerResponse
  return { response, read: () => ({ status, headers, body }) }
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
