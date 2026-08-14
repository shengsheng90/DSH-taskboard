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
]

await mkdir(destination, { recursive: true })
await Promise.all(artifacts.map(name => copyFile(resolve(source, name), resolve(destination, name))))
