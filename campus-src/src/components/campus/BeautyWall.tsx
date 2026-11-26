import { useEffect, useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import * as db from '../../services/chat/db.js'
import { newChat } from '../../services/chat/store.js'
import type { Session } from '../../services/chat/types.js'
import styles from './BeautyWall.module.css'

type Photo = { id: string; name: string }

const collectPhotos = (session: Session): Photo[] => {
  const seen = new Set<string>()
  const photos: Photo[] = []
  for (const message of session.messages) {
    if (message.role !== 'user') {
      continue
    }
    for (const file of message.files) {
      if (!file.isImage || seen.has(file.id)) {
        continue
      }
      seen.add(file.id)
      photos.push({ id: file.id, name: file.name })
    }
  }
  return photos
}

/** 颜值争霸赛的照片墙：把这场会话里出现过的图片集中展示，轻量、只读。 */
export const BeautyWallBar = ({ session }: { session: Session }) => {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const photos = useMemo(() => collectPhotos(session), [session])

  return (
    <>
      <div className={styles.bar}>
        <span className={styles.crown} aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
            <path
              d="M3 14.5 2 6l4.5 3L10 4l3.5 5L18 6l-1 8.5H3Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <path d="M4.5 16.5h11" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </span>
        <div className={styles.text}>
          <span className={styles.title}>{t('beautyBarTitle')}</span>
          <span className={styles.hint}>{t('beautyBarHint', { count: photos.length })}</span>
        </div>
        <button
          type="button"
          className={styles.wallButton}
          onClick={() => setOpen(true)}
          disabled={photos.length === 0}
        >
          {t('beautyWallOpen')}
        </button>
        <button
          type="button"
          className={styles.exitButton}
          onClick={newChat}
          title={t('beautyBarExit')}
        >
          {t('beautyBarExit')}
        </button>
      </div>
      {open ? <BeautyWall photos={photos} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

const BeautyWall = ({ photos, onClose }: { photos: Photo[]; onClose: () => void }) => {
  const t = useTranslate()
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [active, setActive] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const created: string[] = []
    const load = async () => {
      for (const photo of photos) {
        const blob = await db.loadFile(photo.id)
        if (cancelled) {
          return
        }
        if (blob) {
          const url = URL.createObjectURL(blob)
          created.push(url)
          setUrls((current) => ({ ...current, [photo.id]: url }))
        }
      }
    }
    void load()
    return () => {
      cancelled = true
      created.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [photos])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (active) {
          setActive(null)
        } else {
          onClose()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [active, onClose])

  return (
    <div className={styles.mask} onClick={onClose}>
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={t('beautyWallTitle')}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.head}>
          <div className={styles.headTitle}>{t('beautyWallTitle')}</div>
          <button type="button" className={styles.close} onClick={onClose} aria-label={t('close')}>
            ×
          </button>
        </div>
        {photos.length === 0 ? (
          <p className={styles.empty}>{t('beautyWallEmpty')}</p>
        ) : (
          <div className={styles.grid}>
            {photos.map((photo, index) => (
              <figure key={photo.id} className={styles.polaroid}>
                {urls[photo.id] ? (
                  <button
                    type="button"
                    className={styles.photoButton}
                    onClick={() => setActive(urls[photo.id])}
                    aria-label={t('beautyWallCaption', { index: index + 1 })}
                  >
                    <img src={urls[photo.id]} alt="" />
                  </button>
                ) : (
                  <div className={styles.placeholder} />
                )}
                <figcaption className={styles.caption}>
                  {t('beautyWallCaption', { index: index + 1 })}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
      {active ? (
        <div
          className={styles.lightbox}
          onClick={(event) => {
            event.stopPropagation()
            setActive(null)
          }}
        >
          <img src={active} alt="" onClick={(event) => event.stopPropagation()} />
        </div>
      ) : null}
    </div>
  )
}
