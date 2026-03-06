# Local 1-minute Poller (macOS)

On special days (e.g. a card-list release day) you may want to poll more frequently than the GitHub Actions 5-minute schedule.  
`scripts/local-poll.sh` lets you run the same checker every minute from a MacBook with a single `cron` line.

---

## Prerequisites

| Item | Minimum version |
|---|---|
| Node.js | >= 18 (built-in `fetch` required) |
| git | any recent version |
| Repo clone | SSH remote recommended so `git push` works without a password prompt |

---

## Setup

### 1. Export `DISCORD_WEBHOOK_URL`

Never hardcode the secret. Export it in your shell or pass it directly in `cron`:

```bash
export DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/YOUR_ID/YOUR_TOKEN"
```

### 2. One-shot test run

```bash
DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..." \
  bash /path/to/repo/scripts/local-poll.sh
```

---

## Running every minute

### Option A — crontab

Open your crontab (`crontab -e`) and add:

```cron
* * * * * DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..." /path/to/repo/scripts/local-poll.sh >> /tmp/local-poll.log 2>&1
```

Replace `/path/to/repo` with the absolute path to your local clone.

To stop, remove (or comment out) the cron line.

### Option B — launchd (macOS)

Create `~/Library/LaunchAgents/io.github.cardListWatch.local-poll.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>io.github.cardListWatch.local-poll</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>/path/to/repo/scripts/local-poll.sh</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>DISCORD_WEBHOOK_URL</key>
    <string>https://discord.com/api/webhooks/YOUR_ID/YOUR_TOKEN</string>
  </dict>

  <key>StartInterval</key>
  <integer>60</integer>

  <key>StandardOutPath</key>
  <string>/tmp/local-poll.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/local-poll.log</string>
</dict>
</plist>
```

Load it:

```bash
launchctl load ~/Library/LaunchAgents/io.github.cardListWatch.local-poll.plist
```

Unload it when done:

```bash
launchctl unload ~/Library/LaunchAgents/io.github.cardListWatch.local-poll.plist
```

---

## How it works

1. Acquires a lock file (`/tmp/cardListWatch-local-poll.lock`) to prevent overlapping runs.
2. Runs `node scripts/check.js` (same as the GitHub Actions workflow).
3. If `docs/status.json` changed, does `git pull --rebase origin <branch>`, commits, and pushes.
   - The branch defaults to the currently checked-out branch; override with `POLL_BRANCH=<name>`.
   - If the rebase encounters a conflict the script aborts the rebase and exits with an error.
4. The existing Discord notification in `scripts/check.js` is called automatically — no extra wiring needed.

---

## Cautions

- **Only run 1-minute polling on days when a card-list update is expected.** Frequent polling puts unnecessary load on the monitored sites.
- Ensure your SSH key is added to `ssh-agent` (or use HTTPS with a credential helper) so `git push` succeeds unattended.
- Review `/tmp/local-poll.log` to verify the poller is working as expected.
- Remember to **stop the poller** (remove cron line or unload launchd agent) after the special day.
