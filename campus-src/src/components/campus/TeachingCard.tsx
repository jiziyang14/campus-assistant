import { useTranslate } from '../../i18n/index.js'
import styles from './TeachingCard.module.css'

/** 快捷面板里的「讲题」主卡片：拍照或输入题目，AI 分步讲解后直接全屏放映 */
export const TeachingCard = ({
  onTakePhoto,
  onType,
}: {
  onTakePhoto: () => void
  onType: () => void
}) => {
  const t = useTranslate()
  return (
    <div className={styles.card} role="group" aria-label={t('campusTeachTitle')}>
      <svg className={styles.art} viewBox="0 0 200 160" fill="none" aria-hidden="true">
        <text x="4" y="28" className={styles.watermark}>
          ax² + bx + c = 0
        </text>
        <text x="10" y="152" className={styles.watermark}>
          x = (−b ± √Δ) / 2a
        </text>
        <g transform="rotate(-5 108 88)">
          <rect
            x="50"
            y="34"
            width="114"
            height="104"
            rx="12"
            className={styles.paper}
          />
          <rect x="66" y="52" width="54" height="6" rx="3" className={styles.paperLine} />
          <rect x="66" y="66" width="82" height="6" rx="3" className={styles.paperLine} />
          <rect x="66" y="80" width="64" height="6" rx="3" className={styles.paperLine} />
          <text x="66" y="110" className={styles.formula}>
            x² + bx + c = 0
          </text>
          <path d="M66 122h78" className={styles.penLine} />
        </g>
        <path
          d="M36 60V48a8 8 0 0 1 8-8h12"
          className={styles.focusFrame}
        />
        <path
          d="M176 60V48a8 8 0 0 0-8-8h-12"
          className={styles.focusFrame}
        />
        <path
          d="M36 120v12a8 8 0 0 0 8 8h12"
          className={styles.focusFrame}
        />
        <path
          d="M176 120v12a8 8 0 0 1-8 8h-12"
          className={styles.focusFrame}
        />
        <circle cx="164" cy="124" r="4" className={styles.recordDot} />
      </svg>

      <div className={styles.body}>
        <span className={styles.tag}>{t('campusTeachTag')}</span>
        <div className={styles.title}>{t('campusTeachTitle')}</div>
        <p className={styles.desc}>{t('campusTeachDesc')}</p>
        <ol className={styles.steps}>
          <li>
            <span className={styles.stepNo}>1</span>
            {t('campusTeachStepPhoto')}
          </li>
          <li>
            <span className={styles.stepNo}>2</span>
            {t('campusTeachStepExplain')}
          </li>
          <li>
            <span className={styles.stepNo}>3</span>
            {t('campusTeachStepDeck')}
          </li>
        </ol>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={onTakePhoto}>
            <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path
                d="M1.8 5.4h2.6l1.2-2h6.8l1.2 2h2.6v8.8H1.8V5.4Z"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <circle cx="9" cy="9.4" r="2.6" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            {t('campusTeachTakePhoto')}
          </button>
          <button type="button" className={styles.secondary} onClick={onType}>
            {t('campusTeachType')}
          </button>
        </div>
      </div>
    </div>
  )
}
