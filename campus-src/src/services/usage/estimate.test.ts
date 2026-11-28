import { describe, expect, it } from 'vitest'
import type { MessageUsage } from '../api/types.js'
import { estimateUsage, isPeakTime } from './estimate.js'

const usage = (patch: Partial<MessageUsage> = {}): MessageUsage => ({
  input_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  output_tokens: 0,
  ...patch,
})

// 2026-11-23 是周一，02:00Z 对应北京时间 10:00
const mondayTen = Date.parse('2026-11-23T02:00:00Z')

describe('isPeakTime', () => {
  it('工作日高峰时段返回 true', () => {
    expect(isPeakTime(mondayTen)).toBe(true)
    expect(isPeakTime(Date.parse('2026-11-23T06:00:00Z'))).toBe(true) // 14:00
  })

  it('午休、下班后与早上返回 false', () => {
    expect(isPeakTime(Date.parse('2026-11-23T04:00:00Z'))).toBe(false) // 12:00
    expect(isPeakTime(Date.parse('2026-11-23T10:00:00Z'))).toBe(false) // 18:00
    expect(isPeakTime(Date.parse('2026-11-23T00:59:00Z'))).toBe(false) // 08:59
  })

  it('周末全天空闲', () => {
    expect(isPeakTime(Date.parse('2026-11-28T02:00:00Z'))).toBe(false)
  })
})

describe('estimateUsage', () => {
  it('按未命中输入价、命中价与输出价分别计费', () => {
    const result = estimateUsage(
      usage({ input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000, output_tokens: 1_000_000 }),
      'deepseek-flash',
      mondayTen
    )
    expect(result.peak).toBe(true)
    // 高峰：未命中 2 元 + 命中 0.04 元 + 输出 8 元
    expect(result.cost).toBeCloseTo(10.04, 6)
    expect(result.contextTokens).toBe(3_000_000)
  })

  it('空闲时段为高峰价的一半', () => {
    const result = estimateUsage(usage({ output_tokens: 1_000_000 }), 'deepseek-flash', Date.parse('2026-11-23T12:00:00Z'))
    expect(result.peak).toBe(false)
    expect(result.cost).toBeCloseTo(4, 6)
  })

  it('cache_creation 计入未命中输入', () => {
    const result = estimateUsage(
      usage({ input_tokens: 500_000, cache_creation_input_tokens: 500_000 }),
      'deepseek-flash',
      mondayTen
    )
    expect(result.missTokens).toBe(1_000_000)
    expect(result.cost).toBeCloseTo(2, 6)
  })
})
