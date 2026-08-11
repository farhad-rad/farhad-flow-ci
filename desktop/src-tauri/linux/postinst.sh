#!/bin/sh
# Wave 7 — after unpack: expose ARCHITECTURE install prefix /opt/farhad-flow-ci
# (Tauri default layout: /usr/bin + /usr/lib/<productName>/resources)
set -e

mkdir -p /opt/farhad-flow-ci

RES=""
for candidate in \
  "/usr/lib/Farhad Flow CI/resources" \
  "/usr/lib/FarhadFlowCI/resources" \
  "/usr/lib/farhad-flow-ci/resources"
do
  if [ -d "$candidate" ]; then
    RES="$candidate"
    break
  fi
done

if [ -n "$RES" ]; then
  ln -sfn "$RES" /opt/farhad-flow-ci/resources
fi

BIN=""
for candidate in /usr/bin/FarhadFlowCI /usr/bin/farhad-flow-ci; do
  if [ -x "$candidate" ]; then
    BIN="$candidate"
    break
  fi
done

if [ -n "$BIN" ]; then
  ln -sfn "$BIN" /opt/farhad-flow-ci/FarhadFlowCI
fi

exit 0
