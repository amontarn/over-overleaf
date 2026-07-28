export class WebClient {
  constructor(config) {
    this.config = config;
  }

  async authenticate(token) {
    return await this.#json("/oauth/token/info", token);
  }

  // Confirms the token grants write access to the project. Throws with
  // statusCode 403 when the caller may only read, so a push can be rejected
  // before any pack is received.
  async authorizeWrite(projectId, token) {
    return await this.#json(
      `/api/v0/docs/${projectId}/authorize?access=write`,
      token,
    );
  }

  async describe(projectId, token) {
    return await this.#json(`/api/v0/docs/${projectId}`, token);
  }

  async snapshot(projectId, version, token) {
    return await this.#json(
      `/api/v0/docs/${projectId}/snapshots/${version}`,
      token,
    );
  }

  async importSnapshot(projectId, token, body) {
    return await this.#json(`/api/v0/docs/${projectId}/snapshots`, token, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async #json(pathname, token, init = {}) {
    const response = await fetch(`${this.config.webBaseUrl}${pathname}`, {
      ...init,
      headers: {
        ...init.headers,
        authorization: `Bearer ${token}`,
      },
      redirect: "error",
      signal: AbortSignal.timeout(this.config.requestTimeoutMs),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(`web API returned ${response.status}`);
      error.statusCode = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }
}
