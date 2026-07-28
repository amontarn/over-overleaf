<p align="center">
  <img src="doc/over-overleaf-logo.png" alt="Over-Overleaf logo" width="260">
</p>

<h1 align="center">Over-Overleaf</h1>

<p align="center">
  An Overleaf Community Edition distribution extended for collaboration,
  reviewing, Git, GitLab and self-hosted AI assistance.
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#added-features">Features</a> ·
  <a href="#deployment">Deployment</a> ·
  <a href="#security">Security</a>
</p>

## About

Over-Overleaf builds on the official
[`overleaf/overleaf`](https://github.com/overleaf/overleaf) repository — the
Overleaf Community Edition monorepo — rather than a re-implementation of the
editor.

The exact base is commit
[`28ad3b03b71cb4311decdcb55c36b33ec10d72db`](https://github.com/overleaf/overleaf/commit/28ad3b03b71cb4311decdcb55c36b33ec10d72db).
The current repository is published at
[`amontarn/over-overleaf`](https://github.com/amontarn/over-overleaf.git). The
upstream Git history is preserved; the work described here is added on top of
that base.

Over-Overleaf keeps Overleaf's native building blocks — the React and CodeMirror
editor, real-time collaboration, history, MongoDB, Redis and LaTeX compilation —
and then adds targeted Community Edition modules. Project formats, native sharing
and simultaneous editing therefore remain those of Overleaf.

> [!IMPORTANT]
> This project is not an official Overleaf edition and is not supported by the
> Overleaf team. The original trademarks and code remain the property of their
> respective owners.

## Added features

### Users and administration

- an administration panel integrated into **Community Features**;
- creating a user with a controlled, single-use activation link;
- suspending and re-enabling an account;
- revoking all of a user's sessions;
- deleting an account, handling its projects;
- native project sharing with owner, editor, reviewer and read-only roles.

### Reviewing and track changes

- enabling track changes in Community Edition;
- coloured insertions and struck-through deletions in the editor;
- comments, replies, editing, resolving and reopening threads;
- synchronising changes across connected users;
- accepting changes according to Overleaf permissions;
- generating a review PDF with insertions and deletions visible, without
  modifying the project sources.

### Single-branch Git

- a Git Bridge written entirely in Node.js — no Java, Maven or JGit;
- a persistent bare repository per project with full Git history;
- clone, fetch and push over Smart HTTP;
- revocable personal tokens, stored only as a hash;
- a single `master` branch;
- materialising the latest online changes before Git exchanges;
- pushes accepted only when fast-forward;
- no conflict-resolution UI: the contributor must fetch the remote state,
  resolve locally and push again;
- a **Git** card in the native **Integrations** panel, opening a large central
  modal for the clone command and token management.

### GitLab connector

- explicit connection to an HTTPS GitLab-compatible repository;
- creating and directly importing an existing repository from the **New
  project** menu;
- initial import of a branch into an already-created Overleaf project;
- manual pull and push with a distributed lock;
- keeping history in the GitLab repository;
- rejecting divergences instead of automatic resolution;
- an encrypted GitLab token, never returned to the browser;
- a **GitLab** card in **Integrations**, with connect, sync and disconnect in a
  large central modal.

The Git Bridge and the GitLab connector are complementary: the first exposes
Overleaf as a permanent Git remote; the second explicitly synchronises a
repository hosted elsewhere.

### Identity and provenance

- use of the Over-Overleaf logo in the interface, editor, loading screens,
  invitations, emails and social metadata;
- removal of the Digital Science co-branding from public screens;
- an **About** link in the public and authenticated footers, and in the editor
  Help menu, opening a window that references the original Overleaf monorepo and
  the Over-Overleaf repository.

### OpenAI-compatible AI assistant

- a server catalog administered from `/admin/community/ai`;
- configuration limited to the host/API and the access key;
- automatic `/v1` suffix when only the host is provided;
- connection testing and model discovery via `GET /models`;
- refreshing the list after installing a new model;
- support for OpenAI-compatible APIs and an internal Ollama;
- per-user, per-project server and model selection;
- explicit consent, disabled by default for each project;
- a warning showing the origin the data will be sent to;
- a chatbot integrated into the editor rail;
- streamed responses with a waiting animation;
- optional and bounded project context;
- a **Quote in the AI assistant** action in a selection's menu;
- copy, insert at cursor, or controlled replacement of a selection;
- a fresh, empty conversation after changing model or requesting a new
  conversation;
- no conversation persisted in MongoDB, Redis or the HTTP session.

## Architecture at a glance

| Service      | Role                                                                      |
| ------------ | ------------------------------------------------------------------------- |
| `sharelatex` | Web application, editor, administration, reviewing, AI and internal APIs  |
| `git-bridge` | Git Smart HTTP remote, bare repositories and fast-forward enforcement     |
| `mongo`      | projects, accounts, configuration and extension metadata                  |
| `redis`      | sessions, locks and real-time communication                               |

Persistent data for the local Compose setup is stored in:

- `~/sharelatex_data` for Overleaf;
- `~/mongo_data` for MongoDB;
- `~/redis_data` for Redis;
- `~/git_bridge_data` for the Git repositories.

## Quick start

### Prerequisites

- Git;
- Docker Engine or Docker Desktop;
- Docker Compose v2 (`docker compose`);
- ports `80` and `8000` available, or alternative ports configured in `.env`.

### 1. Get the project

```bash
git clone https://github.com/amontarn/over-overleaf.git
cd over-overleaf
```

### 2. Configure secrets

Startup is refused without the required secrets, so create the environment file
before building:

```bash
cp .env.example .env
```

Generate four different values and set them in `.env`:

```bash
openssl rand -base64 48   # OVERLEAF_EXTENSIONS_SECRET
openssl rand -base64 48   # OVERLEAF_INVITE_TOKEN_SECRET
openssl rand -base64 48   # OVERLEAF_SESSION_SECRET
openssl rand -base64 48   # OVERLEAF_GIT_BRIDGE_INTERNAL_SECRET
```

Never reuse a value across these secrets, and keep them stable across restarts.

### 3. Build and start

```bash
docker compose build sharelatex git-bridge
docker compose up -d
docker compose ps
```

The first build downloads the Overleaf image and compiles the frontend; it may
take several minutes. Once the containers are up:

- Over-Overleaf: <http://localhost>;
- create the first administrator: <http://localhost/launchpad>;
- Git Bridge health: <http://localhost:8000/health_check>.

After creating the administrator account, open a project. The **Integrations**,
**AI assistant** and **Review** entries are available in the editor according to
the project permissions.

### 4. Read the logs

```bash
docker compose logs -f sharelatex
docker compose logs -f git-bridge
```

To stop the application without removing the volumes:

```bash
docker compose down
```

## Local configuration

By default the Compose setup binds the Web and Git ports to loopback
(`127.0.0.1`). Ports and bindings can be changed in the `.env` file:

```dotenv
OVERLEAF_HTTP_PORT=127.0.0.1:8080
OVERLEAF_GIT_PORT=127.0.0.1:8001
OVERLEAF_SITE_URL=http://localhost:8080
OVERLEAF_GIT_BRIDGE_PUBLIC_URL=http://localhost:8001
```

After changes:

```bash
docker compose up -d --build
```

## Deployment

### 1. Generate secrets

Create the production environment file from the versioned template:

```bash
cp .env.example .env
```

Then generate four different values:

```bash
openssl rand -base64 48
openssl rand -base64 48
openssl rand -base64 48
openssl rand -base64 48
```

Set the corresponding values in the untracked `.env` file and adapt the domains
to your installation:

```dotenv
OVERLEAF_EXTENSIONS_SECRET=replace_with_the_first_secret
OVERLEAF_INVITE_TOKEN_SECRET=replace_with_the_second_secret
OVERLEAF_SESSION_SECRET=replace_with_the_third_secret
OVERLEAF_GIT_BRIDGE_INTERNAL_SECRET=replace_with_the_fourth_secret

OVERLEAF_SITE_URL=https://latex.example.org
OVERLEAF_GIT_BRIDGE_PUBLIC_URL=https://git.latex.example.org

# Listen on loopback, behind a TLS reverse proxy
OVERLEAF_HTTP_PORT=127.0.0.1:8080
OVERLEAF_GIT_PORT=127.0.0.1:8000

# Serve the session cookie with the Secure attribute over HTTPS
OVERLEAF_SECURE_COOKIE=true

# Safe defaults for an internet-facing deployment
OVERLEAF_AI_ALLOW_PRIVATE_HOSTS=false
OVERLEAF_AI_ALLOW_INSECURE_HTTP=false
OVERLEAF_GITLAB_ALLOW_PRIVATE_HOSTS=false
```

`OVERLEAF_EXTENSIONS_SECRET` encrypts AI and GitLab keys and derives the
per-purpose keys (Git token HMAC, signed blob URLs). `OVERLEAF_SESSION_SECRET`
signs the session cookie. `OVERLEAF_GIT_BRIDGE_INTERNAL_SECRET` authenticates the
internal web↔git-bridge calls. `OVERLEAF_INVITE_TOKEN_SECRET` signs the
activation links. Changing these values after go-live invalidates the existing
encrypted data, sessions or tokens, so store them in a secrets manager and keep
them distinct.

### 2. Put a TLS reverse proxy in front

The reverse proxy should publish:

- `https://latex.example.org` to `127.0.0.1:8080`;
- `https://git.latex.example.org` to `127.0.0.1:8000`.

The second endpoint carries Git Smart HTTP: it must accept large requests and
responses, must not cache the exchanges, and must preserve the `Authorization`
headers. The public URLs declared in `.env` must exactly match the URLs shown to
users. Also enable HSTS and an HTTP→HTTPS redirect at the proxy.

### 3. Build and launch

```bash
docker compose build sharelatex git-bridge
docker compose up -d
docker compose ps
```

Then check:

```bash
curl -f http://127.0.0.1:8080/launchpad
curl -f http://127.0.0.1:8000/health_check
```

The first command may reply with an HTTP redirect, which is normal.

### 4. Create the administrator and configure the services

1. open `/launchpad` on the public Over-Overleaf URL;
2. create the first administrator account;
3. configure email sending if invitations should not be delivered manually;
4. open **Admin → Community Features** to manage users;
5. open **AI Connector** to register the AI servers;
6. create a test project and validate compilation, sharing, commenting, Git and
   backups before opening to users.

### 5. Back up and update

Back up MongoDB together with the `sharelatex_data` and `git_bridge_data`
volumes. A Git repository does not replace the MongoDB backup: MongoDB remains
the source of truth for the collaborative project.

Before an update:

```bash
git pull --ff-only
docker compose build sharelatex git-bridge
docker compose up -d
docker compose logs --tail=200 sharelatex
```

MongoDB migrations run when the `sharelatex` container starts. Always test the
update against a copy of the data before production.

## Configure Ollama

For Ollama on the Docker Desktop machine, the local Compose setup allows private
hosts and HTTP. In **Admin → AI Connector**, use:

```text
Host / API URL : http://host.docker.internal:11434
API key        : ollama
```

Over-Overleaf queries `http://host.docker.internal:11434/v1/models`. Users then
pick a model in the project. After an `ollama pull`, click **Refresh models** in
the administration.

Only enable `OVERLEAF_AI_ALLOW_PRIVATE_HOSTS` and
`OVERLEAF_AI_ALLOW_INSECURE_HTTP` in production for a trusted internal server and
after evaluating the SSRF risk and the absence of network encryption.

## Security

> [!CAUTION]
> Like Overleaf Community Edition, Over-Overleaf is intended for an environment
> where users are trusted. Sandboxed compiles are a Server Pro feature and are
> not available here. A non-sandboxed LaTeX compile can access the `sharelatex`
> container's resources, its network and some environment variables.

In production:

- enforce TLS for the Web, Git and external providers;
- never publish MongoDB, Redis or the Git Bridge internal APIs;
- restrict the private destinations of the AI and GitLab connectors;
- configure backups and test their restoration;
- monitor the logs, disk space and `/health_check`;
- keep keys and tokens in a secrets manager;
- regularly update the Overleaf base and the Docker images.

## Development and validation

Quick validation of the community tests:

```bash
node --test services/web/modules/community-features/test/unit/*.test.mjs
node --test services/git-bridge-node/test/*.test.mjs
```

Full frontend and image validation:

```bash
docker compose build sharelatex git-bridge
```

## License and attribution

The code remains distributed under the GNU Affero General Public License version
3. See [`LICENSE`](LICENSE).

Overleaf is developed by [the Overleaf team](https://www.overleaf.com/about).
The upstream code is available at
[`overleaf/overleaf`](https://github.com/overleaf/overleaf). The Over-Overleaf
modifications are distributed under the same applicable license obligations.

Copyright Overleaf, 2014–2025, and Over-Overleaf contributors.

## Note on AI-assisted development

The Over-Overleaf functionalities described above — the administration panel,
track changes and reviewing, the Node.js Git Bridge, the GitLab connector, the
AI assistant and the surrounding integration work — were built with the help of
AI to extend Overleaf Community Edition.
