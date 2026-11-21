#!/bin/sh
# The AC-65 spike: one whole job (every LuaLaTeX run plus veraPDF) on a fixture,
# with the production setup: the TeX user (uid 10001) through setpriv, rlimits
# through prlimit, a minimal environment, HOME, TMPDIR and java.io.tmpdir in the
# job folder, the read-only font cache, `--safer --nosocket --no-shell-escape`
# and openout_any=p. These are the same command lines src/runner.ts builds.
#
# Runs inside the image, as the server user (root):
#   docker run --rm --cpus 0.1 --memory 512m -v "$PWD/fixtures/math-notes:/fixture:ro" \
#     -v "$PWD/scripts:/scripts:ro" td-worker-tex:spike sh /scripts/spike.sh [tagged]
set -eu
MODE=${1:-plain}
# SAFER=1 adds --safer, which luaotfload refuses (see DECISIONS.md, D-57).
SAFER=${SAFER:-0}
JOB=/jobs/spike
install -d -m 0711 -o root -g root /jobs
rm -rf "$JOB"
install -d -m 0700 -o 10001 -g 10001 "$JOB" "$JOB/home" "$JOB/tmp" "$JOB/src"
cp -r /fixture/. "$JOB/src/"
if [ "$MODE" = tagged ]; then
  # The patched route (M4): tagging on, PDF 2.0, PDF/UA-2.
  { printf '%s\n' '\DocumentMetadata{lang=en-US, pdfversion=2.0, pdfstandard=ua-2, tagging=on}'; cat /fixture/main.tex; } > "$JOB/src/main.tex"
fi
# A fresh copy of the prebuilt font caches for each job: luaotfload reads its
# names database only from the writable cache path, and the image's own copy
# stays read-only, so no job can change what the next one loads.
cp -a /opt/texmf-var "$JOB/home/texmf-var"
chown -R 10001:10001 "$JOB/src" "$JOB/home/texmf-var"

ms() { echo $(( $(date +%s%N) / 1000000 )); }
as_tex() {
  # rlimits: address space, file size, processes, open files; then the TeX user.
  AS=$1; shift
  prlimit --as="$AS" --fsize=$((200*1024*1024)) --nproc=64 --nofile=256 -- \
    setpriv --reuid=10001 --regid=10001 --clear-groups --no-new-privs --inh-caps=-all -- \
    env -i PATH=/usr/local/texlive/2026/bin/x86_64-linux:/usr/bin:/bin \
      HOME="$JOB/home" TMPDIR="$JOB/tmp" LANG=C.UTF-8 \
      TEXMFVAR="$JOB/home/texmf-var" TEXMFCACHE="$JOB/home/texmf-var" openout_any=p shell_escape=f \
      "$@"
}
lualatex_run() {
  (cd "$JOB/src" && as_tex $((400*1024*1024)) lualatex $( [ "$SAFER" = 1 ] && echo --safer ) --nosocket --no-shell-escape \
    --interaction=nonstopmode --halt-on-error --file-line-error ./main.tex >/dev/null 2>&1) || return 1
}

START=$(ms)
RUNS=0
STATUS=ok
while :; do
  T0=$(ms)
  RUNS=$((RUNS + 1))
  if ! lualatex_run; then STATUS="lualatex-failed-run-$RUNS"; fi
  echo "lualatex run $RUNS: $(( $(ms) - T0 )) ms"
  [ "$STATUS" = ok ] || break
  [ $RUNS -ge 3 ] && break
  grep -qE 'Rerun to get|Label\(s\) may have changed|Please rerun LaTeX|Rerun LaTeX' "$JOB/src/main.log" || break
done
TEX_END=$(ms)
PAGES=$(grep -oE 'Output written on .* \(([0-9]+) pages?' "$JOB/src/main.log" | grep -oE '\([0-9]+' | tr -d '(' || true)
echo "pages: $PAGES"
grep -E '^!|Error' "$JOB/src/main.log" | head -5 || true

T0=$(ms)
(cd "$JOB" && as_tex unlimited java -Xmx192m -Xss512k -XX:MaxMetaspaceSize=96m -XX:ReservedCodeCacheSize=32m \
  -XX:+UseSerialGC -XX:TieredStopAtLevel=1 -XX:-UsePerfData -Djava.io.tmpdir="$JOB/tmp" -Duser.home="$JOB/home" -Dfile.encoding=UTF8 \
  -classpath "/opt/verapdf/bin/*" --add-exports=java.base/sun.security.pkcs=ALL-UNNAMED \
  org.verapdf.apps.GreenfieldCliWrapper --flavour ua2 --format json --maxfailuresdisplayed 1 \
  "$JOB/src/main.pdf" > "$JOB/verapdf.json" 2> "$JOB/verapdf.err") || true
echo "verapdf: $(( $(ms) - T0 )) ms, $(wc -c < "$JOB/verapdf.json") bytes of JSON"
grep -oE '"(isCompliant|failedRules|passedRules|failedChecks)" *: *[a-z0-9]+' "$JOB/verapdf.json" | head -4 | tr '\n' ' '; echo
tail -c 300 "$JOB/verapdf.err"
END=$(ms)
echo "RESULT mode=$MODE safer=$SAFER status=$STATUS runs=$RUNS tex_ms=$((TEX_END - START)) verapdf_ms=$((END - TEX_END)) total_ms=$((END - START))"
ls -la "$JOB/src" | head -20
