# The capture spike's image (heard-as-check SPEC AC-1). Never deployed: it is
# built in a session by build.sh, from a context that build.sh assembles.
# It is the hub's Node (the same pinned image), the hub and its mounts idle
# (mult-streak, and Tagging Doctor's checker without its TeX Live), veraPDF
# 1.30.4 as the hub's image installs it, a Java runtime for it, Chrome for
# Testing's headless shell 158.0.8127.36, and pdf.js 6.5.438.
FROM node:24.22.3-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0

# Only for a build behind a proxy that re-signs TLS (a session's): its address,
# and its CA bundle as ca.pem in the context (bound for this step only, kept in no layer; empty otherwise).
ARG APT_PROXY=""
RUN --mount=type=bind,source=ca.pem,target=/tmp/ca.pem \
    if [ -s /tmp/ca.pem ]; then echo 'Acquire::https::CAInfo "/tmp/ca.pem";' > /etc/apt/apt.conf.d/99ca; fi \
 && if [ -n "$APT_PROXY" ]; then echo "Acquire::https::Proxy \"$APT_PROXY\";" > /etc/apt/apt.conf.d/98proxy; fi \
 && sed -i 's#http://deb.debian.org#https://deb.debian.org#g' /etc/apt/sources.list.d/debian.sources \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      openjdk-21-jre-headless unzip util-linux procps \
      libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
      libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64 libdbus-1-3 libexpat1 libx11-6 libxcb1 libxext6 \
      libglib2.0-0t64 libfontconfig1 fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/* /etc/apt/apt.conf.d/98proxy /etc/apt/apt.conf.d/99ca

COPY verapdf.zip verapdf-auto-install.xml /tmp/
RUN cd /tmp && unzip -q verapdf.zip \
 && java -jar /tmp/verapdf-greenfield-1.30.4/verapdf-izpack-installer-1.30.4.jar /tmp/verapdf-auto-install.xml \
 && rm -rf /tmp/verapdf* /opt/verapdf/verapdf-gui /opt/verapdf/Uninstaller

COPY chs.zip /tmp/chs.zip
RUN cd /opt && unzip -q /tmp/chs.zip && mv chrome-headless-shell-linux64 chrome && rm /tmp/chs.zip \
 && /opt/chrome/chrome-headless-shell --version

# The mount's own user: neither root nor 10001 (the checker's TeX user).
RUN groupadd --gid 10002 hacjob && useradd --uid 10002 --gid 10002 --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin hacjob

COPY app /app
WORKDIR /app/spike
ENTRYPOINT ["/app/spike/entry.sh"]
