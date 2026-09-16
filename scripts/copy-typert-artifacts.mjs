import { existsSync } from 'node:fs'
import { copyFile, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'generated')
const destination = resolve(root, 'lib')
const artifacts = [
  { name: 'typert.host.js' },
  { name: 'typert.host.d.ts' },
  { name: 'typert.remote-client.js' },
  { name: 'typert.remote-client.d.ts' },
  // Only emitted by a Harness checkout whose generator returns `remote.dtsMap`.
  { name: 'typert.remote-client.d.ts.map', optional: true },
]

await mkdir(destination, { recursive: true })
await Promise.all(artifacts.map(async ({ name, optional }) => {
  const from = resolve(source, name)
  const to = resolve(destination, name)
  // The build never cleans `lib/`, so a vanished optional artifact has to be cleared here
  // or the previous build's copy keeps pairing with freshly emitted declarations.
  if (optional === true && !existsSync(from)) return rm(to, { force: true })
  return copyFile(from, to)
}))
