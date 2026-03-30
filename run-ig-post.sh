#!/bin/bash
export PATH="$HOME/.nvm/versions/node/v25.5.0/bin:/opt/homebrew/bin:$PATH"
cd "$(dirname "$0")"

# メインMacから最新データを同期
SYNC=~/Library/CloudStorage/GoogleDrive-mikito_tanimoto@lucyalterdesign.com/マイドライブ/event-hub-sync
cp "$SYNC/data.json" output/ 2>/dev/null
cp "$SYNC/state.json" data/ 2>/dev/null

LOG_DIR="$HOME/event-hub-sync/event-hub-pipeline/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/ig-post-$(date +%Y%m%d-%H%M%S).log"

echo "=== IG Post started at $(date) ===" >> "$LOG_FILE"
node src/ig-auto-post.mjs >> "$LOG_FILE" 2>&1
EXIT_CODE=$?
echo "=== IG Post finished at $(date) with exit code $EXIT_CODE ===" >> "$LOG_FILE"

# 投稿後のstateをDriveに戻す（メインMac側でも参照できるように）
cp data/state.json "$SYNC/state.json" 2>/dev/null

# Keep only last 30 log files
ls -t "$LOG_DIR"/ig-post-*.log 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null
