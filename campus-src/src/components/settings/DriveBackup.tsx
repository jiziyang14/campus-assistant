import clsx from 'clsx'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { formatSize } from '../../services/attachments.js'
import {
  listBackups,
  listDrives,
  readBackupFromDrive,
  saveBackupToDrive,
  type DriveBackupFile,
  type DriveInfo,
} from '../../services/campus/driveBackup.js'
import { exportHistory } from '../../services/chat/backup.js'
import { useSettings } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { IconDownloadOutline16, IconLoadingOutline16, IconUploadOutline14 } from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import styles from './Settings.module.css'

type Status = { text: string; error?: boolean } | null
type Mode = 'save' | 'import' | null

/**
 * U 盘直连备份：设置页里的「保存到 U 盘」「从 U 盘导入」。
 * 依赖打包后本地服务的 /campus/api 接口；开发服务器下没有该接口时整块隐藏，
 * 仍可使用上面的下载 / 上传入口。
 */
export const DriveBackup = ({
  disabled,
  onPickImport,
}: {
  disabled: boolean
  /** 从 U 盘读到备份后交给现有合并 / 覆盖确认流程 */
  onPickImport: (file: File) => void
}) => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [drives, setDrives] = useState<DriveInfo[]>([])
  const [drivesLoading, setDrivesLoading] = useState(false)
  const [mode, setMode] = useState<Mode>(null)
  const [drive, setDrive] = useState('')
  const [files, setFiles] = useState<DriveBackupFile[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [saveStatus, setSaveStatus] = useState<Status>(null)
  const [importStatus, setImportStatus] = useState<Status>(null)

  const refreshDrives = useCallback(async () => {
    setDrivesLoading(true)
    try {
      const result = await listDrives()
      setDrives(result)
      setAvailable(true)
      setDrive((current) =>
        current && result.some((item) => item.drive === current)
          ? current
          : (result[0]?.drive ?? '')
      )
      return result
    } catch {
      setAvailable(false)
      return []
    } finally {
      setDrivesLoading(false)
    }
  }, [])

  // 首次挂载时探测本地接口是否存在
  useEffect(() => {
    void refreshDrives()
  }, [refreshDrives])

  // 选中盘后读取备份列表
  useEffect(() => {
    if (mode !== 'import' || !drive) {
      return
    }
    let active = true
    setFiles(null)
    setFileName('')
    listBackups(drive)
      .then((result) => {
        if (active) {
          setFiles(result)
          setFileName(result[0]?.name ?? '')
        }
      })
      .catch(() => {
        if (active) {
          setFiles([])
          setImportStatus({ text: t('driveBackupReadFailed'), error: true })
        }
      })
    return () => {
      active = false
    }
  }, [mode, drive, t])

  if (!available) {
    return null
  }

  const openMode = (next: Mode) => {
    setMode(next)
    setFiles(null)
    setFileName('')
    setProgress(null)
    setBusy(false)
    void refreshDrives()
  }

  const closeModal = () => {
    if (!busy) {
      setMode(null)
      setProgress(null)
    }
  }

  const save = async () => {
    if (!drive || busy) {
      return
    }
    setBusy(true)
    setProgress(0)
    setSaveStatus(null)
    try {
      const { name, blob } = await exportHistory()
      const result = await saveBackupToDrive(drive, name, blob, (loaded, total) => {
        setProgress(total ? loaded / total : 0)
      })
      setSaveStatus({ text: t('driveBackupSaved', { drive, name: result.name }) })
      setMode(null)
    } catch (error) {
      setSaveStatus({
        text: t('driveBackupFailed', {
          message: error instanceof Error ? error.message : String(error),
        }),
        error: true,
      })
      setMode(null)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const importFile = async () => {
    if (!drive || !fileName || busy) {
      return
    }
    setBusy(true)
    setProgress(null)
    setImportStatus(null)
    try {
      const file = await readBackupFromDrive(drive, fileName)
      setImportStatus({ text: t('driveBackupImported', { name: fileName }) })
      setMode(null)
      onPickImport(file)
    } catch (error) {
      setImportStatus({
        text: t('driveBackupFailed', {
          message: error instanceof Error ? error.message : String(error),
        }),
        error: true,
      })
      setMode(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SettingRow
        label={t('driveBackupSaveLabel')}
        description={t('driveBackupSaveDescription')}
        status={saveStatus}
        action={
          <Button
            variant="outlined"
            size="m"
            className={styles.cellButton}
            disabled={disabled}
            onClick={() => openMode('save')}
          >
            <IconDownloadOutline16 />
            {t('driveBackupSaveAction')}
          </Button>
        }
      />
      <SettingRow
        label={t('driveBackupImportLabel')}
        description={t('driveBackupImportDescription')}
        status={importStatus}
        action={
          <Button
            variant="outlined"
            size="m"
            className={styles.cellButton}
            disabled={disabled}
            onClick={() => openMode('import')}
          >
            <IconUploadOutline14 />
            {t('driveBackupImportAction')}
          </Button>
        }
      />

      {mode ? (
        <Modal
          title={t(mode === 'save' ? 'driveBackupDialogSaveTitle' : 'driveBackupDialogImportTitle')}
          className={styles.driveDialog}
          onClose={closeModal}
          footer={
            <div className={styles.driveActions}>
              <Button variant="outlined" disabled={busy} onClick={closeModal}>
                {t('cancel')}
              </Button>
              <Button
                disabled={
                  busy ||
                  !drive ||
                  (mode === 'save'
                    ? drives.length === 0
                    : !fileName || files === null || files.length === 0)
                }
                onClick={() => void (mode === 'save' ? save() : importFile())}
              >
                {t(mode === 'save' ? 'driveBackupSaveAction' : 'driveBackupImportAction')}
              </Button>
            </div>
          }
        >
          <div className={styles.driveSectionTitle}>{t('driveBackupSelectDrive')}</div>
          {drivesLoading && drives.length === 0 ? (
            <div className={styles.driveEmpty}>{t('driveBackupChecking')}</div>
          ) : drives.length === 0 ? (
            <div className={styles.driveEmpty}>{t('driveBackupNoDrive')}</div>
          ) : (
            <div className={styles.driveList}>
              {drives.map((item) => (
                <button
                  key={item.drive}
                  type="button"
                  className={clsx(
                    styles.driveOption,
                    item.drive === drive && styles.driveOptionActive
                  )}
                  disabled={busy}
                  onClick={() => setDrive(item.drive)}
                >
                  <span className={styles.driveName}>
                    {item.drive}
                    {item.label ? ` ${item.label}` : ''}
                  </span>
                  <span className={styles.driveMeta}>
                    {t('driveBackupFreeSpace', { space: formatSize(item.freeSpace) })}
                  </span>
                </button>
              ))}
            </div>
          )}

          {mode === 'import' ? (
            <>
              <div className={styles.driveSectionTitle}>{t('driveBackupSelectFile')}</div>
              {files === null ? (
                <div className={styles.driveEmpty}>{t('driveBackupLoading')}</div>
              ) : files.length === 0 ? (
                <div className={styles.driveEmpty}>{t('driveBackupNoBackup')}</div>
              ) : (
                <div className={styles.driveList}>
                  {files.map((item) => (
                    <button
                      key={item.name}
                      type="button"
                      className={clsx(
                        styles.driveOption,
                        item.name === fileName && styles.driveOptionActive
                      )}
                      disabled={busy}
                      onClick={() => setFileName(item.name)}
                    >
                      <span className={styles.driveName}>{item.name}</span>
                      <span className={styles.driveMeta}>
                        {t('driveBackupFileMeta', {
                          size: formatSize(item.size),
                          time: new Date(item.mtime).toLocaleString(locale),
                        })}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : null}

          {busy || progress !== null ? (
            <div className={styles.driveProgress}>
              {progress !== null ? (
                <div
                  className={styles.importTrack}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progress * 100)}
                >
                  <span style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
              ) : (
                <IconLoadingOutline16 />
              )}
              <span>{t(mode === 'save' ? 'driveBackupSaving' : 'driveBackupLoading')}</span>
            </div>
          ) : null}
        </Modal>
      ) : null}
    </>
  )
}

/** 没有现成 SettingCell 可复用时保持相同行样式 */
const SettingRow = ({
  label,
  description,
  status,
  action,
}: {
  label: string
  description: string
  status: Status
  action: ReactNode
}) => (
  <div className={clsx(styles.cell, styles.row)}>
    <div className={styles.text}>
      <div className={styles.label}>{label}</div>
      <div className={clsx(styles.description, status?.error && styles.error)}>
        {status ? status.text : description}
      </div>
    </div>
    {action}
  </div>
)
