#!/bin/bash
export PATH="$HOME/.nvm/versions/node/v24.13.1/bin:/opt/homebrew/bin:$PATH"
cd "$(dirname "$0")"

LOG_DIR="$HOME/event-hub-pipeline/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/ig-post-$(date +%Y%m%d-%H%M%S).log"

echo "=== IG Post started at $(date) ===" >> "$LOG_FILE"
node src/ig-auto-post.mjs >> "$LOG_FILE" 2>&1
EXIT_CODE=$?
echo "=== IG Post finished at $(date) with exit code $EXIT_CODE ===" >> "$LOG_FILE"

# Keep only last 30 log files
ls -t "$LOG_DIR"/ig-post-*.log 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null
