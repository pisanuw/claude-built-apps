# tagging-doctor-worker: LuaLaTeX and veraPDF behind a small Node server (AC-36, AC-64, AC-65).
#
# Every base is pinned by digest. The TeX Live image is the full scheme of TeX
# Live 2026 (texlive/texlive:latest-full as of 2026-11-15), which also brings
# Java for veraPDF. Build: docker build -t tagging-doctor-worker .

# --- Node, for the server. The server is TypeScript run by Node's own type
# stripping, so the image needs no npm install and no build step.
FROM node:24.22.3-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0 AS node

# --- TeX Live, veraPDF, the TeX user and the read-only caches -------------------
FROM texlive/texlive:latest-full@sha256:c21636aa13e86716d15dab4e352356cb0d34f9365d6091db066e5df71041d67b AS tex

ARG VERAPDF_URL=https://software.verapdf.org/releases/1.30/verapdf-greenfield-1.30.4-installer.zip
ARG VERAPDF_SHA256=04415ef3f149526a3048b9889723e81320ddf013bd891bcc7f0f297f3eadcc23
COPY docker/verapdf-auto-install.xml /tmp/verapdf-auto-install.xml
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
COPY docker/warm /tmp/warm
RUN mkdir -p /opt/texmf-var \
 && luaotfload-tool --update --force \
 && cd /tmp/warm \
 && lualatex --interaction=nonstopmode warm-t1.tex >/dev/null \
 && lualatex --interaction=nonstopmode warm-tagged.tex >/dev/null \
 && lualatex --interaction=nonstopmode warm-tagged.tex >/dev/null \
 && cd / && rm -rf /tmp/warm \
 && chown -R root:root /opt/texmf-var && chmod -R a+rX,go-w /opt/texmf-var

# --- The worker -------------------------------------------------------------------
FROM tex AS worker
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY package.json ./package.json
COPY src ./src
# The jobs root belongs to the server user with mode 0711: the TeX user can
# enter its own job folder by name but cannot list the others (AC-64).
RUN install -d -m 0711 -o root -g root /jobs
ENV NODE_ENV=production \
    JOBS_ROOT=/jobs \
    PORT=10000
EXPOSE 10000
CMD ["node", "--disable-warning=ExperimentalWarning", "src/main.ts"]
