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
/** 向上划动超过该距离才认定为上滑，避免误触和抢走点击 */
const PULL_THRESHOLD = 22
/** 从聊天区底部这段高度起手，避免影响正常滚动和阅读 */
const BOTTOM_TRIGGER_ZONE = 160

/**
 * 底部上滑的「最近会话」面板：
 * 在聊天区底部按住往上滑，面板从下方带阻尼升起，松手后吸附到打开或关闭；
 * 面板顶部的拖动条可以再上下调整，点空白或 Esc 关闭。
 * 列表与左侧栏使用同一套分组和排序，切换会话后侧栏同步高亮。
 */
export const HistorySheet = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [settling, setSettling] = useState(false)
  const offsetRef = useRef(0)
  const sheetRef = useRef<HTMLDivElement>(null)
  const headerDragRef = useRef<{ y: number; from: number } | null>(null)
  const settleTimer = useRef<number | undefined>(undefined)
  const suppressClickRef = useRef(false)

  const updateOffset = (value: number) => {
    offsetRef.current = value
    setOffset(value)
  }

  const openSheet = () => {
    window.clearTimeout(settleTimer.current)
    setSettling(true)
    updateOffset(sheetHeight())
    settleTimer.current = window.setTimeout(() => setSettling(false), 240)
  }

  const closeSheet = () => {
    window.clearTimeout(settleTimer.current)
    setSettling(true)
    updateOffset(0)
    settleTimer.current = window.setTimeout(() => setSettling(false), 240)
  }

  // 聊天区底部按住往上滑即可拉起面板；滚轮和触屏滚动不受影响
  useEffect(() => {
    if (isMobile) {
      return
    }
    const canStartFrom = (target: EventTarget | null, clientY: number) => {
      if (!(target instanceof Element)) {
        return false
      }
      if (sheetRef.current?.contains(target)) {
        return false
      }
      const main = target.closest('[data-history-pull]')
      if (!(main instanceof HTMLElement)) {
        return false
      }
      // 只在聊天区底部起手，上面区域留给滚动和阅读
      if (clientY < main.getBoundingClientRect().bottom - BOTTOM_TRIGGER_ZONE) {
        return false
      }
      // 输入框、按钮、链接上不抢手势
      return !target.closest('input, textarea, select, button, a, [contenteditable="true"]')
    }

    let gesture: { startY: number; startX: number; active: boolean } | null = null

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.button !== 0 || offsetRef.current > 0) {
        return
      }
      if (!canStartFrom(event.target, event.clientY)) {
        return
      }
      gesture = { startY: event.clientY, startX: event.clientX, active: false }
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!gesture) {
        return
      }
      const dy = gesture.startY - event.clientY
      const dx = event.clientX - gesture.startX
      if (!gesture.active) {
        // 只认向上的纵向滑动，避免和横向选择、普通点击打架
        if (dy < PULL_THRESHOLD || dy < Math.abs(dx) * 1.3) {
          return
        }
        gesture.active = true
        setSettling(false)
        setDragging(true)
        document.body.style.userSelect = 'none'
      }
      event.preventDefault()
      const max = sheetHeight()
      let next = dy
      if (next > max) {
        next = max + (next - max) * OVERSHOOT
      }
      updateOffset(next)
    }

    const finishGesture = () => {
      if (!gesture) {
        return
      }
      const active = gesture.active
      gesture = null
      if (!active) {
        return
      }
      document.body.style.userSelect = ''
      setDragging(false)
      suppressClickRef.current = true
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
      if (offsetRef.current > sheetHeight() * OPEN_RATIO) {
        openSheet()
      } else {
        closeSheet()
      }
    }

    const onClickCapture = (event: MouseEvent) => {
      if (suppressClickRef.current) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', finishGesture)
    document.addEventListener('pointercancel', finishGesture)
    document.addEventListener('click', onClickCapture, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', finishGesture)
      document.removeEventListener('pointercancel', finishGesture)
      document.removeEventListener('click', onClickCapture, true)
      document.body.style.userSelect = ''
    }
  }, [isMobile])

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

  // 切换会话后收起面板，左侧栏会同步高亮当前会话
  useEffect(() => {
    updateOffset(0)
  }, [activeId])

  // 面板顶部拖动条：往上推可展开，往下拉可收起
  const beginHeaderDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    headerDragRef.current = { y: event.clientY, from: offsetRef.current }
    setSettling(false)
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveHeaderDrag = (event: React.PointerEvent<HTMLElement>) => {
    const start = headerDragRef.current
    if (!start) {
      return
    }
    const max = sheetHeight()
    let next = start.from - (event.clientY - start.y)
    if (next < 0) {
      next *= OVERSHOOT
    } else if (next > max) {
      next = max + (next - max) * OVERSHOOT
    }
    updateOffset(next)
  }

  const endHeaderDrag = () => {
    if (!headerDragRef.current) {
      return
    }
    headerDragRef.current = null
    setDragging(false)
    if (offsetRef.current > sheetHeight() * OPEN_RATIO) {
      openSheet()
    } else {
      closeSheet()
    }
  }

  const open = offset > 0
  const max = sheetHeight()
  const progress = Math.min(1, offset / max)
  const groups = open ? groupSessions(sessions, Date.now(), t) : []

  // 移动端已有抽屉，不叠加底部上滑
  if (isMobile) {
    return null
  }

  return (
    <>
      {open ? (
        <div
          className={styles.backdrop}
          style={{ opacity: progress * 0.32 }}
          onMouseDown={closeSheet}
        />
      ) : null}
      <div
        ref={sheetRef}
        className={clsx(
          styles.sheet,
          dragging && styles.sheetDragging,
          settling && styles.sheetSettling
        )}
        style={{
          height: max,
          transform: `translateY(${max - offset}px)`,
          visibility: open || settling ? 'visible' : 'hidden',
        }}
        aria-hidden={!open}
      >
        <div
          className={styles.sheetHeader}
          onPointerDown={beginHeaderDrag}
          onPointerMove={dragging && headerDragRef.current ? moveHeaderDrag : undefined}
          onPointerUp={endHeaderDrag}
          onPointerCancel={endHeaderDrag}
        >
          <span className={styles.grabber} />
          <div className={styles.headerRow}>
            <span className={styles.sheetTitle}>{t('historySheetTitle')}</span>
            <span className={styles.sheetHint}>{t('historySheetHint')}</span>
          </div>
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
