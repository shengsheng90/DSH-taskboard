import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(process.argv.find(arg => arg.startsWith('--root='))?.slice(7)
  ?? join(dirname(fileURLToPath(import.meta.url)), '..'))
const manifestPath = join(root, 'lib/build-manifest.json')
// Git clients may normalize text line endings; that is not a changed program.
const digest = async path => createHash('sha256')
  .update((await readFile(join(root, path), 'utf8')).replaceAll('\r\n', '\n')).digest('hex')

async function files(dir) {
  const entries = await readdir(join(root, dir), { withFileTypes: true })
  const nested = await Promise.all(entries.map(entry => entry.isDirectory()
    ? files(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]))
  return nested.flat().sort()
}

async function hashes(paths) {
  return Object.fromEntries(await Promise.all(paths.map(async path => [path, await digest(path)])))
}

async function inputFiles() {
  return [...await files('src'), ...await files('generated'), ...await files('scripts'),
    'package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'tsconfig.build.json', 'tsdown.config.ts'].sort()
}

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const required = [pkg.main, pkg.types, ...Object.values(pkg.bin), 'lib/client.js',
  ...Object.values(pkg.exports).flatMap(value => typeof value === 'string' ? [value] : Object.values(value)),
  pkg.dsh.bundle.patch, 'skills/manage-taskboard/SKILL.md']
for (const path of required) await readFile(join(root, path))
for (const name of ['prepare', 'prepack', 'prepublish', 'preinstall', 'install', 'postinstall']) {
  if (pkg.scripts[name]) throw new Error(`Installation must not run ${name}`)
}

if (process.argv.includes('--write')) {
  const sourceFiles = await inputFiles()
  const outputFiles = (await files('lib')).filter(path => path !== 'lib/build-manifest.json' && !path.endsWith('.js.map'))
  await writeFile(manifestPath, `${JSON.stringify({ inputs: await hashes(sourceFiles), outputs: await hashes(outputFiles) }, null, 2)}\n`)
} else {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (process.argv.includes('--source') && JSON.stringify(await inputFiles()) !== JSON.stringify(Object.keys(manifest.inputs))) {
    throw new Error('Added or removed build inputs; run pnpm build and commit lib/')
  }
  const entries = { ...manifest.outputs, ...(process.argv.includes('--source') ? manifest.inputs : {}) }
  for (const [path, expected] of Object.entries(entries)) {
    if (await digest(path) !== expected) throw new Error(`Stale or modified ${path}; run pnpm build and commit lib/`)
  }
  const actual = (await files('lib')).filter(path => path !== 'lib/build-manifest.json' && !path.endsWith('.js.map'))
  if (JSON.stringify(actual) !== JSON.stringify(Object.keys(manifest.outputs))) {
    throw new Error('Unexpected or missing lib/ files; run pnpm build')
  }
}
console.log('Package entry points and prebuilt artifacts verified')
