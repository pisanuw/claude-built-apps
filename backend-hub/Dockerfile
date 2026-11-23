# backend-hub as a Docker image (CR-13): the hub's Node server with its mounts
# (mult-streak, and Tagging Doctor's checker at /tagging-doctor), on the
# checker's pinned TeX Live 2026 and veraPDF 1.30.4.
#
# The build context is the repository's root, because the image takes three
# folders: backend-hub/, mult-streak/ and tagging-doctor-worker/ (and the
# footer script mult-streak's build runs). Build from the root:
#   docker build -f backend-hub/Dockerfile -t backend-hub:dev .
# backend-hub/Dockerfile.dockerignore keeps the rest of the repository out.
#
# The "tex" stage is tagging-doctor-worker/Dockerfile's, line for line, with
# only the COPY paths set from the root (test/dockerfile.test.ts compares the
# two). The checker runs as the server's user (root) and starts TeX and
# veraPDF as the texjob user (AC-64); no folder is writable by others.

# --- Node, for the server ---------------------------------------------------------
FROM node:24.22.3-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0 AS node

# --- TeX Live, veraPDF, the TeX user and the read-only caches -------------------
FROM texlive/texlive:latest-full@sha256:c21636aa13e86716d15dab4e352356cb0d34f9365d6091db066e5df71041d67b AS tex

ARG VERAPDF_URL=https://software.verapdf.org/releases/1.30/verapdf-greenfield-1.30.4-installer.zip
ARG VERAPDF_SHA256=04415ef3f149526a3048b9889723e81320ddf013bd891bcc7f0f297f3eadcc23
COPY tagging-doctor-worker/docker/verapdf-auto-install.xml /tmp/verapdf-auto-install.xml
RUN curl -fsSL -o /tmp/verapdf.zip "$VERAPDF_URL" \
 && echo "$VERAPDF_SHA256  /tmp/verapdf.zip" | sha256sum -c - \
 && cd /tmp && unzip -q verapdf.zip \
 && java -jar /tmp/verapdf-greenfield-1.30.4/verapdf-izpack-installer-1.30.4.jar /tmp/verapdf-auto-install.xml \
 && rm -rf /tmp/verapdf* /opt/verapdf/verapdf-gui /opt/verapdf/Uninstaller \
 && mkdir -p /opt/versions \
 && /opt/verapdf/verapdf --version | head -1 > /opt/versions/verapdf \
 && lualatex --version | head -1 > /opt/versions/texlive \
 && cat /opt/versions/*

# TeX and veraPDF run as this user, never as the server's (AC-64). No folder
# of the image is writable by others, /tmp included, so a job can write only
# in its own folder (/dev/shm, which the runtime mounts, is emptied of the TeX
# user's files after each job).
RUN groupadd --gid 10001 texjob \
 && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin texjob \
 && find / -xdev -type d -perm -0002 -not -path '/proc/*' -exec chmod o-w {} + \
 && test -z "$(find / -xdev -type d -perm -0002 -not -path '/proc/*')"

# The luaotfload font database, the formats and the font caches are built now,
# into one tree that is read-only at run time (AC-65).
ENV TEXMFVAR=/opt/texmf-var \
    TEXMFCACHE=/opt/texmf-var
COPY tagging-doctor-worker/docker/warm /tmp/warm
RUN mkdir -p /opt/texmf-var \
 && luaotfload-tool --update --force \
 && cd /tmp/warm \
 && lualatex --interaction=nonstopmode warm-t1.tex >/dev/null \
 && lualatex --interaction=nonstopmode warm-tagged.tex >/dev/null \
 && lualatex --interaction=nonstopmode warm-tagged.tex >/dev/null \
 && cd / && rm -rf /tmp/warm \
 && chown -R root:root /opt/texmf-var && chmod -R a+rX,go-w /opt/texmf-var

# --- The hub and mult-streak, built with npm ------------------------------------------
FROM node AS build
# Only for a build behind a proxy that re-signs TLS (a session's): its CA, as
# PEM text. Empty on Render, where npm checks the registry's own certificate.
ARG EXTRA_CA_PEM=""
WORKDIR /src
COPY scripts/site-footer.mjs scripts/site-footer.mjs
COPY mult-streak/package.json mult-streak/package-lock.json mult-streak/
COPY backend-hub/package.json backend-hub/package-lock.json backend-hub/
RUN if [ -n "$EXTRA_CA_PEM" ]; then printf '%s\n' "$EXTRA_CA_PEM" > /tmp/extra-ca.pem; export NODE_EXTRA_CA_CERTS=/tmp/extra-ca.pem; fi \
 && npm --prefix mult-streak ci --no-audit --no-fund \
 && npm --prefix backend-hub ci --no-audit --no-fund \
 && rm -f /tmp/extra-ca.pem
COPY mult-streak/tsconfig.json mult-streak/
COPY mult-streak/src mult-streak/src
COPY backend-hub/tsconfig.json backend-hub/
COPY backend-hub/src backend-hub/src
RUN npm --prefix mult-streak run build \
 && npm --prefix backend-hub run build \
 && npm --prefix mult-streak prune --omit=dev --no-audit --no-fund \
 && npm --prefix backend-hub prune --omit=dev --no-audit --no-fund

# --- The hub -------------------------------------------------------------------------
FROM tex AS hub
COPY --from=node /usr/local/bin/node /usr/local/bin/node
# The same layout as the repository, so backend-hub's node_modules/mult-streak
# (a link to ../../mult-streak, from its file: dependency) resolves.
COPY --from=build /src/mult-streak/package.json /app/mult-streak/package.json
COPY --from=build /src/mult-streak/dist /app/mult-streak/dist
COPY --from=build /src/mult-streak/node_modules /app/mult-streak/node_modules
COPY --from=build /src/backend-hub/package.json /app/backend-hub/package.json
COPY --from=build /src/backend-hub/dist /app/backend-hub/dist
COPY --from=build /src/backend-hub/node_modules /app/backend-hub/node_modules
# The checker is TypeScript that Node runs itself (type stripping): no build step.
COPY tagging-doctor-worker/package.json /app/tagging-doctor-worker/package.json
COPY tagging-doctor-worker/src /app/tagging-doctor-worker/src
# The jobs root belongs to the server user with mode 0711: the TeX user can
# enter its own job folder by name but cannot list the others (AC-64).
# mult-streak's activity file (./data, players' state) is the server's only:
# a job's TeX cannot read it (TeX Live 2026 does not check reads, SPEC section 4).
RUN install -d -m 0711 -o root -g root /jobs \
 && install -d -m 0700 -o root -g root /app/backend-hub/data \
 && chmod -R go-w /app
WORKDIR /app/backend-hub
# Render gives a native Node service NODE_ENV=production and a Docker one
# nothing (render.com/docs/environment-variables), so the image sets it, as
# the native hub had it: Express hides stack traces, and mult-streak refuses
# to start without COOKIE_SECRET (R4b.1-1). The checker does not read it.
ENV NODE_ENV=production \
    PORT=10000 \
    TAGGING_DOCTOR_CHECKER=/app/tagging-doctor-worker/src/mount.ts \
    TAGGING_DOCTOR_JOBS_ROOT=/jobs
EXPOSE 10000
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/index.js"]
