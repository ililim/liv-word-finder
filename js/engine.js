/// Word engine — pure logic, no DOM. Words are lowercase throughout.

export const DICTS = {
  nwl:    { label: "NWL2023", file: "wordlists/nwl2023-words.txt" },
  csw:    { label: "CSW21",   file: "wordlists/csw21-words.txt" },
  enable: { label: "ENABLE",  file: "wordlists/enable1.txt" },
  all:    { label: "ALL",     file: null }, // union of the three
};

const A = "a".charCodeAt(0);


// — Dictionaries ——————————————————————————————————————————————————————————————

const loaded = new Map(); // key -> { words, set, byLen }

export async function loadDict(key) {
  if (loaded.has(key)) return loaded.get(key);

  const words = key === "all"
    ? [...new Set((await Promise.all(["nwl", "csw", "enable"].map(loadDict))).flatMap(d => d.words))].sort()
    : await fetchList(DICTS[key].file);

  const dict = index(words);
  loaded.set(key, dict);
  return dict;
}

async function fetchList(file) {
  const text = await (await fetch(file)).text();
  return text.split("\n").map(w => w.trim()).filter(w => /^[a-z]+$/.test(w));
}

// byLen buckets let every query touch only words of a plausible length.
function index(words) {
  const byLen = new Map();
  for (const w of words) {
    if (!byLen.has(w.length)) byLen.set(w.length, []);
    byLen.get(w.length).push(w);
  }
  return { words, set: new Set(words), byLen };
}


// — Queries ———————————————————————————————————————————————————————————————————

// slots: array of (letter | null), null = any. Length is exact.
export function querySlots(dict, slots, filters = {}) {
  const bucket = dict.byLen.get(slots.length) ?? [];
  const fixed = slots.flatMap((ch, i) => (ch ? [[i, ch]] : []));
  const list = bucket.filter(w => fixed.every(([i, ch]) => w[i] === ch));
  return applyFilters(list, filters);
}

// Same fixed positions, every other length that can still hold them —
// the "what if the word is longer/shorter" tail under the main results.
export function querySlotsLoose(dict, slots, filters = {}) {
  const fixed = slots.flatMap((ch, i) => (ch ? [[i, ch]] : []));
  const minLen = fixed.length ? fixed[fixed.length - 1][0] + 1 : 2;
  const out = [];
  for (const [len, bucket] of [...dict.byLen].sort((a, b) => a[0] - b[0])) {
    if (len === slots.length || len < minLen) continue;
    out.push(...applyFilters(bucket.filter(w => fixed.every(([i, ch]) => w[i] === ch)), filters));
  }
  return out;
}

// Free-typed pattern: "_" (or space) = any one letter, "*" = any run.
// Unanchored ends are open — anchors turn "contains" into starts/ends/exact.
export function queryPattern(dict, str, { anchorStart, anchorEnd, lengths, ...filters } = {}) {
  const re = compilePattern(str, anchorStart, anchorEnd);
  if (!re) return [];

  const list = lengths?.size
    ? [...dict.byLen].flatMap(([len, bucket]) => (matchesLength(len, lengths) ? bucket : []))
    : dict.words;

  return applyFilters(list.filter(w => re.test(w)), filters);
}

export function compilePattern(str, anchorStart, anchorEnd) {
  let core = "";
  for (const ch of str.toLowerCase()) {
    if (ch === "_" || ch === " " || ch === ".") core += "[a-z]";
    else if (ch === "*") core += "[a-z]*";
    else if (ch >= "a" && ch <= "z") core += ch;
  }
  if (!core) return null;
  return new RegExp((anchorStart ? "^" : "^[a-z]*") + core + (anchorEnd ? "$" : "[a-z]*$"));
}

const matchesLength = (len, lengths) => lengths.has(len) || (lengths.has("9+") && len >= 9);

// Words one letter more / less than `word`. "In place" keeps letter order
// (hooks & insertions); "shuffled" allows rearranging (steals & anagram walks).
export function queryPlusMinus(dict, word, { shuffle, noDoubles, hideSPlurals, rack } = {}) {
  const w = word.toLowerCase();
  const out = { plus: { inPlace: [], shuffled: [] }, minus: { inPlace: [], shuffled: [] } };
  if (!/^[a-z]{2,}$/.test(w)) return out;

  const keep = c => c !== w && !(noDoubles && hasDouble(c)) && fitsRack(c, rack);

  const plusSeen = new Set();
  for (let i = 0; i <= w.length; i++)
    for (let k = 0; k < 26; k++) {
      const c = w.slice(0, i) + String.fromCharCode(A + k) + w.slice(i);
      if (plusSeen.has(c) || !dict.set.has(c) || !keep(c)) continue;
      plusSeen.add(c);
      out.plus.inPlace.push(c);
    }

  const minusSeen = new Set();
  for (let i = 0; i < w.length; i++) {
    const c = w.slice(0, i) + w.slice(i + 1);
    if (c.length < 2 || minusSeen.has(c) || !dict.set.has(c) || !keep(c)) continue;
    minusSeen.add(c);
    out.minus.inPlace.push(c);
  }

  if (shuffle) {
    const cw = counts(w);
    for (const c of dict.byLen.get(w.length + 1) ?? [])
      if (!plusSeen.has(c) && offByOne(counts(c), cw) && keep(c)) out.plus.shuffled.push(c);
    for (const c of dict.byLen.get(w.length - 1) ?? [])
      if (c.length >= 2 && !minusSeen.has(c) && offByOne(cw, counts(c)) && keep(c)) out.minus.shuffled.push(c);
  }

  // Half of every +1 list is "…just add S" — she can opt out of the noise.
  if (hideSPlurals) {
    out.plus.inPlace = out.plus.inPlace.filter(c => c !== w + "s");
    out.minus.inPlace = out.minus.inPlace.filter(c => w !== c + "s");
  }
  return out;
}


// — Definitions ———————————————————————————————————————————————————————————————

// Chunked by first letter so a tap costs one small fetch, then it's cached.
const defChunks = new Map();

export async function lookupDef(word) {
  const letter = word[0];
  if (!defChunks.has(letter)) {
    const chunk = await fetch(`data/defs/${letter}.json`).then(r => r.json()).catch(() => ({}));
    defChunks.set(letter, chunk);
  }
  return defChunks.get(letter)[word] ?? null; // [definition, "NCE" flags] | null
}


// — Letters & filters —————————————————————————————————————————————————————————

export function counts(word) {
  const c = new Array(26).fill(0);
  for (let i = 0; i < word.length; i++) c[word.charCodeAt(i) - A]++;
  return c;
}

export function hasDouble(word) {
  const seen = new Set();
  for (const ch of word) {
    if (seen.has(ch)) return true;
    seen.add(ch);
  }
  return false;
}

// rack: counts array (or null = unrestricted). Global drawer, milestone 2.
export function fitsRack(word, rack) {
  if (!rack) return true;
  const c = counts(word);
  return rack.every((n, i) => c[i] <= n);
}

// bigger counts contain smaller with exactly one letter to spare
function offByOne(bigger, smaller) {
  let extra = 0;
  for (let i = 0; i < 26; i++) {
    const d = bigger[i] - smaller[i];
    if (d < 0) return false;
    extra += d;
  }
  return extra === 1;
}

function applyFilters(list, { include, exclude, only, noDoubles, rack }) {
  return list.filter(w =>
    !(noDoubles && hasDouble(w)) &&
    !(exclude && [...exclude].some(ch => w.includes(ch))) &&
    !(include && [...include].some(ch => !w.includes(ch))) &&
    !(only && [...w].some(ch => !only.has(ch))) &&
    fitsRack(w, rack)
  );
}

export function groupByLength(list) {
  const groups = new Map();
  for (const w of list) {
    if (!groups.has(w.length)) groups.set(w.length, []);
    groups.get(w.length).push(w);
  }
  return [...groups].sort((a, b) => a[0] - b[0]);
}
