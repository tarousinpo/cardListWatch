'use strict';

/**
 * Union Arena Card List Watcher
 *
 * Fetches the Union Arena card list page and determines the "latest" product set.
 *
 * Heuristic:
 *   Scans the page HTML for patterns matching `{name}【UA{N}BT】` and picks
 *   the entry with the highest numeric N.  This is the highest-numbered booster
 *   set visible on the page, which correlates to the most recently released set.
 *
 * Requires Node.js >= 18 (uses the built-in `fetch` global; no extra packages needed).
 */

const fs   = require('fs');
const path = require('path');

const SOURCE_URL  = 'https://www.carddass.com/unionarena/cardlist/';
const STATUS_FILE = path.join(__dirname, '..', 'docs', 'status.json');
const USER_AGENT  =
  'cardListWatch/1.0 (https://github.com/tarousinpo/cardListWatch; ' +
  'scheduled checker, runs every 10 min)';

// ── Fetch ──────────────────────────────────────────────────────────────────

async function fetchHTML(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} when fetching ${url}`);
  }
  return res.text();
}

// ── Parse ──────────────────────────────────────────────────────────────────

/**
 * Returns { code, name } for the latest set, or null if nothing found.
 *
 * Primary pattern: Japanese text immediately followed by 【UA\d+BT】
 *   e.g.  魔都精兵のスレイブ【UA49BT】
 *
 * Fallback: bare code anywhere in the HTML
 *   e.g.  UA49BT
 */
function parseLatest(html) {
  const entries = [];

  // Primary: capture "name【UA##BT】"
  const primary = /([^<>\n\r「」【】]{1,80})【(UA(\d+)BT)】/g;
  let m;
  while ((m = primary.exec(html)) !== null) {
    entries.push({
      name: `${m[1].trim()}【${m[2]}】`,
      code: m[2],
      num:  parseInt(m[3], 10),
    });
  }

  // Fallback: any bare UA##BT code
  if (entries.length === 0) {
    const fallback = /UA(\d+)BT/g;
    while ((m = fallback.exec(html)) !== null) {
      const code = `UA${m[1]}BT`;
      entries.push({ name: code, code, num: parseInt(m[1], 10) });
    }
  }

  if (entries.length === 0) return null;

  // Highest numeric code = latest set
  entries.sort((a, b) => b.num - a.num);
  return entries[0];
}

// ── Discord ────────────────────────────────────────────────────────────────

/**
 * @param {object|null} previous  - previous status.json contents (may be null)
 * @param {{ latest_name: string, latest_code: string, checked_at: string }} current
 */
async function sendDiscordNotification(previous, current) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log('DISCORD_WEBHOOK_URL not set – skipping notification.');
    return;
  }

  const prevDisplay = previous && previous.latest_name
    ? previous.latest_name
    : (previous && previous.latest_code ? previous.latest_code : '(none)');

  const payload = {
    embeds: [{
      title: '\uD83C\uDCCF Union Arena \u30AB\u30FC\u30C9\u30EA\u30B9\u30C8\u66F4\u65B0',
      description:
        `\u6700\u65B0\u5F3E\u304C\u5909\u308F\u308A\u307E\u3057\u305F\uFF01\n\n` +
        `**Before:** ${prevDisplay}\n` +
        `**After:** ${current.latest_name}\n\n` +
        `[\u30AB\u30FC\u30C9\u30EA\u30B9\u30C8\u3092\u898B\u308B](${SOURCE_URL})`,
      color: 0x0099ff,
      timestamp: current.checked_at,
    }],
  };

  const res = await fetch(webhookUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Discord webhook returned HTTP ${res.status}`);
  }
  console.log('Discord notification sent.');
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Fetching ${SOURCE_URL} …`);
  const html  = await fetchHTML(SOURCE_URL);
  const found = parseLatest(html);

  if (!found) {
    throw new Error(
      'Could not find any UA##BT product code on the page. ' +
      'The page structure may have changed.',
    );
  }

  const now    = new Date().toISOString();
  const newStatus = {
    latest_code: found.code,
    latest_name: found.name,
    source_url:  SOURCE_URL,
    checked_at:  now,
    changed_at:  now,  // updated below if previous exists and code is the same
  };

  // Load previous status (if any)
  let previous = null;
  if (fs.existsSync(STATUS_FILE)) {
    try {
      previous = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
    } catch (err) {
      console.warn('Could not parse existing status.json – treating as first run:', err.message);
    }
  }

  const isFirstRun = !previous || !previous.latest_code;
  const codeChanged = !isFirstRun && previous.latest_code !== newStatus.latest_code;

  if (isFirstRun) {
    console.log(`First run – setting latest to: ${newStatus.latest_code}`);
  } else if (codeChanged) {
    console.log(`Latest changed: ${previous.latest_code} → ${newStatus.latest_code}`);
    await sendDiscordNotification(previous, newStatus);
  } else {
    // No code change: keep the old changed_at so we don't create a git diff
    newStatus.changed_at = previous.changed_at || now;
    console.log(`No change detected. Latest: ${newStatus.latest_code}`);
  }

  // Write status.json (workflow will only commit when git diff shows a change)
  fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true });
  fs.writeFileSync(STATUS_FILE, JSON.stringify(newStatus, null, 2) + '\n');
  console.log(`Status written to ${STATUS_FILE}`);
}

main().catch(err => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
