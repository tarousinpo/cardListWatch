'use strict';

/**
 * Multi-game Card List Watcher
 *
 * Monitors the card list pages for multiple card games:
 *   - Union Arena        (UA##BT pattern)
 *   - One Piece Card Game (OP-## pattern)
 *   - Gundam Card Game   (GD-## / GD## pattern)
 *
 * For each game, fetches the card list page, determines the latest product set,
 * and writes the result to docs/status.json.  Sends a Discord notification
 * whenever a new latest set is detected.
 *
 * Requires Node.js >= 18 (uses the built-in `fetch` global; no extra packages needed).
 */

const fs   = require('fs');
const path = require('path');

const STATUS_FILE = path.join(__dirname, '..', 'docs', 'status.json');
const USER_AGENT  =
  'cardListWatch/1.0 (https://github.com/tarousinpo/cardListWatch; ' +
  'scheduled checker, runs every 10 min)';

// ── Game definitions ───────────────────────────────────────────────────────

const GAMES = [
  {
    key:   'union_arena',
    label: 'Union Arena',
    url:   'https://www.unionarena-tcg.com/jp/cardlist/',
    parse: parseUnionArena,
  },
  {
    key:   'one_piece',
    label: 'ワンピースカードゲーム',
    url:   'https://www.onepiece-cardgame.com/cardlist/',
    parse: parseOnePiece,
  },
  {
    key:   'gundam',
    label: 'ガンダムカードゲーム',
    url:   'https://www.gundam-gcg.com/jp/cards/',
    parse: parseGundam,
  },
];

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

// ── Parsers ────────────────────────────────────────────────────────────────

/**
 * Union Arena: looks for patterns like  魔都精兵のスレイブ【UA49BT】
 * Returns { code, name } for the highest-numbered set, or null.
 */
function parseUnionArena(html) {
  const entries = [];
  let m;

  // Primary: capture "name【UA##BT】"
  const primary = /([^<>\n\r「」【】]{1,80})【(UA(\d+)BT)】/g;
  while ((m = primary.exec(html)) !== null) {
    entries.push({
      name: `${m[1].trim()}【${m[2]}】`,
      code: m[2],
      num:  parseInt(m[3], 10),
    });
  }

  // Fallback: bare UA##BT code
  if (entries.length === 0) {
    const fallback = /UA(\d+)BT/g;
    while ((m = fallback.exec(html)) !== null) {
      const code = `UA${m[1]}BT`;
      entries.push({ name: code, code, num: parseInt(m[1], 10) });
    }
  }

  if (entries.length === 0) return null;
  entries.sort((a, b) => b.num - a.num);
  return { code: entries[0].code, name: entries[0].name };
}

/**
 * One Piece Card Game: looks for product codes like OP-01 … OP-99
 * Returns { code, name } for the highest-numbered booster, or null.
 *
 * Primary: capture text near "OP-##" e.g. title="ROMANCE DAWN [OP-01]"
 * Fallback: any bare OP-## token in the HTML.
 */
function parseOnePiece(html) {
  const entries = [];
  let m;

  // Primary: Japanese/English set name followed by [OP-##] or (OP-##)
  const bracket = /([^<>\n\r\[\]()「」【】]{1,80})\[(OP-(\d+))\]/g;
  while ((m = bracket.exec(html)) !== null) {
    entries.push({
      name: `${m[1].trim()} [${m[2]}]`,
      code: m[2],
      num:  parseInt(m[3], 10),
    });
  }
  const paren = /([^<>\n\r\[\]()「」【】]{1,80})\((OP-(\d+))\)/g;
  while ((m = paren.exec(html)) !== null) {
    entries.push({
      name: `${m[1].trim()} [${m[2]}]`,
      code: m[2],
      num:  parseInt(m[3], 10),
    });
  }

  // Fallback: bare OP-## token
  if (entries.length === 0) {
    const fallback = /\b(OP-(\d+))\b/g;
    while ((m = fallback.exec(html)) !== null) {
      entries.push({ name: m[1], code: m[1], num: parseInt(m[2], 10) });
    }
  }

  if (entries.length === 0) return null;
  entries.sort((a, b) => b.num - a.num);
  return { code: entries[0].code, name: entries[0].name };
}

/**
 * Gundam Card Game: looks for product codes like GD-01 … GD-99 or GD01 … GD99
 * Returns { code, name } for the highest-numbered set, or null.
 *
 * Primary: set name near [GD-##] or [GD##]
 * Fallback: bare GD-## / GD## token.
 */
function parseGundam(html) {
  const entries = [];
  let m;

  function normalizeGundamCode(raw, num) {
    return raw.includes('-') ? raw : `GD-${num}`;
  }

  // Primary: text near [GD-##] or (GD-##)
  const bracket = /([^<>\n\r\[\]()「」【】]{1,80})\[(GD-?(\d+))\]/g;
  while ((m = bracket.exec(html)) !== null) {
    const code = normalizeGundamCode(m[2], m[3]);
    entries.push({
      name: `${m[1].trim()} [${code}]`,
      code,
      num:  parseInt(m[3], 10),
    });
  }
  const paren = /([^<>\n\r\[\]()「」【】]{1,80})\((GD-?(\d+))\)/g;
  while ((m = paren.exec(html)) !== null) {
    const code = normalizeGundamCode(m[2], m[3]);
    entries.push({
      name: `${m[1].trim()} [${code}]`,
      code,
      num:  parseInt(m[3], 10),
    });
  }

  // Fallback: bare GD-## or GD## token
  if (entries.length === 0) {
    const fallback = /\b(GD-?(\d+))\b/g;
    while ((m = fallback.exec(html)) !== null) {
      const code = normalizeGundamCode(m[1], m[2]);
      entries.push({ name: code, code, num: parseInt(m[2], 10) });
    }
  }

  if (entries.length === 0) return null;
  entries.sort((a, b) => b.num - a.num);
  return { code: entries[0].code, name: entries[0].name };
}

// ── Discord ────────────────────────────────────────────────────────────────

/**
 * @param {string} gameLabel  - human-readable game name
 * @param {string} sourceUrl  - card list URL
 * @param {object|null} previous  - previous entry for this game (may be null)
 * @param {{ latest_name: string, latest_code: string, checked_at: string }} current
 */
async function sendDiscordNotification(gameLabel, sourceUrl, previous, current) {
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
      title: `\uD83C\uDCCF ${gameLabel} \u30AB\u30FC\u30C9\u30EA\u30B9\u30C8\u66F4\u65B0`,
      description:
        `\u6700\u65B0\u5F3E\u304C\u5909\u308F\u308A\u307E\u3057\u305F\uFF01\n\n` +
        `**Before:** ${prevDisplay}\n` +
        `**After:** ${current.latest_name}\n\n` +
        `[\u30AB\u30FC\u30C9\u30EA\u30B9\u30C8\u3092\u898B\u308B](${sourceUrl})`,
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
  console.log(`Discord notification sent for ${gameLabel}.`);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  // Load previous statuses (array format)
  const prevMap = {};
  if (fs.existsSync(STATUS_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
      if (Array.isArray(raw)) {
        for (const entry of raw) {
          if (entry.key) prevMap[entry.key] = entry;
        }
      } else if (raw && raw.source_url) {
        // Migrate old single-game format
        prevMap['union_arena'] = { key: 'union_arena', ...raw };
      }
    } catch (err) {
      console.warn('Could not parse existing status.json – treating as first run:', err.message);
    }
  }

  const now = new Date().toISOString();
  const results = [];

  for (const game of GAMES) {
    console.log(`\n[${game.label}] Fetching ${game.url} …`);
    let found = null;
    let fetchError = null;

    try {
      const html = await fetchHTML(game.url);
      found = game.parse(html);
      if (!found) {
        console.warn(`[${game.label}] No product code found on page – parser may need updating.`);
      }
    } catch (err) {
      fetchError = err.message;
      console.error(`[${game.label}] Fetch error: ${fetchError}`);
    }

    const prev = prevMap[game.key] || null;
    const prevCode = prev ? prev.latest_code : null;
    const newCode  = found ? found.code : null;
    const isFirstRun = !prev || !prevCode;
    const codeChanged = !isFirstRun && prevCode !== newCode && newCode !== null;

    const entry = {
      key:         game.key,
      label:       game.label,
      latest_code: newCode ?? prevCode ?? null,
      latest_name: found    ? found.name : (prev ? prev.latest_name : null),
      source_url:  game.url,
      checked_at:  now,
      changed_at:  codeChanged || isFirstRun
        ? now
        : (prev ? prev.changed_at : now),
      fetch_error: fetchError || null,
    };

    if (isFirstRun && newCode) {
      console.log(`[${game.label}] First run – setting latest to: ${newCode}`);
    } else if (codeChanged) {
      console.log(`[${game.label}] Latest changed: ${prevCode} → ${newCode}`);
      await sendDiscordNotification(game.label, game.url, prev, entry);
    } else {
      console.log(`[${game.label}] No change. Latest: ${entry.latest_code ?? '(unknown)'}`);
    }

    results.push(entry);
  }

  fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true });
  fs.writeFileSync(STATUS_FILE, JSON.stringify(results, null, 2) + '\n');
  console.log(`\nStatus written to ${STATUS_FILE}`);
}

main().catch(err => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
