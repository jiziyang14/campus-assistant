import { unzipSync } from 'fflate'
import {
  splitTextIntoPanes,
  type Deck,
  type DeckPane,
  type DeckSlide,
} from './deck.js'

/** 本地直接读取文件内容并分屏，全程不调用 AI，不改动原文 */

const TEXT_EXTS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'tsv',
  'html',
  'htm',
  'json',
  'log',
  'xml',
  'yaml',
  'yml',
  'ini',
  'conf',
])

type ParsedDoc = {
  name: string
  panes: DeckPane[]
  slides?: DeckSlide[]
}

export type BuildDeckResult = {
  deck: Deck | null
  failed: { name: string; reason: string }[]
}

const decoder = new TextDecoder('utf-8')

const parseXml = (source: string) => new DOMParser().parseFromString(source, 'application/xml')

const baseName = (name: string) => name.replace(/\.[^.]+$/, '').trim() || name

const chunk = <T,>(items: T[], size: number): T[][] => {
  const groups: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size))
  }
  return groups
}

const htmlToText = (html: string) => {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return (doc.body?.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
}

const paragraphTexts = (root: Document | Element) =>
  Array.from(root.getElementsByTagNameNS('*', 'p'))
    .map((paragraph) =>
      Array.from(paragraph.getElementsByTagNameNS('*', 't'))
        .map((node) => node.textContent || '')
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean)

/** docx：保留标题层级，正文按段落还原成纯文本 */
const parseDocx = (buffer: ArrayBuffer) => {
  const entries = unzipSync(new Uint8Array(buffer), {
    filter: (entry) => entry.name === 'word/document.xml',
  })
  const raw = entries['word/document.xml']
  if (!raw) {
    return ''
  }
  const doc = parseXml(decoder.decode(raw))
  const lines: string[] = []
  for (const paragraph of Array.from(doc.getElementsByTagNameNS('*', 'p'))) {
    const text = Array.from(paragraph.getElementsByTagNameNS('*', 't'))
      .map((node) => node.textContent || '')
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) {
      continue
    }
    const style =
      paragraph.getElementsByTagNameNS('*', 'pStyle')[0]?.getAttribute('w:val') || ''
    lines.push(/title|heading/i.test(style) ? `## ${text}` : text)
  }
  return lines.join('\n\n')
}

/** pptx：按原有幻灯片顺序提取每页文字，标题取该页首行 */
const parsePptx = (buffer: ArrayBuffer) => {
  const entries = unzipSync(new Uint8Array(buffer), {
    filter: (entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.name),
  })
  return Object.keys(entries)
    .sort(
      (left, right) =>
        Number(left.match(/\d+/)?.[0] || 0) - Number(right.match(/\d+/)?.[0] || 0)
    )
    .map((name) => paragraphTexts(parseXml(decoder.decode(entries[name]))))
    .filter((paragraphs) => paragraphs.length > 0)
}

const readDoc = async (file: File): Promise<ParsedDoc | null> => {
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  const name = baseName(file.name)
  if (ext === 'pptx') {
    const pages = parsePptx(await file.arrayBuffer())
    if (pages.length === 0) {
      return null
    }
    const slides: DeckSlide[] = pages.map((paragraphs) => ({
      title: paragraphs[0],
      points: paragraphs.slice(1),
    }))
    return { name, slides, panes: [{ title: name, points: pages.flat() }] }
  }
  if (ext === 'docx') {
    const text = parseDocx(await file.arrayBuffer())
    const panes = splitTextIntoPanes(text)
    return panes.length > 0 ? { name, panes } : null
  }
  if (TEXT_EXTS.has(ext)) {
    let text = await file.text()
    if (ext === 'html' || ext === 'htm') {
      text = htmlToText(text)
    }
    const panes = splitTextIntoPanes(text)
    return panes.length > 0 ? { name, panes } : null
  }
  return null
}

const isSupported = (file: File) => {
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  return ext === 'pptx' || ext === 'docx' || TEXT_EXTS.has(ext)
}

export const buildDeckFromFiles = async (files: File[]): Promise<BuildDeckResult> => {
  const failed: { name: string; reason: string }[] = []
  const docs: ParsedDoc[] = []

  for (const file of files) {
    if (!isSupported(file)) {
      failed.push({ name: file.name, reason: 'unsupported' })
      continue
    }
    try {
      const doc = await readDoc(file)
      if (doc) {
        docs.push(doc)
      } else {
        failed.push({ name: file.name, reason: 'empty' })
      }
    } catch {
      failed.push({ name: file.name, reason: 'failed' })
    }
  }

  if (docs.length === 0) {
    return { deck: null, failed }
  }

  if (docs.length === 1) {
    const [doc] = docs
    if (doc.slides && doc.slides.length > 0) {
      return {
        deck: { title: doc.name, split: true, slides: doc.slides.slice(0, 80) },
        failed,
      }
    }
    if (doc.panes.length >= 2) {
      const slides: DeckSlide[] = chunk(doc.panes, 3).map((group) => ({
        title: '',
        points: [],
        panes: group,
      }))
      return { deck: { title: doc.name, split: true, slides }, failed }
    }
    const slides: DeckSlide[] = chunk(doc.panes[0].points, 8).map((points, index) => ({
      title: index === 0 ? doc.name : '',
      points,
    }))
    return { deck: { title: doc.name, split: true, slides }, failed }
  }

  // 多个文件：每个文件占一栏，按原文并列展示
  const slides: DeckSlide[] = chunk(docs, 3).map((group) => ({
    title: '',
    points: [],
    panes: group.map((doc) => ({
      title: doc.name,
      points: doc.panes.flatMap((pane) => pane.points),
    })),
  }))
  return {
    deck: {
      title: docs.map((doc) => doc.name).join(' + ').slice(0, 40),
      split: true,
      slides,
    },
    failed,
  }
}
