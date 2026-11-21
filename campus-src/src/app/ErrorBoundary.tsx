import { Component, type ErrorInfo, type ReactNode } from 'react'
import { translate } from '../i18n/index.js'
import {
  downloadDiagnosticReport,
  recordDiagnostic,
} from '../services/diagnostics.js'
import { Button } from '../components/base/Button.js'
import styles from './ErrorBoundary.module.css'

type State = { error: Error | null }

/** 渲染异常时保留可用界面，并提供重新加载与诊断导出，避免直接白屏。 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    recordDiagnostic({
      kind: 'react',
      message: error.message || error.name,
      stack: error.stack,
      context: { componentStack: info.componentStack ?? '' },
    })
  }

  override render() {
    const { error } = this.state
    if (!error) {
      return this.props.children
    }
    return (
      <main className={styles.page} role="alert">
        <div className={styles.card}>
          <h1 className={styles.title}>{translate('appCrashedTitle')}</h1>
          <p className={styles.description}>{translate('appCrashedDescription')}</p>
          <details className={styles.details}>
            <summary>{translate('appCrashedDetail')}</summary>
            <pre>{error.message || error.name}</pre>
          </details>
          <div className={styles.actions}>
            <Button onClick={() => window.location.reload()}>{translate('reload')}</Button>
            <Button variant="outlined" onClick={() => void downloadDiagnosticReport()}>
              {translate('exportDiagnostics')}
            </Button>
          </div>
        </div>
      </main>
    )
  }
}
