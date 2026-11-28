import { useCallback, useEffect, useRef, useState } from 'react'
import type { TranslationMessage } from '../../i18n/index.js'
import { transcribe } from '../../services/api/speech.js'
import {
  browserRecognitionSupported,
  startBrowserRecognition,
} from '../../services/speech/browserRecognition.js'
import { startRecording, type Recording } from '../../services/speech/recorder.js'
import { useSettings } from '../../services/settings.js'
import { showToast } from '../base/toastState.js'

export type VoiceInputStatus = 'idle' | 'recording' | 'transcribing'

/**
 * 录音依赖 getUserMedia，只在安全上下文可用（HTTPS、localhost、file://）。
 * 普通 HTTP 页面上直接禁用入口，避免点击后必然失败。
 */
const AVAILABLE = typeof window === 'undefined' || window.isSecureContext

const delay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

const describeRecordingError = (error: unknown): TranslationMessage => {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return { key: 'voiceInputPermissionDenied' }
    }
    if (error.name === 'NotFoundError') {
      return { key: 'voiceInputNoDevice' }
    }
  }
  return { key: 'voiceInputFailed' }
}

/**
 * 语音输入：
 * - 默认开启「实时语音」：用浏览器识别边说边出字（Edge 走 Azure），同时后台录音；
 *   浏览器识别不可用或网络失败时，自动改用 DeepSeek 整段转写，文字不丢。
 * - 关闭实时语音时，保持原来的「录完整段再上传」。
 */
export const useVoiceInput = (onText: (text: string) => void) => {
  const [status, setStatus] = useState<VoiceInputStatus>('idle')
  /** 本次录音已录秒数，只在录音中递增 */
  const [seconds, setSeconds] = useState(0)
  /** 浏览器识别出来的临时文字，用于实时预览 */
  const [interim, setInterim] = useState('')
  const recordingRef = useRef<Recording | null>(null)
  const browserRef = useRef<{ stop: () => void } | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const operationRef = useRef(0)
  const committedRef = useRef('')
  const onTextRef = useRef(onText)
  onTextRef.current = onText

  const cancelOperation = useCallback(() => {
    operationRef.current++
    browserRef.current?.stop()
    browserRef.current = null
    recordingRef.current?.cancel()
    recordingRef.current = null
    controllerRef.current?.abort()
    controllerRef.current = null
    committedRef.current = ''
    setInterim('')
  }, [])

  const cancel = useCallback(() => {
    cancelOperation()
    setStatus('idle')
  }, [cancelOperation])

  const finish = useCallback(async () => {
    const recording = recordingRef.current
    if (!recording) {
      // 仍在等待麦克风授权时也允许取消；迟到的录音对象会立即释放。
      cancel()
      return
    }
    const operation = operationRef.current
    recordingRef.current = null
    const browser = browserRef.current
    browserRef.current = null
    let controller: AbortController | null = null
    setInterim('')
    setStatus('transcribing')
    try {
      browser?.stop()
      // 给浏览器一点时间把最后一句定稿，避免末尾几个字丢失
      if (browser) {
        await delay(300)
      }
      if (operationRef.current !== operation) {
        return
      }
      const { stop } = recording
      const audio = await stop()
      const hasText = committedRef.current.trim().length > 0
      // 实时识别已经出字，就不再重复整段转写
      if (hasText) {
        return
      }
      if (operationRef.current !== operation) {
        return
      }
      if (!audio) {
        showToast({ key: 'voiceInputEmpty' })
        return
      }
      controller = new AbortController()
      controllerRef.current = controller
      const text = await transcribe(useSettings.getState().apiKey ?? '', audio, controller.signal)
      if (controller.signal.aborted || operationRef.current !== operation) {
        return
      }
      if (text.trim()) {
        onTextRef.current(text.trim())
      } else {
        showToast({ key: 'voiceInputEmpty' })
      }
    } catch {
      if (operationRef.current === operation && !controller?.signal.aborted) {
        showToast({ key: 'voiceInputFailed' })
      }
    } finally {
      if (operationRef.current === operation) {
        controllerRef.current = null
        setStatus('idle')
      }
    }
  }, [cancel])

  const toggle = useCallback(async () => {
    if (!AVAILABLE) {
      return
    }
    if (status === 'recording') {
      await finish()
      return
    }
    if (status === 'transcribing') {
      cancel()
      return
    }
    const operation = ++operationRef.current
    committedRef.current = ''
    setInterim('')
    setStatus('recording')
    try {
      const recording = await startRecording(() => {
        if (operationRef.current === operation) {
          showToast({ key: 'voiceInputLimitReached' })
          void finish()
        }
      })
      if (operationRef.current !== operation) {
        recording.cancel()
        return
      }
      recordingRef.current = recording

      // 实时语音：浏览器识别只负责出字，录音同时保留用于失败回退
      if (useSettings.getState().realtimeVoice && browserRecognitionSupported()) {
        const browser = startBrowserRecognition(useSettings.getState().locale, {
          onFinal: (text) => {
            if (operationRef.current !== operation) {
              return
            }
            committedRef.current = `${committedRef.current}${text}`
            onTextRef.current(text)
            setInterim('')
          },
          onInterim: setInterim,
          onError: () => {
            if (operationRef.current !== operation) {
              return
            }
            // 浏览器服务不可用：停掉识别，改用 DeepSeek 整段转写
            browserRef.current = null
            showToast({ key: 'voiceRealtimeFallback' })
            void finish()
          },
        })
        if (browser) {
          browserRef.current = browser
        }
      }
    } catch (error) {
      if (operationRef.current === operation) {
        setStatus('idle')
        showToast(describeRecordingError(error))
      }
    }
  }, [status, finish, cancel])

  useEffect(() => {
    if (status !== 'recording') {
      return
    }
    const startedAt = Date.now()
    setSeconds(0)
    // 半秒刷新一次，让显示的秒数与实际录音时长保持一致
    const timer = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000))
    }, 500)
    return () => clearInterval(timer)
  }, [status])

  useEffect(() => cancelOperation, [cancelOperation])

  /** 当前录音的频谱分析节点，未录音时为 null */
  const getAnalyser = useCallback(() => recordingRef.current?.analyser ?? null, [])

  return { status, seconds, interim, getAnalyser, toggle, cancel, available: AVAILABLE }
}
