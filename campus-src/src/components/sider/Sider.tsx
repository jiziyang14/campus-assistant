import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconPanelLeftOutline16, IconSettingsOutline16, NewChatIcon, IconChevronDownOutline14 } from '../base/icons.js'
import { AppLogo } from '../base/AppLogo.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { groupSessions, filterSessions } from '../../services/chat/sessionGroups.js'
import { newChat, removeSession, selectSession, useChatStore } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { openCampusPanel } from '../campus/campusPanelState.js'
import { closeMobileSider, useMobileSider } from './mobileSiderState.js'
import { SessionItem } from './SessionItem.js'
import styles from './Sider.module.css'

/** 展开的侧边栏：名称与收起按钮、开启新对话、按时间分组的会话列表、底部设置；移动端放在抽屉里，收起按钮关闭抽屉 */
export const Sider = ({ mobile = false }: { mobile?: boolean }) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const [now, setNow] = useState(Date.now)
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => filterSessions(sessions, query), [sessions, query])
  const groups = useMemo(() => groupSessions(filtered, now, t), [filtered, now, t])
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [showJump, setShowJump] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startY: number; startTop: number; moved: boolean; pointerId: number } | null>(
    null
  )
  const suppressClickRef = useRef(false)

  // 打开时把当前会话滚到可视区域，避免在长列表里从顶部一路找
  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('[data-session-active="true"]')
    active?.scrollIntoView({ block: 'nearest' })
  }, [activeId, groups])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const time = Date.now()
      setNow(time)
      const midnight = new Date(time).setHours(24, 0, 0, 0)
      timer = setTimeout(refresh, midnight - time)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  const updateJump = () => {
    setShowJump((listRef.current?.scrollTop ?? 0) > 120)
  }

  /** 回到最新：滚到列表顶部并选中最新会话，站在大屏前也不用抬手够顶部 */
  const jumpToLatest = () => {
    listRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    const newest = sessions[0]
    if (newest && newest.id !== activeId) {
      selectSession(newest.id)
    }
  }

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    // 触屏交给原生滚动，这里只处理鼠标拖拽
    if (event.pointerType !== 'mouse' || event.button !== 0) {
      return
    }
    const el = listRef.current
    if (!el) {
      return
    }
    dragRef.current = {
      startY: event.clientY,
      startTop: el.scrollTop,
      moved: false,
      pointerId: event.pointerId,
    }
  }

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const el = listRef.current
    if (!drag || !el || event.pointerId !== drag.pointerId) {
      return
    }
    const delta = event.clientY - drag.startY
    if (!drag.moved) {
      if (Math.abs(delta) < 4) {
        return
      }
      drag.moved = true
      setDragging(true)
      try {
        el.setPointerCapture(event.pointerId)
      } catch {
        // 指针已释放时忽略
      }
    }
    el.scrollTop = drag.startTop - delta
    updateJump()
  }

  const endDrag = () => {
    const drag = dragRef.current
    if (!drag) {
      return
    }
    if (drag.moved) {
      // 拖拽结束时浏览器还会派发一次 click，拦掉避免误选会话
      suppressClickRef.current = true
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
    }
    dragRef.current = null
    setDragging(false)
    try {
      listRef.current?.releasePointerCapture(drag.pointerId)
    } catch {
      // 已经释放时忽略
    }
  }

  return (
    <div className={clsx(styles.sider, mobile && styles.mobile)}>
      <div className={styles.brand}>
        <AppLogo size={30} className={styles.brandLogo} />
        <span className={styles.brandName}>{t('appName')}</span>
      </div>
      <div className={styles.listWrap}>
        <div
          ref={listRef}
          className={clsx(styles.list, dragging && styles.listDragging)}
          onScroll={updateJump}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onClickCapture={(event) => {
            if (suppressClickRef.current) {
              event.preventDefault()
              event.stopPropagation()
            }
          }}
        >
          {groups.length === 0 ? (
            <div className={styles.emptySearch}>{t('sessionSearchEmpty')}</div>
          ) : null}
          {groups.map((group) => (
            <div key={group.key} className={styles.section}>
              <div className={styles.sectionHeader}>{group.label}</div>
              {group.sessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  active={session.id === activeId}
                  onDelete={() => setDeleting(session)}
                />
              ))}
            </div>
          ))}
        </div>
        {showJump ? (
          <button type="button" className={styles.jumpLatest} onClick={jumpToLatest}>
            <span className={styles.jumpIcon}>
              <IconChevronDownOutline14 />
            </span>
            {t('sidebarJumpLatest')}
          </button>
        ) : null}
      </div>
      <div className={styles.bottom}>
        <label className={styles.searchRow}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.4" />
            <path d="m10.6 10.6 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            className={styles.searchInput}
            value={query}
            placeholder={t('sessionSearchPlaceholder')}
            aria-label={t('sessionSearchPlaceholder')}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setQuery('')
              }
            }}
          />
          {query ? (
            <button
              type="button"
              className={styles.searchClear}
              aria-label={t('clear')}
              onClick={() => setQuery('')}
            >
              ×
            </button>
          ) : null}
        </label>
        <button
          type="button"
          className={styles.bottomNewChat}
          onClick={() => {
            newChat()
            closeMobileSider()
          }}
        >
          <span className={styles.newChatIcon}>
            <NewChatIcon />
          </span>
          {t('newChat')}
        </button>
        <div className={styles.bottomRow}>
          <button type="button" className={styles.settings} onClick={openCampusPanel}>
            <span className={styles.settingsIcon}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect x="2.2" y="2.2" width="4.6" height="4.6" stroke="currentColor" strokeWidth="1.2" />
                <rect x="9.2" y="2.2" width="4.6" height="4.6" stroke="currentColor" strokeWidth="1.2" />
                <rect x="2.2" y="9.2" width="4.6" height="4.6" stroke="currentColor" strokeWidth="1.2" />
                <rect x="9.2" y="9.2" width="4.6" height="4.6" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </span>
            <span className={styles.settingsLabel}>{t('shortcuts')}</span>
          </button>
          <button type="button" className={styles.settings} onClick={() => openSettings('general')}>
            <span className={styles.settingsIcon}>
              <IconSettingsOutline16 />
            </span>
            <span className={styles.settingsLabel}>{t('settings')}</span>
          </button>
          <button
            type="button"
            className={styles.collapseButton}
            aria-label={t('collapseSiderbarButton')}
            onClick={() => (mobile ? closeMobileSider() : setSiderCollapsed(true))}
          >
            <IconPanelLeftOutline16 />
          </button>
        </div>
      </div>
      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  try {
                    if (await removeSession(deleting.id)) {
                      setDeleting(null)
                    } else {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    setDeletePending(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}
    </div>
  )
}

/** 移动端抽屉：浮在页面上方，点空白区域关闭。 */
export const MobileSider = () => {
  const open = useMobileSider((state) => state.open)
  if (!open) {
    return null
  }
  return (
    <>
      <div className={styles.drawerMask} onClick={closeMobileSider} />
      <div className={styles.drawer}>
        <Sider mobile />
      </div>
    </>
  )
}
