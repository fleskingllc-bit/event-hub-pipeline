#!/bin/bash
# Event Hub — Hero image generation (backfill + incremental)
# Called by launchd. Skips existing images, generates until rate limit.
# Idempotent: once all images exist, this is a no-op.

export PATH="$HOME/.nvm/versions/node/v24.13.1/bin:/opt/homebrew/bin:$PATH"
cd "$(dirname "$0")"

LOG_DIR="$HOME/event-hub-pipeline/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/hero-gen-$(date +%Y%m%d-%H%M%S).log"

echo "=== Hero generation started at $(date) ===" >> "$LOG_FILE"
node src/gen-event-heroes.mjs >> "$LOG_FILE" 2>&1
EXIT_CODE=$?
echo "=== Hero generation finished at $(date) with exit code $EXIT_CODE ===" >> "$LOG_FILE"

# Keep only last 14 log files
ls -t "$LOG_DIR"/hero-gen-*.log 2>/dev/null | tail -n +15 | xargs rm -f 2>/dev/null

exit $EXIT_CODE
