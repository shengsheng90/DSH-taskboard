import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspace = join(root, '.typert-workspace')
const packageDir = join(workspace, 'packages', 'taskboard')
const protocolDir = join(workspace, 'packages', 'typert', 'protocol')
const generated = join(root, 'generated')
const keepWorkspace = process.env.KEEP_TYPERT_WORKSPACE === '1'
const harnessRoot = resolve(process.env.DSH_HARNESS_ROOT ?? join(root, '../deepseek-harness'))
const generatorPath = join(harnessRoot, 'packages/typert/generator/src/workspace.ts')
const protocolSrc = join(harnessRoot, 'packages/typert/protocol/src')
const protocolManifest = join(harnessRoot, 'packages/typert/protocol/package.json')

if (!existsSync(generatorPath) || !existsSync(protocolSrc) || !existsSync(protocolManifest)) {
  throw new Error(
    `Cannot find the Harness Typert generator/protocol under ${harnessRoot}. `
    + 'Set DSH_HARNESS_ROOT to a DeepSeek Harness checkout that already requires create() factories.',
  )
}

/** Reuse this repo's own compiler options so the analyzed types match `pnpm typecheck`.
 *  Only the workspace layout differs: composite references, no emit, and rewritten paths. */
const ownCompilerOptions = JSON.parse(await readFile(join(root, 'tsconfig.json'), 'utf8')).compilerOptions
const { baseUrl: _baseUrl, rootDir: _rootDir, paths: _paths, ...sharedCompilerOptions } = ownCompilerOptions

const hostTsconfig = `{
  "extends": "./tsconfig.base.json",
  "files": [],
  "references": [
    { "path": "./packages/typert/protocol" },
    { "path": "./packages/taskboard" }
  ]
}
`

const baseTsconfig = `${JSON.stringify({
  compilerOptions: {
    ...sharedCompilerOptions,
    composite: true,
    noEmit: true,
    paths: {
      '@deepseek-ai/dsh-typert-protocol': ['./packages/typert/protocol/src/index.ts'],
      '@shengsheng/dsh-taskboard/domain': ['./packages/taskboard/src/domain/index.ts'],
    },
  },
}, null, 2)}
`

const packageTsconfig = `{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/client"]
}
`

const protocolTsconfig = `{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
`

/** Emit `schema` next to every `create()` factory so one artifact loads on both Host generations.
 *  Harness at published 0.1.6-alpha.1 reads `codec.schema`; the newer loader reads `codec.create()`.
 *  The accessor keeps the factory's materialize-on-first-use behaviour for the legacy field too. */
function withLegacySchemaField(js) {
  const factories = /^(\s*)create: ([\w$]+),$/gm
  const patched = js.replace(factories, '$1create: $2,\n$1get schema() { return $2() },')
  const added = patched.split('\n').length - js.split('\n').length
  if (added === 0) throw new Error('typert generator emitted no create() factories to mirror as schema')
  return { js: patched, added }
}

/** A codec that analyzed as `any` validates nothing at the Host boundary. The synthetic
 *  workspace resolves no peer packages, so an unresolved type would degrade silently. */
function assertNoDegradedCodecs(js, label) {
  if (js.includes('z.any(')) {
    throw new Error(`${label} contains z.any() — a type failed to resolve in the synthetic workspace`)
  }
}

await rm(workspace, { recursive: true, force: true })
await mkdir(packageDir, { recursive: true })
await mkdir(protocolDir, { recursive: true })
await writeFile(join(workspace, 'tsconfig.host.json'), hostTsconfig)
await writeFile(join(workspace, 'tsconfig.base.json'), baseTsconfig)
await writeFile(join(packageDir, 'tsconfig.json'), packageTsconfig)
await writeFile(join(protocolDir, 'tsconfig.json'), protocolTsconfig)
await cp(join(root, 'package.json'), join(packageDir, 'package.json'))
await cp(join(root, 'src'), join(packageDir, 'src'), { recursive: true })
await cp(protocolManifest, join(protocolDir, 'package.json'))
await cp(protocolSrc, join(protocolDir, 'src'), { recursive: true })

try {
  // The published generator at 0.1.6-alpha.1 still emits `schema`. The checkout
  // loader requires create() factories, and it only recognizes Remote markers
  // when @deepseek-ai/dsh-typert-protocol is a workspace package.
  const { WorkspaceTypertGenerator } = await import(pathToFileURL(generatorPath).href)
  const artifacts = new WorkspaceTypertGenerator(workspace, { checkDiagnostics: false }).generate(
    ['@shengsheng/dsh-taskboard'],
    ['host'],
  )
  const host = artifacts.find(artifact => artifact.package === '@shengsheng/dsh-taskboard' && artifact.face === 'host')
  if (host === undefined) {
    throw new Error('typert generator did not emit a host artifact for @shengsheng/dsh-taskboard')
  }
  if (host.remote === undefined) {
    throw new Error('typert generator did not emit Host-for-Client Remote artifacts')
  }

  assertNoDegradedCodecs(host.js, 'typert.host.js')
  assertNoDegradedCodecs(host.remote.js, 'typert.remote-client.js')
  const hostJs = withLegacySchemaField(host.js)
  const remoteJs = withLegacySchemaField(host.remote.js)

  const files = {
    'typert.host.js': hostJs.js,
    'typert.host.d.ts': host.dts,
    'typert.remote-client.js': remoteJs.js,
    'typert.remote-client.d.ts': host.remote.dts,
    'typert.remote-client.d.ts.map': host.remote.dtsMap,
  }
  await mkdir(generated, { recursive: true })
  await Promise.all(Object.entries(files).map(([name, contents]) => writeFile(join(generated, name), contents)))
  console.log(`wrote ${Object.keys(files).length} Typert artifact(s) to ${generated} from ${generatorPath}`)
  console.log(`mirrored ${hostJs.added + remoteJs.added} create() factories as legacy schema accessors`)
} finally {
  if (!keepWorkspace) await rm(workspace, { recursive: true, force: true })
}
