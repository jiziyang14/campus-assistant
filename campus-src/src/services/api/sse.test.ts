import { describe, expect, it } from 'vitest'
import { ServerSentEventDecoder, readServerSentEvents } from './sse.js'

const collect = async (chunks: string[], signal?: AbortSignal) => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
  const events = []
  for await (const event of readServerSentEvents(stream, signal)) {
    events.push(event)
  }
  return events
}

describe('ServerSentEventDecoder', () => {
  it('parses fields and dispatches on a blank line', () => {
    const decoder = new ServerSentEventDecoder()
    expect(decoder.push('event: message\nid: 7\ndata: hello\n\n')).toEqual([
      { event: 'message', data: 'hello', lastEventId: '7' },
    ])
  })

  it('joins multi-line data with newlines', () => {
    const decoder = new ServerSentEventDecoder()
    expect(decoder.push('data: one\ndata: two\n\n')).toEqual([
      { event: 'message', data: 'one\ntwo', lastEventId: '' },
    ])
  })

  it('waits for the second half of a CRLF split across chunks', () => {
    const decoder = new ServerSentEventDecoder()
    expect(decoder.push('data: hello\r')).toEqual([])
    expect(decoder.push('\n\r\n')).toEqual([
      { event: 'message', data: 'hello', lastEventId: '' },
    ])
  })

  it('ignores comments and fields without data', () => {
    const decoder = new ServerSentEventDecoder()
    expect(decoder.push(': keep-alive\nevent: ping\n\n')).toEqual([])
    expect(decoder.push('data: ok\n\n')).toEqual([
      { event: 'message', data: 'ok', lastEventId: '' },
    ])
  })

  it('drops a trailing CR event that never ends with a blank line', () => {
    const decoder = new ServerSentEventDecoder()
    expect(decoder.push('data: tail\r')).toEqual([])
    expect(decoder.end()).toEqual([])
  })

  it('drops an event that never ends with a blank line', () => {
    const decoder = new ServerSentEventDecoder()
    expect(decoder.push('data: unfinished\n')).toEqual([])
    expect(decoder.end()).toEqual([])
  })
})

describe('readServerSentEvents', () => {
  it('decodes UTF-8 split across chunks and removes a BOM', async () => {
    const encoder = new TextEncoder()
    const bytes = encoder.encode('\uFEFFdata: 校园\n\n')
    const split = Math.floor(bytes.length / 2)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, split))
        controller.enqueue(bytes.slice(split))
        controller.close()
      },
    })
    const events = []
    for await (const event of readServerSentEvents(stream)) {
      events.push(event)
    }
    expect(events).toEqual([{ event: 'message', data: '校园', lastEventId: '' }])
  })

  it('stops reading when the signal is aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(collect(['data: never\n\n'], controller.signal)).rejects.toThrow()
  })
})
