import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ResEdit from 'resedit'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(HERE, '../campus-src/dist')
const PACKAGE_FILE = path.resolve(HERE, '../campus-src/package.json')
const CONFIG_FILE = path.resolve(HERE, '../campus-edition/config.json')
const OUT = path.join(HERE, 'out')
const NAME = '校园助手'
const APP = path.join(OUT, 'app.exe')
const EXE = path.join(OUT, `${NAME}.exe`)
const BUNDLE = path.join(HERE, 'bundle.cjs')

const fail = (message) => {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  fail('找不到构建产物，请先在 campus-src 里执行生产构建。')
}

const pkg = readJson(PACKAGE_FILE)
const version = String(pkg.version || '0.0.0')
const versionParts = version
  .split(/[.-]/)
  .slice(0, 4)
  .map((part) => Number.parseInt(part, 10) || 0)
while (versionParts.length < 4) {
  versionParts.push(0)
}
const buildTime = new Date().toISOString()

const walk = (dir, prefix = '') =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name)
    const relative = `${prefix}/${entry.name}`
    return entry.isDirectory()
      ? walk(absolute, relative)
      : [{ url: relative, file: absolute }]
  })

const assets = {}
for (const item of walk(DIST)) {
  const isPageAsset =
    item.url === '/index.html' ||
    item.url === '/LICENSE' ||
    item.url === '/favicon.ico' ||
    item.url === '/favicon.svg' ||
    item.url === '/apple-touch-icon.png'
  if (isPageAsset || item.url.startsWith('/static/')) {
    assets[item.url] = fs.readFileSync(item.file).toString('base64')
  }
}
const totalBytes = Object.values(assets).reduce((sum, value) => sum + value.length, 0)
process.stdout.write(
  `嵌入 ${Object.keys(assets).length} 个文件，约 ${(totalBytes / 1024 / 1024).toFixed(1)} MB（base64）\n`
)

// 默认不把真实 API Key 嵌进 exe：exe 会分发到多台机器，二进制里的 Key 可被直接提取。
// 只有显式设置 CAMPUS_EMBED_KEY=1 时才读取 campus-edition/config.json，用于完全受控的单机场景。
const embeddedConfig = { apiBase: 'https://api.deepseek.com', apiKey: '' }
if (process.env.CAMPUS_EMBED_KEY === '1') {
  if (!fs.existsSync(CONFIG_FILE)) {
    fail('CAMPUS_EMBED_KEY=1，但找不到 campus-edition/config.json。')
  }
  const config = readJson(CONFIG_FILE)
  if (!String(config.apiKey || '').trim()) {
    fail('CAMPUS_EMBED_KEY=1，但 config.json 里没有 apiKey。')
  }
  Object.assign(embeddedConfig, config)
  process.stdout.write('警告：正在把 API Key 嵌入 exe。分发给他人前请确认密钥可轮换、可吊销。\n')
} else if (fs.existsSync(CONFIG_FILE)) {
  process.stdout.write(
    '未嵌入 API Key；exe 首次运行时会读取同目录 config.json（参考 config.example.json）。\n'
  )
}

// 编译任务栏高清图标辅助程序（.NET Framework 自带 csc）。失败时打包仍可继续，只是不做图标替换。
const CSC = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe'
const HELPER_OUT = path.join(os.tmpdir(), `campus-icon-helper-${process.pid}.exe`)
let iconHelper = ''
if (fs.existsSync(CSC) && fs.existsSync(path.join(HERE, 'icon-helper.cs'))) {
  try {
    execFileSync(
      CSC,
      ['/nologo', '/target:winexe', `/out:${HELPER_OUT}`, path.join(HERE, 'icon-helper.cs')],
      { stdio: 'ignore' }
    )
    iconHelper = fs.readFileSync(HELPER_OUT).toString('base64')
    process.stdout.write(`已编译任务栏图标辅助程序：${(iconHelper.length / 1024).toFixed(0)} KB（base64）\n`)
  } catch {
    process.stdout.write('跳过任务栏图标辅助程序（csc 不可用）\n')
  } finally {
    fs.rmSync(HELPER_OUT, { force: true })
  }
} else {
  process.stdout.write('跳过任务栏图标辅助程序（找不到 csc 或 icon-helper.cs）\n')
}
const iconData = fs.readFileSync(path.join(HERE, 'icon.ico')).toString('base64')

const template = fs.readFileSync(path.join(HERE, 'server-template.cjs'), 'utf8')
const mainSource = template
  .replace('__ASSETS__', () => JSON.stringify(assets))
  .replace('__CONFIG__', () => JSON.stringify(embeddedConfig))
  .replace('__VERSION__', () => JSON.stringify(version))
  .replace('__BUILD_TIME__', () => JSON.stringify(buildTime))
  .replace('__ICON_HELPER__', () => JSON.stringify(iconHelper))
  .replace('__ICON_DATA__', () => JSON.stringify(iconData))
fs.writeFileSync(BUNDLE, mainSource)

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

process.stdout.write('打包 exe…\n')
execFileSync(
  process.execPath,
  [
    path.join(HERE, 'node_modules/@yao-pkg/pkg/lib-es5/bin.js'),
    BUNDLE,
    '--targets',
    'node22-win-x64',
    '--output',
    APP,
  ],
  { cwd: HERE, stdio: 'inherit' }
)

process.stdout.write('写入图标与版本信息…\n')
if (process.env.CAMPUS_SKIP_ICON !== '1') {
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(APP), { ignoreCert: true })
  const resource = ResEdit.NtExecutableResource.from(exe)
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(HERE, 'icon.ico')))
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    resource.entries,
    1,
    1033,
    iconFile.icons.map((icon) => icon.data)
  )
  const version = ResEdit.Resource.VersionInfo.createEmpty()
  version.setFileVersion(...versionParts, 1033)
  version.setProductVersion(...versionParts, 1033)
  version.setStringValues(
    { lang: 1033, codepage: 1200 },
    {
      ProductName: NAME,
      FileDescription: `${NAME} - 校园一体机助手`,
      OriginalFilename: `${NAME}.exe`,
      InternalName: 'campus-assistant',
      ProductVersion: versionParts.join('.'),
      FileVersion: versionParts.join('.'),
    }
  )
  version.outputToResourceEntries(resource.entries)
  resource.outputResource(exe)
  fs.writeFileSync(APP, Buffer.from(exe.generate()))
}

// 把控制台子系统改成 GUI，双击时不弹出黑色命令行窗口（CAMPUS_GUI=0 可关闭）
if (process.env.CAMPUS_GUI !== '0') {
  const data = fs.readFileSync(APP)
  const peOffset = data.readUInt32LE(0x3c)
  const optionalHeader = peOffset + 24
  data.writeUInt16LE(2, optionalHeader + 0x44)
  fs.writeFileSync(APP, data)
}

fs.renameSync(APP, EXE)
// 中间产物可能含内嵌配置，构建完即清理
fs.rmSync(BUNDLE, { force: true })
process.stdout.write(
  `完成：${EXE}（${(fs.statSync(EXE).size / 1024 / 1024).toFixed(0)} MB，版本 ${version}）\n`
)
