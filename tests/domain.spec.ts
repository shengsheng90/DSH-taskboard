import assert from 'node:assert/strict'
import test from 'node:test'
import { isHumanOnlyOperation, parseTaskStatus, requireHuman, requireStatus, TaskboardError } from '../src/domain/index.js'
import type { AgentActor, HumanActor } from '../src/domain/index.js'

const human: HumanActor = { kind: 'human', actorId: 'user-1' }
const agent: AgentActor = { kind: 'agent', actorId: 'agent-1', sessionId: 'session-1', agentId: 'agent-1' }

test('human-only policy rejects Agent authority with a stable code', () => {
  assert.doesNotThrow(() => { requireHuman(human, 'accept') })
  assert.throws(
    () => { requireHuman(agent, 'accept') },
    (error: unknown) => error instanceof TaskboardError && error.code === 'TASK_HUMAN_AUTHORITY_REQUIRED',
  )
  assert.equal(isHumanOnlyOperation('accept'), true)
  assert.equal(isHumanOnlyOperation('move status'), true)
  assert.equal(isHumanOnlyOperation('claim'), false)
})

test('intent transitions reject unsupported source states', () => {
  assert.doesNotThrow(() => { requireStatus('backlog', ['backlog'], 'approve') })
  assert.throws(
    () => { requireStatus('done', ['backlog'], 'approve') },
    (error: unknown) => error instanceof TaskboardError && error.code === 'TASK_INVALID_TRANSITION',
  )
})

test('parseTaskStatus accepts the closed vocabulary and rejects unknown tokens', () => {
  assert.equal(parseTaskStatus('in_review'), 'in_review')
  assert.throws(
    () => { parseTaskStatus('ready') },
    (error: unknown) => error instanceof TaskboardError && error.code === 'TASK_INVALID_INPUT',
  )
})
