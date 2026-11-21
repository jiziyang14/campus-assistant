import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const RSPACK = path.join(ROOT, 'node_modules', '@rspack', 'cli', 'bin', 'rspack.js')

// Windows 没有 `rm -rf`，用 Node 清理；其余行为与原来的构建命令一致。
rmSync(DIST, { recursive: true, force: true })
const result = spawnSync(process.execPath, [RSPACK, 'build', '-c', 'rspack.config.ts'], {
  cwd: ROOT,
  env: { ...process.env, NODE_ENV: 'production' },
  stdio: 'inherit',
})

if (result.error) {
  process.stderr.write(`${result.error.message}\n`)
}
process.exit(result.status ?? 1)
