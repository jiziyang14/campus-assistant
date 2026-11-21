import clsx from 'clsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { ApiError } from '../../services/api/client.js'
import { recognizeFile } from '../../services/api/ocr.js'
import { useSettings } from '../../services/settings.js'
import {
  analyzeTable,
  buildMarkedDeck,
  collectHandwrittenNames,
  detectNameColumn,
  getColumnLabel,
  parseTableRows,
  resolveMarkedRecords,
  uniqueNames,
  type HandwrittenItem,
  type MarkedCell,
} from '../../services/campus/tableExtract.js'
import type { Deck } from '../../services/campus/deck.js'
import { showToast } from '../base/toastState.js'
import { DeckViewer } from './DeckViewer.js'
import styles from './TableExtractDialog.module.css'

type Stage = 'ocr' | 'mark' | 'confirm' | 'error'
type Item = { id: string; name: string; checked: boolean; source: 'mark' | 'hand' | 'manual' }

/**
 * 表格提取：OCR 取结构 → 视觉模型找被标记的格子 → 人工确认 → 生成放映稿
 * 支持深色底、彩色底、彩色文字等标记；姓名列可手动指定
 */
export const TableExtractDialog = ({
  file,
  onClose,
  onUseVision,
}: {
  file: File
  onClose: () => void
  onUseVision: () => void
}) => {
  const t = useTranslate()
  const [stage, setStage] = useState<Stage>('ocr')
  const [error, setError] = useState<string | null>(null)
  const [markFailed, setMarkFailed] = useState(false)
  const [cells, setCells] = useState<MarkedCell[]>([])
  const [handwritten, setHandwritten] = useState<HandwrittenItem[]>([])
  const [notes, setNotes] = useState('')
  const [rows, setRows] = useState<string[][]>([])
  const [nameColumn, setNameColumn] = useState(0)
  const [items, setItems] = useState<Item[]>([])
  const [meaning, setMeaning] = useState(() => t('tableDefaultMeaning'))
  const [manual, setManual] = useState('')
  const [deck, setDeck] = useState<Deck | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)
  const cancelled = useRef(false)

  const describeError = useCallback((value: unknown): TranslationKey => {
    if (value instanceof ApiError && value.status === 402) {
      return 'tableOcrBalance'
    }
    if (value instanceof ApiError && value.status === 429) {
      return 'tableOcrLimit'
    }
    return 'tableOcrFailed'
  }, [])

  const columnFallback = useCallback(
    (col: number) => getColumnLabel(rows, col, t('tableColumnN', { index: col + 1 })),
    [rows, t]
  )

  const records = useMemo(
    () => resolveMarkedRecords(cells, rows, nameColumn, columnFallback, handwritten),
    [cells, rows, nameColumn, columnFallback, handwritten]
  )

  const scan = useCallback(async () => {
    cancelled.current = false
    setError(null)
    setMarkFailed(false)
    setMeaning(t('tableDefaultMeaning'))
    setNotes('')
    setHandwritten([])
    setStage('ocr')
    try {
      const ocr = await recognizeFile(
        useSettings.getState().apiKey ?? '',
        file,
        'rich_layout_recognition'
      )
      if (cancelled.current) {
        return
      }
      const tableRows = parseTableRows(ocr.text)
      const initialColumn = detectNameColumn(tableRows)
      setRows(tableRows)
      setNameColumn(initialColumn)
      setStage('mark')
      let analysis = { meaning: '', marked: [] as MarkedCell[], handwritten: [] as HandwrittenItem[], notes: '' }
      try {
        analysis = await analyzeTable(useSettings.getState().apiKey ?? '', file, ocr.text)
      } catch {
        if (cancelled.current) {
          return
        }
        setMarkFailed(true)
      }
      if (cancelled.current) {
        return
      }
      setCells(analysis.marked)
      setHandwritten(analysis.handwritten)
      setNotes(analysis.notes)
      if (analysis.meaning) {
        setMeaning(analysis.meaning)
      }
      const nextRecords = resolveMarkedRecords(
        analysis.marked,
        tableRows,
        initialColumn,
        (col) => getColumnLabel(tableRows, col, t('tableColumnN', { index: col + 1 })),
        analysis.handwritten
      )
      const markNames = uniqueNames(nextRecords)
      const handNames = collectHandwrittenNames(analysis.handwritten, nextRecords, [
        analysis.meaning,
        t('tableDefaultMeaning'),
        t('tableMeaningFocus'),
        t('tableMeaningUnsubmitted'),
        t('tableMeaningExcellent'),
      ])
      setItems([
        ...markNames.map((name) => ({
          id: crypto.randomUUID(),
          name,
          checked: true,
          source: 'mark' as const,
        })),
        ...handNames.map((name) => ({
          id: crypto.randomUUID(),
          name,
          checked: false,
          source: 'hand' as const,
        })),
      ])
      setStage('confirm')
    } catch (value) {
      if (cancelled.current) {
        return
      }
      setError(t(describeError(value)))
      setStage('error')
    }
  }, [describeError, file, t])

  useEffect(() => {
    void scan()
    return () => {
      cancelled.current = true
    }
  }, [scan])

  const changeNameColumn = (index: number) => {
    setNameColumn(index)
    const nextRecords = resolveMarkedRecords(cells, rows, index, (col) =>
      getColumnLabel(rows, col, t('tableColumnN', { index: col + 1 })), handwritten)
    const names = uniqueNames(nextRecords)
    setItems((current) => {
      const kept = current.filter(
        (item) => !records.some((record) => record.name === item.name) && !names.includes(item.name)
      )
      return [
        ...names.map((name) => ({
          id: current.find((item) => item.name === name)?.id ?? crypto.randomUUID(),
          name,
          checked: current.find((item) => item.name === name)?.checked ?? true,
          source: 'mark' as const,
        })),
        ...kept,
      ]
    })
  }

  const styleLabel = (style: string) => {
    if (style.startsWith('dark') || style.startsWith('black')) {
      return t('tableStyleDark')
    }
    if (style === 'red') {
      return t('tableStyleRed')
    }
    return t('tableStyleOther')
  }

  const infoFor = (name: string) => {
    const list = records.filter((record) => record.name === name && record.column)
    if (list.length === 0) {
      return ''
    }
    const first = list[0]
    const more = list.length > 1 ? t('tableMorePlaces', { count: list.length }) : ''
    return `${first.column} ${first.value} · ${styleLabel(first.style)}${more}`
  }

  const addName = () => {
    const name = manual.trim()
    if (!name) {
      return
    }
    setItems((current) =>
      current.some((item) => item.name === name)
        ? current
        : [...current, { id: crypto.randomUUID(), name, checked: true, source: 'manual' as const }]
    )
    setManual('')
  }

  const selected = items.filter((item) => item.checked && item.name.trim())
  const total = rows.length > 0 ? Math.max(rows.length - 1, selected.length) : 0

  const generate = () => {
    if (selected.length === 0) {
      showToast(t('tableNoSelection'))
      return
    }
    const checked = new Set(selected.map((item) => item.name.trim()))
    const selectedRecords = records.filter((record) => checked.has(record.name))
    for (const name of checked) {
      if (!selectedRecords.some((record) => record.name === name)) {
        selectedRecords.push({ row: 0, col: 0, name, column: '', value: '', style: 'other' })
      }
    }
    const next = buildMarkedDeck(
      meaning.trim() || t('tableDefaultMeaning'),
      selectedRecords,
      total
    )
    setDeck(next)
    const target = document.documentElement
    if (target.requestFullscreen) {
      void target.requestFullscreen().catch(() => {})
    }
    setViewerOpen(true)
  }

  if (viewerOpen && deck) {
    return (
      <DeckViewer
        deck={deck}
        onClose={() => {
          setViewerOpen(false)
          onClose()
        }}
      />
    )
  }

  const presets = [
    t('tableDefaultMeaning'),
    t('tableMeaningFocus'),
    t('tableMeaningUnsubmitted'),
    t('tableMeaningExcellent'),
  ]

  return (
    <div className={styles.mask} onClick={stage === 'confirm' ? undefined : onClose}>
      <div
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-label={t('campusTable')}
        onClick={(event) => event.stopPropagation()}
      >
        {stage === 'ocr' || stage === 'mark' ? (
          <div className={styles.center}>
            <div className={styles.title}>{t('campusTable')}</div>
            <p className={styles.hint}>
              {stage === 'ocr' ? t('tableStageOcr') : t('tableStageMark')}
            </p>
            <div className={styles.spinner} aria-hidden="true" />
            <button type="button" className={styles.secondary} onClick={onClose}>
              {t('cancel')}
            </button>
          </div>
        ) : null}

        {stage === 'error' ? (
          <div className={styles.center}>
            <div className={styles.title}>{t('campusTable')}</div>
            <p className={styles.error}>{error ?? t('tableOcrFailed')}</p>
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} onClick={onClose}>
                {t('cancel')}
              </button>
              <button type="button" className={styles.secondary} onClick={onUseVision}>
                {t('tableOcrUseVision')}
              </button>
              <button type="button" className={styles.primary} onClick={() => void scan()}>
                {t('tableOcrRetry')}
              </button>
            </div>
          </div>
        ) : null}

        {stage === 'confirm' ? (
          <>
            <div className={styles.title}>{t('tableMarkTitle')}</div>

            <div className={styles.fields}>
              <label className={styles.meaning}>
                <span>{t('tableMarkMeaning')}</span>
                <input
                  value={meaning}
                  onChange={(event) => setMeaning(event.target.value)}
                  maxLength={12}
                />
              </label>
              {rows.length > 0 && (rows[0]?.length ?? 0) > 1 ? (
                <label className={styles.meaning}>
                  <span>{t('tableMarkNameColumn')}</span>
                  <select
                    value={nameColumn}
                    onChange={(event) => changeNameColumn(Number(event.target.value))}
                  >
                    {rows[0].map((label, index) => (
                      <option key={index} value={index}>
                        {label || t('tableColumnN', { index: index + 1 })}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>

            <div className={styles.presets}>
              {presets.map((label) => (
                <button
                  key={label}
                  type="button"
                  className={clsx(styles.chip, meaning === label && styles.chipOn)}
                  onClick={() => setMeaning(label)}
                >
                  {label}
                </button>
              ))}
            </div>

            {notes ? (
              <p className={styles.handNote}>{t('tableHandNotes', { text: notes })}</p>
            ) : null}

            {markFailed ? <p className={styles.warn}>{t('tableMarkFailed')}</p> : null}
            {items.length === 0 ? <p className={styles.hint}>{t('tableMarkNone')}</p> : null}

            {items.length > 0 ? (
              <div className={styles.list}>
                {items.map((item) => {
                  const info = infoFor(item.name) || (item.source === 'hand' ? t('tableHandName') : '')
                  return (
                    <div key={item.id} className={styles.row}>
                      <input
                        type="checkbox"
                        checked={item.checked}
                        onChange={(event) =>
                          setItems((current) =>
                            current.map((entry) =>
                              entry.id === item.id
                                ? { ...entry, checked: event.target.checked }
                                : entry
                            )
                          )
                        }
                      />
                      <input
                        className={styles.name}
                        value={item.name}
                        onChange={(event) =>
                          setItems((current) =>
                            current.map((entry) =>
                              entry.id === item.id ? { ...entry, name: event.target.value } : entry
                            )
                          )
                        }
                        maxLength={24}
                      />
                      {info ? <span className={styles.info}>{info}</span> : null}
                    </div>
                  )
                })}
              </div>
            ) : null}

            <div className={styles.addRow}>
              <input
                value={manual}
                placeholder={t('tableMarkPlaceholder')}
                onChange={(event) => setManual(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addName()
                  }
                }}
                maxLength={24}
              />
              <button type="button" className={styles.secondary} onClick={addName}>
                {t('tableMarkAdd')}
              </button>
            </div>

            <div className={styles.foot}>
              <span className={styles.count}>{t('tableMarkCount', { count: selected.length })}</span>
              <button type="button" className={styles.secondary} onClick={onClose}>
                {t('cancel')}
              </button>
              <button
                type="button"
                className={styles.primary}
                disabled={selected.length === 0}
                onClick={generate}
              >
                {t('tableGenerate')}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
