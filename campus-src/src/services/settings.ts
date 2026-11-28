import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 本机设置，存 localStorage：API Key、语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态 */
type Settings = {
  apiKey: string | null
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
  /** 实时语音：用浏览器识别边说边出字，失败自动回退 DeepSeek 整段转写 */
  realtimeVoice: boolean
  /** U 盘自动备份：对话后静默写入，默认开启 */
  autoBackup: boolean
  /** 无感合并：新设备空白时自动从 U 盘恢复并合并，默认开启 */
  autoBackupMerge: boolean
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
  realtimeVoice: 'chat-demo:realtime-voice',
  autoBackup: 'chat-demo:auto-backup-enabled',
  autoBackupMerge: 'chat-demo:auto-backup-merge',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

// 校园版密钥已移到本地服务端，清理旧版本留在浏览器里的 Key
try {
  localStorage.removeItem(KEYS.apiKey)
} catch {
  // 存储不可用时忽略
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 校园一体机默认浅色，管理员仍可在设置里改深色或跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'light'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

export const useSettings = create<Settings>(() => ({
  // 密钥由本地服务端代理注入，前端只使用占位值，不再读取或展示真实 Key
  apiKey: 'local-proxy',
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
  // 默认开启实时语音，关闭时退回整段转写
  realtimeVoice: read(KEYS.realtimeVoice) !== 'false',
  // 自动备份与无感合并都默认开启
  autoBackup: read(KEYS.autoBackup) !== 'false',
  autoBackupMerge: read(KEYS.autoBackupMerge) !== 'false',
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

export const setRealtimeVoice = (realtimeVoice: boolean) => {
  write(KEYS.realtimeVoice, String(realtimeVoice))
  useSettings.setState({ realtimeVoice })
}

export const setAutoBackup = (autoBackup: boolean) => {
  write(KEYS.autoBackup, String(autoBackup))
  useSettings.setState({ autoBackup })
}

export const setAutoBackupMerge = (autoBackupMerge: boolean) => {
  write(KEYS.autoBackupMerge, String(autoBackupMerge))
  useSettings.setState({ autoBackupMerge })
}
