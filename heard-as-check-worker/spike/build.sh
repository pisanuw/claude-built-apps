#!/bin/sh
# Assembles the spike's build context and builds the image `hac-spike`.
# Needs: the hub and mult-streak built (npm ci && npm run build in each), and
# a scratch folder with the downloads checked below.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
DL=${DL:?set DL to a folder for the downloads}
CTX=${CTX:-$DL/ctx}
mkdir -p "$DL"
[ -f "$DL/verapdf.zip" ] || curl -fsSL -o "$DL/verapdf.zip" https://software.verapdf.org/releases/1.30/verapdf-greenfield-1.30.4-installer.zip
echo "04415ef3f149526a3048b9889723e81320ddf013bd891bcc7f0f297f3eadcc23  $DL/verapdf.zip" | sha256sum -c -
[ -f "$DL/chs.zip" ] || curl -fsSL -o "$DL/chs.zip" https://storage.googleapis.com/chrome-for-testing-public/158.0.8127.36/linux64/chrome-headless-shell-linux64.zip
echo "2d3a23017323c54fd457a678e4351f895c4076d8050e39d5aa6247f93448b73a  $DL/chs.zip" | sha256sum -c -
[ -d "$DL/pdfjs/node_modules/pdfjs-dist" ] || (mkdir -p "$DL/pdfjs" && cd "$DL/pdfjs" && npm init -y >/dev/null && npm i --no-audit --no-fund pdfjs-dist@6.5.438 >/dev/null)
rm -rf "$CTX" && mkdir -p "$CTX/app/spike/static"
cp "$DL/verapdf.zip" "$DL/chs.zip" "$CTX/"
cp "$ROOT/tagging-doctor-worker/docker/verapdf-auto-install.xml" "$CTX/"
cp "$HERE/spike.mjs" "$HERE/entry.sh" "$CTX/app/spike/"
cp "$HERE/static/capture.html" "$HERE/static/capture.mjs" "$CTX/app/spike/static/"
P="$DL/pdfjs/node_modules/pdfjs-dist"
cp "$P/build/pdf.mjs" "$P/build/pdf.worker.mjs" "$P/web/pdf_viewer.mjs" "$P/web/pdf_viewer.css" "$CTX/app/spike/static/"
for d in backend-hub mult-streak; do
  mkdir -p "$CTX/app/$d"
  cp -a "$ROOT/$d/package.json" "$ROOT/$d/dist" "$ROOT/$d/node_modules" "$CTX/app/$d/"
done
mkdir -p "$CTX/app/tagging-doctor-worker"
cp -a "$ROOT/tagging-doctor-worker/package.json" "$ROOT/tagging-doctor-worker/src" "$CTX/app/tagging-doctor-worker/"
: > "$CTX/ca.pem"
[ -f /root/.ccr/ca-bundle.crt ] && cp /root/.ccr/ca-bundle.crt "$CTX/ca.pem"
docker build --network host --build-arg APT_PROXY="${HTTPS_PROXY:-}" -t hac-spike -f "$HERE/Dockerfile" "$CTX"
