import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { TaskboardService } from '../src/service/index.js'

test('Cordis plugin unload closes the SQLite authority exactly once', async () => {
  const ctx = new Context()
  const service = new TaskboardService(ctx, {
    databasePath: ':memory:',
    attachmentRoot: '.dsh/test-lifecycle-attachments',
  })
  const close = service.provider.close.bind(service.provider)
  let calls = 0
  service.provider.close = () => { calls += 1; close() }

  await ctx.fiber.dispose()
  assert.equal(calls, 1)
  assert.throws(() => service.provider.globalRevision())
})
