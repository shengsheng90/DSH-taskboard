import { existsSync } from 'node:fs'
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

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

const hostTsconfig = `{
  "extends": "./tsconfig.base.json",
  "files": [],
  "references": [
    { "path": "./packages/typert/protocol" },
    { "path": "./packages/taskboard" }
  ]
}
`

const baseTsconfig = `{
  "compilerOptions": {
    "target": "ES2023",
    "jsx": "react-jsx",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["node"],
    "ignoreDeprecations": "6.0",
    "composite": true,
    "noEmit": true,
    "paths": {
      "@deepseek-ai/dsh-typert-protocol": ["./packages/typert/protocol/src/index.ts"],
      "@shengsheng/dsh-taskboard/domain": ["./packages/taskboard/src/domain/index.ts"]
    }
  }
}
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

  await mkdir(generated, { recursive: true })
  await writeFile(join(generated, 'typert.host.js'), host.js)
  await writeFile(join(generated, 'typert.host.d.ts'), host.dts)
  await writeFile(join(generated, 'typert.remote-client.js'), host.remote.js)
  await writeFile(join(generated, 'typert.remote-client.d.ts'), host.remote.dts)
  await writeFile(join(generated, 'typert.remote-client.d.ts.map'), host.remote.dtsMap)
  console.log(`generated ${String(artifacts.length)} Typert artifact(s) from ${generatorPath}`)
} finally {
  if (!keepWorkspace) await rm(workspace, { recursive: true, force: true })
}
