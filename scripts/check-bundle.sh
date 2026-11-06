#!/usr/bin/env bash
#
# What the overlay actually downloads.
#
# The overlay is the bundle OBS keeps loaded for the whole stream (spec §5.1),
# and everything below leaked into it at some point during milestone 3 — twice
# by the same mechanism: a module shared between the two entry points drags all
# of its file along, so separating two *objects* separates nothing. Unit tests
# cannot see this, because they check modules and the leak happens in chunks.
set -euo pipefail

cd "$(dirname "$0")/.."

fail() {
  echo "FAIL: $1" >&2
  exit 1
}
ok() { echo "ok   : $1"; }

[ -f dist/overlay.html ] || fail "dist/overlay.html is missing — run npm run build first"

# Every script the overlay page pulls in, preloads included.
mapfile -t chunks < <(grep -oE '(src|href)="/assets/[^"]+\.js"' dist/overlay.html |
  sed -E 's/.*"(\/assets\/[^"]+)".*/dist\1/' | sort -u)

[ "${#chunks[@]}" -gt 0 ] || fail "no javascript found in dist/overlay.html"
echo "overlay loads: ${chunks[*]}"

absent() {
  local needle="$1" what="$2"
  if grep -qF -- "$needle" "${chunks[@]}"; then
    fail "$what reaches the overlay bundle (found \"$needle\")"
  fi
  ok "$what stays out of the overlay bundle"
}

absent 'bad-length' 'the HID decoder'
absent 'unknown-low-bits' 'the decoder anomalies'
absent 'borderPopover' 'the interface palette'
absent 'panelWidth' 'the interface layout tokens'
absent 'keyboardHint' 'the status bar wording'
absent 'overlay.html?port=' 'the overlay URL builder'
absent 'heOverlayDev' 'the development door'
absent 'halcyon:config' 'the configuration storage'
absent 'IntlBackslash' 'the ISO geometry table'
absent 'ContextMenu' 'the ISO geometry table entries'
absent 'getLayoutMap' 'the layout detection'
# The diagnostics panel is the largest capture-only thing there is, and the
# easiest to drag over by importing one helper from the wrong module.
absent 'undocumented low bits' 'the journal wording'
absent 'Capture raw report' 'the diagnostics panel'
# The interface icons (Lucide) are capture-only; the class every one of them
# carries is the trace one would leave in a shared chunk.
absent 'lucide-icon' 'the interface icons'
# …and the trace is still there to find: were a Lucide upgrade to drop that
# class, the line above would pass with nothing left to detect.
grep -qF 'lucide-icon' dist/assets/capture-*.js ||
  fail "the capture bundle no longer carries 'lucide-icon': the icon guard above proves nothing"
ok   "the icon guard still has its trace in the capture bundle"

# Stylesheets, checked the same way and for the same reason. Fonts are the one
# resource where a leak is measured in tens of kilobytes rather than bytes, and
# `@font-face` makes it easy: one stylesheet imported from the wrong entry
# point puts four interface faces on a page that draws a single weight.
mapfile -t sheets < <(grep -oE 'href="/assets/[^"]+\.css"' dist/overlay.html |
  sed -E 's/.*"(\/assets\/[^"]+)".*/dist\1/' | sort -u)

[ "${#sheets[@]}" -gt 0 ] || fail "no stylesheet found in dist/overlay.html — Archivo 700 is missing"
echo "overlay loads: ${sheets[*]}"

grep -qF 'archivo-latin-700' "${sheets[@]}" ||
  fail "the overlay draws its labels in Archivo 700 and does not load the face"
ok   "the on-air face is loaded"

# The faces the overlay may declare, and no other. A `@font-face` rule is a
# promise, not a download — the browser only fetches a face something on the
# page asks for — so a declaration costs the on-air path nothing; what this has
# to catch is a face that should not be declared here at all, arriving from the
# home page's or the interface's stylesheet.
#
# An admission list rather than a list of known leaks: there were four faces to
# refuse while one went on air, and with three faces a label can be drawn in,
# the next leak would have been a face nobody thought to name. Archivo 400 is
# here for `BrowserChrome.svelte`'s browser-only chrome, which OBS never draws.
allowed=(
  archivo-latin-400-normal
  archivo-latin-700-normal
  fredoka-latin-700-normal
  chakra-petch-latin-700-normal
)
# Vite names them `<face>-<hash>.woff2`; the hash goes, and a file that does
# not end the way ours do keeps its whole name and fails the list.
mapfile -t declared < <(grep -ohE '/assets/[^)"'"'"']+\.woff2' "${sheets[@]}" |
  sed -E 's#^/assets/##; s/^(.+-normal)-[A-Za-z0-9_-]+\.woff2$/\1/' | sort -u)

for face in "${declared[@]}"; do
  [[ " ${allowed[*]} " == *" $face "* ]] || fail "the face $face reaches the overlay bundle"
done
for face in fredoka-latin-700-normal chakra-petch-latin-700-normal; do
  [[ " ${declared[*]} " == *" $face "* ]] ||
    fail "the overlay offers $face for its labels and does not declare it"
done
ok   "the overlay declares the label faces and nothing else"

# The capture page's controls sheet is imported by its entry alone; the same
# shared-module slip that dragged faces over would drag it here.
if grep -qF 'base-select' "${sheets[@]}"; then
  fail "the capture controls stylesheet reaches the overlay bundle"
fi
ok   "the capture controls stylesheet stays out of the overlay bundle"

echo
echo "Overlay bundle is clean."
