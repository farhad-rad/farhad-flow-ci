#!/bin/sh
# Wave 7 — remove /opt prefix symlinks only.
# NEVER delete userdata: {config_dir}/flows-repo, logs, keyring, LANGFLOW_CONFIG_DIR.
set -e

case "$1" in
  remove|purge)
    rm -rf /opt/farhad-flow-ci
    ;;
esac

# Intentionally no: rm -rf ~/.config/... or flows-repo
exit 0
