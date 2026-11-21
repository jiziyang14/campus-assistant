export type DeckPane = {
  title: string
  points: string[]
}

export type DeckSlide = {
  title: string
  points: string[]
  panes?: DeckPane[]
  note?: string
}

export type Deck = {
  title: string
  slides: DeckSlide[]
  /** 由回答直接拆分而来，没有封面页 */
  split?: boolean
}

/** 块级公式里的换行对 KaTeX 没有意义，先合并成一行，避免按行解析时把公式内容误判成列表/空行 */
const collapseDisplayMath = (value: string) =>
  value
    .replace(/\$\$([\s\S]*?)\$\$/g, (block) => block.replace(/\n/g, ' '))
    .replace(/\\\[([\s\S]*?)\\\]/g, (block) => block.replace(/\n/g, ' '))

const cleanInline = (value: string) =>
  value
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    // 不把 LaTeX 的 \[...\] 当成 Markdown 链接
    .replace(/(?<!\\)\[(.*?)\]\([^)]*\)/g, '$1')
    .replace(/^\s*#{1,6}\s*/, '')
    .trim()

const normalizeSlide = (value: unknown): DeckSlide | null => {
  if (!value || typeof value !== 'object') {
    return null
  }
  const item = value as Record<string, unknown>
  const title = cleanInline(String(item.title || item.heading || ''))
  if (!title) {
    return null
  }
  const source = item.points ?? item.bullets ?? item.content ?? item.lines
  let points: string[] = []
  if (Array.isArray(source)) {
    points = source.map((point) => cleanInline(String(point || ''))).filter(Boolean)
  } else if (typeof source === 'string') {
    points = source
      .split(/\n+/)
      .map((point) => cleanInline(point.replace(/^[-*]\s*/, '')))
      .filter(Boolean)
  }
  const panes = Array.isArray(item.panes)
    ? item.panes
        .map((pane) => normalizePane(pane))
        .filter((pane): pane is DeckPane => !!pane)
    : undefined
  return {
    title,
    points: panes && panes.length >= 2 ? [] : points.slice(0, 8),
    panes: panes && panes.length >= 2 ? panes.slice(0, 4) : undefined,
    note: typeof item.note === 'string' ? cleanInline(item.note) : undefined,
  }
}

const normalizePane = (value: unknown): DeckPane | null => {
  if (!value || typeof value !== 'object') {
    return null
  }
  const item = value as Record<string, unknown>
  const title = cleanInline(String(item.title || item.heading || ''))
  if (!title) {
    return null
  }
  const source = item.points ?? item.bullets ?? item.content ?? item.lines
  let points: string[] = []
  if (Array.isArray(source)) {
    points = source.map((point) => cleanInline(String(point || ''))).filter(Boolean)
  } else if (typeof source === 'string') {
    points = source
      .split(/\n+/)
      .map((point) => cleanInline(point.replace(/^[-*]\s*/, '')))
      .filter(Boolean)
  }
  return { title, points: points.slice(0, 6) }
}

const parseJsonDeck = (text: string): Deck | null => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) {
    return null
  }
  try {
    const payload = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
    const rawSlides = Array.isArray(payload.slides)
      ? payload.slides
      : Array.isArray(payload)
        ? payload
        : []
    const slides = rawSlides.map(normalizeSlide).filter((slide): slide is DeckSlide => !!slide)
    if (slides.length < 2) {
      return null
    }
    const title = cleanInline(String(payload.title || slides[0].title))
    return { title, slides: slides.slice(0, 40) }
  } catch {
    return null
  }
}

type Section = { title: string; points: string[] }

const isTableLine = (line: string) => line.startsWith('|')
const isTableDivider = (line: string) => isTableLine(line) && /^[\s|:-]+$/.test(line) && line.includes('-')

/** 把普通回答按标题切段，段内按列表/段落归并成若干条要点 */
const parseAnswerSections = (text: string): Section[] => {
  const sections: Section[] = []
  let current: Section = { title: '', points: [] }
  let paragraph: string[] = []
  let inCode = false

  const flushParagraph = () => {
    const value = cleanInline(paragraph.join(' '))
    paragraph = []
    if (value) {
      current.points.push(value)
    }
  }
  const pushSection = () => {
    flushParagraph()
    if (current.title || current.points.length > 0) {
      sections.push(current)
    }
    current = { title: '', points: [] }
  }

  for (const raw of collapseDisplayMath(text).replace(/\r/g, '').split('\n')) {
    const line = raw.trim()
    if (/^```/.test(line)) {
      flushParagraph()
      inCode = !inCode
      continue
    }
    if (inCode) {
      if (line) {
        paragraph.push(line)
      } else {
        flushParagraph()
      }
      continue
    }
    if (/^#{1,4}\s+/.test(line)) {
      pushSection()
      current.title = cleanInline(line.replace(/^#{1,4}\s+/, ''))
      continue
    }
    if (line === '') {
      flushParagraph()
      continue
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line) || isTableDivider(line)) {
      continue
    }
    if (/^([-*+]|\d+[.)])\s+/.test(line)) {
      flushParagraph()
      current.points.push(cleanInline(line.replace(/^([-*+]|\d+[.)])\s+/, '')))
      continue
    }
    if (/^>\s?/.test(line)) {
      flushParagraph()
      const value = cleanInline(line.replace(/^>\s?/, ''))
      if (value) {
        current.points.push(value)
      }
      continue
    }
    if (isTableLine(line)) {
      flushParagraph()
      const cells = line
        .split('|')
        .map((cell) => cleanInline(cell))
        .filter(Boolean)
      if (cells.length > 0) {
        current.points.push(cells.join(' · '))
      }
      continue
    }
    paragraph.push(line)
  }
  pushSection()
  return sections
}

const chunkSections = (sections: Section[]): Section[][] => {
  if (sections.length <= 4) {
    return [sections]
  }
  const chunks: Section[][] = []
  for (let index = 0; index < sections.length; index += 3) {
    chunks.push(sections.slice(index, index + 3))
  }
  const last = chunks[chunks.length - 1]
  if (last.length === 1 && chunks.length > 1) {
    const previous = chunks[chunks.length - 2]
    chunks.splice(chunks.length - 2, 2, [...previous, ...last])
  }
  return chunks
}

/** 把一段文本按标题/列表原样切成若干栏，不做任何改写 */
export const splitTextIntoPanes = (text: string): DeckPane[] =>
  parseAnswerSections(text)
    .filter((section) => section.points.length > 0)
    .map((section) => ({ title: section.title, points: section.points }))

/**
 * 直接把一条普通回答排成分屏放映稿，不做总结：
 * 有标题就按标题分栏，没有标题就把要点对半分成两栏。
 */
export const buildSplitDeck = (text: string | null | undefined): Deck | null => {
  if (!text) {
    return null
  }
  const source = collapseDisplayMath(text.trim())
  if (!source) {
    return null
  }
  const sections = parseAnswerSections(source).filter((section) => section.points.length > 0)
  const heading = cleanInline(
    source
      .split('\n')
      .map((line) => line.trim())
      .find((line) => !!line) || ''
  )
  const title = (sections[0]?.title || sections[0]?.points[0] || heading).slice(0, 40)

  if (sections.length === 0) {
    return null
  }

  if (sections.length === 1) {
    const [section] = sections
    if (section.points.length >= 4) {
      const half = Math.ceil(section.points.length / 2)
      const panes: DeckPane[] = [
        { title: '', points: section.points.slice(0, half) },
        { title: '', points: section.points.slice(half) },
      ]
      return {
        title,
        split: true,
        slides: [{ title: section.title, points: [], panes }],
      }
    }
    return {
      title,
      split: true,
      slides: [{ title: section.title, points: section.points }],
    }
  }

  const slides: DeckSlide[] = chunkSections(sections).map((chunk) => ({
    title: '',
    points: [],
    panes: chunk.map((section) => ({ title: section.title, points: section.points })),
  }))
  return { title, split: true, slides: slides.slice(0, 20) }
}

/**
 * 识别 AI 生成的放映稿：
 * 1. 优先解析 Markdown 分页（--- 分隔，每页以标题开头）；
 * 2. 兼容模型直接输出的 JSON。
 */
export const parseDeck = (text: string | null | undefined): Deck | null => {
  if (!text) {
    return null
  }
  const trimmed = collapseDisplayMath(text.trim())
  const chunks = trimmed.split(/\n\s*---\s*\n/)
  if (chunks.length >= 3) {
    const slides: DeckSlide[] = []
    for (const chunk of chunks) {
      const lines = chunk
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      if (lines.length === 0) {
        continue
      }
      const headingIndex = lines.findIndex((line) => /^#{1,6}\s+/.test(line))
      const titleIndex = headingIndex >= 0 ? headingIndex : 0
      if (headingIndex < 0 && !/^[-*]\s+/.test(lines[1] || '')) {
        continue
      }
      const title = cleanInline(lines[titleIndex])
      const body = lines.slice(titleIndex + 1)
      const paneIndexes = body
        .map((line, index) => (/^###\s+/.test(line) ? index : -1))
        .filter((index) => index >= 0)
      const points: string[] = []
      const panes: DeckPane[] = []
      let note = ''
      if (paneIndexes.length >= 2) {
        paneIndexes.slice(0, 4).forEach((start, position) => {
          const end = paneIndexes[position + 1] ?? body.length
          const paneTitle = cleanInline(body[start])
          const panePoints: string[] = []
          for (const line of body.slice(start + 1, end)) {
            if (/^[-*]\s+/.test(line)) {
              panePoints.push(cleanInline(line.replace(/^[-*]\s+/, '')))
            } else if (/^>\s?/.test(line)) {
              note = cleanInline(line.replace(/^>\s?/, ''))
            } else if (!note && panePoints.length === 0) {
              panePoints.push(cleanInline(line))
            } else if (panePoints.length > 0 && !note) {
              panePoints[panePoints.length - 1] += ` ${cleanInline(line)}`
            }
          }
          if (paneTitle) {
            panes.push({ title: paneTitle, points: panePoints.slice(0, 6) })
          }
        })
      } else {
        for (const line of body) {
          if (/^#{1,6}\s+/.test(line)) {
            continue
          }
          if (/^[-*]\s+/.test(line)) {
            points.push(cleanInline(line.replace(/^[-*]\s+/, '')))
          } else if (/^>\s?/.test(line)) {
            note = cleanInline(line.replace(/^>\s?/, ''))
          } else if (!note && points.length === 0) {
            points.push(cleanInline(line))
          } else if (points.length > 0 && !note) {
            points[points.length - 1] += ` ${cleanInline(line)}`
          }
        }
      }
      if (title) {
        slides.push({
          title,
          points: panes.length >= 2 ? [] : points.slice(0, 8),
          panes: panes.length >= 2 ? panes : undefined,
          note: note || undefined,
        })
      }
    }
    if (slides.length >= 3) {
      return { title: slides[0].title, slides: slides.slice(0, 40) }
    }
  }
  return parseJsonDeck(trimmed)
}
