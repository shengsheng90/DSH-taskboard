import assert from 'node:assert/strict'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable, Writable } from 'node:stream'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { TaskboardService } from '../src/service/index.js'

interface RpcRoute {
  readonly path: string
  readonly handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

async function fixture() {
  const ctx = new Context()
  const routes = new Map<string, RpcRoute>()
  let mounted!: (route: RpcRoute) => void
  const channel = new Promise<RpcRoute>(resolve => { mounted = resolve })
  let service!: TaskboardService
  // Separate provider fibers preserve the Host's service-injection boundaries.
  ctx.plugin({
    name: 'rpc-test-webserver',
    apply(owner: Context) {
      owner.provide('webServer', {
        register(route: RpcRoute) {
          routes.set(route.path, route)
          if (route.path === '/taskboard') mounted(route)
          return () => { routes.delete(route.path) }
        },
      } as never)
    },
  })
  ctx.plugin({
    name: 'rpc-test-connection',
    apply(owner: Context) {
      new HostConnectionService(owner, [], {
        isAuthenticated: (req: IncomingMessage) => req.headers.cookie === 'test-auth=ok',
      } as never)
    },
  })
  ctx.plugin({
    name: 'rpc-test-taskboard',
    apply(owner: Context) {
      service = new TaskboardService(owner, { databasePath: ':memory:', attachmentRoot: ':memory:' })
    },
  })
  const route = await channel
  return { ctx, routes, service, route }
}

async function request(route: RpcRoute, endpoint: string, body: unknown, headers: IncomingMessage['headers'] = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]) as IncomingMessage
  req.method = 'POST'
  req.url = `/taskboard/${endpoint}`
  req.headers = { host: '127.0.0.1:19387', 'content-type': 'application/json', cookie: 'test-auth=ok', ...headers }
  let status = 0
  const chunks: Buffer[] = []
  const res = new Writable({
    write(chunk: Buffer, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback() },
  }) as Writable & { writeHead(status: number, headers?: unknown): unknown }
  res.writeHead = value => { status = value; return res }
  await route.handler(req, res as unknown as ServerResponse)
  return { status, text: Buffer.concat(chunks).toString('utf8') }
}

const createProject = {
  type: 'client-request', rpcId: 'create-project', method: 'project.create',
  payload: { request: { key: 'RPC', name: 'HTTP channel' } },
}

test('RPC rejects invalid envelopes before they can modify SQLite', { timeout: 5_000 }, async () => {
  const { ctx, service, route } = await fixture()
  try {
    const { rpcId: _rpcId, ...missingId } = createProject
    const invalid = [
      missingId,
      ...[null, 7, {}, []].map(rpcId => ({ ...createProject, rpcId })),
      { ...createProject, type: 'server-response' },
      { ...createProject, method: 7 },
    ]
    for (const body of invalid) {
      const before = service.provider.globalRevision()
      const response = await request(route, 'project.create', body)
      assert.equal(response.status, 200)
      const envelope = JSON.parse(response.text)
      assert.equal(envelope.type, 'server-response')
      const rawId = 'rpcId' in body ? body.rpcId : undefined
      assert.equal(envelope.rpcId, typeof rawId === 'string' ? rawId : 'invalid-request')
      assert.equal(envelope.result.ok, false, `invalid envelope executed: ${JSON.stringify(body)}`)
      assert.equal(envelope.result.error.code, 'gateway/bad-request')
      assert.equal(service.provider.globalRevision(), before)
      assert.deepEqual(service.provider.listProjects(), [])
    }
  } finally {
    await ctx.fiber.dispose()
  }
})

test('RPC channel retains Host authentication and Origin checks before dispatch', { timeout: 5_000 }, async () => {
  const { ctx, service, route } = await fixture()
  try {
    for (const [headers, expected] of [
      [{ cookie: '' }, 401],
      [{ 'sec-fetch-site': 'cross-site' }, 403],
      [{ origin: 'http://untrusted.invalid' }, 403],
    ] as const) {
      assert.equal((await request(route, 'project.create', createProject, headers)).status, expected)
      assert.equal(service.provider.globalRevision(), 0)
    }
  } finally {
    await ctx.fiber.dispose()
  }
})

test('RPC channel commits valid writes, returns errors, and unregisters on unload', { timeout: 5_000 }, async () => {
  const { ctx, routes, service, route } = await fixture()
  try {
    const response = await request(route, 'project.create', createProject)
    assert.equal(response.status, 200)
    const envelope = JSON.parse(response.text)
    assert.equal(envelope.rpcId, createProject.rpcId)
    assert.equal(envelope.result.ok, true)
    assert.equal(service.provider.listProjects()[0]?.id, envelope.result.value.id)
    const taskResponse = await request(route, 'task.create', {
      type: 'client-request', rpcId: 'create-task', method: 'task.create',
      payload: { request: { projectId: envelope.result.value.id, title: 'Valid write', creator: 'test' } },
    })
    assert.equal(JSON.parse(taskResponse.text).result.ok, true)
    assert.equal(service.provider.globalRevision(), 2)
    const mismatch = await request(route, 'task.create', createProject)
    assert.equal(JSON.parse(mismatch.text).result.error.code, 'gateway/bad-request')
    assert.equal(service.provider.globalRevision(), 2)
    const domainError = await request(route, 'task.search', {
      type: 'client-request', rpcId: 'search', method: 'task.search',
      payload: { projectId: envelope.result.value.id, search: '' },
    })
    assert.match(JSON.parse(domainError.text).result.error.message, /TASK_INVALID_INPUT/)
    const malformedPath = await request(route, '%ZZ', createProject)
    assert.equal(malformedPath.status, 400)
    assert.equal(service.provider.globalRevision(), 2)
  } finally {
    await ctx.fiber.dispose()
  }
  assert.equal(routes.size, 0)
})
