'use strict';

/**
 * Multi-game Card List Watcher
 *
 * Monitors the card list pages for multiple card games:
 *   - Union Arena        (UA##BT and special expansions like EX##BT)
 *   - One Piece Card Game (OP-## and other set types like ST-##, EB-##)
 *   - Gundam Card Game   (GD-## / GD## pattern)
 *
 * For each game, fetches the card list page, collects ALL visible product-set
 * codes, and compares them with the previously-saved known_codes list.
 * A Discord notification is sent whenever any *new* code is detected —
 * including non-standard reinforcement/expansion sets that do not follow the
 * numbered booster pattern (e.g. UA-EX02BT, EX02, ST-16, etc.).
 *
 * docs/status.json stores, per game:
 *   known_codes – every set code ever seen on the page
 *   new_codes   – codes first detected in the most recent change event
 *   latest_code – highest-numbered standard booster (for display / backwards-compat)
 *
 * Requires Node.js >= 18 (uses the built-in `fetch` global; no extra packages needed).
 */

const fs   = require('fs');
const path = require('path');

const STATUS_FILE = path.join(__dirname, '..', 'docs', 'status.json');
const USER_AGENT  =
  'cardListWatch/1.0 (https://github.com/tarousinpo/cardListWatch; ' +
  'scheduled checker, runs every 1 min on 2026-03-06 JST)';

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
 * Also captures non-standard codes in 【】 brackets (e.g. 【EX02BT】, 【UA-EX02BT】).
 *
 * Returns { code, name, all_codes } where:
 *   code / name   – highest-numbered standard UA##BT set (for display)
 *   all_codes     – every product code found on the page
 *
 * Returns null if nothing is found.
 */
function parseUnionArena(html) {
  const codeMap = new Map(); // code -> display name
  let m;

  // Primary: capture "name【UA##BT】" – standard numbered boosters
  const primary = /([^<>\n\r「」【】]{1,80})【(UA(\d+)BT)】/g;
  while ((m = primary.exec(html)) !== null) {
    if (!codeMap.has(m[2])) {
      codeMap.set(m[2], `${m[1].trim()}【${m[2]}】`);
    }
  }

  // Extended: any ASCII product-code inside 【】.
  // Pattern: uppercase letter, then uppercase letters/digits/hyphens, must contain at least
  // one digit (via [0-9] before the optional trailing letters/digits).
  // Examples matched: EX02BT, UA-EX02BT, UAEX01BT.  Non-code Japanese words are excluded
  // because they contain non-ASCII characters which are not in [A-Z0-9\-].
  const extended = /([^<>\n\r「」【】]{0,80})【([A-Z][A-Z0-9\-]*[0-9][A-Z0-9]*)】/g;
  while ((m = extended.exec(html)) !== null) {
    const code = m[2];
    if (!codeMap.has(code)) {
      const name = m[1].trim();
      codeMap.set(code, name ? `${name}【${code}】` : code);
    }
  }

  // Fallback: bare UA##BT token anywhere in the HTML
  if (codeMap.size === 0) {
    const fallback = /UA(\d+)BT/g;
    while ((m = fallback.exec(html)) !== null) {
      const code = `UA${m[1]}BT`;
      if (!codeMap.has(code)) codeMap.set(code, code);
    }
  }

  if (codeMap.size === 0) return null;

  // Latest standard: highest-numbered UA##BT booster
  const standardEntries = [];
  for (const [code] of codeMap) {
    const n = code.match(/^UA(\d+)BT$/);
    if (n) {
      standardEntries.push({ code, name: codeMap.get(code), num: parseInt(n[1], 10) });
    }
  }

  let latest;
  if (standardEntries.length > 0) {
    standardEntries.sort((a, b) => b.num - a.num);
    latest = standardEntries[0];
  } else {
    // No standard UA##BT code found – fall back to the last entry in the map
    const entries = [...codeMap.entries()];
    latest = { code: entries[entries.length - 1][0], name: entries[entries.length - 1][1] };
  }

  return { code: latest.code, name: latest.name, all_codes: [...codeMap.keys()] };
}

/**
 * One Piece Card Game: looks for product codes like OP-01 … OP-99 (boosters),
 * ST-01 … (starter decks), EB-01 … (extra boosters), and similar set types.
 *
 * Returns { code, name, all_codes } where:
 *   code / name   – highest-numbered OP-## booster (for display)
 *   all_codes     – every product code found on the page
 *
 * Returns null if nothing is found.
 */
function parseOnePiece(html) {
  const codeMap = new Map(); // code -> display name
  let m;

  // Primary: Japanese/English set name followed by [XX-##] or (XX-##)
  // Captures OP-##, ST-##, EB-##, and any other 2–3 uppercase letter prefix codes.
  const bracketRe = /([^<>\n\r\[\]()「」【】]{0,80})\[([A-Z]{1,3}-(\d+))\]/g;
  while ((m = bracketRe.exec(html)) !== null) {
    if (!codeMap.has(m[2])) {
      const name = m[1].trim();
      codeMap.set(m[2], name ? `${name} [${m[2]}]` : m[2]);
    }
  }
  const parenRe = /([^<>\n\r\[\]()「」【】]{0,80})\(([A-Z]{1,3}-(\d+))\)/g;
  while ((m = parenRe.exec(html)) !== null) {
    if (!codeMap.has(m[2])) {
      const name = m[1].trim();
      codeMap.set(m[2], name ? `${name} [${m[2]}]` : m[2]);
    }
  }

  // Fallback: bare XX-## token
  if (codeMap.size === 0) {
    const fallback = /\b([A-Z]{1,3}-(\d+))\b/g;
    while ((m = fallback.exec(html)) !== null) {
      if (!codeMap.has(m[1])) codeMap.set(m[1], m[1]);
    }
  }

  if (codeMap.size === 0) return null;

  // Latest: highest-numbered OP-## booster
  const standardEntries = [];
  for (const [code] of codeMap) {
    const n = code.match(/^OP-(\d+)$/);
    if (n) {
      standardEntries.push({ code, name: codeMap.get(code), num: parseInt(n[1], 10) });
    }
  }

  let latest;
  if (standardEntries.length > 0) {
    standardEntries.sort((a, b) => b.num - a.num);
    latest = standardEntries[0];
  } else {
    // No OP-## code – pick highest-numbered code of any prefix
    const anyEntries = [];
    for (const [code] of codeMap) {
      const n = code.match(/^[A-Z]+-(\d+)$/);
      if (n) anyEntries.push({ code, name: codeMap.get(code), num: parseInt(n[1], 10) });
    }
    if (anyEntries.length > 0) {
      anyEntries.sort((a, b) => b.num - a.num);
      latest = anyEntries[0];
    } else {
      const entries = [...codeMap.entries()];
      latest = { code: entries[entries.length - 1][0], name: entries[entries.length - 1][1] };
    }
  }

  return { code: latest.code, name: latest.name, all_codes: [...codeMap.keys()] };
}

/**
 * Gundam Card Game: looks for product codes like GD-01 … GD-99 or GD01 … GD99,
 * and also captures other set types (e.g. GD-EX##, SD-##) if present.
 *
 * Returns { code, name, all_codes } where:
 *   code / name   – highest-numbered GD-## set (for display)
 *   all_codes     – every product code found on the page
 *
 * Returns null if nothing is found.
 */
function parseGundam(html) {
  const codeMap = new Map(); // code -> display name
  let m;

  function normalizeGundamCode(raw, num) {
    return raw.includes('-') ? raw : `GD-${num}`;
  }

  // Primary: text near [GD-##] or (GD-##) – standard numbered sets
  const bracket = /([^<>\n\r\[\]()「」【】]{1,80})\[(GD-?(\d+))\]/g;
  while ((m = bracket.exec(html)) !== null) {
    const code = normalizeGundamCode(m[2], m[3]);
    if (!codeMap.has(code)) {
      codeMap.set(code, `${m[1].trim()} [${code}]`);
    }
  }
  const paren = /([^<>\n\r\[\]()「」【】]{1,80})\((GD-?(\d+))\)/g;
  while ((m = paren.exec(html)) !== null) {
    const code = normalizeGundamCode(m[2], m[3]);
    if (!codeMap.has(code)) {
      codeMap.set(code, `${m[1].trim()} [${code}]`);
    }
  }

  // Extended: other set codes in brackets, e.g. [GD-EX01], [SD-01].
  // Pattern: 1–3 uppercase letters, hyphen, optional uppercase letters, digits, optional
  // trailing uppercase/digits.  Catches non-standard Gundam expansion codes.
  const extBracket = /([^<>\n\r\[\]()「」【】]{0,80})\[([A-Z]{1,3}-[A-Z]*\d+[A-Z0-9]*)\]/g;
  while ((m = extBracket.exec(html)) !== null) {
    const code = m[2];
    if (!codeMap.has(code)) {
      const name = m[1].trim();
      codeMap.set(code, name ? `${name} [${code}]` : code);
    }
  }

  // Fallback: bare GD-## or GD## token
  if (codeMap.size === 0) {
    const fallback = /\b(GD-?(\d+))\b/g;
    while ((m = fallback.exec(html)) !== null) {
      const code = normalizeGundamCode(m[1], m[2]);
      if (!codeMap.has(code)) codeMap.set(code, code);
    }
  }

  if (codeMap.size === 0) return null;

  // Latest: highest-numbered GD-## set
  const standardEntries = [];
  for (const [code] of codeMap) {
    const n = code.match(/^GD-(\d+)$/);
    if (n) {
      standardEntries.push({ code, name: codeMap.get(code), num: parseInt(n[1], 10) });
    }
  }

  let latest;
  if (standardEntries.length > 0) {
    standardEntries.sort((a, b) => b.num - a.num);
    latest = standardEntries[0];
  } else {
    const entries = [...codeMap.entries()];
    latest = { code: entries[entries.length - 1][0], name: entries[entries.length - 1][1] };
  }

  return { code: latest.code, name: latest.name, all_codes: [...codeMap.keys()] };
}

// ── Discord ────────────────────────────────────────────────────────────────

/**
 * @param {string} gameLabel  - human-readable game name
 * @param {string} sourceUrl  - card list URL
 * @param {object|null} previous  - previous entry for this game (may be null)
 * @param {{ latest_name: string, latest_code: string, new_codes: string[], checked_at: string }} current
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

  const newCodesDisplay = current.new_codes && current.new_codes.length > 0
    ? current.new_codes.join(', ')
    : current.latest_name;

  const payload = {
    embeds: [{
      title: `\uD83C\uDCCF ${gameLabel} \u30AB\u30FC\u30C9\u30EA\u30B9\u30C8\u66F4\u65B0`,
      description:
        `\u65B0\u3057\u3044\u30BB\u30C3\u30C8\u304C\u691C\u51FA\u3055\u308C\u307E\u3057\u305F\uFF01\n\n` +
        `**\u65B0\u898F\u691C\u51FA:** ${newCodesDisplay}\n` +
        `**\u4EE5\u524D\u306E\u6700\u65B0\u5F3E:** ${prevDisplay}\n` +
        `**\u73FE\u5728\u306E\u6700\u65B0\u5F3E:** ${current.latest_name}\n\n` +
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

    // Determine previously-known codes.
    // If the previous entry has no known_codes (first run after this feature is added),
    // treat it as a first run so we don't flood notifications for all existing codes.
    const isFirstRun = !prev || !prev.known_codes;
    const prevKnownCodes = (prev && prev.known_codes) ? prev.known_codes : [];

    const newCode  = found ? found.code : null;
    const allCodes = found ? found.all_codes : [];

    // New codes = codes visible on the page that weren't previously tracked.
    // Use a Set for O(1) lookups when filtering.
    const prevKnownSet = new Set(prevKnownCodes);
    const newCodes = allCodes.filter(c => !prevKnownSet.has(c));
    const hasNewCodes = !isFirstRun && newCodes.length > 0;

    // Union of all codes ever seen (preserved even on fetch error).
    const updatedKnownCodes = isFirstRun
      ? allCodes
      : [...new Set([...prevKnownCodes, ...allCodes])];

    const entry = {
      key:          game.key,
      label:        game.label,
      latest_code:  newCode ?? prevCode ?? null,
      latest_name:  found ? found.name : (prev ? prev.latest_name : null),
      new_codes:    hasNewCodes ? newCodes : (prev ? (prev.new_codes || []) : []),
      known_codes:  updatedKnownCodes,
      source_url:   game.url,
      checked_at:   now,
      changed_at:   hasNewCodes || isFirstRun
        ? now
        : (prev ? prev.changed_at : now),
      fetch_error: fetchError || null,
    };

    if (isFirstRun && allCodes.length > 0) {
      console.log(`[${game.label}] First run – recording ${allCodes.length} known code(s). Latest standard: ${entry.latest_code}`);
    } else if (hasNewCodes) {
      console.log(`[${game.label}] New code(s) detected: ${newCodes.join(', ')}`);
      await sendDiscordNotification(game.label, game.url, prev, entry);
    } else {
      console.log(`[${game.label}] No change. Latest: ${entry.latest_code ?? '(unknown)'} | Known sets: ${updatedKnownCodes.length}`);
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
