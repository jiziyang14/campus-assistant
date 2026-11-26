import { create } from 'zustand'

/** 相机用途：attach 拍完作为附件；teach 拍照讲题；table 拍完走表格 OCR；beauty 颜值争霸赛自拍 */
export type CameraMode = 'attach' | 'teach' | 'table' | 'beauty'

export const useCameraDialog = create<{ open: boolean; mode: CameraMode }>(() => ({
  open: false,
  mode: 'attach',
}))

export const openCameraDialog = (mode: CameraMode = 'attach') =>
  useCameraDialog.setState({ open: true, mode })

export const closeCameraDialog = () =>
  useCameraDialog.setState({ open: false, mode: 'attach' })
