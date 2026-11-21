import { useEffect, useRef, useState } from 'react'
import { translate, useTranslate } from '../../i18n/index.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import { sendMessage, useChatStore } from '../../services/chat/store.js'
import { setDraftText } from '../../services/chat/drafts.js'
import { closeCampusPanel, useCampusPanel } from './campusPanelState.js'
import { openCameraDialog } from './cameraDialogState.js'
import { CampusDeckDialog } from './CampusDeckDialog.js'
import { TeachingCard } from './TeachingCard.js'
import styles from './CampusQuickPanel.module.css'

type Shortcut = {
  id: string
  title: string
  hint: string
  prompt: string
  autoSend: boolean
}

const STORAGE_KEY = 'campus:shortcuts:v1'
const SEED_KEY = 'campus:shortcuts:seed:explain'

/** 拍照讲题：题目在照片里，提示词直接按“读题→思路→推导→答案→易错点”展开 */
const photoExplainPrompt = () => translate('campusPhotoExplainPrompt')

/** 首次进入时补一张“讲解题目”卡片，删除后不会再自动出现 */
const DEFAULT_SHORTCUT_ID = 'campus-default-explain'

const defaultShortcut = (): Shortcut => ({
  id: DEFAULT_SHORTCUT_ID,
  title: translate('shortcutDefaultExplainTitle'),
  hint: translate('shortcutDefaultExplainHint'),
  prompt: translate('shortcutDefaultExplainPrompt'),
  autoSend: false,
})

const loadShortcuts = (): Shortcut[] => {
  let shortcuts: Shortcut[] = []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const value = raw ? JSON.parse(raw) : []
    if (Array.isArray(value)) {
      shortcuts = value
        .filter((item) => item && typeof item.title === 'string' && typeof item.prompt === 'string')
        .map((item) => ({
          id: String(item.id || crypto.randomUUID()),
          title: String(item.title),
          hint: typeof item.hint === 'string' ? item.hint : '',
          prompt: String(item.prompt),
          autoSend: Boolean(item.autoSend),
        }))
    }
  } catch {
    shortcuts = []
  }
  try {
    if (!localStorage.getItem(SEED_KEY)) {
      localStorage.setItem(SEED_KEY, '1')
      if (!shortcuts.some((item) => item.id === DEFAULT_SHORTCUT_ID)) {
        shortcuts = [defaultShortcut(), ...shortcuts]
      }
    }
  } catch {
    // 存储不可用时只在当前页面生效
  }
  return shortcuts
}

const focusComposer = () => {
  requestAnimationFrame(() => {
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea')
    if (!textarea) {
      return
    }
    textarea.focus()
    const end = textarea.value.length
    textarea.setSelectionRange(end, end)
  })
}

/** 侧边栏拉出的快捷操作面板：内置文档放映 + 用户自建卡片 */
export const CampusQuickPanel = () => {
  const t = useTranslate()
  const open = useCampusPanel((state) => state.open)
  const [deckOpen, setDeckOpen] = useState(false)
  const [shortcuts, setShortcuts] = useState<Shortcut[]>(loadShortcuts)
  const [formOpen, setFormOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [hint, setHint] = useState('')
  const [prompt, setPrompt] = useState('')
  const [autoSend, setAutoSend] = useState(false)
  const pressTimer = useRef<number | null>(null)
  const longPressed = useRef(false)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(shortcuts))
    } catch {
      // 存储不可用时只在当前页面生效
    }
  }, [shortcuts])

  useEffect(() => {
    if (!open) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeCampusPanel()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  const openDeck = () => {
    setDeckOpen(true)
    closeCampusPanel()
  }

  const runShortcut = (shortcut: Shortcut) => {
    if (!ensureApiKey()) {
      return
    }
    const sessionId = useChatStore.getState().activeId
    setDraftText(sessionId, shortcut.prompt)
    closeCampusPanel()
    if (shortcut.autoSend) {
      sendMessage(sessionId)
    } else {
      focusComposer()
    }
  }

  /** 讲题主卡片：先填好讲题提示词，再打开相机拍题目（默认展台摄像头） */
  const takePhotoAndExplain = () => {
    if (!ensureApiKey()) {
      return
    }
    const sessionId = useChatStore.getState().activeId
    setDraftText(sessionId, photoExplainPrompt())
    closeCampusPanel()
    openCameraDialog()
  }

  const resetForm = () => {
    setTitle('')
    setHint('')
    setPrompt('')
    setAutoSend(false)
    setFormOpen(false)
  }

  const saveShortcut = () => {
    if (!title.trim() || !prompt.trim()) {
      return
    }
    setShortcuts((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        title: title.trim(),
        hint: hint.trim(),
        prompt: prompt.trim(),
        autoSend,
      },
    ])
    resetForm()
  }

  const removeShortcut = (id: string) => {
    setShortcuts((current) => current.filter((item) => item.id !== id))
  }

  const clearPress = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
  }

  const startPress = (id: string) => {
    longPressed.current = false
    clearPress()
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null
      longPressed.current = true
      removeShortcut(id)
    }, 800)
  }

  return (
    <>
      {open ? (
        <div className={styles.mask} onClick={closeCampusPanel}>
          <aside
            className={styles.panel}
            role="dialog"
            aria-modal="true"
            aria-label={t('shortcuts')}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.head}>
              <div className={styles.title}>{t('shortcuts')}</div>
              <button
                type="button"
                className={styles.close}
                onClick={closeCampusPanel}
                aria-label={t('close')}
              >
                ×
              </button>
            </div>

            <div className={styles.cards}>
              <button type="button" className={styles.card} onClick={openDeck}>
                <span className={styles.deckIcon} aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <rect
                      x="2"
                      y="3.4"
                      width="16"
                      height="11.2"
                      rx="2"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                    <path
                      d="M10 14.6v2M7 17.4h6"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                    <path d="m8.6 6.6 3.6 2.6-3.6 2.6V6.6Z" fill="currentColor" />
                  </svg>
                </span>
                <span className={styles.cardTitle}>{t('campusDeck')}</span>
                <span className={styles.cardHint}>{t('shortcutDeckHint')}</span>
              </button>

              <button
                type="button"
                className={styles.card}
                onClick={() => {
                  if (!ensureApiKey()) {
                    return
                  }
                  closeCampusPanel()
                  openCameraDialog('table')
                }}
              >
                <span className={styles.cardTitle}>{t('campusTable')}</span>
                <span className={styles.cardHint}>{t('campusTableHint')}</span>
              </button>

              {shortcuts.map((shortcut) =>
                shortcut.id === DEFAULT_SHORTCUT_ID ? (
                  <TeachingCard
                    key={shortcut.id}
                    onTakePhoto={takePhotoAndExplain}
                    onType={() => runShortcut(shortcut)}
                  />
                ) : (
                  <div key={shortcut.id} className={styles.cardWrap}>
                    <button
                      type="button"
                      className={styles.card}
                      onPointerDown={() => startPress(shortcut.id)}
                      onPointerUp={clearPress}
                      onPointerLeave={clearPress}
                      onPointerCancel={clearPress}
                      onClick={() => {
                        if (longPressed.current) {
                          longPressed.current = false
                          return
                        }
                        runShortcut(shortcut)
                      }}
                    >
                      <span className={styles.cardTitle}>{shortcut.title}</span>
                      {shortcut.hint ? (
                        <span className={styles.cardHint}>{shortcut.hint}</span>
                      ) : null}
                    </button>
                  </div>
                )
              )}

              {!formOpen ? (
                <button type="button" className={styles.addCard} onClick={() => setFormOpen(true)}>
                  + {t('shortcutAdd')}
                </button>
              ) : null}
            </div>

            {formOpen ? (
              <div className={styles.form}>
                <div className={styles.formTitle}>{t('shortcutFormTitle')}</div>
                <label className={styles.field}>
                  <span>{t('shortcutName')}</span>
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    maxLength={24}
                  />
                </label>
                <label className={styles.field}>
                  <span>{t('shortcutHint')}</span>
                  <input
                    value={hint}
                    onChange={(event) => setHint(event.target.value)}
                    maxLength={40}
                  />
                </label>
                <label className={styles.field}>
                  <span>{t('shortcutPrompt')}</span>
                  <textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    rows={4}
                  />
                </label>
                <label className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={autoSend}
                    onChange={(event) => setAutoSend(event.target.checked)}
                  />
                  <span>{t('shortcutAutoSend')}</span>
                </label>
                <div className={styles.formFoot}>
                  <button type="button" className={styles.cancel} onClick={resetForm}>
                    {t('cancel')}
                  </button>
                  <button
                    type="button"
                    className={styles.save}
                    disabled={!title.trim() || !prompt.trim()}
                    onClick={saveShortcut}
                  >
                    {t('shortcutSave')}
                  </button>
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      ) : null}
      <CampusDeckDialog open={deckOpen} onClose={() => setDeckOpen(false)} />
    </>
  )
}
