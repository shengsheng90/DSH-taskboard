import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, symlink, writeFile, mkdir, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temp = await mkdtemp(join(tmpdir(), 'taskboard-package-'))
const consumerPnpm = process.env.PNPM_CONSUMER_COMMAND ?? 'pnpm'
const run = (command, args, cwd = root, extraEnv = {}) => execFileSync(command, args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: 'true', ...extraEnv },
})
try {
  run('node', ['scripts/verify-package.mjs', '--source'])
  run('pnpm', ['pack', '--pack-destination', temp])
  const tarball = join(temp, (await readdir(temp)).find(name => name.endsWith('.tgz')))
  const profile = join(temp, 'profile')
  await mkdir(profile)
  await writeFile(join(profile, 'package.json'), '{"private":true,"type":"module"}\n')
  // Even default peer auto-installation must not pull a second Harness into a profile.
  await writeFile(join(profile, 'pnpm-workspace.yaml'), 'packages: [.]\nnodeLinker: hoisted\nautoInstallPeers: true\nstrictPeerDependencies: true\n')
  run(consumerPnpm, ['add', '-w', '--ignore-scripts', tarball], profile)
  const installed = join(profile, 'node_modules/@shengsheng/dsh-taskboard')
  const installedPkg = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'))
  assert.equal(Object.keys(installedPkg.dependencies).join(), 'zod')
  assert.deepEqual((await readdir(join(profile, 'node_modules'))).filter(name => name === '@deepseek-ai' || name === 'react'), [])
  run('node', ['scripts/verify-package.mjs', `--root=${installed}`])
  // Prove the gate detects the original missing-entry-point failure and corrupted output.
  const entry = join(installed, 'lib/client.js')
  const contents = await readFile(entry)
  await rm(entry)
  assert.throws(() => run('node', ['scripts/verify-package.mjs', `--root=${installed}`]))
  await writeFile(entry, 'corrupted')
  assert.throws(() => run('node', ['scripts/verify-package.mjs', `--root=${installed}`]))
  await writeFile(entry, contents)

  // Resolve every peer through one Harness installation, with no plugin SDK copies.
  const runtime = resolve(process.env.DSH_SMOKE_RUNTIME ?? root)
  if (process.env.DSH_SMOKE_RUNTIME) {
    const { evaluatePluginCompatibility } = await import(pathToFileURL(join(runtime, 'node_modules/@deepseek-ai/dsh-app-boot/lib/index.js')))
    for (const version of ['0.1.6-alpha.1', '0.1.6-alpha.2', '0.1.7-alpha.1', '0.1.7-rc.1', '0.1.7-rc.2', '0.1.7', '0.1.8', '0.2.0-alpha.1', '0.2.0-rc.1', '0.2.0-rc.2', '0.2.0', '0.2.1']) {
      assert.equal(evaluatePluginCompatibility(installedPkg, {}, version), undefined, version)
    }
    for (const version of ['0.1.5', '0.3.0-rc.1', '0.3.0', '1.0.0']) {
      assert.ok(evaluatePluginCompatibility(installedPkg, {}, version), `must reject ${version}`)
    }
    const bin = join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
    const env = { DSH_HOME: join(temp, 'dsh-home') }
    run('node', [bin, 'plugin', '--profile', 'web', 'add', '-w', tarball], temp, env)
    const config = run('node', [bin, '--profile', 'web', '--dump-config'], temp, env)
    assert.ok(config.includes('@shengsheng/dsh-taskboard'))
    console.log('Real dsh plugin add and --dump-config passed without a version exemption')
  }
  for (const name of Object.keys(installedPkg.peerDependencies)) {
    const target = join(profile, 'node_modules', name)
    await mkdir(dirname(target), { recursive: true })
    await symlink(join(runtime, 'node_modules', name), target, 'dir')
  }
  const probe = await readFile(join(root, 'scripts/smoke-runtime.mjs'), 'utf8')
  await writeFile(join(profile, 'probe.mjs'), probe)
  process.stdout.write(run('node', ['probe.mjs'], profile))

  // Git installs use exactly the committed prebuilt tree, without developer dependencies.
  const git = join(temp, 'git-source')
  await mkdir(git)
  for (const name of ['.gitattributes', 'lib', 'package.json', 'cordis.patch.yml', 'scripts', 'skills']) {
    await cp(join(root, name), join(git, name), { recursive: true })
  }
  run('git', ['init', '--quiet'], git)
  run('git', ['add', '.'], git)
  run('git', ['-c', 'user.name=Package Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'prebuilt fixture'], git)
  const gitProfile = join(temp, 'git-profile')
  await mkdir(gitProfile)
  await writeFile(join(gitProfile, 'package.json'), '{"private":true,"type":"module"}\n')
  await writeFile(join(gitProfile, 'pnpm-workspace.yaml'), 'packages: [.]\nnodeLinker: hoisted\nautoInstallPeers: true\nstrictPeerDependencies: true\n')
  // No --ignore-scripts: the Git package must install without asking to build anything.
  run(consumerPnpm, ['add', '-w', `git+file://${git}`], gitProfile)
  const gitInstalled = join(gitProfile, 'node_modules/@shengsheng/dsh-taskboard')
  run('node', ['scripts/verify-package.mjs', `--root=${gitInstalled}`])
  assert.deepEqual((await readdir(join(gitProfile, 'node_modules'))).filter(name => name === '@deepseek-ai' || name === 'typescript' || name === 'react'), [])
  console.log('Tarball and Git install smoke passed (no consumer build or duplicate Harness peers)')
} catch (error) {
  if (error.stdout) process.stderr.write(error.stdout)
  if (error.stderr) process.stderr.write(error.stderr)
  throw error
} finally {
  if (process.env.KEEP_PACKAGE_SMOKE === '1') console.log(`Kept smoke fixture: ${temp}`)
  else await rm(temp, { recursive: true, force: true })
}
