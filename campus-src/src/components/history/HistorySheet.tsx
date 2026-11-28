import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import { selectSession, useChatStore } from '../../services/chat/store.js'
import styles from './HistorySheet.module.css'

/** 面板最大高度：约占屏幕一半，便于站着操作 */
const sheetHeight = () => Math.min(window.innerHeight * 0.55, 560)
/** 松手后超过该比例就停在打开状态 */
const OPEN_RATIO = 0.32
/** 越界拖拽的阻尼系数 */
const OVERSHOOT = 0.15

/**
 * 顶部下拉的「最近会话」面板：
 * 从聊天区顶部往下拖，面板跟随手指/鼠标带阻尼下移，松手后吸附到打开或关闭；
 * 右上角标题栏也能上下拖动，点空白或 Esc 关闭。
 */
export const HistorySheet = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [settling, setSettling] = useState(false)
  const startRef = useRef<{ y: number; from: number } | null>(null)
  const settleTimer = useRef<number | undefined>(undefined)

  const openSheet = () => {
    window.clearTimeout(settleTimer.current)
    setSettling(true)
    setOffset(sheetHeight())
    settleTimer.current = window.setTimeout(() => setSettling(false), 240)
  }

  const closeSheet = () => {
    window.clearTimeout(settleTimer.current)
    setSettling(true)
    setOffset(0)
    settleTimer.current = window.setTimeout(() => setSettling(false), 240)
  }

  useEffect(() => {
    if (offset <= 0) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeSheet()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [offset])

  // 切换会话后收起面板
  useEffect(() => {
    setOffset(0)
  }, [activeId])

  const beginDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    startRef.current = { y: event.clientY, from: offset }
    setSettling(false)
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveDrag = (event: React.PointerEvent<HTMLElement>) => {
    const start = startRef.current
    if (!start) {
      return
    }
    const max = sheetHeight()
    let next = start.from + (event.clientY - start.y)
    // 上下越界都带阻尼，避免拖出屏幕
    if (next < 0) {
      next *= OVERSHOOT
    } else if (next > max) {
      next = max + (next - max) * OVERSHOOT
    }
    setOffset(next)
  }

  const endDrag = () => {
    const start = startRef.current
    if (!start) {
      return
    }
    startRef.current = null
    setDragging(false)
    const max = sheetHeight()
    if (offset > max * OPEN_RATIO) {
      openSheet()
    } else {
      closeSheet()
    }
  }

  const open = offset > 0
  const max = sheetHeight()
  const progress = Math.min(1, offset / max)
  const groups = open ? groupSessions(sessions, Date.now(), t) : []

  // 移动端已有抽屉，不叠加顶部下拉
  if (isMobile) {
    return null
  }

  return (
    <>
      <div
        className={styles.pullZone}
        onPointerDown={beginDrag}
        onPointerMove={dragging ? moveDrag : undefined}
        onPointerUp={dragging ? endDrag : undefined}
        onPointerCancel={dragging ? endDrag : undefined}
      >
        <span className={styles.pullHandle} />
      </div>
      {open ? (
        <div
          className={styles.backdrop}
          style={{ opacity: progress * 0.32 }}
          onMouseDown={closeSheet}
        />
      ) : null}
      <div
        className={clsx(
          styles.sheet,
          dragging && styles.sheetDragging,
          settling && styles.sheetSettling
        )}
        style={{
          height: max,
          transform: `translateY(${offset - max}px)`,
          visibility: open || settling ? 'visible' : 'hidden',
        }}
        aria-hidden={!open}
      >
        <div
          className={styles.sheetHeader}
          onPointerDown={beginDrag}
          onPointerMove={dragging ? moveDrag : undefined}
          onPointerUp={dragging ? endDrag : undefined}
          onPointerCancel={dragging ? endDrag : undefined}
        >
          <span className={styles.sheetTitle}>{t('historySheetTitle')}</span>
          <span className={styles.sheetHint}>{t('historySheetHint')}</span>
        </div>
        <div className={styles.sheetList}>
          {groups.length === 0 ? (
            <div className={styles.empty}>{t('historySheetEmpty')}</div>
          ) : (
            groups.map((group) => (
              <div key={group.key}>
                <div className={styles.groupLabel}>{group.label}</div>
                {group.sessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    className={clsx(styles.row, session.id === activeId && styles.rowActive)}
                    onClick={() => {
                      selectSession(session.id)
                      closeSheet()
                    }}
                  >
                    <span className={styles.rowTitle}>{session.title || t('untitledChat')}</span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  )
}
