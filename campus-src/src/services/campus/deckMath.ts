/** 放映稿文本里的 LaTeX 片段：$$...$$、\[...\] 为块级公式，$...$、\(...\) 为行内公式 */
export type DeckMathSegment =
  | { kind: 'text'; value: string }
  | { kind: 'inline'; value: string }
  | { kind: 'display'; value: string }

const isWhitespace = (char: string): boolean => /\s/.test(char)

/** 从开头的 $ 之后找行内公式的结束位置；找不到返回 -1（金额等普通文本保持原样） */
const findInlineEnd = (input: string, start: number): number => {
  if (start + 1 >= input.length || isWhitespace(input[start + 1])) {
    return -1
  }
  for (let index = start + 1; index < input.length; index += 1) {
    const char = input[index]
    if (char === '\\') {
      index += 1
      continue
    }
    if (char === '\n') {
      return -1
    }
    if (char === '$') {
      // 结束符前面不能是空白，避免把 “$5 和 $10” 这类金额当成公式
      return isWhitespace(input[index - 1]) ? -1 : index
    }
  }
  return -1
}

/**
 * 把放映文本切成“普通文字 + 行内公式 + 块级公式”。
 * 只识别成对出现的定界符，未闭合的 $ 等保持原文，避免公式没写完时整段消失。
 */
export const splitDeckMath = (input: string): DeckMathSegment[] => {
  const segments: DeckMathSegment[] = []
  let text = ''
  const flushText = () => {
    if (text) {
      segments.push({ kind: 'text', value: text })
      text = ''
    }
  }
  let index = 0
  while (index < input.length) {
    const char = input[index]
    if (char === '\\') {
      const next = input[index + 1]
      if (next === '$') {
        // 转义美元符号按普通字符显示，不再当成公式开头
        text += '$'
        index += 2
        continue
      }
      if (next === '[' || next === '(') {
        const end = input.indexOf(next === '[' ? '\\]' : '\\)', index + 2)
        const value = end > index + 1 ? input.slice(index + 2, end) : ''
        if (value.trim() && (next === '[' || !isWhitespace(value[0]))) {
          flushText()
          segments.push({ kind: next === '[' ? 'display' : 'inline', value: value.trim() })
          index = end + 2
          continue
        }
      }
      text += char
      index += 1
      continue
    }
    if (char === '$') {
      if (input[index + 1] === '$') {
        const end = input.indexOf('$$', index + 2)
        const value = end > index + 2 ? input.slice(index + 2, end) : ''
        if (value.trim()) {
          flushText()
          segments.push({ kind: 'display', value: value.trim() })
          index = end + 2
          continue
        }
      } else {
        const end = findInlineEnd(input, index)
        if (end > 0) {
          flushText()
          segments.push({ kind: 'inline', value: input.slice(index + 1, end).trim() })
          index = end + 1
          continue
        }
      }
      text += char
      index += 1
      continue
    }
    text += char
    index += 1
  }
  flushText()
  return segments
}
