export type DiagnosticKind = 'error' | 'unhandledrejection' | 'react'

export type DiagnosticEntry = {
  at: string
  kind: DiagnosticKind
  message: string
  stack?: string
  source?: string
  line?: number
  column?: number
  context?: Record<string, string | number | boolean>
}

const STORAGE_KEY = 'campus:diagnostics:v1'
const MAX_ENTRIES = 40
const MAX_TEXT = 4000

const limit = (value: string, max = MAX_TEXT) => value.slice(0, max)

const safeRead = (): DiagnosticEntry[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter(
      (item): item is DiagnosticEntry =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as DiagnosticEntry).at === 'string' &&
        typeof (item as DiagnosticEntry).message === 'string'
    )
  } catch {
    return []
  }
}

const safeWrite = (entries: DiagnosticEntry[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)))
  } catch {
    // 存储不可用时诊断信息只保留在内存里；不阻塞主流程
  }
}

/** 记录一条诊断信息；最多保留最近 40 条，不记录请求正文或密钥。 */
export const recordDiagnostic = (entry: Omit<DiagnosticEntry, 'at'>) => {
  const next: DiagnosticEntry = {
    ...entry,
    at: new Date().toISOString(),
    message: limit(entry.message),
    stack: entry.stack ? limit(entry.stack) : undefined,
    context: entry.context
      ? Object.fromEntries(
          Object.entries(entry.context).map(([key, value]) => [
            key,
            typeof value === 'string' ? limit(value, 1200) : value,
          ])
        )
      : undefined,
  }
  safeWrite([...safeRead(), next])
}

export const getDiagnosticEntries = (): DiagnosticEntry[] => safeRead()

export const clearDiagnosticEntries = () => {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 忽略存储错误
  }
}

const reasonText = (reason: unknown): string => {
  if (reason instanceof Error) {
    return reason.message || reason.name
  }
  if (typeof reason === 'string') {
    return reason
  }
  try {
    return JSON.stringify(reason)
  } catch {
    return String(reason)
  }
}

const reasonStack = (reason: unknown): string | undefined =>
  reason instanceof Error ? reason.stack : undefined

let installed = false

/** 安装全局错误监听；React 渲染错误由 ErrorBoundary 单独记录。 */
export const installGlobalErrorHandlers = () => {
  if (installed || typeof window === 'undefined') {
    return
  }
  installed = true
  window.addEventListener('error', (event) => {
    if (!event.message) {
      return
    }
    recordDiagnostic({
      kind: 'error',
      message: event.message,
      stack: reasonStack(event.error),
      source: event.filename,
      line: event.lineno,
      column: event.colno,
    })
  })
  window.addEventListener('unhandledrejection', (event) => {
    recordDiagnostic({
      kind: 'unhandledrejection',
      message: reasonText(event.reason),
      stack: reasonStack(event.reason),
    })
  })
}

type HealthPayload = {
  app?: string
  version?: string
  buildTime?: string
  port?: number
  startedAt?: string
  config?: { configured?: boolean; source?: string; error?: string }
  logDir?: string
}

const readHealth = async (): Promise<HealthPayload | { error: string }> => {
  try {
    const response = await fetch('/health', { cache: 'no-store' })
    if (!response.ok) {
      return { error: `HTTP ${response.status}` }
    }
    return (await response.json()) as HealthPayload
  } catch (error) {
    return { error: reasonText(error) }
  }
}

const readStorage = async () => {
  try {
    const estimate = await navigator.storage?.estimate?.()
    if (!estimate) {
      return null
    }
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 }
  } catch {
    return null
  }
}

/** 生成可交给管理员排查的 JSON；不包含 API Key、消息内容或附件。 */
export const createDiagnosticReport = async () => {
  const [health, storage] = await Promise.all([readHealth(), readStorage()])
  return {
    generatedAt: new Date().toISOString(),
    appVersion: __APP_VERSION__,
    buildTime: __BUILD_TIME__,
    url: location.href,
    userAgent: navigator.userAgent,
    language: navigator.language,
    health,
    storage,
    errors: getDiagnosticEntries(),
  }
}

export const downloadDiagnosticReport = async () => {
  const report = await createDiagnosticReport()
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `campus-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
