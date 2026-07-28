import { expect } from 'chai'
import { render } from '@testing-library/react'

import SafeMarkdown, {
  renderSafeMarkdown,
} from '../../../../modules/community-features/frontend/js/ai/safe-markdown'

describe('<SafeMarkdown />', function () {
  it('renders useful Markdown without executing code blocks', function () {
    const { container } = render(
      <SafeMarkdown content={'**Texte**\n\n```html\n<script>alert(1)</script>\n```'} />
    )

    expect(container.querySelector('strong')?.textContent).to.equal('Texte')
    expect(container.querySelector('pre code')?.textContent).to.equal(
      '<script>alert(1)</script>\n'
    )
    expect(container.querySelector('script')).to.equal(null)
  })

  it('blocks active HTML, images, event handlers, and dangerous links', function () {
    const html = renderSafeMarkdown(
      '<img src=x onerror=alert(1)>\n\n[attaque](javascript:alert(1))'
    )
    const { container } = render(
      <div dangerouslySetInnerHTML={{ __html: html }} />
    )

    expect(container.querySelector('img')).to.equal(null)
    expect(container.querySelector('script')).to.equal(null)
    expect(container.querySelector('[onerror]')).to.equal(null)
    expect(container.querySelector('a')?.hasAttribute('href')).to.equal(false)
  })

  it('hardens HTTPS links opened from an AI response', function () {
    const { container } = render(
      <SafeMarkdown content="[documentation](https://example.com/docs)" />
    )
    const link = container.querySelector('a')

    expect(link?.getAttribute('href')).to.equal('https://example.com/docs')
    expect(link?.getAttribute('target')).to.equal('_blank')
    expect(link?.getAttribute('rel')).to.equal(
      'nofollow noreferrer noopener'
    )
  })
})
