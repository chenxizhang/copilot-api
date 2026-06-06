#!/usr/bin/env bash
#
# Install copilot-api as a systemd *user* service.
#
# Usage:
#   ./scripts/install-service.sh                  # use defaults
#   PORT=4141 ACCOUNT_TYPE=enterprise ./scripts/install-service.sh
#   ./scripts/install-service.sh --port 8080 --account-type individual
#
# Re-running this script is safe; it overwrites the unit and restarts the service.

set -euo pipefail

# ----- defaults (overridable via env or flags) -----
PORT="${PORT:-4141}"
ACCOUNT_TYPE="${ACCOUNT_TYPE:-enterprise}"
SERVICE_NAME="copilot-api"

# ----- parse flags -----
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --account-type) ACCOUNT_TYPE="$2"; shift 2 ;;
    --name) SERVICE_NAME="$2"; shift 2 ;;
    -h|--help)
      grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# ----- resolve paths -----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

BUN_BIN="$(command -v bun || true)"
if [[ -z "$BUN_BIN" ]]; then
  echo "ERROR: 'bun' not found in PATH. Install it from https://bun.sh first." >&2
  exit 1
fi
BUN_DIR="$(dirname "$BUN_BIN")"

echo "Repository : $REPO_DIR"
echo "Bun binary : $BUN_BIN"
echo "Service    : ${SERVICE_NAME}.service (port $PORT, account-type $ACCOUNT_TYPE)"
echo

# ----- install dependencies -----
echo "==> Installing dependencies (bun install)..."
( cd "$REPO_DIR" && "$BUN_BIN" install )

# ----- write the systemd user unit -----
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_FILE="$UNIT_DIR/${SERVICE_NAME}.service"
mkdir -p "$UNIT_DIR"

echo "==> Writing unit file: $UNIT_FILE"
cat > "$UNIT_FILE" <<EOF
[Unit]
Description=Copilot API Proxy (from source)
After=network.target

[Service]
Type=simple
WorkingDirectory=$REPO_DIR
ExecStart=$BUN_BIN --env-file=/dev/null run ./src/main.ts start --port $PORT --account-type $ACCOUNT_TYPE
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PATH=$BUN_DIR:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
EOF

# ----- enable + start -----
echo "==> Reloading systemd and (re)starting the service..."
systemctl --user daemon-reload
systemctl --user enable "${SERVICE_NAME}.service"
systemctl --user restart "${SERVICE_NAME}.service"

# ----- keep it running without an active login session -----
if command -v loginctl >/dev/null 2>&1; then
  echo "==> Enabling linger so the service runs without an active login..."
  loginctl enable-linger "$USER" || echo "   (could not enable linger; may need: sudo loginctl enable-linger $USER)"
fi

echo
sleep 2
systemctl --user --no-pager status "${SERVICE_NAME}.service" | head -n 12 || true

echo
echo "Done. The proxy should be listening on http://localhost:$PORT"
echo
echo "Useful commands:"
echo "  systemctl --user status  ${SERVICE_NAME}"
echo "  systemctl --user restart ${SERVICE_NAME}"
echo "  systemctl --user stop    ${SERVICE_NAME}"
echo "  journalctl --user -u ${SERVICE_NAME} -f"
echo
echo "NOTE: First run needs a GitHub login. If the logs show a device-code"
echo "      prompt, run the auth flow once in a terminal:"
echo "        cd $REPO_DIR && $BUN_BIN run ./src/main.ts auth"
echo "      then: systemctl --user restart ${SERVICE_NAME}"
