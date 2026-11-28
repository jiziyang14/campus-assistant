/**
 * 浏览器自带语音识别（Edge 走 Azure 在线服务）。
 * 只用来做「边说边出字」的体验；失败时由调用方回退到 DeepSeek 整段转写。
 */
type RecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

type SpeechRecognitionEventLike = {
  resultIndex: number
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
}

type SpeechRecognitionCtor = new () => RecognitionLike

export type BrowserRecognitionError = 'network' | 'denied' | 'unavailable' | 'other'

export type BrowserRecognitionHandlers = {
  /** 每句定稿时回调，只会回调一次 */
  onFinal: (text: string) => void
  /** 当前未定稿的临时文字，停顿后会变成 final */
  onInterim: (text: string) => void
  /** 不可恢复的错误，调用方应回退到整段识别 */
  onError: (error: BrowserRecognitionError) => void
}

export const browserRecognitionSupported = (): boolean => {
  if (typeof window === 'undefined') {
    return false
  }
  const ctor =
    (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor })
      .webkitSpeechRecognition
  return typeof ctor === 'function'
}

const mapError = (code: string): BrowserRecognitionError => {
  if (code === 'network') {
    return 'network'
  }
  if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture') {
    return 'denied'
  }
  if (code === 'language-not-supported') {
    return 'unavailable'
  }
  return 'other'
}

/**
 * 开始浏览器语音识别。返回 null 表示浏览器不支持。
 * 静音后浏览器会自动结束，这里在未主动停止时自动续听。
 */
export const startBrowserRecognition = (
  locale: string,
  handlers: BrowserRecognitionHandlers
): { stop: () => void } | null => {
  const ctor =
    (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor })
      .webkitSpeechRecognition
  if (typeof ctor !== 'function') {
    return null
  }
  const recognition = new ctor()
  recognition.lang = locale === 'en-US' ? 'en-US' : 'zh-CN'
  recognition.continuous = true
  recognition.interimResults = true
  recognition.maxAlternatives = 1

  const finalized = new Set<number>()
  let stopped = false
  let failed = false
  let restartTimer: number | undefined

  recognition.onresult = (event) => {
    let interim = ''
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index]
      const text = result[0]?.transcript ?? ''
      if (result.isFinal) {
        if (!finalized.has(index) && text.trim()) {
          finalized.add(index)
          handlers.onFinal(text.trim())
        }
      } else {
        interim += text
      }
    }
    handlers.onInterim(interim.trim())
  }

  recognition.onerror = (event) => {
    // no-speech / aborted 属于正常结束，交给 onend 续听
    if (event.error === 'no-speech' || event.error === 'aborted') {
      return
    }
    failed = true
    stopped = true
    handlers.onError(mapError(event.error))
  }

  recognition.onend = () => {
    if (stopped || failed) {
      return
    }
    // 连续模式下浏览器仍会因静音结束，稍后续听
    window.clearTimeout(restartTimer)
    restartTimer = window.setTimeout(() => {
      if (stopped) {
        return
      }
      try {
        recognition.start()
      } catch {
        // 重启失败时按不可用处理，由调用方回退
        failed = true
        stopped = true
        handlers.onError('other')
      }
    }, 200)
  }

  try {
    recognition.start()
  } catch {
    return null
  }

  return {
    stop: () => {
      stopped = true
      window.clearTimeout(restartTimer)
      try {
        recognition.stop()
      } catch {
        // 已经结束时忽略
      }
    },
  }
}
