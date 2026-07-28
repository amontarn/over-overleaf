import { expect } from 'chai'
import { createDeletedTextElement } from '@/features/source-editor/extensions/changes/deleted-text'

describe('createDeletedTextElement', function () {
  it('renders deleted content as highlighted tracked text', function () {
    const element = createDeletedTextElement('removed LaTeX')

    expect(element.tagName).to.equal('DEL')
    expect(element.textContent).to.equal('removed LaTeX')
    expect(element.classList.contains('ol-cm-change')).to.equal(true)
    expect(element.classList.contains('ol-cm-change-d')).to.equal(true)
  })

  it('does not interpret deleted content as HTML', function () {
    const element = createDeletedTextElement('<img src=x onerror=alert(1)>')

    expect(element.children).to.have.length(0)
    expect(element.textContent).to.equal('<img src=x onerror=alert(1)>')
  })
})
