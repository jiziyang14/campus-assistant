import { useEffect, useState, type ReactNode } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  clearDiagnosticEntries,
  downloadDiagnosticReport,
  getDiagnosticEntries,
  type DiagnosticEntry,
} from '../../services/diagnostics.js'
import { Button } from '../base/Button.js'
import styles from './Settings.module.css'

type Health = {
  app?: string
  version?: string
  buildTime?: string
  port?: number
  startedAt?: string
  config?: { configured?: boolean; source?: string; error?: string }
  logDir?: string
}

type HealthState = { data: Health } | { error: string } | null

const formatBytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B'
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

const formatTime = (value: string | undefined, locale: string) => {
  if (!value) {
    return '-'
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale)
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className={styles.diagnosticsRow}>
    <span className={styles.diagnosticsLabel}>{label}</span>
    <span className={styles.diagnosticsValue}>{children}</span>
  </div>
)

/** 诊断分组：版本、本地服务、存储与最近错误；所有内容都可导出为 JSON。 */
export const DiagnosticsSettings = () => {
  const t = useTranslate()
  const [tick, setTick] = useState(0)
  const [health, setHealth] = useState<HealthState>(null)
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null)
  const [errors, setErrors] = useState<DiagnosticEntry[]>([])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const [healthResult, storageResult] = await Promise.all([
        fetch('/health', { cache: 'no-store' })
          .then(async (response) => {
            if (!response.ok) {
              return { error: `HTTP ${response.status}` } as const
            }
            return { data: (await response.json()) as Health } as const
          })
          .catch((error: unknown) => ({
            error: error instanceof Error ? error.message : String(error),
          })),
        navigator.storage
          ?.estimate?.()
          .then((estimate) => ({ usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 }))
          .catch(() => null) ?? Promise.resolve(null),
      ])
      if (!cancelled) {
        setHealth(healthResult)
        setStorage(storageResult)
        setErrors(getDiagnosticEntries().slice(-5).reverse())
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [tick])

  const locale = document.documentElement.lang || 'zh-CN'
  const online = health !== null && 'data' in health
  const server = online ? health.data : null
  const serverError = health !== null && 'error' in health ? health.error : null

  return (
    <div className={styles.diagnostics}>
      <p className={styles.description}>{t('diagnosticsDescription')}</p>
      <div className={styles.diagnosticsGrid}>
        <Row label={t('diagnosticsVersion')}>{__APP_VERSION__}</Row>
        <Row label={t('diagnosticsBuildTime')}>{formatTime(__BUILD_TIME__, locale)}</Row>
        <Row label={t('diagnosticsServer')}>
          <span className={online ? styles.badgeOnline : styles.badgeOffline}>
            {t(online ? 'diagnosticsServerOnline' : 'diagnosticsServerOffline')}
          </span>
          {server?.version ? ` ${server.version}` : ''}
          {server?.port ? ` :${server.port}` : ''}
        </Row>
        {serverError ? (
          <Row label={t('diagnosticsServer')}>
            {t('diagnosticsHealthError', { message: serverError })}
          </Row>
        ) : null}
        {server?.config ? (
          <>
            <Row label={t('diagnosticsConfig')}>
              {t(
                server.config.configured
                  ? 'diagnosticsConfigConfigured'
                  : 'diagnosticsConfigMissing'
              )}
            </Row>
            <Row label={t('diagnosticsConfigSource')}>{server.config.source ?? '-'}</Row>
            {server.config.error ? (
              <Row label={t('diagnosticsConfigSource')}>{server.config.error}</Row>
            ) : null}
          </>
        ) : null}
        <Row label={t('diagnosticsStorage')}>
          {storage
            ? t('diagnosticsStorageValue', {
                used: formatBytes(storage.usage),
                quota: formatBytes(storage.quota),
              })
            : t('diagnosticsStorageUnavailable')}
        </Row>
        {server?.logDir ? (
          <Row label={t('diagnosticsLogDir')}>
            <code className={styles.mono}>{server.logDir}</code>
          </Row>
        ) : null}
      </div>

      <div className={styles.diagnosticsSection}>
        <div className={styles.diagnosticsHeading}>{t('diagnosticsErrors')}</div>
        {errors.length === 0 ? (
          <p className={styles.description}>{t('diagnosticsNoErrors')}</p>
        ) : (
          <div className={styles.errorList}>
            {errors.map((entry) => (
              <details key={`${entry.at}-${entry.message}`} className={styles.errorItem}>
                <summary>
                  <span className={styles.errorMeta}>
                    {formatTime(entry.at, locale)} · {entry.kind}
                  </span>
                  <span className={styles.errorMessage}>{entry.message}</span>
                </summary>
                {entry.stack ? <pre className={styles.errorStack}>{entry.stack}</pre> : null}
              </details>
            ))}
          </div>
        )}
      </div>

      <div className={styles.diagnosticsActions}>
        <Button variant="outlined" size="s" onClick={() => setTick((value) => value + 1)}>
          {t('diagnosticsRefresh')}
        </Button>
        <Button variant="outlined" size="s" onClick={() => void downloadDiagnosticReport()}>
          {t('diagnosticsExport')}
        </Button>
        <Button
          variant="outlined"
          size="s"
          disabled={errors.length === 0}
          onClick={() => {
            clearDiagnosticEntries()
            setErrors([])
          }}
        >
          {t('diagnosticsClear')}
        </Button>
      </div>
    </div>
  )
}
