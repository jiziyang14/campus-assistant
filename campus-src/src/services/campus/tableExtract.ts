import { streamMessage } from '../api/client.js'
import type { CreateMessageRequest } from '../api/types.js'
import type { Deck, DeckSlide } from './deck.js'

/** 表格分析：OCR 给结构与文字，视觉模型负责标记和手写内容 */

export type MarkedCell = {
  row: number
  col: number
  /** 模型从图里读到的姓名，OCR 缺失时兜底 */
  name: string
  /** 格子文字 */
  value: string
  /** dark / red / orange / yellow / green / blue / other */
  style: string
  note: string
}

export type HandwrittenItem = {
  row: number | null
  col: number | null
  text: string
  scope: 'cell' | 'margin' | 'header' | 'footer'
}

export type TableAnalysis = {
  /** 从手写说明或图例推断出的含义，如“重默” */
  meaning: string
  marked: MarkedCell[]
  handwritten: HandwrittenItem[]
  notes: string
}

export type MarkedRecord = {
  row: number
  col: number
  name: string
  column: string
  value: string
  style: string
}

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })

const MARKER_PROMPT = (ocrText: string) => `下面的 OCR 结构只包含印刷文字，不含颜色和手写内容。请结合图片补充三类信息：
1. 被标记的单元格：底色明显深于普通格子、底色是彩色（红/黄/绿/蓝等），或者文字颜色明显不同。
2. 手写内容：表格内外的手写文字、圈画、勾叉、批注，尽量给出所在行列。
3. 手写说明/图例：例如表格上方写着“重默名单”“黑底为需订正”，据此推断这些标记代表什么。

只输出 JSON，不要输出其他内容：
{"meaning":"重默","marked":[{"row":1,"col":0,"name":"李四","value":"李四","style":"dark","note":""}],"handwritten":[{"row":2,"col":0,"text":"李四","scope":"cell"}],"notes":"表格上方手写：重默名单"}
要求：
- row/col 从 0 开始（表头为第 0 行）；对不上具体行列时填空值 null。
- style 取 dark、red、orange、yellow、green、blue、other 之一。
- scope 取 cell、margin、header、footer；表格外统一用 margin。
- meaning 不确定就填空字符串；没有手写就返回空数组和空字符串。

【OCR 结构】
${ocrText}`

const parseJson = (text: string) => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) {
    return null
  }
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

const asString = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const asIndex = (value: unknown) => {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const readMarked = (value: unknown): MarkedCell[] => {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return []
    }
    const cell = item as Record<string, unknown>
    const row = asIndex(cell.row)
    const col = asIndex(cell.col)
    if (row === null || col === null) {
      return []
    }
    return [
      {
        row,
        col,
        name: asString(cell.name),
        value: asString(cell.value),
        style: asString(cell.style).toLowerCase() || 'other',
        note: asString(cell.note),
      },
    ]
  })
}

const readHandwritten = (value: unknown): HandwrittenItem[] => {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return []
    }
    const cell = item as Record<string, unknown>
    const text = asString(cell.text)
    if (!text) {
      return []
    }
    const scope = asString(cell.scope).toLowerCase()
    return [
      {
        row: asIndex(cell.row),
        col: asIndex(cell.col),
        text,
        scope:
          scope === 'cell'
            ? 'cell'
            : scope === 'header'
              ? 'header'
              : scope === 'footer'
                ? 'footer'
                : 'margin',
      },
    ]
  })
}

/** 调用视觉模型分析标记与手写内容；失败或格式异常时返回空结果 */
export const analyzeTable = async (
  apiKey: string,
  file: File,
  ocrText: string,
  signal?: AbortSignal
): Promise<TableAnalysis> => {
  const data = await fileToBase64(file)
  const body: CreateMessageRequest = {
    model: 'deepseek-flash',
    system: '',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: file.type || 'image/jpeg', data },
          },
          { type: 'text', text: MARKER_PROMPT(ocrText) },
        ],
      },
    ],
    thinking: { type: 'disabled' },
    tools: [],
    safety_check: { level: 'high' },
  }
  let output = ''
  for await (const event of streamMessage(apiKey, body, signal ?? new AbortController().signal)) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      output += event.delta.text
    }
  }
  const parsed = parseJson(output)
  return {
    meaning: asString(parsed?.meaning),
    marked: readMarked(parsed?.marked),
    handwritten: readHandwritten(parsed?.handwritten),
    notes: asString(parsed?.notes),
  }
}

/** 从 OCR 文本里取出 HTML 表格的行列 */
export const parseTableRows = (ocrText: string): string[][] => {
  const match = ocrText.match(/<table[\s\S]*?<\/table>/i)
  if (!match) {
    return []
  }
  const doc = new DOMParser().parseFromString(match[0], 'text/html')
  return Array.from(doc.querySelectorAll('tr')).map((tr) =>
    Array.from(tr.querySelectorAll('td,th')).map((cell) => (cell.textContent || '').trim())
  )
}

/** 优先按表头里的“姓名 / 学生 / 名字”找姓名列，找不到就用第一列 */
export const detectNameColumn = (rows: string[][]): number => {
  const header = rows[0] ?? []
  const index = header.findIndex((cell) => /姓名|学生|名字|name/i.test(cell))
  return index >= 0 ? index : 0
}

export const getColumnLabel = (rows: string[][], col: number, fallback: string) => {
  const label = rows[0]?.[col]?.trim()
  return label || fallback
}

/**
 * 还原“姓名 + 所在列 + 格子内容”。
 * 印刷文字优先，缺失时用同位置的手写内容补齐。
 */
export const resolveMarkedRecords = (
  cells: MarkedCell[],
  rows: string[][],
  nameColumn: number,
  columnFallback: (col: number) => string,
  handwritten: HandwrittenItem[] = []
): MarkedRecord[] => {
  const handAt = (row: number, col: number) =>
    handwritten.find((item) => item.row === row && item.col === col)?.text ?? ''
  return cells.flatMap((cell) => {
    const name =
      rows[cell.row]?.[nameColumn]?.trim() ||
      handAt(cell.row, nameColumn) ||
      cell.name
    if (!name) {
      return []
    }
    const value = cell.value || rows[cell.row]?.[cell.col] || handAt(cell.row, cell.col)
    return [
      {
        row: cell.row,
        col: cell.col,
        name,
        column: cell.col === nameColumn ? '' : columnFallback(cell.col),
        value,
        style: cell.style,
      },
    ]
  })
}

export const uniqueNames = (records: MarkedRecord[]) => {
  const names: string[] = []
  for (const record of records) {
    if (record.name && !names.includes(record.name)) {
      names.push(record.name)
    }
  }
  return names
}

/** 从手写内容里挑出像姓名的词，供确认层补充 */
export const collectHandwrittenNames = (
  items: HandwrittenItem[],
  records: MarkedRecord[],
  meanings: string[]
): string[] => {
  const names: string[] = []
  const push = (value: string) => {
    const text = value.trim()
    if (!text) {
      return
    }
    if (meanings.some((meaning) => meaning && text.includes(meaning))) {
      return
    }
    if (records.some((record) => record.name === text) || names.includes(text)) {
      return
    }
    names.push(text)
  }
  for (const item of items) {
    // 一格里的手写可能是“李四、王五”，拆开逐个判断；表格外的批注只收 2-3 字的短词
    const parts = item.text.split(/[、,，;；\s]+/).filter(Boolean)
    for (const part of parts) {
      const limit = item.scope === 'cell' ? 4 : 3
      if (part.length < 2 || part.length > limit) {
        continue
      }
      if (!/^[\u4e00-\u9fa5·]+$/.test(part)) {
        continue
      }
      push(part)
    }
  }
  return names
}

const chunkColumns = (names: string[], columns: number) => {
  const size = Math.ceil(names.length / columns)
  return Array.from({ length: columns }, (_, index) =>
    names.slice(index * size, (index + 1) * size)
  ).filter((group) => group.length > 0)
}

/** 确定性生成放映稿：名单页 +（有项目时）明细页 + 统计页 */
export const buildMarkedDeck = (
  meaning: string,
  records: MarkedRecord[],
  total: number
): Deck => {
  const names = uniqueNames(records)
  const columns = names.length <= 8 ? 2 : 3
  const panes = chunkColumns(names, columns).map((group, index) => ({
    title: `第 ${index + 1} 组`,
    points: group,
  }))
  const slides: DeckSlide[] = [{ title: `${meaning}名单`, points: [], panes }]

  const details = records.filter((record) => record.column && record.value)
  if (details.length > 0) {
    const detailColumns = details.length <= 8 ? 2 : 3
    slides.push({
      title: `${meaning}明细`,
      points: [],
      panes: chunkColumns(
        details.map((record) => `${record.name} · ${record.column} ${record.value}`),
        detailColumns
      ).map((group, index) => ({ title: `第 ${index + 1} 组`, points: group })),
    })
  }

  const stats: string[] = [`共 ${names.length} 人`]
  if (total > 0) {
    stats.push(`全班 ${total} 人`)
    stats.push(`占比 ${Math.round((names.length / total) * 100)}%`)
  }
  const perColumn = new Map<string, number>()
  for (const record of details) {
    perColumn.set(record.column, (perColumn.get(record.column) ?? 0) + 1)
  }
  if (perColumn.size > 1) {
    for (const [column, count] of perColumn) {
      stats.push(`${column} ${count} 处`)
    }
  }
  slides.push({ title: `${meaning}统计`, points: stats })
  return { title: `${meaning}名单`, split: true, slides }
}
