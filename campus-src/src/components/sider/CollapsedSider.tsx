import { IconPanelLeftOutline16, NewChatIcon } from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { newChat } from '../../services/chat/store.js'
import { openCampusPanel } from '../campus/campusPanelState.js'
import { IconButton } from '../base/IconButton.js'
import styles from './Sider.module.css'

/** 收起后左上角的按钮组 */
export const CollapsedSider = () => {
  const t = useTranslate()
  return (
    <div className={styles.collapsed}>
      <div className={styles.collapsedGroup}>
        <IconButton
          size="m"
          tone="primary"
          icon={<IconPanelLeftOutline16 />}
          tooltip={t('expandSiderbarButton')}
          onClick={() => setSiderCollapsed(false)}
        />
        <IconButton
          size="m"
          tone="primary"
          icon={<NewChatIcon />}
          tooltip={t('newChat')}
          onClick={newChat}
        />
        <IconButton
          size="m"
          tone="primary"
          icon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="2.2" y="2.2" width="4.6" height="4.6" stroke="currentColor" strokeWidth="1.2" />
              <rect x="9.2" y="2.2" width="4.6" height="4.6" stroke="currentColor" strokeWidth="1.2" />
              <rect x="2.2" y="9.2" width="4.6" height="4.6" stroke="currentColor" strokeWidth="1.2" />
              <rect x="9.2" y="9.2" width="4.6" height="4.6" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          }
          tooltip={t('shortcuts')}
          onClick={openCampusPanel}
        />
      </div>
    </div>
  )
}
