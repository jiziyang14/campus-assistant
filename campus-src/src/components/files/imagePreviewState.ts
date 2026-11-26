import { create } from 'zustand'

/** 全局图片预览：同一时间只显示一张，避免点开图片时跳出应用窗口 */
type ImagePreviewState = { src: string; name: string } | null

export const useImagePreview = create<ImagePreviewState>(() => null)

export const openImagePreview = (src: string, name: string) => {
  useImagePreview.setState({ src, name })
}

export const closeImagePreview = () => {
  useImagePreview.setState(null)
}
