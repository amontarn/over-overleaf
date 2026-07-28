import { useState } from 'react'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import { OVER_OVERLEAF_LOGO_URL } from '@/shared/utils/branding'

export function AboutOverOverleafModal({
  show,
  onHide,
}: {
  show: boolean
  onHide: () => void
}) {
  return (
    <>
      <OLModal
        show={show}
        onHide={onHide}
        id="about-over-overleaf-modal"
        size="lg"
      >
        <OLModalHeader>
          <OLModalTitle>About Over-Overleaf</OLModalTitle>
        </OLModalHeader>
        <OLModalBody>
          <img
            src={OVER_OVERLEAF_LOGO_URL}
            alt="Over-Overleaf"
            width="112"
            height="112"
            className="d-block mx-auto mb-4"
          />
          <p>
            Overleaf Community Edition is an open-source collaborative LaTeX
            platform, developed in the official{' '}
            <a
              href="https://github.com/overleaf/overleaf"
              target="_blank"
              rel="noopener noreferrer"
            >
              overleaf/overleaf
            </a>{' '}
            monorepo.
          </p>
          <p>
            Over-Overleaf is an extension of that monorepo. It adds multi-user
            administration, track changes, Git and GitLab connectors, and a
            configurable AI assistant.
          </p>
          <p className="mb-0">
            The source code and the history of the adaptations are available in
            the{' '}
            <a
              href="https://github.com/amontarn/over-overleaf"
              target="_blank"
              rel="noopener noreferrer"
            >
              amontarn/over-overleaf
            </a>{' '}
            repository.
          </p>
        </OLModalBody>
        <OLModalFooter>
          <OLButton variant="secondary" onClick={onHide}>
            Close
          </OLButton>
        </OLModalFooter>
      </OLModal>
    </>
  )
}

export default function AboutOverOverleaf() {
  const [show, setShow] = useState(false)

  return (
    <>
      <a
        href="#about-over-overleaf"
        onClick={event => {
          event.preventDefault()
          setShow(true)
        }}
      >
        About
      </a>
      <AboutOverOverleafModal show={show} onHide={() => setShow(false)} />
    </>
  )
}
