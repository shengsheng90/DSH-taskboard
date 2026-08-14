import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { TaskboardService } from '../src/service/index.js'
import { taskboardToolDefinitions } from '../src/tool/index.js'
import type { HumanActor } from '../src/domain/index.js'

const human: HumanActor = { kind: 'human', actorId: 'user-1' }

test('model tool catalog omits accept and generic status mutation', () => {
  const service = new TaskboardService(new Context(), { databasePath: ':memory:', attachmentRoot: '.dsh/test' })
  try {
    const names = taskboardToolDefinitions(service).map(tool => tool.name)
    assert.deepEqual(names, [
      'taskboard_list', 'taskboard_get', 'taskboard_claim', 'taskboard_comment',
      'taskboard_submit_review', 'taskboard_block', 'taskboard_release_claim', 'taskboard_relate',
    ])
    assert.equal(names.includes('taskboard_accept'), false)
  } finally {
    service.provider.close()
  }
})

test('claim and review tools derive ownership from the executing Agent', async () => {
  const service = new TaskboardService(new Context(), { databasePath: ':memory:', attachmentRoot: '.dsh/test' })
  try {
    const project = service.provider.createProject({ key: 'DSH', name: 'Harness' }, human)
    let task = service.provider.createTask({ projectId: project.id, title: 'Tools', creator: human.actorId }, human)
    task = service.provider.approve(task.id, task.version, human)
    const definitions = taskboardToolDefinitions(service)
    const claim = definitions.find(tool => tool.name === 'taskboard_claim')!
    const review = definitions.find(tool => tool.name === 'taskboard_submit_review')!
    const exec = { agent: { id: 'session-1' } } as never

    const claimed = await claim.execute({ task_id: task.id, expected_version: task.version }, exec) as { task: { version: number } }
    await review.execute({
      task_id: task.id,
      expected_version: claimed.task.version,
      verification: 'tests passed',
      result_comment: 'implemented',
    }, exec)
    const detail = service.provider.getTaskDetail(task.id)
    assert.equal(detail.task.status, 'in_review')
    assert.equal(detail.activeClaim, undefined)
    assert.equal(detail.comments.length, 1)
  } finally {
    service.provider.close()
  }
})
