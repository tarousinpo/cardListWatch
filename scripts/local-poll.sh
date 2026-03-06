#!/usr/bin/env bash
# local-poll.sh — run scripts/check.js every minute from a local Mac
#
# Usage (one-shot):
#   DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..." bash scripts/local-poll.sh
#
# Usage (cron, every minute):
#   * * * * * DISCORD_WEBHOOK_URL="..." /path/to/repo/scripts/local-poll.sh >> /tmp/local-poll.log 2>&1
#
# See docs/local-poller.md for full instructions.

set -euo pipefail

# ── Resolve repo root ────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd ""$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ── Lock file (prevent overlapping runs) ─────────────────────────────────────
LOCK_FILE="/tmp/cardListWatch-local-poll.lock"

if [ -e "${LOCK_FILE}" ]; then
  LOCK_PID="$(cat "${LOCK_FILE}" 2>/dev/null || true)"
  if [ -n "${LOCK_PID}" ] && kill -0 "${LOCK_PID}" 2>/dev/null; then
    echo "[local-poll] Another instance is running (PID ${LOCK_PID}). Exiting."
    exit 0
  fi
  echo "[local-poll] Stale lock file found (PID ${LOCK_PID}). Removing."
  rm -f "${LOCK_FILE}"
fi

echo $$ > "${LOCK_FILE}"
trap 'rm -f "${LOCK_FILE}"' EXIT

# ── Validate required secret ─────────────────────────────────────────────────
if [ -z "${DISCORD_WEBHOOK_URL:-}" ]; then
  echo "[local-poll] ERROR: DISCORD_WEBHOOK_URL is not set. Aborting." >&2
  exit 1
fi

# ── Move to repo and sync first ──────────────────────────────────────────────
cd "${REPO_ROOT}"

BRANCH="${POLL_BRANCH:-$(git branch --show-current)}"

# If you have local edits, don't risk committing unknown changes.
if ! git diff --quiet; then
  echo "[local-poll] ERROR: working tree has unstaged changes. Aborting." >&2
  git status --porcelain
  exit 1
fi

# Pull BEFORE running the checker, so rebase doesn't fail due to status.json edits.
git pull --rebase origin "${BRANCH}"

# ── Run the checker ──────────────────────────────────────────────────────────
echo "[local-poll] $(date -u '+%Y-%m-%dT%H:%M:%SZ') — running scripts/check.js …"
nod ...e scripts/check.js
 echo "[local-poll] check.js finished."

# ── Commit and push if docs/status.json changed ──────────────────────────────
# (Timestamp-only changes are still changes, and should be pushed.)
if ! git diff --quiet docs/status.json; then
  echo "[local-poll] docs/status.json changed — committing and pushing …"
  git add docs/status.json
  git commit -m "chore: update status.json (local poller)"
  git push origin "${BRANCH}"
  echo "[local-poll] Pushed successfully."
else
  echo "[local-poll] No changes to docs/status.json."
fi
