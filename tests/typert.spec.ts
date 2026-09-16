import assert from 'node:assert/strict'
import test from 'node:test'
import type { TypertCodec } from '@deepseek-ai/dsh-typert-protocol'
import { TYPERT } from '../generated/typert.host.js'
import remote from '../generated/typert.remote-client.js'

/** Compile-time anchor on the pinned Host contract. `scripts/generate-typert.mjs` mirrors every
 *  `create()` factory as a `schema` accessor because the published Harness still reads that field;
 *  when a release drops it from `TypertCodec` this alias stops resolving and the mirror can go. */
type StrictCodec = Extract<TypertCodec, { readonly mode: 'strict' }>
type _LegacySchemaFieldStillExists = StrictCodec['schema']

const MUTATE_ID = '@shengsheng/dsh-taskboard#taskboard/mutate'
const REMOTE_IDS = [MUTATE_ID, '@shengsheng/dsh-taskboard#taskboard/snapshot', '@shengsheng/dsh-taskboard#taskboard/taskDetail']

interface RuntimeCodec {
  readonly mode?: unknown
  readonly create?: unknown
  readonly schema?: unknown
}

interface RuntimeParameter {
  readonly wire?: unknown
  readonly codec?: unknown
}

interface RuntimeInvocation {
  readonly id?: unknown
  readonly parameters?: unknown
  readonly result?: unknown
}

interface RuntimeSchema {
  parse: (value: unknown) => unknown
}

/** The Host face lists `invocations`; the Host-for-Client face lists `descriptors`. Read the key
 *  each manifest is supposed to carry rather than falling back, so a face that loses its own key
 *  fails here instead of quietly passing on the other one. */
function invocationsOf(manifest: unknown, key: 'invocations' | 'descriptors', label: string): readonly RuntimeInvocation[] {
  assert.ok(manifest !== null && typeof manifest === 'object', `${label} must be an object`)
  const invocations = (manifest as Record<string, unknown>)[key]
  assert.ok(Array.isArray(invocations), `${label} must list ${key}`)
  return invocations as RuntimeInvocation[]
}

/** One artifact has to load on both Host generations: `0.1.6-alpha.1` reads `codec.schema`,
 *  the newer loader reads `codec.create()`. Assert both, and that they hand back one memoized
 *  schema so the legacy field keeps the materialize-on-first-use behaviour. */
function assertCodec(value: unknown, subject: string): RuntimeSchema {
  assert.ok(value !== null && typeof value === 'object', `${subject} must be a codec object`)
  const codec = value as RuntimeCodec
  assert.equal(codec.mode, 'strict', `${subject} must be a strict codec`)
  assert.equal(typeof codec.create, 'function', `${subject} must expose create()`)
  const schema = (codec.create as () => unknown)()
  assert.ok(schema !== null && typeof schema === 'object', `${subject} create() must return a schema`)
  assert.equal(typeof (schema as RuntimeSchema).parse, 'function', `${subject} schema must expose parse()`)
  assert.equal(codec.schema, schema, `${subject} legacy schema field must mirror create()`)
  return schema as RuntimeSchema
}

function assertManifest(manifest: unknown, key: 'invocations' | 'descriptors', label: string): void {
  const invocations = invocationsOf(manifest, key, label)
  assert.deepEqual(
    invocations.map(invocation => invocation.id).sort(),
    [...REMOTE_IDS].sort(),
    `${label} must emit exactly the Taskboard remotes`,
  )
  for (const invocation of invocations) {
    const id = String(invocation.id)
    assert.ok(Array.isArray(invocation.parameters), `${id} must declare a parameters array`)
    for (const [index, parameter] of (invocation.parameters as RuntimeParameter[]).entries()) {
      const wire = typeof parameter.wire === 'string' ? parameter.wire : String(index)
      assertCodec(parameter.codec, `${id} parameter ${wire}`)
    }
    assertCodec(invocation.result, `${id} result`)
  }
}

function mutateRequestSchema(manifest: unknown, key: 'invocations' | 'descriptors', label: string): RuntimeSchema {
  const mutate = invocationsOf(manifest, key, label).find(invocation => invocation.id === MUTATE_ID)
  assert.ok(mutate !== undefined, `${label} must emit ${MUTATE_ID}`)
  const [parameter] = mutate.parameters as RuntimeParameter[]
  assert.ok(parameter !== undefined, `${MUTATE_ID} must declare its request parameter`)
  return assertCodec(parameter.codec, `${MUTATE_ID} parameter 0`)
}

test('generated Typert host codecs carry both create() and schema', () => {
  assertManifest(TYPERT, 'invocations', 'TYPERT')
})

test('generated Typert remote codecs carry both create() and schema', () => {
  assert.equal((remote as { package?: unknown }).package, '@shengsheng/dsh-taskboard')
  assertManifest(remote, 'descriptors', 'TYPERT_REMOTE')
})

test('generated codecs still validate the domain request shape', () => {
  for (const [manifest, key, label] of [[TYPERT, 'invocations', 'TYPERT'], [remote, 'descriptors', 'TYPERT_REMOTE']] as const) {
    const schema = mutateRequestSchema(manifest, key, label)
    const request = { endpoint: 'changes.watch', payloadJson: '{"afterRevision":0}' }
    assert.deepEqual(schema.parse(request), request, `${label} must accept a well-formed mutation request`)
    assert.throws(() => schema.parse({ endpoint: 'changes.watch' }), `${label} must reject a missing payloadJson`)
    assert.throws(() => schema.parse({ ...request, endpoint: 1 }), `${label} must reject a non-string endpoint`)
  }
})
