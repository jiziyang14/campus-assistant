import { useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { buildDeckFromFiles } from '../../services/campus/document.js'
import type { Deck } from '../../services/campus/deck.js'
import { showToast } from '../base/toastState.js'
import { DeckViewer } from './DeckViewer.js'
import styles from './CampusDeckDialog.module.css'

/** 文档放映：本地读取课件/文档，按原文结构直接分屏，不做总结或改写 */
const SUPPORTED = '.pptx,.docx,.txt,.md,.markdown,.csv,.tsv,.html,.htm,.json,.log'

export const CampusDeckDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const t = useTranslate()
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [deck, setDeck] = useState<Deck | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  if (!open) {
    return null
  }

  const accept = (incoming: File[]) => {
    if (incoming.length === 0) {
      return
    }
    setFiles((current) => {
      const seen = new Set(current.map((file) => `${file.name}:${file.size}`))
      const merged = [...current]
      for (const file of incoming) {
        const key = `${file.name}:${file.size}`
        if (!seen.has(key)) {
          seen.add(key)
          merged.push(file)
        }
      }
      return merged
    })
  }

  const present = async () => {
    if (files.length === 0) {
      showToast(t('deckNeedFiles'))
      return
    }
    setBusy(true)
    try {
      const result = await buildDeckFromFiles(files)
      if (!result.deck || result.deck.slides.length === 0) {
        showToast(t('deckNoContent'))
        return
      }
      if (result.failed.length > 0) {
        showToast(t('deckPartialFailed', { count: result.failed.length }))
      }
      setDeck(result.deck)
      const target = document.documentElement
      if (target.requestFullscreen) {
        void target.requestFullscreen().catch(() => {})
      }
      setViewerOpen(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className={styles.mask} onClick={onClose}>
        <div
          className={styles.dialog}
          role="dialog"
          aria-modal="true"
          aria-label={t('deckDialogTitle')}
          onClick={(event) => event.stopPropagation()}
        >
          <div className={styles.head}>
            <div className={styles.title}>{t('deckDialogTitle')}</div>
            <button type="button" className={styles.close} onClick={onClose}>
              ×
            </button>
          </div>

          <button
            type="button"
            className={styles.choose}
            onClick={() => fileInputRef.current?.click()}
          >
            <span>+</span>
            {t('deckChooseFiles')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            accept={SUPPORTED}
            onChange={(event) => {
              accept(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />

          {files.length > 0 ? (
            <div className={styles.files}>
              {files.map((file) => (
                <div key={`${file.name}:${file.size}`} className={styles.file}>
                  <span className={styles.fileName}>{file.name}</span>
                  <button
                    type="button"
                    className={styles.fileRemove}
                    aria-label={t('deckRemoveFile')}
                    onClick={() =>
                      setFiles((current) => current.filter((item) => item !== file))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className={styles.foot}>
            <button type="button" className={styles.cancel} onClick={onClose}>
              {t('cancel')}
            </button>
            <button
              type="button"
              className={styles.generate}
              disabled={busy || files.length === 0}
              onClick={() => void present()}
            >
              {busy ? t('deckReading') : t('deckGenerate')}
            </button>
          </div>
        </div>
      </div>

      {viewerOpen && deck ? (
        <DeckViewer
          deck={deck}
          onClose={() => {
            setViewerOpen(false)
            onClose()
          }}
        />
      ) : null}
    </>
  )
}
