import { describe, expect, it } from 'vitest'
import {
  buildMarkedDeck,
  collectHandwrittenNames,
  detectNameColumn,
  getColumnLabel,
  resolveMarkedRecords,
  uniqueNames,
  type MarkedCell,
} from './tableExtract.js'

const cell = (row: number, col: number, name = '', value = '', style = 'red'): MarkedCell => ({
  row,
  col,
  name,
  value,
  style,
  note: '',
})

describe('detectNameColumn', () => {
  it('finds a name header in Chinese or English', () => {
    expect(detectNameColumn([['学号', '姓名', '成绩']])).toBe(1)
    expect(detectNameColumn([['ID', 'Name', 'Score']])).toBe(1)
  })

  it('falls back to the first column', () => {
    expect(detectNameColumn([['学号', '成绩']])).toBe(0)
    expect(detectNameColumn([])).toBe(0)
  })
})

describe('getColumnLabel', () => {
  it('uses the header, then the fallback', () => {
    expect(getColumnLabel([['姓名', '默写']], 1, '第 2 列')).toBe('默写')
    expect(getColumnLabel([['姓名']], 3, '第 4 列')).toBe('第 4 列')
  })
})

describe('resolveMarkedRecords', () => {
  const rows = [
    ['姓名', '默写', '订正'],
    ['李四', '95', ''],
    ['王五', '', '✓'],
  ]

  it('prefers printed text and fills missing values from handwriting', () => {
    const records = resolveMarkedRecords(
      [cell(1, 1), cell(2, 2)],
      rows,
      0,
      (col) => getColumnLabel(rows, col, `第 ${col + 1} 列`),
      [{ row: 2, col: 1, text: '未交', scope: 'cell' }]
    )
    expect(records).toEqual([
      { row: 1, col: 1, name: '李四', column: '默写', value: '95', style: 'red' },
      { row: 2, col: 2, name: '王五', column: '订正', value: '✓', style: 'red' },
    ])
  })

  it('uses the model name when the row is missing and drops nameless cells', () => {
    const records = resolveMarkedRecords(
      [cell(9, 1, '赵六'), cell(1, 1)],
      rows,
      0,
      (col) => String(col)
    )
    expect(records.map((record) => record.name)).toEqual(['赵六', '李四'])
  })
})

describe('uniqueNames', () => {
  it('keeps first-seen order without duplicates', () => {
    expect(
      uniqueNames([
        { row: 0, col: 0, name: '李四', column: '', value: '', style: '' },
        { row: 1, col: 0, name: '王五', column: '', value: '', style: '' },
        { row: 2, col: 0, name: '李四', column: '', value: '', style: '' },
      ])
    ).toEqual(['李四', '王五'])
  })
})

describe('collectHandwrittenNames', () => {
  it('collects short Chinese names and skips meanings and duplicates', () => {
    const names = collectHandwrittenNames(
      [
        { row: 1, col: 0, text: '李四、王五', scope: 'cell' },
        { row: null, col: null, text: '重默名单', scope: 'margin' },
        { row: 2, col: 0, text: '李四', scope: 'cell' },
        { row: 3, col: 0, text: 'ABC', scope: 'cell' },
      ],
      [{ row: 1, col: 0, name: '李四', column: '', value: '', style: '' }],
      ['重默']
    )
    expect(names).toEqual(['王五'])
  })
})

describe('buildMarkedDeck', () => {
  it('builds a name slide, detail slide and statistics slide', () => {
    const deck = buildMarkedDeck(
      '重默',
      [
        { row: 1, col: 1, name: '李四', column: '默写', value: '95', style: 'red' },
        { row: 2, col: 2, name: '王五', column: '订正', value: '✓', style: 'red' },
      ],
      40
    )
    expect(deck.title).toBe('重默名单')
    expect(deck.slides).toHaveLength(3)
    expect(deck.slides[0].panes?.flatMap((pane) => pane.points)).toEqual(['李四', '王五'])
    expect(deck.slides[1].panes?.flatMap((pane) => pane.points)).toContain('李四 · 默写 95')
    expect(deck.slides[2].points).toContain('占比 5%')
  })

  it('omits the detail slide when no column/value detail exists', () => {
    const deck = buildMarkedDeck('未交', [{ ...cell(1, 0, '李四'), column: '', value: '' }], 0)
    expect(deck.slides).toHaveLength(2)
    expect(deck.slides[1].points).toEqual(['共 1 人'])
  })
})
