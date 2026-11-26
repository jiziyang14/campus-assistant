'use strict'

const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { spawn, execFile } = require('node:child_process')
const { promisify } = require('node:util')

const ASSETS = __ASSETS__
const EMBEDDED_CONFIG = __CONFIG__
const APP_VERSION = __VERSION__
const BUILD_TIME = __BUILD_TIME__
const ICON_HELPER = __ICON_HELPER__
const ICON_DATA = __ICON_DATA__

const APP_ID = 'campus-assistant'
const HOST = '127.0.0.1'
const BASE_PORT = Number(process.env.PORT || 8130)
const MAX_PORT_ATTEMPTS = 10
const STARTED_AT = new Date().toISOString()
const CONFIG_PATH = path.join(path.dirname(process.execPath), 'config.json')
const LOG_DIR = path.join(process.env.LOCALAPPDATA || os.homedir(), 'CampusAssistant', 'logs')
const LOG_FILE = path.join(LOG_DIR, 'server.log')
const MAX_LOG_BYTES = 2 * 1024 * 1024
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
}

let activePort = BASE_PORT
let configCache = null

/** 写滚动日志；只记录启动、配置与代理错误，不记录请求正文或密钥。 */
const log = (level, message, extra = {}) => {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true })
    try {
      if (fs.statSync(LOG_FILE).size > MAX_LOG_BYTES) {
        fs.renameSync(LOG_FILE, `${LOG_FILE}.1`)
      }
    } catch {
      // 日志文件还不存在
    }
    fs.appendFileSync(
      LOG_FILE,
      `${JSON.stringify({ at: new Date().toISOString(), level, message, ...extra })}\n`
    )
  } catch {
    // 日志失败不影响主流程
  }
}

/**
 * 读取 exe 同目录的 config.json。支持 UTF-8 BOM；解析失败时回退到内置配置，
 * 但会把错误写进日志和 /health，不再静默假装配置成功。
 */
const loadConfig = () => {
  let stat
  try {
    stat = fs.statSync(CONFIG_PATH)
  } catch {
    configCache = null
    return { config: EMBEDDED_CONFIG, source: 'embedded', error: null }
  }
  if (configCache && configCache.mtimeMs === stat.mtimeMs) {
    return configCache.result
  }
  try {
    const text = fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, '')
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('config.json 必须是 JSON 对象')
    }
    const result = {
      config: { ...EMBEDDED_CONFIG, ...parsed },
      source: 'file',
      error: null,
    }
    configCache = { mtimeMs: stat.mtimeMs, result }
    log('info', '已加载外部配置', { path: CONFIG_PATH })
    return result
  } catch (error) {
    const result = {
      config: EMBEDDED_CONFIG,
      source: 'embedded-fallback',
      error: error instanceof Error ? error.message : String(error),
    }
    configCache = { mtimeMs: stat.mtimeMs, result }
    log('error', 'config.json 读取失败，已回退到内置配置', { error: result.error })
    return result
  }
}

const securityHeaders = () => ({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data: blob: https: http:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
})

const sendJson = (response, status, payload) => {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...securityHeaders(),
  })
  response.end(body)
}

const hostOf = (value) => {
  try {
    return new URL(`http://${value}`).hostname.toLowerCase()
  } catch {
    return ''
  }
}

const isAllowedHost = (request) => {
  const host = hostOf(String(request.headers.host || ''))
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]'
}

const isAllowedOrigin = (request) => {
  const origin = request.headers.origin
  if (!origin) {
    return true
  }
  try {
    const parsed = new URL(origin)
    const host = parsed.hostname.toLowerCase()
    return (
      parsed.protocol === 'http:' &&
      (host === '127.0.0.1' || host === 'localhost' || host === '[::1]') &&
      Number(parsed.port || 80) === activePort
    )
  } catch {
    return false
  }
}

const readRawBody = async (request, maxBytes = 120 * 1024 * 1024) => {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxBytes) {
      throw new Error('请求体过大')
    }
    chunks.push(chunk)
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined
}

const execFileAsync = promisify(execFile)

/** 备份固定放在 U 盘根目录的这个文件夹里，导入导出都不经过浏览器下载目录 */
const BACKUP_DIR_NAME = '校园助手备份'
const MAX_BACKUP_BYTES = 256 * 1024 * 1024

/** 用系统 CIM 查询可移动磁盘（U 盘/移动硬盘） */
const listRemovableDrives = async () => {
  const script =
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' | Select-Object DeviceID,VolumeName,Size,FreeSpace | ConvertTo-Json -Compress"
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { timeout: 15000, windowsHide: true, maxBuffer: 1024 * 1024 }
  )
  const text = String(stdout || '').trim()
  if (!text) {
    return []
  }
  const parsed = JSON.parse(text)
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  return rows
    .filter((row) => /^[A-Za-z]:$/.test(String(row.DeviceID || '').trim()))
    .map((row) => ({
      drive: String(row.DeviceID).trim().toUpperCase(),
      label: String(row.VolumeName || ''),
      size: Number(row.Size || 0),
      freeSpace: Number(row.FreeSpace || 0),
    }))
}

/** 盘符必须是当前插着的可移动磁盘，避免前端传任意路径写系统盘 */
const resolveRemovableDrive = async (value) => {
  const drive = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\\/]+$/, '')
  if (!/^[A-Z]:$/.test(drive)) {
    return null
  }
  const drives = await listRemovableDrives()
  return drives.some((item) => item.drive === drive) ? drive : null
}

/** 只允许简单文件名，禁止路径分隔符与 ..，防止路径穿越 */
const safeBackupName = (value) => {
  const name = String(value || '').trim()
  if (!name || name.length > 120 || !/\.zip$/i.test(name)) {
    return null
  }
  if (name.includes('..') || /[\\/:*?"<>|]/.test(name)) {
    return null
  }
  return name
}

const backupDirOf = (drive) => `${drive}\\${BACKUP_DIR_NAME}`

const listBackups = async (drive) => {
  const dir = backupDirOf(drive)
  let entries
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return []
    }
    throw error
  }
  const files = []
  for (const entry of entries) {
    if (!entry.isFile() || !/\.zip$/i.test(entry.name)) {
      continue
    }
    try {
      const stat = await fs.promises.stat(path.join(dir, entry.name))
      files.push({ name: entry.name, size: stat.size, mtime: stat.mtimeMs })
    } catch {
      // 单个文件读不到时跳过，不影响其他备份
    }
  }
  return files.sort((a, b) => b.mtime - a.mtime)
}

/** U 盘备份：列出可移动盘、写入备份、列出与读取备份 */
const handleDriveBackup = async (request, response, url) => {
  if (url.pathname === '/campus/api/drives' && request.method === 'GET') {
    try {
      sendJson(response, 200, { drives: await listRemovableDrives() })
    } catch (error) {
      sendJson(response, 500, {
        error: {
          code: 'drives_failed',
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }
    return
  }

  if (url.pathname === '/campus/api/backups' && request.method === 'GET') {
    const drive = await resolveRemovableDrive(url.searchParams.get('drive'))
    if (!drive) {
      sendJson(response, 400, {
        error: { code: 'drive_invalid', message: '未找到该可移动磁盘，请确认 U 盘已插好。' },
      })
      return
    }
    try {
      sendJson(response, 200, { drive, backups: await listBackups(drive) })
    } catch (error) {
      sendJson(response, 500, {
        error: {
          code: 'backups_failed',
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }
    return
  }

  if (url.pathname === '/campus/api/backup' && request.method === 'POST') {
    const drive = await resolveRemovableDrive(url.searchParams.get('drive'))
    if (!drive) {
      sendJson(response, 400, {
        error: { code: 'drive_invalid', message: '未找到该可移动磁盘，请确认 U 盘已插好。' },
      })
      return
    }
    const name = safeBackupName(url.searchParams.get('name'))
    if (!name) {
      sendJson(response, 400, { error: { code: 'name_invalid', message: '备份文件名不合法。' } })
      return
    }
    let body
    try {
      body = await readRawBody(request, MAX_BACKUP_BYTES)
    } catch {
      sendJson(response, 413, {
        error: { code: 'too_large', message: '备份文件超过 256MB，请清理后再试。' },
      })
      return
    }
    if (!body || body.length === 0) {
      sendJson(response, 400, { error: { code: 'empty', message: '备份内容为空。' } })
      return
    }
    const dir = backupDirOf(drive)
    const file = path.resolve(dir, name)
    if (path.dirname(file) !== path.resolve(dir)) {
      sendJson(response, 400, { error: { code: 'name_invalid', message: '备份文件名不合法。' } })
      return
    }
    try {
      await fs.promises.mkdir(dir, { recursive: true })
      await fs.promises.writeFile(file, body)
      log('info', '已保存 U 盘备份', { drive, name, size: body.length })
      sendJson(response, 200, { saved: true, name, size: body.length, path: file })
    } catch (error) {
      sendJson(response, 500, {
        error: {
          code: 'write_failed',
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }
    return
  }

  if (url.pathname === '/campus/api/backup' && request.method === 'GET') {
    const drive = await resolveRemovableDrive(url.searchParams.get('drive'))
    const name = safeBackupName(url.searchParams.get('name'))
    if (!drive || !name) {
      sendJson(response, 400, {
        error: { code: 'request_invalid', message: '备份位置或文件名不合法。' },
      })
      return
    }
    const dir = backupDirOf(drive)
    const file = path.resolve(dir, name)
    if (path.dirname(file) !== path.resolve(dir)) {
      sendJson(response, 400, { error: { code: 'name_invalid', message: '备份文件名不合法。' } })
      return
    }
    let stat
    try {
      stat = await fs.promises.stat(file)
    } catch {
      stat = null
    }
    if (!stat || !stat.isFile()) {
      sendJson(response, 404, { error: { code: 'not_found', message: '备份文件不存在。' } })
      return
    }
    response.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="backup.zip"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
      ...securityHeaders(),
    })
    try {
      await pipeline(fs.createReadStream(file), response)
    } catch (error) {
      log('error', '读取 U 盘备份失败', {
        drive,
        name,
        error: error instanceof Error ? error.message : String(error),
      })
      response.end()
    }
    return
  }
}

const proxy = async (request, response, url) => {
  const loaded = loadConfig()
  const apiKey = String(loaded.config.apiKey || '').trim()
  if (!apiKey) {
    sendJson(response, 503, {
      error: {
        code: 'api_key_missing',
        message: '未配置 API Key，请在程序同目录的 config.json 中填写 apiKey。',
      },
    })
    return
  }
  const apiBase = String(loaded.config.apiBase || 'https://api.deepseek.com').replace(/\/+$/, '')
  let parsedBase
  try {
    parsedBase = new URL(apiBase)
  } catch {
    sendJson(response, 503, {
      error: { code: 'api_base_invalid', message: 'config.json 中的 apiBase 不是有效地址。' },
    })
    return
  }
  if (parsedBase.protocol !== 'https:' && parsedBase.protocol !== 'http:') {
    sendJson(response, 503, {
      error: { code: 'api_base_invalid', message: 'config.json 中的 apiBase 只支持 http/https。' },
    })
    return
  }

  const headers = new Headers()
  for (const name of ['content-type', 'accept', 'anthropic-beta', 'user-agent']) {
    const value = request.headers[name]
    if (value) {
      headers.set(name, Array.isArray(value) ? value.join(',') : value)
    }
  }
  headers.set('authorization', `Bearer ${apiKey}`)
  headers.set('x-api-key', apiKey)

  const controller = new AbortController()
  response.on('close', () => {
    if (!response.writableEnded) {
      controller.abort()
    }
  })

  try {
    const body =
      request.method === 'GET' || request.method === 'HEAD' ? undefined : await readRawBody(request)
    const upstream = await fetch(`${apiBase}${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      body,
      signal: controller.signal,
    })
    response.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control': 'no-store',
      ...securityHeaders(),
    })
    if (upstream.body) {
      await pipeline(Readable.fromWeb(upstream.body), response)
    } else {
      response.end()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log('error', '代理请求失败', { path: url.pathname, error: message })
    if (!response.headersSent) {
      sendJson(response, 502, { error: { code: 'proxy_error', message } })
    } else {
      response.end()
    }
  }
}

/** 用多尺寸 ICO 给 Edge 应用窗口重设图标，解决高 DPI 下任务栏/标题栏图标模糊 */
const fixTaskbarIcon = () => {
  if (!ICON_HELPER || !ICON_DATA) {
    return
  }
  try {
    const dir = path.join(os.tmpdir(), 'campus-assistant-icons')
    fs.mkdirSync(dir, { recursive: true })
    const helper = path.join(dir, 'icon-helper.exe')
    const icon = path.join(dir, 'icon.ico')
    fs.writeFileSync(helper, Buffer.from(ICON_HELPER, 'base64'))
    fs.writeFileSync(icon, Buffer.from(ICON_DATA, 'base64'))
    const child = spawn(helper, [icon, '校园助手', 'Campus Assistant'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.unref()
    setTimeout(() => {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        // 辅助程序还在运行时文件被占用，忽略
      }
    }, 240_000)
  } catch {
    // 图标优化失败不影响主流程
  }
}

const route = async (request, response) => {
  if (!isAllowedHost(request)) {
    sendJson(response, 403, { error: { code: 'host_not_allowed', message: 'Forbidden host' } })
    return
  }
  if (!isAllowedOrigin(request)) {
    sendJson(response, 403, { error: { code: 'origin_not_allowed', message: 'Forbidden origin' } })
    return
  }

  const url = new URL(request.url || '/', `http://${HOST}:${activePort}`)

  if (url.pathname === '/health') {
    const loaded = loadConfig()
    sendJson(response, 200, {
      app: APP_ID,
      version: APP_VERSION,
      buildTime: BUILD_TIME,
      pid: process.pid,
      port: activePort,
      startedAt: STARTED_AT,
      uptime: Math.round(process.uptime()),
      config: {
        configured: Boolean(String(loaded.config.apiKey || '').trim()),
        source: loaded.source,
        error: loaded.error,
      },
      logDir: LOG_DIR,
    })
    return
  }

  if (url.pathname.startsWith('/campus/api/')) {
    await handleDriveBackup(request, response, url)
    return
  }

  if (
    url.pathname === '/models' ||
    url.pathname.startsWith('/anthropic/') ||
    url.pathname.startsWith('/v1/')
  ) {
    await proxy(request, response, url)
    return
  }

  const key = url.pathname === '/' ? '/index.html' : url.pathname
  const data = ASSETS[key]
  if (!data || (request.method !== 'GET' && request.method !== 'HEAD')) {
    sendJson(response, 404, { error: 'Not found' })
    return
  }
  const buffer = Buffer.from(data, 'base64')
  const isStatic = key.startsWith('/static/')
  response.writeHead(200, {
    'Content-Type': MIME[path.extname(key)] || 'application/octet-stream',
    'Content-Length': buffer.length,
    'Cache-Control': isStatic ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...securityHeaders(),
  })
  response.end(request.method === 'HEAD' ? undefined : buffer)
}

const handler = async (request, response) => {
  try {
    await route(request, response)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log('error', '未处理的请求错误', { error: message })
    if (!response.headersSent) {
      sendJson(response, 500, { error: { code: 'internal_error', message } })
    } else {
      response.end()
    }
  }
}

const openWindow = (url) => {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ]
  const edge = candidates.find((file) => {
    try {
      return fs.existsSync(file)
    } catch {
      return false
    }
  })
  if (edge) {
    const child = spawn(edge, [`--app=${url}`, '--start-maximized'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.unref()
    return
  }
  const child = spawn('cmd.exe', ['/c', 'start', '', url], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
}

const probeExisting = async (port) => {
  try {
    const response = await fetch(`http://${HOST}:${port}/health`, {
      signal: AbortSignal.timeout(800),
    })
    if (!response.ok) {
      return null
    }
    const body = await response.json()
    return body && body.app === APP_ID ? body : null
  } catch {
    return null
  }
}

const listen = (port) =>
  new Promise((resolve, reject) => {
    const server = http.createServer(handler)
    const onError = (error) => {
      server.close()
      reject(error)
    }
    server.once('error', onError)
    server.listen(port, HOST, () => {
      server.off('error', onError)
      resolve(server)
    })
  })

const start = async () => {
  let server = null
  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset += 1) {
    const port = BASE_PORT + offset
    try {
      server = await listen(port)
      activePort = port
      break
    } catch (error) {
      if (!error || error.code !== 'EADDRINUSE') {
        throw error
      }
      const existing = await probeExisting(port)
      if (existing) {
        log('info', '端口已被同应用实例占用，打开已有实例', {
          port,
          version: existing.version,
        })
        if (process.env.CAMPUS_NO_BROWSER !== '1') {
          openWindow(`http://${HOST}:${port}`)
          fixTaskbarIcon()
        }
        setTimeout(() => process.exit(0), 500)
        return
      }
      log('warn', '端口被其他程序占用，尝试下一个端口', { port })
    }
  }
  if (!server) {
    log('error', '没有可用端口', { basePort: BASE_PORT, attempts: MAX_PORT_ATTEMPTS })
    process.exit(1)
  }

  const loaded = loadConfig()
  log('info', '服务已启动', {
    port: activePort,
    version: APP_VERSION,
    configSource: loaded.source,
    configConfigured: Boolean(String(loaded.config.apiKey || '').trim()),
  })
  if (process.env.CAMPUS_NO_BROWSER !== '1') {
    openWindow(`http://${HOST}:${activePort}`)
    fixTaskbarIcon()
  }
}

process.on('uncaughtException', (error) => {
  log('error', 'uncaughtException', { error: error instanceof Error ? error.message : String(error) })
  process.exit(1)
})
process.on('unhandledRejection', (reason) => {
  log('error', 'unhandledRejection', {
    error: reason instanceof Error ? reason.message : String(reason),
  })
})

start().catch((error) => {
  log('error', '服务启动失败', {
    error: error instanceof Error ? error.message : String(error),
  })
  process.exit(1)
})
