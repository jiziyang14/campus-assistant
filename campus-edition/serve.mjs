import http from 'node:http'
import { promises as fs } from 'node:fs'
import fsSync from 'node:fs'
import os from 'node:os'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_ID = 'campus-assistant'
const HOST = process.env.HOST || '127.0.0.1'
const PORT = Number(process.env.PORT || 8130)
const ROOT = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = path.join(ROOT, 'config.json')
const VERSION_PATH = path.join(ROOT, 'version.json')
const LOG_DIR = path.join(process.env.LOCALAPPDATA || os.homedir(), 'CampusAssistant', 'logs')
const LOG_FILE = path.join(LOG_DIR, 'web.log')
const STARTED_AT = new Date().toISOString()
const MAX_LOG_BYTES = 2 * 1024 * 1024
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

const readVersion = () => {
  try {
    const value = JSON.parse(fsSync.readFileSync(VERSION_PATH, 'utf8').replace(/^\uFEFF/, ''))
    return typeof value.version === 'string' ? value.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}
const APP_VERSION = readVersion()

const log = (level, message, extra = {}) => {
  try {
    fsSync.mkdirSync(LOG_DIR, { recursive: true })
    try {
      if (fsSync.statSync(LOG_FILE).size > MAX_LOG_BYTES) {
        fsSync.renameSync(LOG_FILE, `${LOG_FILE}.1`)
      }
    } catch {
      // 日志文件还不存在
    }
    fsSync.appendFileSync(
      LOG_FILE,
      `${JSON.stringify({ at: new Date().toISOString(), level, message, ...extra })}\n`
    )
  } catch {
    // 日志失败不影响主流程
  }
}

let configCache = null

const readConfig = () => {
  let stat
  try {
    stat = fsSync.statSync(CONFIG_PATH)
  } catch {
    configCache = null
    return { config: {}, source: 'missing', error: null }
  }
  if (configCache && configCache.mtimeMs === stat.mtimeMs) {
    return configCache.result
  }
  try {
    const text = fsSync.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, '')
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('config.json 必须是 JSON 对象')
    }
    const result = { config: parsed, source: 'file', error: null }
    configCache = { mtimeMs: stat.mtimeMs, result }
    return result
  } catch (error) {
    const result = {
      config: {},
      source: 'file-error',
      error: error instanceof Error ? error.message : String(error),
    }
    configCache = { mtimeMs: stat.mtimeMs, result }
    log('error', 'config.json 读取失败', { error: result.error })
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
      Number(parsed.port || 80) === PORT
    )
  } catch {
    return false
  }
}

const readConfigObject = () => {
  try {
    const text = fsSync.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, '')
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** 应用内 API Key 设置：保存到本目录 config.json，GET 只返回是否已配置 */
const handleConfigApi = async (request, response) => {
  const loaded = readConfig()
  if (request.method === 'GET') {
    sendJson(response, 200, {
      configured: Boolean(
        String(loaded.config.apiKey || process.env.DEEPSEEK_API_KEY || '').trim()
      ),
      source: loaded.source,
      apiBase: String(
        loaded.config.apiBase || process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com'
      ),
    })
    return
  }
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: { code: 'method_not_allowed', message: 'Method not allowed' } })
    return
  }
  let body = null
  try {
    body = JSON.parse(String((await readRawBody(request)) || '{}'))
  } catch {
    body = null
  }
  const apiKey = body && typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
  if (apiKey.length < 8 || apiKey.length > 256 || /\s/.test(apiKey)) {
    sendJson(response, 400, { error: { code: 'api_key_invalid', message: 'API Key 格式不正确。' } })
    return
  }
  const apiBase =
    (body && typeof body.apiBase === 'string' ? body.apiBase.trim() : '') ||
    String(loaded.config.apiBase || process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com')
  let parsedBase = null
  try {
    parsedBase = new URL(apiBase)
  } catch {
    parsedBase = null
  }
  if (!parsedBase || (parsedBase.protocol !== 'https:' && parsedBase.protocol !== 'http:')) {
    sendJson(response, 400, {
      error: { code: 'api_base_invalid', message: 'API 地址只支持 http/https。' },
    })
    return
  }
  try {
    const next = { ...readConfigObject(), apiKey, apiBase }
    await fs.writeFile(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    configCache = null
    log('info', '已通过应用设置保存 API Key')
    sendJson(response, 200, { configured: true, source: 'file', apiBase })
  } catch (error) {
    sendJson(response, 500, {
      error: {
        code: 'config_write_failed',
        message: `无法写入配置文件：${error instanceof Error ? error.message : String(error)}`,
      },
    })
  }
}

const proxy = async (request, response, url) => {
  const loaded = readConfig()
  const apiKey = String(loaded.config.apiKey || process.env.DEEPSEEK_API_KEY || '').trim()
  if (!apiKey) {
    sendJson(response, 503, {
      error: {
        code: 'api_key_missing',
        message: '本地服务未配置 API Key，请在 campus-edition/config.json 中填写 apiKey。',
      },
    })
    return
  }
  const apiBase = String(
    process.env.DEEPSEEK_API_BASE || loaded.config.apiBase || 'https://api.deepseek.com'
  ).replace(/\/+$/, '')
  let parsedBase
  try {
    parsedBase = new URL(apiBase)
  } catch {
    sendJson(response, 503, {
      error: { code: 'api_base_invalid', message: 'apiBase 不是有效地址。' },
    })
    return
  }
  if (parsedBase.protocol !== 'https:' && parsedBase.protocol !== 'http:') {
    sendJson(response, 503, {
      error: { code: 'api_base_invalid', message: 'apiBase 只支持 http/https。' },
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
      request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await readRawBody(request)
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

const route = async (request, response) => {
  if (!isAllowedHost(request)) {
    sendJson(response, 403, { error: { code: 'host_not_allowed', message: 'Forbidden host' } })
    return
  }
  if (!isAllowedOrigin(request)) {
    sendJson(response, 403, { error: { code: 'origin_not_allowed', message: 'Forbidden origin' } })
    return
  }

  const url = new URL(request.url || '/', `http://${HOST}:${PORT}`)

  if (url.pathname === '/health') {
    const loaded = readConfig()
    sendJson(response, 200, {
      app: APP_ID,
      version: APP_VERSION,
      pid: process.pid,
      port: PORT,
      startedAt: STARTED_AT,
      uptime: Math.round(process.uptime()),
      config: {
        configured: Boolean(
          String(loaded.config.apiKey || process.env.DEEPSEEK_API_KEY || '').trim()
        ),
        source: loaded.source,
        error: loaded.error,
      },
      logDir: LOG_DIR,
    })
    return
  }

  if (url.pathname === '/campus/api/config') {
    await handleConfigApi(request, response)
    return
  }

  if (
    url.pathname === '/models' ||
    url.pathname === '/user/balance' ||
    url.pathname.startsWith('/anthropic/') ||
    url.pathname.startsWith('/v1/')
  ) {
    await proxy(request, response, url)
    return
  }

  const allowStatic =
    url.pathname === '/' ||
    url.pathname === '/index.html' ||
    url.pathname === '/LICENSE' ||
    url.pathname === '/favicon.ico' ||
    url.pathname === '/favicon.svg' ||
    url.pathname === '/apple-touch-icon.png' ||
    url.pathname.startsWith('/static/')
  if (!allowStatic || (request.method !== 'GET' && request.method !== 'HEAD')) {
    sendJson(response, 404, { error: 'Not found' })
    return
  }

  let relative
  try {
    relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
  } catch {
    sendJson(response, 400, { error: 'Bad request' })
    return
  }
  const target = path.resolve(ROOT, `.${relative}`)
  const relativeToRoot = path.relative(ROOT, target)
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', ...securityHeaders() })
    response.end('Forbidden')
    return
  }
  try {
    const data = await fs.readFile(target)
    const isStatic = relative.startsWith('/static/')
    response.writeHead(200, {
      'Content-Type': MIME[path.extname(target)] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': isStatic ? 'public, max-age=31536000, immutable' : 'no-cache',
      ...securityHeaders(),
    })
    response.end(request.method === 'HEAD' ? undefined : data)
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...securityHeaders() })
    response.end('Not found')
  }
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

const server = http.createServer(handler)
server.on('error', (error) => {
  log('error', '服务启动失败', { error: error instanceof Error ? error.message : String(error) })
  if (error && error.code === 'EADDRINUSE') {
    process.stderr.write(`端口 ${PORT} 已被占用，请关闭占用程序后重试。\n`)
  }
  process.exit(1)
})
server.listen(PORT, HOST, () => {
  log('info', '服务已启动', { port: PORT, version: APP_VERSION })
  process.stdout.write(`校园助手: http://${HOST}:${PORT}\n`)
})
