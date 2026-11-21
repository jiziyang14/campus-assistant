import logoUrl from '../../assets/logo-small.svg'

/** 校园助手 Logo：界面里以 30px 左右展示，使用网友绘制的「大肥鱼」头像版 */
export const AppLogo = ({ size = 30, className }: { size?: number; className?: string }) => (
  <img
    className={className}
    src={logoUrl}
    width={size}
    height={size}
    alt=""
    draggable={false}
    aria-hidden="true"
  />
)
