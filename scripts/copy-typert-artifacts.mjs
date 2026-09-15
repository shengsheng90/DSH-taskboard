import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'generated')
const destination = resolve(root, 'lib')
const artifacts = [
  'typert.host.js',
  'typert.host.d.ts',
  'typert.remote-client.js',
  'typert.remote-client.d.ts',
  'typert.remote-client.d.ts.map',
]

await mkdir(destination, { recursive: true })
await Promise.all(artifacts.map(async name => {
  try {
    await copyFile(resolve(source, name), resolve(destination, name))
  } catch (error) {
    if (name.endsWith('.map') && error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return
    }
    throw error
  }
}))
