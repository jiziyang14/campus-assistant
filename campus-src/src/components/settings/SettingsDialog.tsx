import clsx from 'clsx'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  IconDarkOutline16,
  IconDataOutline16,
  IconDownloadOutline16,
  IconFollowsystemOutline16,
  IconLightOutline16,
  IconLoadingOutline16,
  IconSettingsOutline16,
  IconUploadOutline14,
  IconWarningOutline16,
} from '../base/icons.js'
import {
  BackupError,
  clearHistory,
  exportHistory,
  importHistory,
  mergeImportHistory,
} from '../../services/chat/backup.js'
import { currencySymbol, fetchBalance } from '../../services/api/balance.js'
import { fetchServerConfig, saveServerApiKey } from '../../services/api/serverConfig.js'
import { useChatStore } from '../../services/chat/store.js'
import { regionCodes, getRegionName, provinces } from '../../services/location.js'
import {
  isChineseBrowser,
  setLocale,
  setLocation,
  setRealtimeVoice,
  setThemePreference,
  setTtsVoice,
  useSettings,
  type ThemePreference,
} from '../../services/settings.js'
import { useTranslate, type TranslationKey, type TranslationMessage } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import { closeSettings, useSettingsDialog, type SettingsSection } from './settingsDialogState.js'
import { DiagnosticsSettings } from './DiagnosticsSettings.js'
import { DriveBackup } from './DriveBackup.js'
import styles from './Settings.module.css'

/**
 * 设置弹窗：分「通用设置」（主题、语言、朗读音色、位置）与「数据管理」（导入、导出、删除）。
 * API Key 由本地服务端代理注入，界面不再读取或展示。
 */
export const SettingsDialog = () => {
  const open = useSettingsDialog((state) => state.open)
  // 导入状态放在弹窗外面，关闭设置再打开时还能看到进度
  const historyImport = useHistoryImport()
  return open ? <SettingsContent historyImport={historyImport} /> : null
}

const sections: { value: SettingsSection; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'general',
    label: 'settingDialogAsideGeneralOptionLabel',
    icon: <IconSettingsOutline16 />,
  },
  { value: 'data', label: 'settingDialogAsideDataOptionLabel', icon: <IconDataOutline16 /> },
  {
    value: 'diagnostics',
    label: 'settingDialogAsideDiagnosticsOptionLabel',
    icon: <IconWarningOutline16 />,
  },
]

const SettingsContent = ({
  historyImport,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
}) => {
  const t = useTranslate()
  // 打开时按调用方指定的分组选中，之后在弹窗内切换
  const [section, setSection] = useState(() => useSettingsDialog.getState().section)
  const historyDelete = useHistoryDelete()
  const replacingHistory = useChatStore((state) => state.importingHistory)
  const historyBusy = historyImport.busy || historyDelete.busy || replacingHistory
  return (
    <>
      <Modal
        title={t('settings')}
        closable
        className={styles.dialog}
        mainClassName={styles.dialogMain}
        onClose={() => {
          if (!historyDelete.busy) {
            historyImport.dismiss()
            closeSettings()
          }
        }}
      >
        <div role="tablist" className={styles.navigation}>
          {sections.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={section === item.value}
              className={clsx(styles.navItem, section === item.value && styles.navItemActive)}
              onClick={() => setSection(item.value)}
            >
              {item.icon}
              {t(item.label)}
            </button>
          ))}
        </div>
        <div role="tabpanel" className={styles.content}>
          {section === 'general' ? (
            <>
              <ApiKeySetting />
              <ThemeSetting />
              <LocaleSetting />
              <TtsVoiceSetting />
              <RealtimeVoiceSetting />
              <LocationSetting />
              <BalanceSetting />
            </>
          ) : section === 'data' ? (
            <>
              <ImportHistory historyImport={historyImport} disabled={historyBusy} />
              <ExportHistory disabled={historyBusy} />
              <DriveBackup disabled={historyBusy} onPickImport={historyImport.select} />
              <SettingCell
                label={t('deleteAllSessions')}
                status={null}
                action={
                  <Button
                    variant="dangerOutlined"
                    size="m"
                    className={styles.cellButton}
                    disabled={historyBusy}
                    onClick={historyDelete.open}
                  >
                    {t('delete')}
                  </Button>
                }
              />
            </>
          ) : (
            <DiagnosticsSettings />
          )}
        </div>
      </Modal>
      {historyImport.file ? <ImportConfirm historyImport={historyImport} /> : null}
      {historyDelete.opened ? <DeleteAllConfirm historyDelete={historyDelete} /> : null}
    </>
  )
}

/** 删除确认保留在设置之上；失败可重试，成功只关闭确认弹窗。 */
const DeleteAllConfirm = ({
  historyDelete,
}: {
  historyDelete: ReturnType<typeof useHistoryDelete>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('deleteAllSessionsModalTitle')}
      className={styles.deleteConfirm}
      onClose={historyDelete.cancel}
      footer={
        <div className={styles.deleteActions} aria-busy={historyDelete.busy}>
          <Button
            variant="outlined"
            autoFocus
            disabled={historyDelete.busy}
            onClick={historyDelete.cancel}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={historyDelete.busy}
            onClick={() => void historyDelete.confirm()}
          >
            {t(historyDelete.busy ? 'historyDeleting' : 'deleteAllSessions')}
          </Button>
        </div>
      }
    >
      {t('deleteAllSessionsModalDescription')}
    </Modal>
  )
}

const useHistoryDelete = () => {
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const deleting = useRef(false)

  const confirm = async () => {
    if (deleting.current) {
      return
    }
    deleting.current = true
    setBusy(true)
    try {
      await clearHistory()
      setOpened(false)
      showToast({ key: 'historyDeleted' })
    } catch {
      showToast({ key: 'historyDeleteFailed', type: 'error' })
    } finally {
      deleting.current = false
      setBusy(false)
    }
  }

  return {
    opened,
    busy,
    open: () => setOpened(true),
    cancel: () => {
      if (!deleting.current) {
        setOpened(false)
      }
    },
    confirm,
  }
}

const LocationSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const location = useSettings((state) => state.location)
  const province =
    location?.region === 'CN'
      ? provinces.find((item) => item.code === location.province)
      : undefined

  return (
    <SettingCell
      label={t('settingsLocation')}
      status={null}
      className={styles.locationCell}
      action={
        <div className={styles.locationSelectors}>
          {isChineseBrowser() ? (
            <>
              <Select
                ariaLabel={t('settingsLocationProvince')}
                className={styles.provinceSelect}
                value={province?.code ?? ''}
                placeholder={t('settingsLocationProvince')}
                options={provinces.map((item) => ({ value: item.code, label: item.name }))}
                onChange={(value) => {
                  if (value !== province?.code) {
                    setLocation({ region: 'CN', province: value })
                  }
                }}
              />
              <Select
                ariaLabel={t('settingsLocationCity')}
                className={styles.citySelect}
                value={province ? (location?.city ?? '') : ''}
                disabled={!province?.cities.length}
                placeholder={t('settingsLocationCity')}
                options={
                  province?.cities.map((item) => ({ value: item.code, label: item.name })) ?? []
                }
                onChange={(value) => {
                  if (province) {
                    setLocation({ region: 'CN', province: province.code, city: value })
                  }
                }}
              />
            </>
          ) : (
            <Select
              ariaLabel={t('settingsLocationRegion')}
              className={styles.regionSelect}
              value={location?.region ?? ''}
              placeholder={t('settingsLocationRegion')}
              options={regionCodes
                .map((code) => ({ value: code, label: getRegionName(code, locale) }))
                .sort((a, b) => a.label.localeCompare(b.label, locale))}
              onChange={(value) => setLocation({ region: value })}
            />
          )}
        </div>
      }
    />
  )
}

/** 应用内填写 API Key：公开分发的 exe 不嵌 Key，保存到本机 config.json */
const ApiKeySetting = () => {
  const t = useTranslate()
  const [status, setStatus] = useState<'loading' | 'configured' | 'missing' | 'unsupported'>(
    'loading'
  )
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetchServerConfig()
      .then((config) => {
        if (active) {
          setStatus(config.configured ? 'configured' : 'missing')
        }
      })
      .catch(() => {
        if (active) {
          setStatus('unsupported')
        }
      })
    return () => {
      active = false
    }
  }, [])

  // 开发服务器没有本地配置接口时不展示，避免干扰
  if (status === 'unsupported') {
    return null
  }

  const save = async () => {
    const apiKey = value.trim()
    if (!apiKey || saving) {
      return
    }
    setSaving(true)
    setError(null)
    try {
      await saveServerApiKey(apiKey)
      setStatus('configured')
      setEditing(false)
      setValue('')
      showToast({ key: 'apiKeySavedToast' })
    } catch (e) {
      setError(t('apiKeySaveFailed', { message: e instanceof Error ? e.message : String(e) }))
    } finally {
      setSaving(false)
    }
  }

  const description =
    status === 'loading'
      ? t('apiKeyStatusLoading')
      : status === 'configured'
        ? t('apiKeyStatusConfigured')
        : t('apiKeyStatusMissing')

  return (
    <div className={styles.cell}>
      <div className={styles.apiKey}>
        <div className={styles.row}>
          <div className={styles.text}>
            <div className={styles.label}>{t('apiKeySettingLabel')}</div>
            <div className={styles.description}>{description}</div>
          </div>
          <Button
            variant="outlined"
            size="m"
            className={styles.cellButton}
            disabled={status === 'loading'}
            onClick={() => setEditing((current) => !current)}
          >
            {status === 'configured' ? t('apiKeyEdit') : t('apiKeySaveButton')}
          </Button>
        </div>
        {editing ? (
          <div className={styles.apiKeyInput}>
            <input
              type="password"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder={t('apiKeyPlaceholder')}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  void save()
                }
              }}
            />
            <span className={styles.divider} />
            <button
              type="button"
              className={styles.confirm}
              disabled={!value.trim() || saving}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void save()}
            >
              {saving ? t('apiKeyVerifying') : t('confirm')}
            </button>
          </div>
        ) : null}
        {error ? <div className={styles.error}>{error}</div> : null}
      </div>
    </div>
  )
}

/** 账户余额：同源代理查询，本地服务端注入 Key，前端不接触真实密钥 */
const BalanceSetting = () => {
  const t = useTranslate()
  const [state, setState] = useState<{ status: 'loading' | 'done' | 'error'; text?: string }>({
    status: 'loading',
  })
  const activeRef = useRef(true)

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const balance = await fetchBalance()
      const info =
        balance.balance_infos?.find((item) => item.currency === 'CNY') ?? balance.balance_infos?.[0]
      if (!info) {
        throw new Error('empty balance')
      }
      const symbol = currencySymbol(info.currency)
      if (activeRef.current) {
        setState({
          status: 'done',
          text: `${t('settingsBalanceTotal')} ${symbol}${info.total_balance} · ${t('settingsBalanceGranted')} ${symbol}${info.granted_balance} · ${t('settingsBalanceToppedUp')} ${symbol}${info.topped_up_balance}`,
        })
      }
    } catch {
      if (activeRef.current) {
        setState({ status: 'error', text: t('settingsBalanceUnavailable') })
      }
    }
  }, [t])

  useEffect(() => {
    activeRef.current = true
    void load()
    return () => {
      activeRef.current = false
    }
  }, [load])

  return (
    <SettingCell
      label={t('settingsBalance')}
      status={null}
      description={state.status === 'loading' ? t('settingsBalanceLoading') : state.text}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={state.status === 'loading'}
          onClick={() => void load()}
        >
          {t('settingsBalanceRefresh')}
        </Button>
      }
    />
  )
}

const LocaleSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  return (
    <SettingCell
      label={t('settingsLocalePreference')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsLocalePreference')}
          value={locale}
          options={[
            { value: 'zh-CN', label: t('settingsLocaleZhCN'), lang: 'zh-CN' },
            { value: 'en-US', label: t('settingsLocaleEnUS'), lang: 'en' },
          ]}
          onChange={setLocale}
        />
      }
    />
  )
}

/** 朗读音色：stella（海星，女声）/ tide（暗潮，男声） */const TtsVoiceSetting = () => {
  const t = useTranslate()
  const ttsVoice = useSettings((state) => state.ttsVoice)
  return (
    <SettingCell
      label={t('settingsTtsVoice')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsTtsVoice')}
          value={ttsVoice}
          options={[
            { value: 'stella', label: t('settingsTtsVoiceStella') },
            { value: 'tide', label: t('settingsTtsVoiceTide') },
          ]}
          onChange={setTtsVoice}
        />
      }
    />
  )
}

/** 实时语音：默认开启，用浏览器识别边说边出字，失败自动回退 DeepSeek 整段转写 */
const RealtimeVoiceSetting = () => {
  const t = useTranslate()
  const realtimeVoice = useSettings((state) => state.realtimeVoice)
  return (
    <SettingCell
      label={t('settingsRealtimeVoice')}
      description={t('settingsRealtimeVoiceDescription')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsRealtimeVoice')}
          value={realtimeVoice ? 'on' : 'off'}
          options={[
            { value: 'on', label: t('settingsRealtimeVoiceOn') },
            { value: 'off', label: t('settingsRealtimeVoiceOff') },
          ]}
          onChange={(value) => setRealtimeVoice(value === 'on')}
        />
      }
    />
  )
}

/** 覆盖导入的二次确认，叠在设置弹窗上 */
const ImportConfirm = ({
  historyImport,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('historyImportConfirmTitle')}
      className={styles.importConfirm}
      onClose={historyImport.cancel}
      footer={
        <>
          <Button variant="outlined" size="m" autoFocus onClick={historyImport.cancel}>
            {t('cancel')}
          </Button>
          <Button
            variant="dangerOutlined"
            size="m"
            onClick={() => void historyImport.confirm('overwrite')}
          >
            {t('historyImportOverwrite')}
          </Button>
          <Button size="m" onClick={() => void historyImport.confirm('merge')}>
            {t('historyImportMerge')}
          </Button>
        </>
      }
    >
      <div className={styles.importConfirmText}>{t('historyImportConfirmDescription')}</div>
      <div className={styles.importConfirmText}>{t('historyImportMergeHint')}</div>
      <div className={styles.importConfirmText}>{t('historyImportOverwriteHint')}</div>
    </Modal>
  )
}

const themeOptions: { value: ThemePreference; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'light',
    label: 'avatarMenuSettingsDialogThemeSelectLightOption',
    icon: <IconLightOutline16 />,
  },
  {
    value: 'dark',
    label: 'avatarMenuSettingsDialogThemeSelectDarkOption',
    icon: <IconDarkOutline16 />,
  },
  {
    value: 'system',
    label: 'avatarMenuSettingsDialogThemeSelectSystemOption',
    icon: <IconFollowsystemOutline16 />,
  },
]

/**
 * 主题项：标题下方浅色 / 深色 / 跟随系统三个选块。
 * 与下方语言选项连续排列。
 */
const ThemeSetting = () => {
  const t = useTranslate()
  const themePreference = useSettings((state) => state.themePreference)
  const label = t('avatarMenuSettingsDialogThemeItemLabel')
  return (
    <div className={styles.theme}>
      {label}
      <div role="radiogroup" aria-label={label} className={styles.themeOptions}>
        {themeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={themePreference === option.value}
            className={clsx(
              styles.themeOption,
              themePreference === option.value && styles.themeOptionSelected
            )}
            onClick={() => setThemePreference(option.value)}
          >
            {option.icon}
            {t(option.label)}
          </button>
        ))}
      </div>
    </div>
  )
}

/** `reason` 为失败原因的文案 key，展示时按当前语言翻译后填入 `message` 参数。 */
type Status = (TranslationMessage & { error?: boolean; reason?: TranslationKey }) | null

/** 导出失败附带原因：预期的错误用对应文案作原因，其他错误用错误信息。 */
const errorStatus = (key: TranslationKey, error: unknown): Status => ({
  key,
  ...(error instanceof BackupError
    ? { reason: error.key }
    : { params: { message: error instanceof Error ? error.message : String(error) } }),
  error: true,
})

const SettingCell = ({
  label,
  description,
  status,
  action,
  className,
}: {
  label: string
  description?: string
  status: Status
  action: ReactNode
  className?: string
}) => {
  const t = useTranslate()
  return (
    <div className={clsx(styles.cell, styles.row, className)}>
      <div className={styles.text}>
        <div className={styles.label}>{label}</div>
        {status || description ? (
          <div className={clsx(styles.description, status?.error && styles.error)}>
            {status
              ? t(status.key, status.reason ? { message: t(status.reason) } : status.params)
              : description}
          </div>
        ) : null}
      </div>
      {action}
    </div>
  )
}

/** 导入选择：合并会保留本机记录，覆盖会先清空；两种方式都在确认后执行。 */
const useHistoryImport = () => {
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState<{ processed: number; total?: number } | null>(null)
  const [status, setStatus] = useState<Status>(null)
  const importing = useRef(false)

  const confirm = async (mode: 'merge' | 'overwrite') => {
    if (!file || importing.current) {
      return
    }
    importing.current = true
    setFile(null)
    setProgress({ processed: 0 })
    setStatus(null)
    const onProgress = (processed: number, total: number) => setProgress({ processed, total })
    try {
      if (mode === 'merge') {
        const result = await mergeImportHistory(file, onProgress)
        setStatus({
          key: 'historyImportMergeResult',
          params: { added: result.added, skipped: result.skipped },
        })
      } else {
        const count = await importHistory(file, onProgress)
        setStatus({ key: count === 1 ? 'historyImportedOne' : 'historyImported', params: { count } })
      }
    } catch {
      setStatus({ key: 'historyImportFailed', error: true })
    } finally {
      importing.current = false
      setProgress(null)
    }
  }

  return {
    file,
    busy: progress !== null,
    progress,
    status,
    select: setFile,
    cancel: () => setFile(null),
    dismiss: () => {
      setFile(null)
      setStatus(null)
    },
    confirm,
  }
}

/** 导入 = 合并或覆盖：合并保留本机记录，覆盖用备份替换本地全部会话与附件。 */
const ImportHistory = ({
  historyImport,
  disabled,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
  disabled: boolean
}) => {
  const t = useTranslate()
  const inputRef = useRef<HTMLInputElement>(null)
  const { progress } = historyImport

  return (
    <SettingCell
      className={progress ? styles.importing : undefined}
      label={t('historyImport')}
      description={t('historyImportDescription')}
      status={historyImport.status}
      action={
        <>
          <Button
            variant="outlined"
            size="m"
            className={clsx(styles.cellButton, styles.uploadButton)}
            aria-busy={historyImport.busy}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            {progress ? (
              <IconLoadingOutline16 />
            ) : (
              <>
                <IconUploadOutline14 />
                {t('upload')}
              </>
            )}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) {
                historyImport.select(file)
              }
            }}
          />
          {progress?.total !== undefined ? (
            <div className={styles.importProgress}>
              <div
                className={styles.importTrack}
                role="progressbar"
                aria-label={t('historyImport')}
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-valuenow={progress.processed}
              >
                <span
                  style={{
                    width: `${progress.total ? (progress.processed / progress.total) * 100 : 0}%`,
                  }}
                />
              </div>
              <span>
                {progress.processed} / {progress.total}
              </span>
            </div>
          ) : null}
        </>
      }
    />
  )
}

/** 将全部会话及图片导出为 ZIP 文件并下载 */
const ExportHistory = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const empty = useChatStore((state) => state.sessions.length === 0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  const onExport = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const { name, blob } = await exportHistory()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (error) {
      setStatus(errorStatus('historyExportFailed', error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingCell
      label={t('exportAllLabel')}
      description={t('historyExportDescription')}
      status={status}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={disabled || busy || empty}
          onClick={() => void onExport()}
        >
          <IconDownloadOutline16 />
          {t('exportAllDownload')}
        </Button>
      }
    />
  )
}
