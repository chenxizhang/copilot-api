#!/usr/bin/env bash
#
# Uninstall the copilot-api systemd *user* service.
#
# Usage:
#   ./scripts/uninstall-service.sh
#   ./scripts/uninstall-service.sh --name copilot-api

set -euo pipefail

SERVICE_NAME="copilot-api"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) SERVICE_NAME="$2"; shift 2 ;;
    -h|--help)
      grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_FILE="$UNIT_DIR/${SERVICE_NAME}.service"

echo "==> Stopping and disabling ${SERVICE_NAME}.service..."
systemctl --user stop "${SERVICE_NAME}.service" 2>/dev/null || true
systemctl --user disable "${SERVICE_NAME}.service" 2>/dev/null || true

if [[ -f "$UNIT_FILE" ]]; then
  echo "==> Removing unit file: $UNIT_FILE"
  rm -f "$UNIT_FILE"
fi

systemctl --user daemon-reload
echo "Done. The ${SERVICE_NAME} user service has been removed."
echo "(Cached GitHub token in ~/.local/share/copilot-api was left untouched.)"
