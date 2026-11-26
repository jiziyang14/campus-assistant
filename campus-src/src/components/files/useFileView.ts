import { useEffect, useState, type MouseEvent } from 'react'
import { getFileViewType, isImage } from '../../services/attachments.js'
import { loadFile } from '../../services/chat/db.js'
import { openImagePreview } from './imagePreviewState.js'

const createViewUrl = (original: Blob, type: string) => {
  const blob = original.slice(0, original.size, type || 'application/octet-stream')
  if (type !== 'image/svg+xml') {
    return URL.createObjectURL(blob)
  }
  // SVG 缩略图用 data: 地址，单独打开图片时也与应用隔离。
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** 草稿传 File，已发送的附件传 IndexedDB 原件 ID。 */
export const useFileView = (source: File | string, name: string) => {
  const type = getFileViewType(name)
  const [state, setState] = useState<{ source: File | string; type: string; url: string | null }>()
  useEffect(() => {
    let active = true
    const original = typeof source === 'string' ? loadFile(source) : Promise.resolve(source)
    const pending = original
      .then((blob) => (active && blob ? createViewUrl(blob, type) : null))
      .catch(() => null)
    void pending.then((url) => {
      if (active) {
        setState({ source, type, url })
      }
    })
    return () => {
      active = false
      void pending.then((url) => {
        if (url?.startsWith('blob:')) {
          URL.revokeObjectURL(url)
        }
      })
    }
  }, [source, type])

  const url = state?.source === source && state.type === type ? state.url : undefined
  const image = isImage(type)
  // 图片在应用内预览，PDF 仍开新窗口，其余文件保持下载
  const link = url
    ? type === 'application/pdf'
      ? { href: url, target: '_blank', rel: 'noreferrer' }
      : image
        ? {
            href: url,
            onClick: (event: MouseEvent<HTMLAnchorElement>) => {
              event.preventDefault()
              openImagePreview(url, name)
            },
          }
        : { href: url, download: name }
    : undefined
  return { url, image, link }
}
