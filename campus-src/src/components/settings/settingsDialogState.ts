import { create } from 'zustand'

/** 设置弹窗的分组：通用设置 / 数据管理 / 诊断 */
export type SettingsSection = 'general' | 'data' | 'diagnostics'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
}))

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section })

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/**
 * 校园版的 Key 由本地服务代理，前端不读取也不保存真实 Key。
 * 保留这个函数作为调用方的统一入口；服务端未配置时由请求返回 503。
 */
export const ensureApiKey = () => true
