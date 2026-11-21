'use strict'

const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { spawn } = require('node:child_process')

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

const readRawBody = async (request) => {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 120 * 1024 * 1024) {
      throw new Error('请求体过大')
    }
    chunks.push(chunk)
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined
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
    }, 90_000)
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
