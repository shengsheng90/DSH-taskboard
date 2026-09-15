import assert from 'node:assert/strict'
import test from 'node:test'
import { TYPERT } from '../generated/typert.host.js'
import remote from '../generated/typert.remote-client.js'

interface RuntimeCodec {
  readonly mode?: unknown
  readonly create?: unknown
  readonly schema?: unknown
}

interface RuntimeInvocation {
  readonly id?: unknown
  readonly parameters?: readonly { readonly wire?: unknown; readonly codec?: RuntimeCodec }[]
  readonly result?: RuntimeCodec
}

function invocationsOf(manifest: unknown): readonly RuntimeInvocation[] {
  assert.equal(typeof manifest, 'object')
  assert.notEqual(manifest, null)
  const invocations = (manifest as { invocations?: unknown; descriptors?: unknown }).invocations
    ?? (manifest as { descriptors?: unknown }).descriptors
  assert.ok(Array.isArray(invocations), 'Typert manifest must list invocations')
  return invocations as RuntimeInvocation[]
}

function assertFactory(codec: RuntimeCodec | undefined, subject: string): void {
  assert.equal(codec?.mode, 'strict', `${subject} must be a strict codec`)
  assert.equal(typeof codec?.create, 'function', `${subject} must expose create()`)
  assert.equal(codec?.schema, undefined, `${subject} must not keep the pre-factory schema field`)
}

function assertManifest(manifest: unknown, label: string): void {
  const invocations = invocationsOf(manifest)
  assert.ok(invocations.length >= 3, `${label} must emit the Taskboard remotes`)
  for (const invocation of invocations) {
    const id = typeof invocation.id === 'string' ? invocation.id : label
    invocation.parameters?.forEach((parameter, index) => {
      const wire = typeof parameter.wire === 'string' ? parameter.wire : String(index)
      assertFactory(parameter.codec, `${id} parameter ${wire}`)
    })
    assertFactory(invocation.result, `${id} result`)
  }
}

test('generated Typert host codecs expose create() factories', () => {
  assertManifest(TYPERT, 'TYPERT')
})

test('generated Typert remote codecs expose create() factories', () => {
  assert.equal((remote as { package?: unknown }).package, '@shengsheng/dsh-taskboard')
  assertManifest(remote, 'TYPERT_REMOTE')
})
