/// Liv Word Finder — UI. Three apps over one engine: Slots, Pattern, ±1.
/// Design: assist, don't solve. No points anywhere.

import { DICTS, loadDict, lookupDef, querySlots, queryPattern, queryPlusMinus, groupByLength } from "./engine.js";

const $ = id => document.getElementById(id);
const plural = n => (n === 1 ? "WORD" : "WORDS");
const PAGE = 150;         // words shown per group before "+n more"
const WRAP_AT = 12;       // slots per row — beyond this they take a second line

const state = {
  app: "slots",
  dictKey: localStorage.getItem("dict") ?? "nwl",
  dict: null,
  rack: null, // global rack drawer — milestone 2, engine already honors it
  slots:   { len: 5, letters: [], cursor: 0, may: new Set(), must: new Set(), noDoubles: false },
  pattern: { str: "", anchorStart: false, anchorEnd: false, lengths: new Set(), noDoubles: false },
  lab:     { word: "", shuffle: true, noDoubles: false, hideSPlurals: false, trail: [] },
};


// — Boot ——————————————————————————————————————————————————————————————————————

async function boot() {
  $("app").dataset.app = state.app;
  buildSlots();
  buildBoard();
  buildLenChips();
  buildDictRadios();
  wireEvents();
  await switchDict(state.dictKey);
}

async function switchDict(key) {
  state.dictKey = key;
  localStorage.setItem("dict", key);
  resultsEl().innerHTML = `<div class="idle">loading ${DICTS[key].label}…</div>`;
  state.dict = await loadDict(key);
  buildDictRadios();
  render();
}


// — App switching —————————————————————————————————————————————————————————————

function switchApp(app) {
  state.app = app;
  $("app").dataset.app = app;
  for (const b of $("seg").children) b.classList.toggle("active", b.dataset.app === app);
  for (const v of document.querySelectorAll(".view")) v.classList.toggle("active", v.id === `view-${app}`);
  if (app === "slots") $("ghost").focus({ preventScroll: true });
  render();
}

const resultsEl = () => $(`${state.app === "lab" ? "lab" : state.app}-results`);


// — Slots —————————————————————————————————————————————————————————————————————

function buildSlots() {
  const s = state.slots;
  const wrap = $("slots");
  wrap.innerHTML = "";
  $("len-label").textContent = s.len;

  // Shrink to fit one row up to WRAP_AT slots, then wrap — never overflow.
  const cols = Math.min(s.len, WRAP_AT);
  const avail = wrap.clientWidth || wrap.parentElement.clientWidth;
  const width = Math.max(26, Math.min(52, Math.floor((avail - (cols - 1) * 7) / cols)));

  for (let i = 0; i < s.len; i++) {
    const ch = s.letters[i];
    const el = document.createElement("button");
    el.className = "slot";
    el.style.width = `${width}px`;
    el.classList.toggle("small", width < 36);
    el.classList.toggle("filled", !!ch);
    el.classList.toggle("cursor", i === s.cursor);
    el.innerHTML = `<span class="idx">${i + 1}</span>${ch ?? "·"}`;
    el.onclick = () => { s.cursor = i; $("ghost").focus({ preventScroll: true }); buildSlots(); };
    wrap.append(el);
  }
}

function setLen(len) {
  const s = state.slots;
  s.len = Math.max(2, Math.min(15, len));
  s.letters.length = Math.min(s.letters.length, s.len);
  s.cursor = Math.min(s.cursor, s.len - 1);
  buildSlots();
  render();
}

function slotKey(key) {
  const s = state.slots;
  if (key === "Backspace") {
    if (!s.letters[s.cursor] && s.cursor > 0) s.cursor--;
    s.letters[s.cursor] = null;
  } else if (/^[a-zA-Z]$/.test(key)) {
    s.letters[s.cursor] = key.toLowerCase();
    s.cursor = Math.min(s.cursor + 1, s.len - 1);
  } else if (key.length === 1) { // space or anything else = any
    s.letters[s.cursor] = null;
    s.cursor = Math.min(s.cursor + 1, s.len - 1);
  } else return;
  buildSlots();
  render();
}

function buildBoard() {
  $("board").innerHTML = "";
  for (const row of ["qwertyuiop", "asdfghjkl", "zxcvbnm"]) {
    const div = document.createElement("div");
    div.className = "board-row";
    for (const ch of row) {
      const key = document.createElement("button");
      key.className = "bkey";
      key.textContent = ch;
      key.dataset.ch = ch;
      key.onclick = () => cycleConstraint(ch);
      div.append(key);
    }
    $("board").append(div);
  }
}

// blank → may → must → blank. Once anything is tapped, untapped letters are out.
function cycleConstraint(ch) {
  const { may, must } = state.slots;
  if (may.has(ch)) { may.delete(ch); must.add(ch); }
  else if (must.has(ch)) must.delete(ch);
  else may.add(ch);
  paintBoard();
  render();
}

function paintBoard() {
  const { may, must } = state.slots;
  $("board").classList.toggle("active", may.size + must.size > 0);
  for (const key of document.querySelectorAll(".bkey")) {
    key.classList.toggle("may", may.has(key.dataset.ch));
    key.classList.toggle("must", must.has(key.dataset.ch));
  }
}


// — Pattern ———————————————————————————————————————————————————————————————————

function buildLenChips() {
  const wrap = $("lenchips");
  wrap.innerHTML = "";
  for (const len of ["ALL", 3, 4, 5, 6, 7, 8, "9+"]) {
    const chip = document.createElement("button");
    chip.className = "lchip";
    chip.textContent = len;
    chip.dataset.len = len;
    chip.onclick = () => {
      const { lengths } = state.pattern;
      if (len === "ALL") lengths.clear();
      else lengths.has(len) ? lengths.delete(len) : lengths.add(len);
      paintLenChips();
      render();
    };
    wrap.append(chip);
  }
  paintLenChips();
}

// ALL is simply "no length filter" — it lights up whenever nothing else is on.
function paintLenChips() {
  const { lengths } = state.pattern;
  for (const chip of document.querySelectorAll(".lchip")) {
    const len = chip.dataset.len === "ALL" ? "ALL" : (chip.dataset.len === "9+" ? "9+" : Number(chip.dataset.len));
    chip.classList.toggle("on", len === "ALL" ? lengths.size === 0 : lengths.has(len));
  }
}

// Keep only letters and our two wildcards; space reads as "_".
function normalizePattern(raw) {
  return raw.toLowerCase().replace(/ /g, "_").replace(/[^a-z_*]/g, "");
}


// — ±1 Lab ————————————————————————————————————————————————————————————————————

function walkTo(word) {
  const lab = state.lab;
  if (lab.word && lab.word !== word) lab.trail.push(lab.word);
  lab.word = word;
  $("lab-input").value = word.toUpperCase();
  paintTrail();
  render();
}

// Typing directly is a fresh start — the trail resets.
function labTyped(value) {
  state.lab.word = value.toLowerCase().replace(/[^a-z]/g, "");
  state.lab.trail = [];
  paintTrail();
  render();
}

function paintTrail() {
  const wrap = $("trail");
  wrap.innerHTML = "";
  for (const [i, word] of state.lab.trail.entries()) {
    const crumb = document.createElement("button");
    crumb.className = "crumb";
    crumb.textContent = word;
    crumb.onclick = () => {
      state.lab.trail.length = i; // jumping back forgets what came after
      state.lab.word = word;
      $("lab-input").value = word.toUpperCase();
      paintTrail();
      render();
    };
    wrap.append(crumb);
  }
  if (state.lab.trail.length) {
    const clear = el(`<button class="trail-clear">✕ CLEAR</button>`);
    clear.onclick = () => { state.lab.trail = []; paintTrail(); };
    wrap.append(clear);
  }
}


// — Rendering —————————————————————————————————————————————————————————————————

let renderTimer;
function render() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(paint, 60);
}

function paint() {
  if (!state.dict) return;
  if (state.app === "slots") paintSlotsResults();
  if (state.app === "pattern") paintPatternResults();
  if (state.app === "lab") paintLabResults();
}

function paintSlotsResults() {
  const s = state.slots;
  const slots = Array.from({ length: s.len }, (_, i) => s.letters[i] ?? null);
  const restricted = s.may.size + s.must.size > 0;
  const touched = slots.some(Boolean) || restricted;

  // Tapped letters are the whole alphabet she's allowing; slot letters ride along.
  const only = restricted ? new Set([...s.may, ...s.must, ...slots.filter(Boolean)]) : null;
  const words = querySlots(state.dict, slots, { include: s.must, only, noDoubles: s.noDoubles, rack: state.rack });
  paintGroups($("slots-results"), touched ? words : [], touched ? null : "fill a slot or tap a letter below");
}

function paintPatternResults() {
  const p = state.pattern;
  const words = p.str ? queryPattern(state.dict, p.str, { ...p, rack: state.rack }) : [];
  paintGroups($("pattern-results"), words, p.str ? null : "type a pattern — try B_TT*Y");
}

function paintLabResults() {
  const lab = state.lab;
  const wrap = $("lab-results");
  if (lab.word.length < 2) {
    wrap.innerHTML = `<div class="idle">type a word, then walk one letter at a time</div>`;
    return;
  }
  const { plus, minus } = queryPlusMinus(state.dict, lab.word, { ...lab, rack: state.rack });

  wrap.innerHTML = "";
  wrap.append(labSection("+1", "ONE LETTER MORE", plus));
  wrap.append(labSection("−1", "ONE LETTER LESS", minus));
}

function labSection(sign, title, { inPlace, shuffled }) {
  const total = inPlace.length + shuffled.length;
  const section = el(`<div class="lab-section"><div class="lab-h"><span><span class="sign">${sign}</span>${title}</span><span><b>${total}</b> ${plural(total)}</span></div></div>`);
  if (!total) section.append(el(`<div class="idle">none</div>`));
  if (inPlace.length) section.append(wordRow(inPlace, true));
  if (shuffled.length) {
    section.append(el(`<div class="sublabel">SHUFFLED</div>`));
    section.append(wordRow(shuffled, true));
  }
  return section;
}

function paintGroups(wrap, words, idleText) {
  wrap.innerHTML = "";
  if (idleText) return wrap.append(el(`<div class="idle">${idleText}</div>`));
  if (!words.length) return wrap.append(el(`<div class="idle">no words — loosen something</div>`));

  const groups = groupByLength(words);
  const single = groups.length <= 1;
  for (const [len, group] of groups) {
    const label = single ? `<span><b>${words.length}</b> ${plural(words.length)}</span><span></span>`
                         : `<span>${len} LETTERS</span><span><b>${group.length}</b> ${plural(group.length)}</span>`;
    wrap.append(el(`<div class="res-h">${label}</div>`));
    wrap.append(wordRow(group, false));
  }
}

function wordRow(words, walkable) {
  const row = el(`<div class="words"></div>`);
  for (const word of words.slice(0, PAGE)) row.append(wordChip(word, walkable));
  if (words.length > PAGE) {
    const more = el(`<button class="more-btn">+${words.length - PAGE} MORE</button>`);
    more.onclick = () => {
      more.remove();
      for (const word of words.slice(PAGE)) row.append(wordChip(word, walkable));
    };
    row.append(more);
  }
  return row;
}

// Tap: definition — except in ±1 where tap walks and hold gives the meaning.
function wordChip(word, walkable) {
  const chip = el(`<button class="word">${word}</button>`);
  if (walkable) {
    chip.onclick = () => { if (!chip.dataset.held) walkTo(word); delete chip.dataset.held; };
    onHold(chip, () => { chip.dataset.held = 1; openDef(word); });
  } else {
    chip.onclick = () => openDef(word);
  }
  return chip;
}

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstChild;
}

function onHold(node, fn, ms = 450) {
  let timer;
  node.addEventListener("pointerdown", () => { timer = setTimeout(fn, ms); });
  for (const ev of ["pointerup", "pointerleave", "pointercancel"])
    node.addEventListener(ev, () => clearTimeout(timer));
  node.addEventListener("contextmenu", e => e.preventDefault());
}


// — Sheets ————————————————————————————————————————————————————————————————————

async function openDef(word) {
  $("def-word").textContent = word;
  $("def-flags").innerHTML = "";
  $("def-text").textContent = "…";
  openSheet("def-sheet");

  const entry = await lookupDef(word);
  const flags = entry?.[1] ?? "";
  $("def-flags").innerHTML = [["N", "NWL2023"], ["C", "CSW21"], ["E", "ENABLE"]]
    .map(([f, label]) => `<span class="flag ${flags.includes(f) ? "yes" : ""}">${label}</span>`)
    .join("");
  $("def-text").innerHTML = entry?.[0]
    ? entry[0].replace(/\[([^\]]+)\]/g, `<span class="tag">[$1]</span>`)
    : `<span class="tag">no definition on file</span>`;
}

function openSheet(id) {
  $(id).classList.add("open");
  $("scrim").classList.add("open");
}

function closeSheets() {
  for (const sheet of document.querySelectorAll(".sheet")) sheet.classList.remove("open");
  $("scrim").classList.remove("open");
}

function buildDictRadios() {
  const wrap = $("dict-radios");
  wrap.innerHTML = "";
  for (const [key, { label }] of Object.entries(DICTS)) {
    const sub = { nwl: "NA Scrabble", csw: "international Scrabble", enable: "public domain", all: "union of all three" }[key];
    const row = el(`<button class="radio-row ${key === state.dictKey ? "on" : ""}">
        <span>${label} <span class="sub">${sub}</span></span><span class="dot"></span></button>`);
    row.onclick = () => { closeSheets(); switchDict(key); };
    wrap.append(row);
  }
}


// — Events ————————————————————————————————————————————————————————————————————

function wireEvents() {
  $("seg").onclick = e => e.target.dataset.app && switchApp(e.target.dataset.app);
  $("help-btn").onclick = () => openSheet("help-sheet");
  $("settings-btn").onclick = () => openSheet("set-sheet");
  $("scrim").onclick = closeSheets;

  // Slots type through an invisible input so the native keyboard does the work.
  $("ghost").addEventListener("keydown", e => {
    if (e.key === "Enter") return $("ghost").blur();
    e.preventDefault();
    slotKey(e.key);
  });
  $("len-minus").onclick = () => setLen(state.slots.len - 1);
  $("len-plus").onclick = () => setLen(state.slots.len + 1);
  toggle($("slots-nodoubles"), on => { state.slots.noDoubles = on; });

  $("pat-input").addEventListener("input", e => {
    const clean = normalizePattern(e.target.value);
    e.target.value = clean.toUpperCase();
    state.pattern.str = clean;
    render();
  });
  $("anchor-start").onclick = () => anchor("anchorStart", "anchor-start");
  $("anchor-end").onclick = () => anchor("anchorEnd", "anchor-end");
  toggle($("pat-nodoubles"), on => { state.pattern.noDoubles = on; });

  $("lab-input").addEventListener("input", e => labTyped(e.target.value));
  toggle($("lab-shuffle"), on => { state.lab.shuffle = on; }, state.lab.shuffle);
  toggle($("lab-nodoubles"), on => { state.lab.noDoubles = on; });
  toggle($("lab-nos"), on => { state.lab.hideSPlurals = on; });

  window.addEventListener("resize", buildSlots);
}

function anchor(prop, id) {
  state.pattern[prop] = !state.pattern[prop];
  $(id).classList.toggle("on", state.pattern[prop]);
  render();
}

function toggle(node, fn, initial = false) {
  node.classList.toggle("on", initial);
  node.onclick = () => {
    const on = node.classList.toggle("on");
    fn(on);
    render();
  };
}

boot();
