/// Liv Word Finder — UI. Three modes over one engine: Slots, Pattern, Ladder.
/// Design: assist, don't solve. No points anywhere.

import { DICTS, loadDict, lookupDef, querySlots, querySlotsLoose, queryPattern, queryPlusMinus, queryRack, parseRack, usesAllRack, groupByLength } from "./engine.js";

const $ = id => document.getElementById(id);
const plural = n => (n === 1 ? "WORD" : "WORDS");
const ALPHA = "abcdefghijklmnopqrstuvwxyz";
const PAGE = 150;         // words shown per group before "+n more"
const WRAP_AT = 12;       // slots per row — beyond this they take a second line

// set per paint: does this word spend the whole rack?
let rackMark = () => false;

const state = {
  app: "slots",
  dictKey: localStorage.getItem("dict") ?? "nwl",
  dict: null,
  rack: null, // { counts, blanks } — set from the rack strip, filters every mode
  slots:   { len: 5, letters: [], cursor: 0, may: new Set(), must: new Set(), noDoubles: false },
  pattern: { str: "", anchorStart: false, anchorEnd: false, lengths: new Set(), noDoubles: false },
  lab:     { word: "", shuffle: true, noDoubles: false, hideSPlurals: false, trail: [], pos: 0 },
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
  state.dict = await loadDict(key);
  buildDictRadios();
  render();
}


// — App switching —————————————————————————————————————————————————————————————

function switchApp(app) {
  state.app = app;
  $("app").dataset.app = app;
  $("scroll-top").classList.remove("show"); // the new view starts at its top
  for (const b of $("seg").children) b.classList.toggle("active", b.dataset.app === app);
  for (const v of document.querySelectorAll(".view")) v.classList.toggle("active", v.id === `view-${app}`);
  if (app === "slots") $("ghost").focus({ preventScroll: true });
  render();
}

const resultsEl = () => $(`${state.app}-results`);


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
    const cell = el(`<button class="slot"><span class="idx">${i + 1}</span>${ch ?? "·"}</button>`);
    cell.style.width = `${width}px`;
    cell.classList.toggle("small", width < 36);
    cell.classList.toggle("filled", !!ch);
    cell.classList.toggle("cursor", i === s.cursor);
    cell.onclick = () => { s.cursor = i; $("ghost").focus({ preventScroll: true }); buildSlots(); };
    wrap.append(cell);
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
    if (row[0] === "z") div.append(fnKey("ALL", toggleAll));
    for (const ch of row) {
      const key = document.createElement("button");
      key.className = "bkey";
      key.textContent = ch;
      key.dataset.ch = ch;
      key.onclick = () => cycleConstraint(ch);
      div.append(key);
    }
    if (row[0] === "z") div.append(fnKey("✕", clearBoard));
    $("board").append(div);
  }
}

function fnKey(label, fn) {
  const key = el(`<button class="bkey fn">${label}</button>`);
  key.onclick = fn;
  return key;
}

// ALL is a toggle: everything to MAY (musts stay), or back to a clean board.
function toggleAll() {
  const { may, must } = state.slots;
  if ([...ALPHA].every(ch => may.has(ch) || must.has(ch))) return clearBoard();
  for (const ch of ALPHA) if (!must.has(ch)) may.add(ch);
  paintBoard();
  render();
}

function clearBoard() {
  state.slots.may.clear();
  state.slots.must.clear();
  paintBoard();
  render();
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
  const rack = state.rack;
  $("board").classList.toggle("active", may.size + must.size > 0);
  for (const key of document.querySelectorAll(".bkey")) {
    if (!key.dataset.ch) continue;
    key.classList.toggle("may", may.has(key.dataset.ch));
    key.classList.toggle("must", must.has(key.dataset.ch));
    key.classList.toggle("norack",
      !!rack && !rack.blanks && rack.counts[ALPHA.indexOf(key.dataset.ch)] === 0);
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

// Letters stay; SPACE types "_"; any other character types "*".
function normalizePattern(raw) {
  return [...raw.toLowerCase()]
    .map(ch => (/[a-z_]/.test(ch) ? ch : ch === " " ? "_" : "*"))
    .join("");
}


// — ±1 Lab ————————————————————————————————————————————————————————————————————

// Stepping from mid-trail forks: the abandoned future is dropped only then.
function walkTo(word) {
  const lab = state.lab;
  lab.trail = lab.trail.slice(0, lab.pos + 1);
  lab.trail.push(word);
  lab.pos = lab.trail.length - 1;
  lab.word = word;
  $("lab-input").value = word.toUpperCase();
  paintTrail();
  render();
}

// Typing directly is a fresh start — the trail resets.
function labTyped(value) {
  const word = value.toLowerCase().replace(/[^a-z]/g, "");
  state.lab.word = word;
  state.lab.trail = word ? [word] : [];
  state.lab.pos = 0;
  paintTrail();
  render();
}

function paintTrail() {
  const lab = state.lab;
  const wrap = $("trail");
  wrap.innerHTML = "";
  if (lab.trail.length < 2) return;

  let currentEl = null;
  for (const [i, word] of lab.trail.entries()) {
    if (i) wrap.append(el(`<span class="t-arrow">›</span>`));
    const crumb = el(`<button class="crumb${i === lab.pos ? " current" : ""}">${word}</button>`);
    if (i === lab.pos) currentEl = crumb;
    crumb.onclick = () => {
      if (i === lab.pos) return;
      lab.pos = i; // just move the cursor — the future survives until she forks
      lab.word = word;
      $("lab-input").value = word.toUpperCase();
      paintTrail();
      render();
    };
    wrap.append(crumb);
  }
  currentEl?.scrollIntoView({ inline: "nearest", block: "nearest" });
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
  const given = slots.filter(Boolean).join(""); // board letters: the rack doesn't pay for these

  const only = restricted ? new Set([...s.may, ...s.must, ...slots.filter(Boolean)]) : null;
  const filters = { include: s.must, only, noDoubles: s.noDoubles, rack: state.rack, given };
  rackMark = w => usesAllRack(w, state.rack, given);
  const wrap = $("slots-results");

  if (!touched && state.rack) { // rack alone: everything she can build
    paintGroups(wrap, queryRack(state.dict, state.rack, { noDoubles: s.noDoubles }), false);
    return;
  }
  const words = querySlots(state.dict, slots, filters);
  paintGroups(wrap, touched ? words : [], !touched);
  if (touched) appendOtherLengths(wrap, querySlotsLoose(state.dict, slots, filters));
}

function paintPatternResults() {
  const p = state.pattern;
  const given = p.str.replace(/[^a-z]/g, ""); // typed literals sit on the board
  rackMark = w => usesAllRack(w, state.rack, given);
  const wrap = $("pattern-results");

  if (!p.str && state.rack) {
    paintGroups(wrap, queryRack(state.dict, state.rack, { noDoubles: p.noDoubles }), false);
    return;
  }
  const words = p.str ? queryPattern(state.dict, p.str, { ...p, rack: state.rack, given }) : [];
  paintGroups(wrap, words, !p.str);
  if (p.str && p.lengths.size) {
    const seen = new Set(words);
    const loose = queryPattern(state.dict, p.str, { ...p, lengths: null, rack: state.rack, given }).filter(w => !seen.has(w));
    appendOtherLengths(wrap, loose);
  }
}

function paintLabResults() {
  const lab = state.lab;
  const wrap = $("lab-results");
  if (lab.word.length < 2) {
    wrap.innerHTML = "";
    return;
  }
  rackMark = w => usesAllRack(w, state.rack, lab.word);
  const { plus, minus } = queryPlusMinus(state.dict, lab.word, { ...lab, rack: state.rack });

  wrap.innerHTML = "";
  wrap.scrollTop = 0;
  wrap.append(labSection("+1", "ONE LETTER MORE", plus, ""));
  wrap.append(labSection("−1", "ONE LETTER LESS", minus, "minus"));
}

function labSection(sign, title, { inPlace, shuffled }, cls) {
  const total = inPlace.length + shuffled.length;
  const section = el(`<div class="lab-section"><div class="lab-h ${cls}"><span><span class="sign">${sign}</span>${title}</span><span><b>${total}</b> ${plural(total)}</span></div></div>`);
  if (!total) section.append(el(`<div class="idle">none</div>`));
  if (inPlace.length) section.append(wordRow(inPlace, true));
  if (shuffled.length) {
    section.append(el(`<div class="sublabel">ANAGRAMS</div>`));
    section.append(wordRow(shuffled, true));
  }
  return section;
}

// idle = nothing entered yet: an empty canvas says it better than copy
function paintGroups(wrap, words, idle) {
  wrap.innerHTML = "";
  wrap.scrollTop = 0;
  if (idle) return;
  if (!words.length) return wrap.append(el(`<div class="idle">no words: loosen something</div>`));
  appendGroups(wrap, words);
}

function appendGroups(wrap, words) {
  const groups = groupByLength(words);
  const single = groups.length <= 1;
  for (const [len, group] of groups) {
    const label = single ? `<span><b>${words.length}</b> ${plural(words.length)}</span><span></span>`
                         : `<span>${len} LETTERS</span><span><b>${group.length}</b> ${plural(group.length)}</span>`;
    wrap.append(el(`<div class="res-h">${label}</div>`));
    wrap.append(wordRow(group, false));
  }
}

function appendOtherLengths(wrap, words) {
  if (!words.length) return;
  wrap.append(el(`<div class="res-h other"><span>OTHER LENGTHS</span><span><b>${words.length}</b> ${plural(words.length)}</span></div>`));
  appendGroups(wrap, words);
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
  const chip = el(`<button class="word${rackMark(word) ? " all-rack" : ""}">${word}</button>`);
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

  // Inflections are cross-references (<dog=v>): resolve to the base word's
  // definition and say what this form is.
  let def = entry?.[0] ?? "";
  let lead = "";
  for (let hop = 0; hop < 2; hop++) {
    const ref = def.match(/^<([a-z]+)=([a-z]+)>/);
    if (!ref) break;
    lead = `${ref[2] === "n" ? "plural of" : "form of"} ${ref[1].toUpperCase()} · `;
    def = (await lookupDef(ref[1]))?.[0] ?? "";
  }
  def = def.replace(/\{([a-z]+)=[a-z]+\}/g, "$1"); // {frighten=v} -> frighten
  $("def-text").innerHTML = def
    ? `<span class="tag">${lead}</span>` + def.replace(/\[([^\]]+)\]/g, `<span class="tag">[$1]</span>`)
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
    const sub = { nwl: "North American Scrabble", csw: "international Scrabble", enable: "Words With Friends", all: "all three combined" }[key];
    const row = el(`<button class="radio-row ${key === state.dictKey ? "on" : ""}">
        <span>${label} <span class="sub">${sub}</span></span><span class="dot"></span></button>`);
    row.onclick = () => { closeSheets(); switchDict(key); };
    wrap.append(row);
  }
}


// — Rack ——————————————————————————————————————————————————————————————————————

function setRack(str) {
  state.rack = parseRack(str);
  $("rack-btn").classList.toggle("on", !!state.rack);
  paintRackStrip();
  paintBoard();
  render();
}

function paintRackStrip() {
  const raw = $("rack-input").value.toLowerCase().replace(/[^a-z?]/g, "");
  const editing = document.activeElement === $("rack-input");
  $("rack-strip").classList.toggle("show", !!raw || editing);
  $("rack-strip").classList.toggle("filled", !!raw);
  const tiles = [...raw]
    .map(ch => `<span class="rt${ch === "?" ? " blank" : ""}">${ch === "?" ? "?" : ch}</span>`)
    .join("");
  $("rack-tiles").innerHTML =
    tiles +
    (editing ? `<span class="caret"></span>` : "") +
    (editing && !raw ? `<span class="hint-tile">TYPE THE LETTERS YOU HOLD · ? FOR A BLANK TILE</span>` : "");
}

function wireRack() {
  const focus = () => {
    const input = $("rack-input");
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
    paintRackStrip();
  };
  $("rack-btn").onclick = focus;
  $("rack-tiles").onclick = focus;
  $("rack-dismiss").onclick = () => {
    $("rack-input").value = "";
    setRack("");
  };
  $("rack-input").addEventListener("input", e => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z?]/g, "");
    setRack(e.target.value);
  });
  $("rack-input").addEventListener("keydown", e => {
    if (e.key === "Enter") $("rack-input").blur();
  });
  $("rack-input").addEventListener("blur", paintRackStrip);
}


// — Events ————————————————————————————————————————————————————————————————————

function wireEvents() {
  wireRack();
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

  for (const btn of document.querySelectorAll(".tchip.reset")) btn.onclick = resetView;
  window.addEventListener("resize", buildSlots);

  for (const list of document.querySelectorAll(".results"))
    list.addEventListener("scroll", () => $("scroll-top").classList.toggle("show", list.scrollTop > 400), { passive: true });
  $("scroll-top").onclick = () => {
    resultsEl().scrollTo({ top: 0, behavior: "smooth" });
    $("scroll-top").classList.remove("show");
  };
}

function resetView() {
  const app = state.app;
  if (app === "slots") {
    state.slots = { len: 5, letters: [], cursor: 0, may: new Set(), must: new Set(), noDoubles: false };
    $("slots-nodoubles").classList.remove("on");
    buildSlots();
    paintBoard();
  }
  if (app === "pattern") {
    state.pattern = { str: "", anchorStart: false, anchorEnd: false, lengths: new Set(), noDoubles: false };
    $("pat-input").value = "";
    $("anchor-start").classList.remove("on");
    $("anchor-end").classList.remove("on");
    $("pat-nodoubles").classList.remove("on");
    paintLenChips();
  }
  if (app === "lab") {
    state.lab = { word: "", shuffle: true, noDoubles: false, hideSPlurals: false, trail: [], pos: 0 };
    $("lab-input").value = "";
    $("lab-shuffle").classList.add("on");
    $("lab-nodoubles").classList.remove("on");
    $("lab-nos").classList.remove("on");
    paintTrail();
  }
  render();
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
