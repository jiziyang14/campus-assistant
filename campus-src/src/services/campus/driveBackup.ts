/**
 * U 盘直连备份：由本地服务端读写可移动磁盘根目录的「校园助手备份」文件夹，
 * 跨设备换机时不必先下载再拷贝，也不依赖浏览器下载目录。
 */
export type DriveInfo = {
  drive: string
  label: string
  size: number
  freeSpace: number
}

export type DriveBackupFile = {
  name: string
  size: number
  mtime: number
}

export class DriveBackupError extends Error {}

const BASE = '/campus/api'

const readError = async (response: Response): Promise<string> => {
  try {
    const data = (await response.json()) as { error?: { message?: string } }
    return data?.error?.message || `本地服务返回 ${response.status}`
  } catch {
    return `本地服务返回 ${response.status}`
  }
}

/** 服务端接口只在打包后的 exe 里存在，开发服务器下会失败，调用方据此隐藏入口 */
export const listDrives = async (): Promise<DriveInfo[]> => {
  const response = await fetch(`${BASE}/drives`, { cache: 'no-store' })
  if (!response.ok) {
    throw new DriveBackupError(await readError(response))
  }
  const data = (await response.json()) as { drives?: DriveInfo[] }
  return Array.isArray(data.drives) ? data.drives : []
}

export const listBackups = async (drive: string): Promise<DriveBackupFile[]> => {
  const response = await fetch(`${BASE}/backups?drive=${encodeURIComponent(drive)}`, {
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new DriveBackupError(await readError(response))
  }
  const data = (await response.json()) as { backups?: DriveBackupFile[] }
  return Array.isArray(data.backups) ? data.backups : []
}

/** 用 XHR 上传以拿到写入进度，ZIP 作为原始字节直接写盘 */
export const saveBackupToDrive = (
  drive: string,
  name: string,
  blob: Blob,
  onProgress?: (loaded: number, total: number) => void
): Promise<{ name: string; size: number; path: string }> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(
      'POST',
      `${BASE}/backup?drive=${encodeURIComponent(drive)}&name=${encodeURIComponent(name)}`
    )
    xhr.setRequestHeader('Content-Type', 'application/zip')
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(event.loaded, event.total)
      }
    }
    xhr.onload = () => {
      let payload: { saved?: boolean; name?: string; size?: number; path?: string; error?: { message?: string } } | null =
        null
      try {
        payload = JSON.parse(xhr.responseText)
      } catch {
        payload = null
      }
      if (xhr.status >= 200 && xhr.status < 300 && payload?.saved) {
        resolve({
          name: payload.name || name,
          size: payload.size ?? blob.size,
          path: payload.path || '',
        })
      } else {
        reject(new DriveBackupError(payload?.error?.message || `保存失败（${xhr.status}）`))
      }
    }
    xhr.onerror = () => reject(new DriveBackupError('无法连接到本地服务，请重启程序后再试。'))
    xhr.send(blob)
  })

/** 读取 U 盘备份并还原成 File，直接交给现有的合并 / 覆盖导入流程 */
export const readBackupFromDrive = async (drive: string, name: string): Promise<File> => {
  const response = await fetch(
    `${BASE}/backup?drive=${encodeURIComponent(drive)}&name=${encodeURIComponent(name)}`,
    { cache: 'no-store' }
  )
  if (!response.ok) {
    throw new DriveBackupError(await readError(response))
  }
  const blob = await response.blob()
  return new File([blob], name, { type: 'application/zip' })
}
