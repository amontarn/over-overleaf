FROM node:24.14.1-bookworm-slim

RUN apt-get update \
  && apt-get install --yes --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY services/git-bridge-node/package.json ./package.json
COPY services/git-bridge-node/src ./src

RUN useradd --create-home --uid 10001 gitbridge \
  && mkdir -p /data/git-bridge \
  && chown -R gitbridge:gitbridge /app /data/git-bridge

USER gitbridge
EXPOSE 8000
CMD ["node", "src/server.mjs"]
