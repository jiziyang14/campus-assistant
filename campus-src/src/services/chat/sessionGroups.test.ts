import { describe, expect, it } from 'vitest'
import { filterSessions } from './sessionGroups.js'
import type { SessionSummary } from './types.js'

const session = (id: string, title: string): SessionSummary =>
  ({ id, title, createdAt: 0, updatedAt: 0 }) as unknown as SessionSummary

describe('filterSessions', () => {
  const sessions = [
    session('1', '数学错题整理'),
    session('2', '英语阅读技巧'),
    session('3', 'Math notes'),
  ]

  it('空关键词返回原列表', () => {
    expect(filterSessions(sessions, '   ')).toBe(sessions)
  })

  it('按标题包含匹配', () => {
    expect(filterSessions(sessions, '错题').map((item) => item.id)).toEqual(['1'])
  })

  it('忽略大小写与首尾空格', () => {
    expect(filterSessions(sessions, '  MATH ').map((item) => item.id)).toEqual(['3'])
  })

  it('没有匹配时返回空列表', () => {
    expect(filterSessions(sessions, '物理')).toEqual([])
  })
})
