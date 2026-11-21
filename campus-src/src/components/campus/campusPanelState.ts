import { create } from 'zustand'

/** 快捷操作抽屉的开合状态；入口在侧边栏，不占用首页 */
export const useCampusPanel = create<{ open: boolean }>(() => ({ open: false }))

export const openCampusPanel = () => useCampusPanel.setState({ open: true })
export const closeCampusPanel = () => useCampusPanel.setState({ open: false })
