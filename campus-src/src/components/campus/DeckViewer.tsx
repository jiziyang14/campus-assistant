import clsx from 'clsx'
import { Fragment, useCallback, useEffect, useState, type CSSProperties } from 'react'
import { useTranslate } from '../../i18n/index.js'
import type { Deck } from '../../services/campus/deck.js'
import { DeckText } from './DeckText.js'
import styles from './DeckViewer.module.css'

/** 全屏放映：大字号、左右翻页、支持触摸滑动、方向键与字号/放宽控制 */
export const DeckViewer = ({ deck, onClose }: { deck: Deck; onClose: () => void }) => {
  const t = useTranslate()
  const [index, setIndex] = useState(0)
  const [scale, setScale] = useState(1)
  const [wide, setWide] = useState(false)
  const [touchStart, setTouchStart] = useState<number | null>(null)
  const total = deck.slides.length
  const slide = deck.slides[index]
  // 直接分屏的回答没有封面概念，第一页就展示分栏内容
  const cover = index === 0 && !deck.split && !slide?.panes

  const go = (next: number) => setIndex(Math.max(0, Math.min(total - 1, next)))

  const close = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {})
    }
    onClose()
  }, [onClose])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown') {
        event.preventDefault()
        setIndex((current) => Math.min(total - 1, current + 1))
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault()
        setIndex((current) => Math.max(0, current - 1))
      } else if (event.key === 'Escape') {
        close()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [total, close])

  if (!slide) {
    return null
  }

  return (
    <div
      className={styles.viewer}
      role="dialog"
      aria-modal="true"
      aria-label={t('deckButton')}
      onPointerDown={(event) => setTouchStart(event.clientX)}
      onPointerUp={(event) => {
        if (touchStart === null) {
          return
        }
        const delta = event.clientX - touchStart
        setTouchStart(null)
        if (Math.abs(delta) > 48) {
          go(index + (delta < 0 ? 1 : -1))
        }
      }}
    >
      <header className={styles.head}>
        <div className={styles.deckTitle}>
          <DeckText text={deck.title} />
        </div>
        <div className={styles.controls}>
          <button
            type="button"
            className={styles.control}
            aria-label={t('deckSmaller')}
            onClick={() => setScale((value) => Math.max(0.8, Math.round((value - 0.1) * 10) / 10))}
          >
            A−
          </button>
          <button
            type="button"
            className={styles.control}
            aria-label={t('deckLarger')}
            onClick={() => setScale((value) => Math.min(1.6, Math.round((value + 0.1) * 10) / 10))}
          >
            A+
          </button>
          <button
            type="button"
            className={clsx(styles.control, wide && styles.controlOn)}
            onClick={() => setWide((value) => !value)}
          >
            {t('deckWide')}
          </button>
          <button
            type="button"
            className={styles.control}
            onClick={() => {
              setScale(1)
              setWide(false)
            }}
          >
            {t('deckFit')}
          </button>
        </div>
        <div className={styles.counter}>{t('deckSlideCounter', { index: index + 1, total })}</div>
        <button type="button" className={styles.close} onClick={close} aria-label={t('deckClose')}>
          {t('deckClose')}
        </button>
      </header>

      <main
        className={clsx(cover ? styles.cover : styles.slide, wide && styles.wide)}
        style={{ '--deck-scale': scale } as CSSProperties}
      >
        <div className={styles.content}>
          {cover ? (
          <>
            <h1>
              <DeckText text={slide.title} />
            </h1>
            {slide.points.length > 0 ? (
              <p>
                {slide.points.map((point, pointIndex) => (
                  <Fragment key={pointIndex}>
                    {pointIndex > 0 ? ' / ' : ''}
                    <DeckText text={point} />
                  </Fragment>
                ))}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <div className={styles.kicker}>{String(index + 1).padStart(2, '0')}</div>
            {slide.title ? (
              <h2>
                <DeckText text={slide.title} />
              </h2>
            ) : null}
            {slide.panes && slide.panes.length >= 2 ? (
              <div className={styles.panes} data-count={slide.panes.length}>
                {slide.panes.map((pane, paneIndex) => (
                  <section key={paneIndex} className={styles.pane}>
                    {pane.title ? (
                      <h3>
                        <DeckText text={pane.title} />
                      </h3>
                    ) : null}
                    <ul>
                      {pane.points.map((point, pointIndex) => (
                        <li key={pointIndex}>
                          <DeckText text={point} />
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            ) : (
              <ul>
                {slide.points.map((point, pointIndex) => (
                  <li key={pointIndex}>
                    <DeckText text={point} />
                  </li>
                ))}
              </ul>
            )}
            {slide.note ? (
              <div className={styles.note}>
                <DeckText text={slide.note} />
              </div>
            ) : null}
          </>
        )}
        </div>
      </main>

      <footer className={styles.foot}>
        <button
          type="button"
          className={styles.nav}
          disabled={index === 0}
          onClick={() => go(index - 1)}
        >
          {t('deckPrev')}
        </button>
        <div className={styles.progress}>
          <div className={styles.bar}>
            <span style={{ width: `${((index + 1) / total) * 100}%` }} />
          </div>
        </div>
        <button
          type="button"
          className={styles.nav}
          disabled={index === total - 1}
          onClick={() => go(index + 1)}
        >
          {t('deckNext')}
        </button>
      </footer>

      <button
        type="button"
        className={`${styles.zone} ${styles.zoneLeft}`}
        aria-label={t('deckPrev')}
        onClick={() => go(index - 1)}
        disabled={index === 0}
      />
      <button
        type="button"
        className={`${styles.zone} ${styles.zoneRight}`}
        aria-label={t('deckNext')}
        onClick={() => go(index + 1)}
        disabled={index === total - 1}
      />
    </div>
  )
}
