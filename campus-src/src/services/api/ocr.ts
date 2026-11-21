import { API_ORIGIN, ApiError, request } from './client.js'

/** 官方 OCR：/v1/tools/ocr 按页识别，返回识别后的原始文字 */
export type OcrPurpose = 'text_recognition' | 'rich_layout_recognition'

type OcrPage = { index?: number; text?: string }
type OcrResponse = { page_count?: number; pages?: OcrPage[] }

/** 去掉 OCR 结果里的定位标记，保留标记包裹的文字 */
const stripMarks = (text: string) =>
  text
    .replace(/<｜box｜>\[\[[^\]]*\]\]<｜\/box｜>/g, '')
    .replace(/<｜ref｜>/g, '')
    .replace(/<｜\/ref｜>/g, '')

export type OcrResult = { text: string; pageCount: number }

export const recognizeFile = async (
  apiKey: string,
  file: File,
  purpose: OcrPurpose,
  signal?: AbortSignal
): Promise<OcrResult> => {
  const form = new FormData()
  form.append('purpose', purpose)
  form.append('file', file)
  const response = await request(`${API_ORIGIN}/v1/tools/ocr`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal,
  })
  const body = (await response.json()) as OcrResponse
  const pages = Array.isArray(body.pages) ? body.pages : []
  if (pages.length === 0) {
    throw new ApiError('protocol', 'OCR 没有返回识别结果')
  }
  const text = stripMarks(pages.map((page) => page.text ?? '').join('\n\n')).trim()
  return { text, pageCount: body.page_count ?? pages.length }
}
