import { useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import type { ChatModel, MessageUsage } from '../../services/api/types.js'
import { CONTEXT_LIMIT, estimateUsage } from '../../services/usage/estimate.js'
import { IconUsageOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import styles from './UsageInfo.module.css'

const formatTokens = (value: number): string => {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}K`
  }
  return String(value)
}

/** 金额保留 4–6 位小数，去掉末尾多余的 0 */
const formatCost = (cost: number): string => {
  if (!(cost > 0)) {
    return '¥0'
  }
  const text = (cost < 0.01 ? cost.toFixed(6) : cost.toFixed(4)).replace(/\.?0+$/, '')
  return `¥${text}`
}

/** 回答工具栏里的「本轮用量」图标：点开才显示 Token 与估算金额明细。 */
export const UsageInfo = ({
  usage,
  model,
  at,
}: {
  usage: MessageUsage
  model: ChatModel
  /** 请求开始时间，用于判断峰谷价 */
  at: number
}) => {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const estimate = estimateUsage(usage, model, at)

  useEffect(() => {
    if (!open) {
      return
    }
    const onMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (estimate.totalTokens <= 0) {
    return null
  }

  return (
    <div ref={rootRef} className={styles.usage}>
      <IconButton
        icon={<IconUsageOutline16 />}
        tooltip={t('usageToggle')}
        tooltipPlacement="bottom"
        aria-expanded={open}
        aria-haspopup="dialog"
        className={open ? styles.active : undefined}
        onClick={() => setOpen((value) => !value)}
      />
      {open ? (
        <div className={styles.popover} role="dialog" aria-label={t('usageToggle')}>
          <div className={styles.summary}>
            {t('usageSummary', {
              input: formatTokens(estimate.missTokens + estimate.cacheReadTokens),
              output: formatTokens(estimate.outputTokens),
              cost: formatCost(estimate.cost),
            })}
          </div>
          <div className={styles.row}>
            <span className={styles.label}>{t('usageInputLabel')}</span>
            <span className={styles.value}>
              {formatTokens(estimate.missTokens)}（{t('usageCacheMissLabel')}） +{' '}
              {formatTokens(estimate.cacheReadTokens)}（{t('usageCacheHitLabel')}）
            </span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>{t('usageOutputLabel')}</span>
            <span className={styles.value}>{formatTokens(estimate.outputTokens)}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>
              {t(estimate.peak ? 'usagePricePeak' : 'usagePriceOffPeak')}
            </span>
            <span className={styles.value}>
              {t('usagePriceLine', {
                miss: String(estimate.price.miss),
                output: String(estimate.price.output),
              })}
            </span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>{t('usageContextLabel')}</span>
            <span className={styles.value}>
              <span className={styles.contextText}>
                {t('usageContextValue', {
                  used: formatTokens(estimate.contextTokens),
                  total: formatTokens(CONTEXT_LIMIT),
                })}
              </span>
              <span className={styles.track}>
                <span
                  className={styles.trackFill}
                  style={{
                    width: `${Math.min(100, (estimate.contextTokens / CONTEXT_LIMIT) * 100)}%`,
                  }}
                />
              </span>
            </span>
          </div>
          <div className={styles.note}>{t('usageEstimateNote')}</div>
        </div>
      ) : null}
    </div>
  )
}
