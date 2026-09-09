#!/usr/bin/env bash
set -u

BOT_DIR="${BOT_DIR:-/home/rdp2/rafiq-rouh}"
PM2_LOG_DIR="${PM2_HOME:-/home/rdp2/.pm2}/logs"
PROCESS_NAME="rafiq-rouh"

echo "[$(date --iso-8601=seconds)] Starting daily maintenance"

# Remove only this Unix user's stale temporary files. Active/recent files and
# temporary data belonging to system services or other users are untouched.
find /tmp -xdev -user "$(id -u)" -type f -mtime +3 -delete 2>/dev/null || true
find /tmp -xdev -user "$(id -u)" -depth -type d -empty -mtime +3 -delete 2>/dev/null || true

# Retain useful diagnostics while preventing either bot log from growing forever.
if [[ -d "$PM2_LOG_DIR" ]]; then
    find "$PM2_LOG_DIR" -maxdepth 1 -type f -name "${PROCESS_NAME}-*.log" -size +25M \
        -exec truncate --size 0 {} \;
fi

cd "$BOT_DIR"
pm2 restart "$PROCESS_NAME" --update-env
pm2 save
sleep 12
curl --fail --silent --show-error http://127.0.0.1:5174/api/health
echo
echo "[$(date --iso-8601=seconds)] Daily maintenance completed"
