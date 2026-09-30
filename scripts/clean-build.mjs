import { rm } from 'node:fs/promises'

// A deleted source must not leave an old executable in the distributed package.
await rm(new URL('../lib/', import.meta.url), { recursive: true, force: true })
