import clsx from 'clsx'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { IconCloseOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { closeImagePreview, useImagePreview } from './imagePreviewState.js'
import styles from './ImagePreview.module.css'

/** 应用内图片预览：暗色遮罩居中显示原图，Esc 或点遮罩关闭，不跳出新窗口。 */
export const ImagePreview = () => {
  const t = useTranslate()
  const preview = useImagePreview()

  useEffect(() => {
    if (!preview) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeImagePreview()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [preview])

  if (!preview) {
    return null
  }

  return createPortal(
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={preview.name}
      onMouseDown={(event) => event.target === event.currentTarget && closeImagePreview()}
    >
      <div className={styles.bar}>
        <div className={styles.name} title={preview.name}>
          {preview.name}
        </div>
        <IconButton
          className={styles.close}
          tone="primary"
          icon={<IconCloseOutline16 />}
          aria-label={t('close')}
          onClick={closeImagePreview}
        />
      </div>
      <img className={clsx(styles.image)} src={preview.src} alt={preview.name} />
    </div>,
    document.body
  )
}
