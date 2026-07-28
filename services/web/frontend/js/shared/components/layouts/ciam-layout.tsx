import React, { FC, ReactNode } from 'react'

type Props = { children: ReactNode }

const CiamLayout: FC<Props> = ({ children }: Props) => (
  <div className="ciam-layout ciam-enabled">
    <header className="ciam-logo">
      <a href="/" className="brand overleaf-ds-logo ciam-image-link">
        <span className="visually-hidden">Overleaf</span>
      </a>
    </header>
    <div className="ciam-container">
      <main className="ciam-card" id="main-content">
        {children}
      </main>
    </div>
    <footer>
      <div className="footer-links">
        <a href="https://www.overleaf.com/legal#Privacy">Privacy</a>
        <a href="https://www.overleaf.com/legal#Terms">Terms</a>
      </div>
    </footer>
  </div>
)

export default CiamLayout
