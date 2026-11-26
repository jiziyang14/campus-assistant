/** 取中止原因；旧版浏览器没有 signal.reason，退回标准的 AbortError。 */
export const getAbortReason = (signal: AbortSignal): unknown =>
  'reason' in signal ? signal.reason : new DOMException('The operation was aborted.', 'AbortError')

/** 旧版浏览器没有 AbortSignal.prototype.throwIfAborted，统一走这个函数。 */
export const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw getAbortReason(signal)
  }
}
