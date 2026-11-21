import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'campus-src')
const DIST = path.join(SRC, 'dist')
const EDITION = path.join(ROOT, 'campus-edition')
const EXE_DIR = path.join(ROOT, 'campus-exe')
const EXE_NAME = '校园助手.exe'
const args = process.argv.slice(2)
const buildExe = args.includes('--exe') || process.env.CAMPUS_BUILD_EXE === '1'
const usbIndex = args.indexOf('--usb')
const usbTarget = usbIndex >= 0 ? path.resolve(args[usbIndex + 1] || '') : null

const fail = (message) => {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

if (usbIndex >= 0 && !args[usbIndex + 1]) {
  fail('--usb 后面需要目标目录，例如 --usb D:\\校园助手')
}

const run = (command, commandArgs, cwd) => {
  const result = spawnSync(command, commandArgs, { cwd, stdio: 'inherit' })
  if (result.error) {
    fail(result.error.message)
  }
  if (result.status !== 0) {
    fail(`命令失败：${command} ${commandArgs.join(' ')}`)
  }
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))

const syncEdition = (target = EDITION) => {
  fs.rmSync(path.join(target, 'static'), { recursive: true, force: true })
  fs.cpSync(path.join(DIST, 'static'), path.join(target, 'static'), { recursive: true })
  for (const name of ['index.html', 'LICENSE', 'favicon.ico', 'favicon.svg', 'apple-touch-icon.png']) {
    copyFileTo(DIST, target, name)
  }
  const pkg = readJson(path.join(SRC, 'package.json'))
  fs.writeFileSync(
    path.join(target, 'version.json'),
    `${JSON.stringify({ version: pkg.version, buildTime: new Date().toISOString() }, null, 2)}\n`
  )
}

const copyFileTo = (fromDir, toDir, name) => {
  const from = path.join(fromDir, name)
  if (fs.existsSync(from)) {
    fs.copyFileSync(from, path.join(toDir, name))
  }
}

const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')

if (!fs.existsSync(path.join(SRC, 'package.json'))) {
  fail('找不到 campus-src/package.json，请在仓库根目录运行。')
}

process.stdout.write('1/4 构建前端…\n')
run(process.execPath, [path.join('scripts', 'build.mjs')], SRC)

process.stdout.write('2/4 同步网页版…\n')
syncEdition()
const pkg = readJson(path.join(SRC, 'package.json'))
process.stdout.write(`   版本 ${pkg.version}\n`)

let exePath = null
if (buildExe) {
  process.stdout.write('3/4 打包 exe（默认不嵌入 API Key）…\n')
  run(process.execPath, ['build.mjs'], EXE_DIR)
  exePath = path.join(EXE_DIR, 'out', EXE_NAME)
  if (!fs.existsSync(exePath)) {
    fail('exe 构建完成但找不到输出文件。')
  }
} else {
  process.stdout.write('3/4 跳过 exe（需要时加 --exe）\n')
}

if (usbTarget) {
  process.stdout.write(`4/4 同步到 ${usbTarget}…\n`)
  fs.mkdirSync(usbTarget, { recursive: true })
  const webTarget = path.join(usbTarget, 'campus-edition')
  fs.mkdirSync(webTarget, { recursive: true })
  syncEdition(webTarget)
  if (exePath) {
    fs.copyFileSync(exePath, path.join(usbTarget, EXE_NAME))
  }
} else {
  process.stdout.write('4/4 跳过 U 盘同步（需要时加 --usb D:\\校园助手）\n')
}

const releaseDir = path.join(EXE_DIR, 'release')
fs.mkdirSync(releaseDir, { recursive: true })
let publishedExe = null
if (exePath && fs.existsSync(exePath)) {
  publishedExe = path.join(releaseDir, EXE_NAME)
  fs.copyFileSync(exePath, publishedExe)
}

const manifest = {
  version: pkg.version,
  builtAt: new Date().toISOString(),
  exe: publishedExe
    ? { path: publishedExe, sha256: sha256(publishedExe) }
    : null,
  web: {
    path: EDITION,
    indexSha256: sha256(path.join(EDITION, 'index.html')),
  },
}
fs.writeFileSync(path.join(releaseDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

process.stdout.write('\n完成。\n')
process.stdout.write(`  网页版：${EDITION}\n`)
if (manifest.exe) {
  process.stdout.write(`  exe：${manifest.exe.path}\n`)
  process.stdout.write(`  SHA256：${manifest.exe.sha256}\n`)
}
process.stdout.write(`  manifest：${path.join(releaseDir, 'manifest.json')}\n`)
