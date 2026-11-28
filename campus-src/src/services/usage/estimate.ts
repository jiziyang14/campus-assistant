import type { ChatModel, MessageUsage } from '../api/types.js'

/** 官方价格：人民币 / 百万 tokens；空闲价为高峰价的一半 */
export type ModelPrice = { hit: number; miss: number; output: number }

const PRICES: Record<ChatModel, { peak: ModelPrice; offPeak: ModelPrice }> = {
  'deepseek-flash': {
    peak: { hit: 0.04, miss: 2, output: 8 },
    offPeak: { hit: 0.02, miss: 1, output: 4 },
  },
  'deepseek-v4-pro': {
    peak: { hit: 0.3, miss: 9, output: 27 },
    offPeak: { hit: 0.15, miss: 4.5, output: 13.5 },
  },
}

/** 两个模型的上下文长度都是 1M */
export const CONTEXT_LIMIT = 1_000_000

/**
 * 高峰时段：北京时间周一至周五 9:00–12:00、14:00–18:00。
 * 官方还会排除中国法定节假日，本地没有节假日日历，界面按「估算」展示。
 */
export const isPeakTime = (timestamp: number): boolean => {
  const beijing = new Date(timestamp + 8 * 60 * 60 * 1000)
  const weekday = beijing.getUTCDay()
  if (weekday === 0 || weekday === 6) {
    return false
  }
  const hour = beijing.getUTCHours()
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
}

export type UsageEstimate = {
  model: ChatModel
  peak: boolean
  price: ModelPrice
  /** 未命中缓存的输入（含 cache_creation） */
  missTokens: number
  cacheReadTokens: number
  outputTokens: number
  totalTokens: number
  /** 本轮结束后上下文占用 */
  contextTokens: number
  /** 估算金额（元） */
  cost: number
}

/**
 * 按官方价格估算单轮用量。usage.input_tokens 为未命中缓存的部分，
 * cache_read_input_tokens 按命中价，cache_creation_input_tokens 按未命中价。
 */
export const estimateUsage = (
  usage: MessageUsage,
  model: ChatModel,
  at: number
): UsageEstimate => {
  const missTokens = usage.input_tokens + usage.cache_creation_input_tokens
  const cacheReadTokens = usage.cache_read_input_tokens
  const outputTokens = usage.output_tokens
  const peak = isPeakTime(at)
  const price = peak ? PRICES[model].peak : PRICES[model].offPeak
  const cost =
    (missTokens * price.miss + cacheReadTokens * price.hit + outputTokens * price.output) / 1_000_000
  return {
    model,
    peak,
    price,
    missTokens,
    cacheReadTokens,
    outputTokens,
    totalTokens: missTokens + cacheReadTokens + outputTokens,
    contextTokens: missTokens + cacheReadTokens + outputTokens,
    cost,
  }
}
