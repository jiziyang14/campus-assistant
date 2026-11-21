import { create } from 'zustand'

/** 相机用途：attach 拍完作为附件；table 拍完走表格 OCR */
export type CameraMode = 'attach' | 'table'

export const useCameraDialog = create<{ open: boolean; mode: CameraMode }>(() => ({
  open: false,
  mode: 'attach',
}))

export const openCameraDialog = (mode: CameraMode = 'attach') =>
  useCameraDialog.setState({ open: true, mode })

export const closeCameraDialog = () =>
  useCameraDialog.setState({ open: false, mode: 'attach' })
