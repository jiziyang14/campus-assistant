import { showToast } from '../../components/base/toastState.js'
import { exportHistory, mergeImportHistory } from '../chat/backup.js'
import { useChatStore } from '../chat/store.js'
import type { SessionSummary } from '../chat/types.js'
import { listBackups, listDrives, readBackupFromDrive, saveBackupToDrive } from './driveBackup.js'

/**
 * U 盘无感同步（轻量版）：
 * - 对话变化后延迟 30 秒、且距上次写入超过 5 分钟，才在空闲时把历史自动写到 U 盘
 * - 只在本机没有任何会话、且从未恢复过时，启动后自动从 U 盘最新备份恢复
 * - 任何失败都静默跳过，不弹窗、不影响聊天
 */
const DEVICE_KEY = 'chat-demo:device-id'
const META_KEY = 'chat-demo:auto-backup'
const BACKUP_NAME_PREFIX = 'auto-'
const DEBOUNCE_MS = 30_000
const MIN_INTERVAL_MS = 5 * 60_000

type AutoBackupMeta = {
  /** 已写入 U 盘的历史指纹，避免内容没变也重写 */
  fingerprint?: string
  at?: number
  drive?: string
  /** 是否已经在本机自动恢复过，避免清空历史后又被自动灌回来 */
  restored?: boolean
}

const readMeta = (): AutoBackupMeta => {
  try {
    const raw = localStorage.getItem(META_KEY)
    return raw ? (JSON.parse(raw) as AutoBackupMeta) : {}
  } catch {
    return {}
  }
}

const writeMeta = (patch: Partial<AutoBackupMeta>) => {
  try {
    localStorage.setItem(META_KEY, JSON.stringify({ ...readMeta(), ...patch }))
  } catch {
    // 存储不可用时放弃元数据，不影响主流程
  }
}

const deviceId = (): string => {
  try {
    const existing = localStorage.getItem(DEVICE_KEY)
    if (existing) {
      return existing
    }
    const next = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
    localStorage.setItem(DEVICE_KEY, next)
    return next
  } catch {
    return 'device'
  }
}

const fingerprintOf = (sessions: SessionSummary[]): string => {
  let latest = 0
  for (const session of sessions) {
    latest = Math.max(latest, session.updatedAt)
  }
  return `${sessions.length}:${latest}`
}

/** 设置里展示用：上次自动备份时间与盘符 */
export const getAutoBackupSummary = (): { at: number; drive: string } | null => {
  const meta = readMeta()
  return meta.at && meta.drive ? { at: meta.at, drive: meta.drive } : null
}

let debounceTimer: number | undefined
let running = false
let disposed = false

const schedule = (delay = DEBOUNCE_MS) => {
  if (disposed) {
    return
  }
  window.clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(() => void runBackup(), delay)
}

const runBackup = async () => {
  if (disposed || running) {
    return
  }
  const state = useChatStore.getState()
  if (!state.ready || state.importingHistory || state.sessions.length === 0) {
    return
  }
  const meta = readMeta()
  const fingerprint = fingerprintOf(state.sessions)
  if (meta.fingerprint === fingerprint) {
    return
  }
  // 距离上次写入太近就等一会儿，宁可慢也不抢占对话
  const wait = meta.at ? MIN_INTERVAL_MS - (Date.now() - meta.at) : 0
  if (wait > 0) {
    schedule(wait)
    return
  }
  running = true
  try {
    const drives = await listDrives().catch(() => [])
    const drive = drives.find((item) => item.drive === meta.drive) ?? drives[0]
    if (!drive) {
      return
    }
    // 导入进行中不写，等下一轮
    if (useChatStore.getState().importingHistory) {
      return
    }
    const { blob } = await exportHistory()
    if (disposed) {
      return
    }
    await saveBackupToDrive(drive.drive, `${BACKUP_NAME_PREFIX}${deviceId()}.zip`, blob)
    writeMeta({ fingerprint, at: Date.now(), drive: drive.drive })
  } catch {
    // 无 U 盘、服务不可用或写入失败都静默跳过
  } finally {
    running = false
  }
}

/** 新机首次使用：本机没有会话时，自动读取 U 盘上最新的备份 */
const restoreIfEmpty = async () => {
  const meta = readMeta()
  const state = useChatStore.getState()
  if (meta.restored || !state.ready || state.sessions.length > 0 || state.importingHistory) {
    return
  }
  try {
    const drives = await listDrives()
    let newest: { drive: string; name: string; mtime: number } | null = null
    for (const drive of drives) {
      const backups = await listBackups(drive.drive).catch(() => [])
      for (const item of backups) {
        if (/\.zip$/i.test(item.name) && (!newest || item.mtime > newest.mtime)) {
          newest = { drive: drive.drive, name: item.name, mtime: item.mtime }
        }
      }
    }
    if (!newest) {
      return
    }
    const file = await readBackupFromDrive(newest.drive, newest.name)
    const result = await mergeImportHistory(file)
    writeMeta({ restored: true })
    if (result.added > 0) {
      showToast({ key: 'autoRestoreDone', params: { count: result.added } })
    }
  } catch {
    // 备份损坏或服务不可用时保持空白，不打扰用户
  }
}

/** 在 App 挂载后调用，返回取消订阅函数 */
export const startAutoBackup = (): (() => void) => {
  disposed = false
  let storedFingerprint = useChatStore.getState().ready
    ? fingerprintOf(useChatStore.getState().sessions)
    : ''
  const unsubscribe = useChatStore.subscribe((state) => {
    if (!state.ready) {
      return
    }
    const fingerprint = fingerprintOf(state.sessions)
    if (fingerprint !== storedFingerprint) {
      storedFingerprint = fingerprint
      schedule()
    }
  })
  // 启动后先尝试恢复，再做一次内容变化检查；都放在空闲时，避免拖慢首屏
  window.setTimeout(() => {
    void (async () => {
      await restoreIfEmpty()
      schedule(0)
    })()
  }, 2_500)
  return () => {
    disposed = true
    window.clearTimeout(debounceTimer)
    unsubscribe()
  }
}
