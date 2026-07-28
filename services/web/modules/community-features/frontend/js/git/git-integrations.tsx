import { FormEvent, useCallback, useEffect, useState } from "react";
import IntegrationCard from "@/features/integrations-panel/integration-card";
import MaterialIcon from "@/shared/components/material-icon";
import getMeta from "@/utils/meta";
import { useProjectContext } from "@/shared/context/project-context";
import { useIdeReactContext } from "@/features/ide-react/context/ide-react-context";
import { Modal } from "react-bootstrap";
import "../../stylesheets/git-integrations.scss";

type GitToken = {
  id: string;
  label: string;
  prefix: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type GitLabConnection = {
  remoteUrl: string;
  branch: string;
  username: string;
  lastSyncedCommit: string;
  lastSyncedAt: string;
};

type GitStatus = {
  gitBridgeEnabled: boolean;
  gitBridgeCloneUrl: string;
  gitLabAvailable: boolean;
  gitLabConnection: GitLabConnection | null;
  gitTokens: GitToken[];
};

const csrfToken = getMeta("ol-csrfToken");

async function requestJson(url: string, options: RequestInit = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
  return body;
}

export default function GitIntegrations() {
  const { projectId } = useProjectContext();
  const { permissionsLevel } = useIdeReactContext();
  const [view, setView] = useState<"catalog" | "git" | "gitlab">("catalog");
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [token, setToken] = useState("");
  const [tokenLabel, setTokenLabel] = useState("Local Git");
  const canAdminProject = permissionsLevel === "owner";

  const refresh = useCallback(async () => {
    setStatus(await requestJson(`/project/${projectId}/git/status`));
  }, [projectId]);

  useEffect(() => {
    refresh().catch((error) => setNotice(error.message));
  }, [refresh]);

  const mutate = async (
    path: string,
    body: Record<string, unknown>,
    success?: (result: Record<string, any>) => void,
  ) => {
    setBusy(true);
    setNotice("");
    try {
      const result = await requestJson(`/project/${projectId}/git${path}`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
          "x-requested-with": "XMLHttpRequest",
        },
        body: JSON.stringify({ ...body, _csrf: csrfToken }),
      });
      success?.(result);
      setNotice(result.message || "Operation completed.");
      await refresh();
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <IntegrationCard
        title="Git"
        description="Clone this project and sync its Git history."
        icon={<MaterialIcon type="account_tree" />}
        showPaywallBadge={false}
        onClick={() => {
          setNotice("");
          setView("git");
        }}
      />
      <IntegrationCard
        title="GitLab"
        description="Import, pull and push to a GitLab repository."
        icon={<MaterialIcon type="cloud_sync" />}
        showPaywallBadge={false}
        onClick={() => {
          setNotice("");
          setView("gitlab");
        }}
      />
      <Modal
        show={view !== "catalog"}
        onHide={() => {
          if (busy) return;
          setNotice("");
          setToken("");
          setView("catalog");
        }}
        size="xl"
        centered
        dialogClassName="community-git-integration-modal"
      >
        <Modal.Header closeButton>
          <Modal.Title>
            {view === "git" ? "Clone with Git" : "Sync with GitLab"}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {!status ? (
            <p>Loading…</p>
          ) : view === "git" ? (
            <GitBridgePanel
              status={status}
              busy={busy}
              token={token}
              tokenLabel={tokenLabel}
              setTokenLabel={setTokenLabel}
              createToken={() =>
                mutate("/tokens", { label: tokenLabel }, (result) =>
                  setToken(String(result.token || "")),
                )
              }
              revokeToken={(tokenId) => mutate(`/tokens/${tokenId}/revoke`, {})}
            />
          ) : (
            <GitLabPanel
              status={status}
              busy={busy}
              canAdminProject={canAdminProject}
              mutate={mutate}
            />
          )}
          {notice && (
            <div className="community-git-integration-notice" role="status">
              {notice}
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => {
              setNotice("");
              setToken("");
              setView("catalog");
            }}
          >
            Close
          </button>
        </Modal.Footer>
      </Modal>
    </>
  );
}

function GitBridgePanel({
  status,
  busy,
  token,
  tokenLabel,
  setTokenLabel,
  createToken,
  revokeToken,
}: {
  status: GitStatus;
  busy: boolean;
  token: string;
  tokenLabel: string;
  setTokenLabel: (value: string) => void;
  createToken: () => void;
  revokeToken: (tokenId: string) => void;
}) {
  if (!status.gitBridgeEnabled) {
    return <p className="community-git-integration-body">Git is disabled.</p>;
  }
  const cloneCommand = `git clone ${status.gitBridgeCloneUrl}`;
  return (
    <div className="community-git-integration-body">
      <p>
        The project exposes a single <code>master</code> branch. Pushes
        must be fast-forward.
      </p>
      <div className="form-label">Clone command</div>
      <div className="community-git-copy-row">
        <code>{cloneCommand}</code>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => navigator.clipboard.writeText(cloneCommand)}
        >
          Copy
        </button>
      </div>
      <p className="form-text">
        Username: <code>git</code>. Password: a token created below.
      </p>
      <label htmlFor="community-git-token-label">Token name</label>
      <input
        id="community-git-token-label"
        className="form-control"
        value={tokenLabel}
        maxLength={100}
        onChange={(event) => setTokenLabel(event.target.value)}
      />
      <button
        type="button"
        className="btn btn-primary btn-sm mt-2"
        disabled={busy}
        onClick={createToken}
      >
        Generate a token
      </button>
      {token && (
        <div className="alert alert-warning mt-2">
          <strong>Copy this token now.</strong>
          <code className="community-git-one-time-token">{token}</code>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => navigator.clipboard.writeText(token)}
          >
            Copy token
          </button>
        </div>
      )}
      <h6>Tokens</h6>
      {status.gitTokens.length === 0 ? (
        <p className="text-muted">No tokens.</p>
      ) : (
        <ul className="community-git-token-list">
          {status.gitTokens.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.label}</strong>
                <small>
                  {item.prefix}… · expires on {formatDate(item.expiresAt)}
                </small>
              </div>
              {!item.revokedAt && (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={busy}
                  onClick={() => revokeToken(item.id)}
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GitLabPanel({
  status,
  busy,
  canAdminProject,
  mutate,
}: {
  status: GitStatus;
  busy: boolean;
  canAdminProject: boolean;
  mutate: (
    path: string,
    body: Record<string, unknown>,
    success?: (result: Record<string, any>) => void,
  ) => Promise<void>;
}) {
  if (!status.gitLabAvailable) {
    return (
      <p className="community-git-integration-body">GitLab is disabled.</p>
    );
  }
  if (!canAdminProject) {
    return (
      <p className="community-git-integration-body">
        Only the project owner can configure GitLab
        synchronization.
      </p>
    );
  }
  if (status.gitLabConnection) {
    const connection = status.gitLabConnection;
    return (
      <div className="community-git-integration-body">
        <dl>
          <dt>Repository</dt>
          <dd>
            <code>{connection.remoteUrl}</code>
          </dd>
          <dt>Branch</dt>
          <dd>
            <code>{connection.branch}</code>
          </dd>
          <dt>Last commit</dt>
          <dd>
            <code>{connection.lastSyncedCommit.slice(0, 12)}</code>
          </dd>
          <dt>Synced</dt>
          <dd>{formatDate(connection.lastSyncedAt)}</dd>
        </dl>
        <p className="alert alert-info">
          In case of divergence, fetch the repository and resolve conflicts
          in your Git client.
        </p>
        <div className="d-flex gap-2 flex-wrap">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={() => mutate("/gitlab/pull", {})}
          >
            Pull from GitLab
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={() => mutate("/gitlab/push", {})}
          >
            Push to GitLab
          </button>
          <button
            type="button"
            className="btn btn-danger btn-sm"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  "Disconnect GitLab without changing files?",
                )
              ) {
                void mutate("/gitlab/disconnect", { confirmDisconnect: "yes" });
              }
            }}
          >
            Disconnect
          </button>
        </div>
      </div>
    );
  }
  return <GitLabConnectForm busy={busy} mutate={mutate} />;
}

function GitLabConnectForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (path: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void mutate("/gitlab/connect", {
      remoteUrl: data.get("remoteUrl"),
      branch: data.get("branch"),
      username: data.get("username"),
      token: data.get("token"),
      confirmImport: data.get("confirmImport"),
    });
  };
  return (
    <form className="community-git-integration-body" onSubmit={submit}>
      <p className="alert alert-warning">
        The first import replaces the project's current files.
      </p>
      <label htmlFor="community-gitlab-url">HTTPS repository</label>
      <input
        id="community-gitlab-url"
        className="form-control"
        type="url"
        name="remoteUrl"
        placeholder="https://gitlab.example/group/article.git"
        required
      />
      <label htmlFor="community-gitlab-branch">Branch</label>
      <input
        id="community-gitlab-branch"
        className="form-control"
        name="branch"
        defaultValue="master"
        required
      />
      <label htmlFor="community-gitlab-username">Git username</label>
      <input
        id="community-gitlab-username"
        className="form-control"
        name="username"
        defaultValue="oauth2"
        required
      />
      <label htmlFor="community-gitlab-token">Access token</label>
      <input
        id="community-gitlab-token"
        className="form-control"
        type="password"
        name="token"
        autoComplete="new-password"
      />
      <label className="community-git-confirmation">
        <input type="checkbox" name="confirmImport" value="yes" required />
        I confirm the initial replacement of the project files.
      </label>
      <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>
        Connect and import
      </button>
    </form>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
