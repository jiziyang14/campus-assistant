import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { ACCEPT } from '../../services/attachments.js'
import {
  collectCameras,
  findDocumentCamera,
  nextCamera,
  type CameraOption,
} from './cameraDevices.js'
import styles from './CameraDialog.module.css'

type CameraErrorKey = 'cameraDenied' | 'cameraUnavailable' | 'cameraBusy' | 'cameraFailed'
type CameraStatus = 'starting' | 'ready' | 'error' | 'preview'
type Facing = 'user' | 'environment'

type CameraRequest = {
  /** 每次需要重新取流时递增，effect 依赖它 */
  revision: number
  /** 非空时按 deviceId 精确选择；为空时交给 facingMode 选默认摄像头 */
  deviceId: string | null
  facing: Facing
}

type Shot = { file: File; url: string }

// 首次使用时浏览器会弹出权限询问，超时留足用户确认时间
const START_TIMEOUT = 20_000
const INITIAL_REQUEST: CameraRequest = { revision: 0, deviceId: null, facing: 'user' }

const listCameras = async (): Promise<CameraOption[]> => {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return []
    }
    return collectCameras(await navigator.mediaDevices.enumerateDevices())
  } catch {
    return []
  }
}

const describeError = (error: unknown): CameraErrorKey => {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'cameraDenied'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'cameraUnavailable'
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return 'cameraBusy'
  }
  return 'cameraFailed'
}

/**
 * 相机拍照：预览、连拍多张、单张删除、切换前后摄像头。
 * preferred 为 selfie 时不自动选展台摄像头，用于颜值争霸赛这类自拍场景。
 */
export const CameraDialog = ({
  open,
  preferred = 'document',
  allowUpload = false,
  title,
  onClose,
  onDone,
}: {
  open: boolean
  preferred?: 'document' | 'selfie'
  allowUpload?: boolean
  title?: string
  onClose: () => void
  onDone: (files: File[]) => void
}) => {
  const t = useTranslate()
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const shotsRef = useRef<Shot[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [request, setRequest] = useState<CameraRequest>(INITIAL_REQUEST)
  const [facing, setFacing] = useState<Facing>('user')
  const [cameras, setCameras] = useState<CameraOption[]>([])
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null)
  const [status, setStatus] = useState<CameraStatus>('starting')
  const [errorKey, setErrorKey] = useState<CameraErrorKey>('cameraFailed')
  const [shots, setShots] = useState<Shot[]>([])
  /** 当前预览第几张；null 表示回到实时取景 */
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const preferSelfie = preferred === 'selfie'

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const revokeShots = useCallback((list: Shot[]) => {
    list.forEach((shot) => URL.revokeObjectURL(shot.url))
  }, [])

  const close = useCallback(() => {
    stopStream()
    revokeShots(shotsRef.current)
    shotsRef.current = []
    setShots([])
    setPreviewIndex(null)
    setStatus('starting')
    // 每次打开都回到默认摄像头，手动切换只对本次拍摄有效
    setRequest(INITIAL_REQUEST)
    setFacing('user')
    skipPreferredRef.current = false
    onClose()
  }, [onClose, revokeShots, stopStream])
  const closeRef = useRef(close)
  closeRef.current = close
  const openRef = useRef(open)
  openRef.current = open
  // 展台摄像头本次不可用（被占用/被拔出）时，不要再反复自动选它
  const skipPreferredRef = useRef(false)

  useEffect(() => {
    if (!open) {
      return
    }
    let active = true
    let timedOut = false
    const timer = window.setTimeout(() => {
      if (!active) {
        return
      }
      timedOut = true
      setErrorKey('cameraFailed')
      setStatus('error')
    }, START_TIMEOUT)
    setStatus('starting')
    setPreviewIndex(null)
    // 本次取流是否自动用上了展台摄像头
    let usingPreferred = false
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        window.clearTimeout(timer)
        setErrorKey('cameraUnavailable')
        setStatus('error')
        return
      }
      try {
        // 自拍模式不自动切展台；普通模式优先展台摄像头
        let targetDeviceId = request.deviceId
        if (!targetDeviceId && !skipPreferredRef.current && !preferSelfie) {
          const preferredCamera = findDocumentCamera(await listCameras())
          if (preferredCamera) {
            targetDeviceId = preferredCamera.deviceId
            usingPreferred = true
          }
        }
        const video: MediaTrackConstraints = { width: { ideal: 3840 }, height: { ideal: 2160 } }
        if (targetDeviceId) {
          // 按设备精确取流，桌面浏览器的 facingMode 不会真正切换摄像头
          video.deviceId = { exact: targetDeviceId }
        } else {
          video.facingMode = { ideal: request.facing }
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video })
        if (!active || timedOut) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        window.clearTimeout(timer)
        streamRef.current = stream
        const track = stream.getVideoTracks()[0]
        const settings = track?.getSettings()
        const deviceId = settings?.deviceId || targetDeviceId
        if (deviceId) {
          setActiveDeviceId(deviceId)
        }
        if (usingPreferred) {
          // 展台对着桌面和纸张，预览不做镜像，方便核对文字
          setFacing('environment')
        }
        // 只有摄像头自己报告了朝向时才据此决定预览镜像，桌面 USB 摄像头不会报告
        if (settings?.facingMode === 'user' || settings?.facingMode === 'environment') {
          setFacing(settings.facingMode)
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
        if (!active) {
          return
        }
        setStatus('ready')
        const list = await listCameras()
        if (!active) {
          return
        }
        setCameras(list)
        if (!request.deviceId && !usingPreferred && !skipPreferredRef.current && !preferSelfie) {
          // 默认摄像头不是展台（首次授权读不到设备名）：自动切到展台
          const preferredCamera = findDocumentCamera(list)
          if (preferredCamera && preferredCamera.deviceId !== deviceId) {
            setFacing('environment')
            setRequest({
              revision: request.revision + 1,
              deviceId: preferredCamera.deviceId,
              facing: 'environment',
            })
          }
        }
      } catch (error) {
        window.clearTimeout(timer)
        if (!active) {
          return
        }
        const name = error instanceof DOMException ? error.name : ''
        if (
          usingPreferred &&
          (name === 'NotFoundError' ||
            name === 'OverconstrainedError' ||
            name === 'NotReadableError')
        ) {
          // 展台摄像头本次不可用：退回系统默认摄像头，别卡在报错上
          skipPreferredRef.current = true
          setRequest({ revision: request.revision + 1, deviceId: null, facing: request.facing })
          return
        }
        if (request.deviceId && (name === 'NotFoundError' || name === 'OverconstrainedError')) {
          // 选中的摄像头被拔出或已失效：退回默认摄像头，避免一直报错
          setRequest({ revision: request.revision + 1, deviceId: null, facing: request.facing })
          return
        }
        // 取流失败也刷新设备列表：默认摄像头被占用时，用户还能切换到其他摄像头
        void listCameras().then((list) => {
          if (active && list.length > 0) {
            setCameras(list)
          }
        })
        setErrorKey(describeError(error))
        setStatus('error')
      }
    }
    void start()
    return () => {
      active = false
      window.clearTimeout(timer)
      stopStream()
    }
  }, [open, preferSelfie, request, stopStream])

  // 从预览回到取景时视频元素会重新挂载，把还活着的流接回去，避免重新启动相机
  useEffect(() => {
    const stream = streamRef.current
    const video = videoRef.current
    if (status !== 'ready' || previewIndex !== null || !stream || !video) {
      return
    }
    if (video.srcObject !== stream) {
      video.srcObject = stream
      void video.play().catch(() => {})
    }
  }, [status, previewIndex])

  useEffect(() => {
    if (!open) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeRef.current()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  if (!open) {
    return null
  }

  const retry = () => {
    setRequest((previous) => ({ ...previous, revision: previous.revision + 1 }))
  }

  const switchCamera = () => {
    const nextFacing: Facing = facing === 'user' ? 'environment' : 'user'
    // 上一次切换失败时 request.deviceId 才是用户想用的设备，按它继续轮转，
    // 否则连点切换会一直落在同一台取流失败的摄像头上
    const target = cameras.length > 1 ? nextCamera(cameras, request.deviceId ?? activeDeviceId) : null
    setFacing(nextFacing)
    setRequest((previous) => ({
      revision: previous.revision + 1,
      deviceId: target?.deviceId ?? null,
      facing: nextFacing,
    }))
  }

  const capture = () => {
    const video = videoRef.current
    if (!video || status !== 'ready' || !video.videoWidth) {
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) {
      return
    }
    // 预览可以镜像，照片必须保持真实方向，否则拍到的文档文字会左右翻转
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(
      (blob) => {
        if (!blob || !openRef.current) {
          return
        }
        const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' })
        const shot: Shot = { file, url: URL.createObjectURL(blob) }
        shotsRef.current = [...shotsRef.current, shot]
        setShots(shotsRef.current)
        setPreviewIndex(shotsRef.current.length - 1)
        setStatus('preview')
        // 不关闭视频流：继续拍时直接回到实时取景，不用重新启动相机
      },
      'image/jpeg',
      0.92
    )
  }

  const resume = () => {
    // 流还在就直接恢复取景；设备被拔出或流已停止时才重新启动
    const live = Boolean(streamRef.current?.getVideoTracks().some((track) => track.readyState === 'live'))
    setPreviewIndex(null)
    if (live) {
      setStatus('ready')
      return
    }
    retry()
  }

  const removeShot = (index: number) => {
    const target = shotsRef.current[index]
    if (!target) {
      return
    }
    URL.revokeObjectURL(target.url)
    shotsRef.current = shotsRef.current.filter((_, itemIndex) => itemIndex !== index)
    const nextPreview =
      shotsRef.current.length === 0
        ? null
        : Math.min(previewIndex === null ? shotsRef.current.length : previewIndex, shotsRef.current.length - 1)
    setShots(shotsRef.current)
    setPreviewIndex(nextPreview)
    if (shotsRef.current.length === 0) {
      resume()
    }
  }

  const finish = () => {
    const files = shotsRef.current.map((shot) => shot.file)
    if (files.length === 0) {
      return
    }
    onDone(files)
    close()
  }

  /** 上传文件与拍照走同一出口：选完直接把已拍的照片一起交出去 */
  const pickFiles = (picked: File[]) => {
    if (picked.length === 0) {
      return
    }
    onDone([...shotsRef.current.map((shot) => shot.file), ...picked])
    close()
  }

  const activeCameraIndex = cameras.findIndex((camera) => camera.deviceId === activeDeviceId)
  const activeCamera = activeCameraIndex >= 0 ? cameras[activeCameraIndex] : undefined
  const switchable = cameras.length !== 1
  const previewShot = previewIndex === null ? null : shots[previewIndex]

  return (
    <div className={styles.mask} onClick={close}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? t('cameraTitle')}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.head}>
          <div className={styles.titleBlock}>
            <div className={styles.title}>{title ?? t('cameraTitle')}</div>
            {cameras.length > 0 ? (
              <div className={styles.cameraInfo}>
                {t('cameraPosition', {
                  index: (activeCameraIndex < 0 ? 0 : activeCameraIndex) + 1,
                  total: cameras.length,
                })}
                {activeCamera?.label ? ` · ${activeCamera.label}` : ''}
              </div>
            ) : null}
          </div>
          <button type="button" className={styles.close} onClick={close} aria-label={t('cameraClose')}>
            ×
          </button>
        </div>

        <div className={styles.stage}>
          {previewShot ? (
            <img src={previewShot.url} alt={t('cameraTitle')} />
          ) : (
            <video
              ref={videoRef}
              className={facing === 'user' ? styles.mirror : undefined}
              autoPlay
              muted
              playsInline
            />
          )}
          {status === 'starting' ? (
            <div className={styles.overlay}>{t('cameraStarting')}</div>
          ) : null}
          {status === 'error' ? (
            <div className={styles.overlay}>
              <span>{t(errorKey)}</span>
              <button type="button" className={styles.retry} onClick={retry}>
                {t('cameraRetry')}
              </button>
            </div>
          ) : null}
        </div>

        {shots.length > 0 ? (
          <div className={styles.shots} aria-label={t('cameraShots')}>
            {shots.map((shot, index) => (
              <div
                key={shot.url}
                className={index === previewIndex ? styles.shotActive : styles.shot}
              >
                <button
                  type="button"
                  className={styles.shotPreview}
                  onClick={() => setPreviewIndex(index)}
                  aria-label={t('cameraViewShot', { index: index + 1 })}
                >
                  <img src={shot.url} alt="" />
                </button>
                <button
                  type="button"
                  className={styles.shotRemove}
                  onClick={() => removeShot(index)}
                  aria-label={t('cameraRemoveShot')}
                  title={t('cameraRemoveShot')}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className={styles.foot}>
          {previewShot ? (
            <>
              <button type="button" className={styles.secondary} onClick={resume}>
                {t('cameraAddMore')}
              </button>
              <button type="button" className={styles.primary} onClick={finish}>
                {t('cameraDone', { count: shots.length })}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={styles.secondary}
                disabled={!switchable}
                title={switchable ? undefined : t('cameraSwitchDisabled')}
                onClick={switchCamera}
              >
                {t('cameraSwitch')}
              </button>
              {allowUpload ? (
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {t('uploadFile')}
                </button>
              ) : null}
              <button
                type="button"
                className={styles.primary}
                onClick={capture}
                disabled={status !== 'ready'}
              >
                {t('cameraCapture')}
              </button>
            </>
          )}
        </div>
        {allowUpload ? (
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            accept={ACCEPT}
            onChange={(event) => {
              pickFiles(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />
        ) : null}
      </div>
    </div>
  )
}
