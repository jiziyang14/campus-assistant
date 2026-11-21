import { Fragment, memo, useMemo } from 'react'
import { splitDeckMath } from '../../services/campus/deckMath.js'
import { InlineMath, MathBlock } from '../markdown/MathFormula.js'

/** 放映文本：把 $...$、$$...$$、\(...\)、\[...\] 里的 LaTeX 交给 KaTeX 渲染 */
export const DeckText = memo(function DeckText({ text }: { text: string }) {
  const segments = useMemo(() => splitDeckMath(text), [text])
  if (!segments.some((segment) => segment.kind !== 'text')) {
    return <>{text}</>
  }
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === 'text') {
          return <Fragment key={index}>{segment.value}</Fragment>
        }
        if (segment.kind === 'inline') {
          return <InlineMath key={index} value={segment.value} />
        }
        return <MathBlock key={index} value={segment.value} />
      })}
    </>
  )
})
