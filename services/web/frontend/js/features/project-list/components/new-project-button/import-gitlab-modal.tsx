import { useState } from 'react'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import OLForm from '@/shared/components/ol/ol-form'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import Notification from '@/shared/components/notification'
import useAsync from '@/shared/hooks/use-async'
import {
  getUserFacingMessage,
  postJSON,
} from '@/infrastructure/fetch-json'

type ImportResult = {
  project_id: string
  commit: string
}

type ImportGitLabModalProps = {
  onHide: () => void
  openProject: (projectId: string) => void
}

export default function ImportGitLabModal({
  onHide,
  openProject,
}: ImportGitLabModalProps) {
  const [projectName, setProjectName] = useState('')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [branch, setBranch] = useState('main')
  const [username, setUsername] = useState('oauth2')
  const [token, setToken] = useState('')
  const [redirecting, setRedirecting] = useState(false)
  const { isLoading, isError, error, runAsync } = useAsync<ImportResult>()

  const submit = (event?: React.FormEvent) => {
    event?.preventDefault()
    runAsync(
      postJSON<ImportResult>('/project/new/import-gitlab', {
        body: { projectName, remoteUrl, branch, username, token },
      })
    )
      .then(result => {
        setRedirecting(true)
        openProject(result.project_id)
      })
      .catch(() => {})
  }

  const disabled =
    !projectName.trim() ||
    !remoteUrl.trim() ||
    !branch.trim() ||
    isLoading ||
    redirecting

  return (
    <OLModal
      show
      animation
      onHide={onHide}
      id="import-gitlab-project-modal"
      backdrop="static"
      size="lg"
    >
      <OLModalHeader>
        <OLModalTitle>Import a GitLab project</OLModalTitle>
      </OLModalHeader>
      <OLModalBody>
        {isError && (
          <Notification
            type="error"
            content={getUserFacingMessage(error) as string}
          />
        )}
        <Notification
          type="info"
          content="A new Over-Overleaf project will be created from the given branch. The token is encrypted and will not be shown again after the import."
        />
        <OLForm onSubmit={submit}>
          <OLFormGroup controlId="gitlab-import-project-name">
            <OLFormLabel>Project name</OLFormLabel>
            <OLFormControl
              value={projectName}
              onChange={event => setProjectName(event.currentTarget.value)}
              maxLength={150}
              required
            />
          </OLFormGroup>
          <OLFormGroup controlId="gitlab-import-remote-url">
            <OLFormLabel>GitLab repository HTTPS URL</OLFormLabel>
            <OLFormControl
              type="url"
              value={remoteUrl}
              onChange={event => setRemoteUrl(event.currentTarget.value)}
              placeholder="https://gitlab.example.org/equipe/article.git"
              required
            />
          </OLFormGroup>
          <OLFormGroup controlId="gitlab-import-branch">
            <OLFormLabel>Branch</OLFormLabel>
            <OLFormControl
              value={branch}
              onChange={event => setBranch(event.currentTarget.value)}
              required
            />
          </OLFormGroup>
          <OLFormGroup controlId="gitlab-import-username">
            <OLFormLabel>Git username</OLFormLabel>
            <OLFormControl
              value={username}
              onChange={event => setUsername(event.currentTarget.value)}
              autoComplete="username"
            />
          </OLFormGroup>
          <OLFormGroup controlId="gitlab-import-token">
            <OLFormLabel>Access token</OLFormLabel>
            <OLFormControl
              type="password"
              value={token}
              onChange={event => setToken(event.currentTarget.value)}
              autoComplete="new-password"
            />
            <div className="form-text">
              Leave this field empty only for a public repository. The token
              must allow reading the repository, and writing for future
              pushes.
            </div>
          </OLFormGroup>
        </OLForm>
      </OLModalBody>
      <OLModalFooter>
        <OLButton variant="secondary" onClick={onHide} disabled={isLoading}>
          Cancel
        </OLButton>
        <OLButton
          variant="primary"
          onClick={() => submit()}
          disabled={disabled}
          isLoading={isLoading || redirecting}
          loadingLabel="Importing…"
        >
          Import
        </OLButton>
      </OLModalFooter>
    </OLModal>
  )
}
