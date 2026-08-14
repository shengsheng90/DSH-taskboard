import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SqliteTaskboardProvider } from '../../lib/index.js'

const root = mkdtempSync(join(tmpdir(), 'dsh-taskboard-example-'))
const provider = new SqliteTaskboardProvider(join(root, 'taskboard.sqlite'), {
  root: join(root, 'attachments'),
  maxAttachmentBytes: 1024,
  maxTaskAttachmentBytes: 4096,
  allowedContentTypes: ['text/plain'],
})
const human = { kind: 'human', actorId: 'human:example' }
const firstAgent = { kind: 'agent', actorId: 'agent:first', sessionId: 'session:first', agentId: 'agent:first' }
const secondAgent = { kind: 'agent', actorId: 'agent:second', sessionId: 'session:second', agentId: 'agent:second' }

try {
  const project = provider.createProject({ key: 'EX', name: 'Keyless example', labels: ['demo'] }, human)
  let task = provider.createTask({ projectId: project.id, title: 'Prove review gate', creator: human.actorId }, human)
  const states = [task.status]
  task = provider.approve(task.id, task.version, human); states.push(task.status)
  task = provider.claim(task.id, { expectedVersion: task.version, sessionId: firstAgent.sessionId, agentId: firstAgent.agentId }, firstAgent).task; states.push(task.status)
  task = provider.submitReview(task.id, task.version, 'node example assertion passed', 'First implementation', firstAgent); states.push(task.status)
  task = provider.returnForRework(task.id, task.version, 'todo', 'Add a second independent verification.', human); states.push(task.status)
  task = provider.claim(task.id, { expectedVersion: task.version, sessionId: secondAgent.sessionId, agentId: secondAgent.agentId }, secondAgent).task; states.push(task.status)
  task = provider.submitReview(task.id, task.version, 'second assertion passed', 'Reworked implementation', secondAgent); states.push(task.status)
  task = provider.accept(task.id, task.version, human); states.push(task.status)

  const detail = provider.getTaskDetail(task.id)
  const actual = {
    identifier: task.identifier,
    states,
    finalStatus: task.status,
    claimStates: detail.claims.map(claim => claim.state),
    commentBodies: detail.comments.map(comment => comment.body),
    activityKinds: detail.activities.map(activity => activity.kind),
  }
  const expectedPath = join(dirname(fileURLToPath(import.meta.url)), 'expected-transcript.json')
  const expected = JSON.parse(readFileSync(expectedPath, 'utf8'))
  assert.deepEqual(actual, expected)
  process.stdout.write(`${JSON.stringify(actual, null, 2)}\n`)
} finally {
  provider.close()
  rmSync(root, { recursive: true, force: true })
}
