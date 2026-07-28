import classNames from 'classnames'
import { OVER_OVERLEAF_LOGO_URL } from '@/shared/utils/branding'

type InterstitialProps = {
  className?: string
  contentClassName?: string
  children: React.ReactNode
  showLogo: boolean
  title?: string
}

export function Interstitial({
  className,
  contentClassName,
  children,
  showLogo,
  title,
}: InterstitialProps) {
  return (
    <div className={classNames('interstitial', className)}>
      {showLogo && (
        <img
          className="logo"
          src={OVER_OVERLEAF_LOGO_URL}
          alt="Over-Overleaf"
        />
      )}
      {title && <h1 className="h3 interstitial-header">{title}</h1>}
      <div className={classNames(contentClassName)}>{children}</div>
    </div>
  )
}
