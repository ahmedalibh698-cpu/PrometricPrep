/* Prometric Prep — quiz app logic */
"use strict";

const MODULE_SIZE = 100;
const LETTERS = ["A", "B", "C", "D", "E"];
const BEST_KEY = "prometric_best_v2";
const HISTORY_KEY = "prometric_history_v1";
const MISTAKE_KEY = "prometric_mistakes_v1";
const MODULE_ICONS = ["i-book", "i-layers", "i-target", "i-zap", "i-award", "i-clipboard", "i-flag"];

/* inline SVG icon from the sprite in index.html */
const icon = (name) => `<svg class="ic" aria-hidden="true"><use href="#${name}"/></svg>`;

/* stable per-question id (its index in the bank) — lets the mistake tracker
   recognise a question across sessions even after its options are reshuffled */
QUESTIONS.forEach((q, i) => { q.id = i; });

/* ---------- modules ---------- */
const MODULES = [];
for (let i = 0; i < QUESTIONS.length; i += MODULE_SIZE) {
  const qs = QUESTIONS.slice(i, i + MODULE_SIZE);
  MODULES.push({
    index: MODULES.length,
    name: "Module " + (MODULES.length + 1),
    from: i + 1,
    to: i + qs.length,
    questions: qs,
    icon: MODULE_ICONS[MODULES.length % MODULE_ICONS.length],
  });
}

/* imported modules (user files) — appended after the official ones */
const CUSTOM_KEY = "prometric_custom_v1";
function getCustom() { return loadJSON(CUSTOM_KEY, { nextId: 1000000, modules: [] }); }
function saveCustom(c) { saveJSON(CUSTOM_KEY, c); }
function addCustomModulesTo(c) {
  c.modules.forEach((m) => {
    MODULES.push({
      index: MODULES.length,
      name: m.name,
      from: 1,
      to: m.questions.length,
      questions: m.questions,
      icon: "i-import",
      custom: true,
      customId: m.id,
    });
  });
}
addCustomModulesTo(getCustom());

const $ = (id) => document.getElementById(id);
const views = {
  home: $("viewHome"), quiz: $("viewQuiz"), results: $("viewResults"),
  history: $("viewHistory"), performance: $("viewPerformance"), mistakes: $("viewMistakes"),
};

const state = {
  module: null,
  config: null,     // {count, minutes, shuffleQ, shuffleOpts, mode, sim}
  order: [],        // working copies of questions in session order
  idx: 0,
  answers: [],      // selected option index or null, aligned with order
  locked: [],       // practice mode: question answered & locked
  mode: "exam",     // "exam" | "practice" | "learn"
  startedAt: 0,
  elapsed: 0,
  finished: false,
  timedOut: false,
  from: "module",   // "module" | "retry" | "learn"
  pendingModule: null,
  learn: null,      // learn session tracker {initial, cleared, attempts, wrong, queue}
};
let modalAction = "finish"; // what the confirm modal's OK button does: "finish" | "exit" | "clearHistory"

/* ---------- helpers ---------- */
function getBest() {
  try { return JSON.parse(localStorage.getItem(BEST_KEY)) || {}; } catch { return {}; }
}
function bestKey(mod, count) { return "m" + mod.index + "-" + count; }
function saveBest(mod, count, record) {
  const all = getBest();
  const k = bestKey(mod, count);
  const cur = all[k];
  if (!cur || record.pct > cur.pct) { all[k] = record; localStorage.setItem(BEST_KEY, JSON.stringify(all)); }
}
function loadJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v === null || v === undefined ? fallback : v;
  } catch { return fallback; }
}
function saveJSON(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

/* ---------- exam history (every finished session, by time & score) ---------- */
function getHistory() { return loadJSON(HISTORY_KEY, []); }
function addHistory(rec) {
  const h = getHistory();
  h.push(rec);
  if (h.length > 300) h.splice(0, h.length - 300); // keep the newest 300
  saveJSON(HISTORY_KEY, h);
}

/* ---------- mistake bank: questions answered incorrectly ---------- */
function getMistakes() { return loadJSON(MISTAKE_KEY, { entries: {}, added: 0, cleared: 0 }); }
function logMistake(id) {
  if (id === undefined || id === null) return;
  const m = getMistakes();
  if (m.entries[id]) { m.entries[id].n++; m.entries[id].t = Date.now(); }
  else { m.entries[id] = { n: 1, t: Date.now() }; m.added++; }
  saveJSON(MISTAKE_KEY, m);
}
function clearMistake(id) {
  const m = getMistakes();
  if (!m.entries[id]) return;
  delete m.entries[id];
  m.cleared++;
  saveJSON(MISTAKE_KEY, m);
}
/* resolve any question id — the official bank, or an imported module's question */
function questionById(id) {
  if (id === undefined || id === null) return null;
  if (id >= 0 && id < QUESTIONS.length) return QUESTIONS[id];
  const c = getCustom();
  for (const m of c.modules) {
    const hit = m.questions.find((q) => q.id === id);
    if (hit) return hit;
  }
  return null;
}
function mistakeEntries() {
  const m = getMistakes();
  return Object.keys(m.entries)
    .map((id) => ({ id: +id, n: m.entries[id].n, t: m.entries[id].t, q: questionById(+id) }))
    .filter((e) => e.q)
    .sort((a, b) => b.n - a.n || b.t - a.t); // most-wrong first
}
function mistakeCount() { return Object.keys(getMistakes().entries).length; }
function fmtTime(s) {
  s = Math.max(0, s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const mm = String(m).padStart(2, "0"), rr = String(r).padStart(2, "0");
  return (h ? String(h).padStart(2, "0") + ":" : "") + mm + ":" + rr;
}
function showView(name) {
  Object.entries(views).forEach(([k, el]) => { el.hidden = k !== name; });
  window.scrollTo(0, 0);
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
/* deep-copy a question and shuffle its option order, remapping the answer index
   so the correct answer lands on a random letter every session */
function shuffleOptions(q) {
  const idx = shuffle(q.o.map((_, i) => i));
  return { ...q, o: idx.map((i) => q.o[i]), a: idx.indexOf(q.a) };
}

/* ---------- HOME ---------- */
function renderHome() {
  const grid = $("moduleGrid");
  grid.innerHTML = "";
  const best = getBest();
  MODULES.forEach((mod) => {
    const entries = Object.entries(best)
      .filter(([k]) => k.startsWith("m" + mod.index + "-"))
      .map(([, v]) => v);
    const bestPct = entries.length ? Math.max(...entries.map((e) => e.pct)) : null;
    const card = document.createElement("button");
    card.className = "module-card";
    card.type = "button";
    card.style.animationDelay = (mod.index * 0.06) + "s";
    card.innerHTML = `
      <span class="module-top">
        <span class="module-ic">${icon(mod.icon)}</span>
        <span class="module-titles">
          <span class="module-range">Q ${mod.from} – ${mod.to}</span>
          <span class="module-name">${mod.name}</span>
        </span>
        ${bestPct !== null ? `<span class="module-best">${icon("i-award")}best ${bestPct}%</span>` : ""}
      </span>
      <span class="module-sub">${mod.custom ? mod.questions.length + " imported questions" : mod.questions.length + " questions · no repeats"}</span>
      <span class="btn btn-primary btn-sm module-start">Start module ${icon("i-arrow-right")}</span>`;
    card.addEventListener("click", () => openSetup(mod));
    grid.appendChild(card);
  });
  $("topMeta").textContent = QUESTIONS.length + " questions · official answer key";
  // progress hub badges
  const hist = getHistory();
  $("hubHistoryCount").textContent = hist.length
    ? hist.length + (hist.length === 1 ? " exam" : " exams")
    : "no exams yet";
  const mCount = mistakeCount();
  $("hubMistakeCount").hidden = mCount === 0;
  $("hubMistakeCount").textContent = mCount + " to fix";
  const customs = getCustom().modules;
  const customQs = customs.reduce((s, m) => s + m.questions.length, 0);
  $("hubImportCount").hidden = !customs.length;
  $("hubImportCount").textContent = customs.length
    ? customs.length + " module" + (customs.length === 1 ? "" : "s")
    : "";
  if (customQs) {
    $("topMeta").textContent = QUESTIONS.length + " official + " + customQs + " imported questions";
  }
}

/* ---------- SETUP MODAL ---------- */
function openSetup(mod) {
  state.pendingModule = mod;
  $("setupTitle").textContent = mod.name;
  $("setupRange").textContent = "Q " + mod.from + " – " + mod.to + " · " + mod.questions.length + " questions available";
  // question count buttons
  const qWrap = $("setupCount");
  qWrap.innerHTML = "";
  const presets = mod.questions.length > 50 ? [10, 25, 50, 75] : [10, 25];
  presets.filter((p) => p < mod.questions.length).forEach((p) => qWrap.appendChild(segBtn("count", p, p + " Q")));
  qWrap.appendChild(segBtn("count", mod.questions.length, "All " + mod.questions.length));
  // time buttons
  const tWrap = $("setupTime");
  tWrap.innerHTML = "";
  [["none", "No limit"], [10, "10 min"], [20, "20 min"], [30, "30 min"], [60, "1 hour"], [120, "2 hours"], ["custom", "Custom…"]]
    .forEach(([v, label]) => tWrap.appendChild(segBtn("time", v, label)));
  // defaults
  selectSeg("count", mod.questions.length);
  selectSeg("time", "none");
  $("optShuffleQ").checked = true;
  $("optShuffleOpts").checked = true;
  document.querySelector('input[name="setupMode"][value="exam"]').checked = true;
  $("setupModal").hidden = false;
  $("setupStart").focus();
}

function segBtn(group, value, label) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "seg";
  b.dataset.group = group;
  b.dataset.value = value;
  b.textContent = label;
  b.addEventListener("click", () => selectSeg(group, value));
  return b;
}
function selectSeg(group, value) {
  document.querySelectorAll('.seg[data-group="' + group + '"]').forEach((b) => {
    b.classList.toggle("is-active", String(b.dataset.value) === String(value));
  });
  // reveal the custom-minutes input only when "Custom…" is chosen
  if (group === "time") {
    $("customTimeRow").hidden = String(value) !== "custom";
    $("customTimeErr").hidden = true;
    if (String(value) === "custom") $("customTimeMin").focus();
  }
  if (group === "simtime") {
    $("simCustomTimeRow").hidden = String(value) !== "custom";
    $("simCustomTimeErr").hidden = true;
    if (String(value) === "custom") $("simCustomTimeMin").focus();
  }
}
function readSeg(group) {
  const active = document.querySelector('.seg[data-group="' + group + '"].is-active');
  return active ? active.dataset.value : null;
}

function startFromSetup() {
  const mod = state.pendingModule;
  if (!mod) return;
  const count = parseInt(readSeg("count"), 10);
  const timeRaw = readSeg("time");
  let minutes = null;
  if (timeRaw === "custom") {
    const v = parseInt($("customTimeMin").value, 10);
    if (!v || v < 1 || v > 600) {
      $("customTimeErr").hidden = false;
      $("customTimeMin").classList.add("is-error");
      $("customTimeMin").focus();
      return;
    }
    minutes = v;
  } else if (timeRaw !== "none") {
    minutes = parseInt(timeRaw, 10);
  }
  const config = {
    count: Math.min(count, mod.questions.length),
    minutes: minutes,
    shuffleQ: $("optShuffleQ").checked,
    shuffleOpts: $("optShuffleOpts").checked,
    mode: document.querySelector('input[name="setupMode"]:checked').value,
  };
  $("setupModal").hidden = true;
  startSession(mod, config, "module");
}

/* ---------- SESSION ---------- */
function buildOrder(mod, config) {
  let qs = mod.questions.slice();
  // the session's questions are always drawn at random from the pool, so
  // closing and reopening the app serves a different set every time —
  // the shuffle checkbox only controls the order they appear in
  if (qs.length > config.count) {
    const picked = shuffle(qs.map((q, i) => ({ q, i }))).slice(0, config.count);
    if (!config.shuffleQ) picked.sort((a, b) => a.i - b.i); // bank order when order shuffle is off
    qs = picked.map((p) => p.q);
  } else if (config.shuffleQ) {
    qs = shuffle(qs);
  }
  if (config.shuffleOpts) qs = qs.map(shuffleOptions);
  return qs;
}

function startSession(mod, config, from, presetOrder) {
  state.module = mod;
  state.config = config;
  state.from = from;
  state.order = presetOrder || buildOrder(mod, config);
  state.idx = 0;
  state.answers = new Array(state.order.length).fill(null);
  state.locked = new Array(state.order.length).fill(false);
  state.mode = config.mode;
  state.startedAt = Date.now();
  state.elapsed = 0;
  state.finished = false;
  state.timedOut = false;
  state.learn = from === "learn"
    ? { initial: state.order.length, cleared: 0, attempts: 0, wrong: 0, queue: [] }
    : null;
  $("quizName").textContent = from === "retry" ? "Retry — " + mod.name
    : from === "learn" ? "Learn from mistakes" : mod.name;
  $("quizModeTag").textContent = state.mode === "practice" ? "practice"
    : state.mode === "learn" ? "learn" : "exam";
  $("finishBtn").querySelector("span").textContent =
    state.mode === "learn" ? "Finish session" : "Finish & See Results";
  $("quizTimerWrap").classList.remove("is-low");
  buildPalette();
  renderQuestion();
  if (config.sim) {
    $("viewSimulator").hidden = false;
    simBegin();
  } else {
    showView("quiz");
  }
  tickTimer();
}

function secondsLeft() {
  if (!state.config || state.config.minutes === null) return null;
  const limit = state.config.minutes * 60;
  return Math.max(0, limit - state.elapsed);
}

function tickTimer() {
  if (state.finished) return;
  if (sim.active && sim.breakActive) { setTimeout(tickTimer, 250); return; } // break is untimed
  state.elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
  const left = secondsLeft();
  const t = $("quizTimer"), wrap = $("quizTimerWrap");
  if (left === null) {
    t.textContent = fmtTime(state.elapsed);
  } else {
    t.textContent = fmtTime(left);
    wrap.classList.toggle("is-low", left <= 60);
    if (left <= 0) {
      if (sim.active && sim.part === 1) {
        startBreak(true); // part 1 ends on time — break, then part 2 with a fresh timer
        setTimeout(tickTimer, 250);
        return;
      }
      state.timedOut = true;
      finish();
      return;
    }
  }
  if (sim.active) simTick(left);
  setTimeout(tickTimer, 250);
}

function renderQuestion() {
  const q = state.order[state.idx];
  const sel = state.answers[state.idx];
  const isLocked = state.mode !== "exam" && state.locked[state.idx];

  $("qNum").textContent = "Q" + (state.idx + 1);
  $("qText").textContent = q.q;
  $("quizCount").textContent = (state.idx + 1) + " / " + state.order.length;
  $("progressFill").style.width = (100 * (state.idx + 1) / state.order.length) + "%";
  const answeredCount = state.answers.filter((a) => a !== null).length;
  $("qState").textContent = sel !== null ? "answered · " + LETTERS[sel] : "not answered";
  $("paletteSummary").textContent = answeredCount + " of " + state.order.length + " answered";

  const opts = $("opts");
  opts.innerHTML = "";
  q.o.forEach((text, j) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "opt";
    btn.dataset.j = j;
    btn.innerHTML = `<span class="opt-letter">${LETTERS[j]}</span><span class="opt-text"></span><span class="opt-mark"></span>`;
    btn.querySelector(".opt-text").textContent = text;
    if (sel === j) btn.classList.add("is-selected");
    if (isLocked || state.finished) {
      btn.disabled = true;
      if (j === q.a) { btn.classList.add("is-correct"); btn.querySelector(".opt-mark").innerHTML = icon("i-check-c") + "<span>correct</span>"; }
      if (sel === j && j !== q.a) { btn.classList.add("is-wrong"); btn.querySelector(".opt-mark").innerHTML = icon("i-x-c") + "<span>your answer</span>"; }
    }
    btn.addEventListener("click", () => selectOption(j));
    opts.appendChild(btn);
  });

  const fb = $("feedback");
  if (isLocked) {
    const correct = q.a === sel;
    fb.hidden = false;
    fb.className = "feedback " + (correct ? "ok" : "bad");
    fb.innerHTML = correct
      ? icon("i-check-c") + "<span><strong>Correct.</strong> Well done.</span>"
      : icon("i-x-c") + `<span><strong>Incorrect.</strong> The correct answer is <strong>${LETTERS[q.a]}</strong> — ${escapeHtml(q.o[q.a])}</span>`;
  } else {
    fb.hidden = true;
  }

  $("prevBtn").disabled = state.idx === 0;
  const last = state.idx === state.order.length - 1;
  if (state.mode === "learn" && last) {
    // end of the queue: replay the questions answered wrong, or wrap up
    const more = state.learn.queue.length > 0;
    const allAnswered = state.answers.every((a) => a !== null);
    $("nextLabel").textContent = more
      ? "Retry " + state.learn.queue.length + " wrong"
      : allAnswered ? "See results" : "Finish session";
    $("nextBtn").disabled = false;
  } else {
    $("nextLabel").textContent = last ? "Last question" : "Next";
    $("nextBtn").disabled = last;
  }
  renderPalette();
}

function selectOption(j) {
  const isLocked = state.mode !== "exam" && state.locked[state.idx];
  if (isLocked || state.finished) return;
  state.answers[state.idx] = j;
  if (state.mode !== "exam") state.locked[state.idx] = true;
  if (state.mode === "learn") {
    // answer-and-see: correct clears the question from the mistake bank,
    // wrong leaves it there and queues the question for another replay
    const q = state.order[state.idx];
    state.learn.attempts++;
    if (j === q.a) { clearMistake(q.id); state.learn.cleared++; }
    else { logMistake(q.id); state.learn.wrong++; state.learn.queue.push(state.idx); }
  }
  renderQuestion();
}

function buildPalette() {
  const grid = $("paletteGrid");
  grid.innerHTML = "";
  state.order.forEach((_, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pal-btn";
    b.textContent = i + 1;
    b.addEventListener("click", () => { state.idx = i; renderQuestion(); });
    grid.appendChild(b);
  });
}

function renderPalette() {
  const grid = $("paletteGrid");
  [...grid.children].forEach((b, i) => {
    b.classList.toggle("is-answered", state.answers[i] !== null);
    b.classList.toggle("is-current", i === state.idx);
  });
}

function navigate(delta) {
  // learn mode, standing on the last slot: continue the replay loop or wrap up
  if (delta > 0 && state.mode === "learn" && state.idx === state.order.length - 1) {
    learnAdvance();
    return;
  }
  const next = state.idx + delta;
  if (next < 0 || next >= state.order.length) return;
  state.idx = next;
  renderQuestion();
}

/* learn mode, end of queue reached — append fresh copies of every question that
   was answered wrong (options reshuffled), then jump to the first of them */
function learnAdvance() {
  if (state.learn.queue.length) {
    const queued = state.learn.queue.splice(0);
    const startAt = state.order.length;
    queued.forEach((i) => {
      state.order.push(shuffleOptions(state.order[i]));
      state.answers.push(null);
      state.locked.push(false);
    });
    buildPalette();
    state.idx = startAt;
    renderQuestion();
    return;
  }
  if (state.answers.every((a) => a !== null)) finish();
  else confirmFinish();
}

/* ---------- FINISH & RESULTS ---------- */
function confirmFinish() {
  let unanswered = 0;
  if (state.config && state.config.sim) {
    const offset = simPartOffset();
    for (let i = offset; i < offset + simPartLength(); i++) {
      if (state.answers[i] === null) unanswered++;
    }
  } else {
    unanswered = state.answers.filter((a) => a === null).length;
  }
  const isSim = state.config && state.config.sim;
  if (isSim && sim.part === 1) {
    $("modalTitle").textContent = "Finish Part 1?";
    $("modalBody").textContent = (unanswered > 0
      ? "You have " + unanswered + " unanswered question" + (unanswered === 1 ? "" : "s") + " in Part 1 — they will be marked as skipped. "
      : "All Part 1 questions answered. ")
      + "After submitting you get a break, then Part 2 begins.";
    modalAction = "break";
    $("modalOk").querySelector("span").textContent = "Submit & take break";
  } else if (state.mode === "learn") {
    const pending = state.learn.queue.length + state.answers.filter((a) => a === null).length;
    $("modalTitle").textContent = "End the learn session?";
    $("modalBody").textContent = pending > 0
      ? pending + " question" + (pending === 1 ? " is" : "s are") + " still waiting to be replayed. Questions you have cleared stay cleared — the rest will be here next time."
      : "Ready to see your result?";
    modalAction = "finish";
    $("modalOk").querySelector("span").textContent = "End session";
  } else {
    $("modalTitle").textContent = isSim ? "Finish Part 2?" : "Finish the module?";
    $("modalBody").textContent = unanswered > 0
      ? "You have " + unanswered + " unanswered question" + (unanswered === 1 ? "" : "s") + ". They will be marked as skipped."
      : "All questions answered. Ready to see your result?";
    modalAction = "finish";
    $("modalOk").querySelector("span").textContent = "Finish & see results";
  }
  $("modal").hidden = false;
  $("modalCancel").focus();
}

function finish() {
  $("modal").hidden = true;
  $("setupModal").hidden = true;
  hideSimChrome();
  sim.active = false;
  state.finished = true;
  state.elapsed = Math.floor((Date.now() - state.startedAt) / 1000);

  const isLearn = state.from === "learn";
  let correct = 0, wrong = 0, skipped = 0;
  if (isLearn) {
    correct = state.learn.cleared;   // questions mastered this session
    wrong = state.learn.wrong;       // wrong answers given along the way
  } else {
    state.order.forEach((q, i) => {
      const a = state.answers[i];
      if (a === null) skipped++;
      else if (a === q.a) correct++;
      else wrong++;
    });
  }
  const total = isLearn ? state.learn.initial : state.order.length;
  const pct = total ? Math.round((100 * correct) / total) : 0;

  // simulator exam: two parts, 4 points per question, 536/800 to pass
  const isSimExam = !isLearn && state.config && state.config.sim && state.from !== "retry";
  const passed = isSimExam ? correct * SIM_POINTS_PER_Q >= SIM_PASS_POINTS : pct >= 60;
  const totalTime = isSimExam ? sim.totalElapsed + state.elapsed : state.elapsed;

  if (state.from === "module" && state.module) {
    saveBest(state.module, total, { pct, score: correct, total });
  }

  // history + mistake tracking — learn sessions log at answer time instead
  if (isLearn) {
    addHistory({
      kind: "learn", name: "Learn from mistakes", mode: "learn", modIndex: null,
      ts: Date.now(), duration: state.elapsed,
      correct, wrong, skipped: 0, total, pct, points: null,
      passed: correct >= total && total > 0,
    });
  } else {
    addHistory({
      kind: isSimExam ? "sim" : state.from,
      name: isSimExam ? "Prometric Exam Simulator"
        : state.from === "retry" ? "Retry — " + (state.module ? state.module.name : "module")
        : (state.module ? state.module.name : "Module"),
      mode: state.mode,
      modIndex: state.module ? state.module.index : null,
      ts: Date.now(), duration: totalTime,
      correct, wrong, skipped, total, pct,
      points: isSimExam ? correct * SIM_POINTS_PER_Q : null,
      passed,
    });
    // every question answered incorrectly joins the mistake bank
    state.order.forEach((q, i) => {
      const a = state.answers[i];
      if (a !== null && a !== q.a) logMistake(q.id);
    });
  }

  if (isLearn) {
    const allDone = correct >= total && mistakeCount() === 0;
    $("resultKicker").textContent = allDone
      ? "Learn from mistakes — everything cleared!"
      : "Learn from mistakes — session complete";
    animateCount($("scoreNum"), correct + "/" + total, 900);
    $("scoreTotal").textContent = "cleared";
    $("countPoints").hidden = true;
    $("countPart1").hidden = true;
    $("countPart2").hidden = true;
    $("passNote").hidden = true;
    $("countCorrect").innerHTML = icon("i-check-c") + correct + " cleared";
    $("countWrong").innerHTML = icon("i-x-c") + (total - correct) + " still to master";
    $("countSkipped").innerHTML = icon("i-rotate") + wrong + " wrong answer" + (wrong === 1 ? "" : "s");
    $("retryWrongBtn").hidden = true;
    $("retakeBtn").querySelector("span").textContent = "Learn again";
  } else if (isSimExam) {
    const points = correct * SIM_POINTS_PER_Q;
    let p1 = 0, p2 = 0;
    for (let i = 0; i < SIM_PART_SIZE && i < total; i++) {
      if (state.answers[i] !== null && state.answers[i] === state.order[i].a) p1++;
    }
    for (let i = SIM_PART_SIZE; i < total; i++) {
      if (state.answers[i] !== null && state.answers[i] === state.order[i].a) p2++;
    }
    $("resultKicker").textContent = "Prometric Exam Simulator · Part 1 + Part 2";
    $("scoreNum").textContent = points; // big points score
    $("scoreTotal").textContent = "/ " + (total * SIM_POINTS_PER_Q) + " points";
    $("countPoints").hidden = false;
    $("countPoints").innerHTML = icon("i-award") + points + " / " + (total * SIM_POINTS_PER_Q) + " pts";
    $("countPart1").hidden = false;
    $("countPart1").innerHTML = icon("i-layers") + "part 1: " + p1 + "/" + SIM_PART_SIZE;
    $("countPart2").hidden = false;
    $("countPart2").innerHTML = icon("i-layers") + "part 2: " + p2 + "/" + Math.max(0, total - SIM_PART_SIZE);
    $("passNote").hidden = false;
    $("retryWrongBtn").hidden = false;
    $("retakeBtn").querySelector("span").textContent = "Retake exam";
  } else {
    $("resultKicker").textContent =
      (state.from === "retry" ? "Retry — incorrect questions" : state.module.name) +
      " · " + (state.mode === "practice" ? "practice" : "exam") + " mode";
    animateCount($("scoreNum"), correct + "/" + total, 900);
    $("scoreTotal").textContent = "questions";
    $("countPoints").hidden = true;
    $("countPart1").hidden = true;
    $("countPart2").hidden = true;
    $("passNote").hidden = true;
    $("retryWrongBtn").hidden = false;
    $("retakeBtn").querySelector("span").textContent = "Retake module";
  }
  if (!isLearn) {
    $("countCorrect").innerHTML = icon("i-check-c") + correct + " correct";
    $("countWrong").innerHTML = icon("i-x-c") + wrong + " incorrect";
    $("countSkipped").innerHTML = icon("i-minus-c") + skipped + " skipped";
  }
  $("scoreTime").textContent = "time " + fmtTime(totalTime) + (state.timedOut ? " · time expired" : "");
  const stamp = $("stamp");
  stamp.classList.toggle("is-retry", !passed);
  $("stampText").textContent = isSimExam
    ? (pct >= 90 ? "Outstanding" : passed ? "Pass" : "Fail")
    : (pct >= 90 ? "Outstanding" : passed ? "Pass" : "Keep studying");
  stamp.style.animation = "none";
  void stamp.offsetWidth;
  stamp.style.animation = "";

  // score ring: reset while hidden, then animate once the view is visible
  const C = 2 * Math.PI * 52;
  const ring = $("scoreRing");
  ring.style.strokeDashoffset = C;
  $("scorePct").textContent = pct + "%";

  if (isLearn) renderLearnReview();
  else renderReview("all");
  showView("results");
  requestAnimationFrame(() => requestAnimationFrame(() => {
    ring.style.strokeDashoffset = C * (1 - pct / 100);
  }));
}

function animateCount(el, target, dur) {
  // Set the final value immediately (rAF is throttled in background tabs);
  // the count-up below is purely cosmetic and settles on the same value.
  const isFraction = target.includes("/");
  const num = parseInt(target, 10);
  const suffix = isFraction ? "/" + target.split("/")[1] : "%";
  el.textContent = isFraction ? target : target;
  const t0 = performance.now();
  function frame(t) {
    const p = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(num * eased) + suffix;
    if (p < 1) requestAnimationFrame(frame);
    else el.textContent = isFraction ? target : num + suffix;
  }
  requestAnimationFrame(frame);
  setTimeout(() => { el.textContent = isFraction ? target : num + suffix; }, dur + 80);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- REVIEW ---------- */
function renderReview(filter) {
  const list = $("reviewList");
  list.innerHTML = "";
  state.order.forEach((q, i) => {
    const a = state.answers[i];
    const status = a === null ? "skipped" : a === q.a ? "correct" : "wrong";
    if (filter !== "all" && filter !== status) return;
    const item = document.createElement("div");
    item.className = "review-item is-" + status;
    const verdict = status === "correct" ? `<span class="review-verdict ok">${icon("i-check-c")}correct</span>`
      : status === "wrong" ? `<span class="review-verdict bad">${icon("i-x-c")}incorrect</span>`
      : `<span class="review-verdict skip">${icon("i-minus-c")}skipped</span>`;
    let optsHtml = "";
    q.o.forEach((text, j) => {
      if (j !== q.a && j !== a) return;
      const cls = j === q.a ? "answer" : "yours";
      const tag = j === q.a ? icon("i-check") + "correct answer" : icon("i-x") + "your answer";
      optsHtml += `<div class="review-opt ${cls}"><span class="opt-letter">${LETTERS[j]}</span><span>${escapeHtml(text)}</span><span class="tag">${tag}</span></div>`;
    });
    if (a === null) {
      optsHtml += `<div class="review-opt" style="border-style:dashed"><span class="opt-letter">–</span><span>not answered</span><span class="tag">${icon("i-minus-c")}skipped</span></div>`;
    }
    item.innerHTML = `
      <div class="review-q">
        <span class="review-qnum">Q${i + 1}</span>
        <span>${escapeHtml(q.q)}</span>
        ${verdict}
      </div>
      <div class="review-opts">${optsHtml}</div>`;
    list.appendChild(item);
  });
  if (!list.children.length) {
    list.innerHTML = `<div class="review-empty">${icon("i-award")}<span>Nothing here — great work!</span></div>`;
  }
}

/* learn results: one entry per unique question, verdict = how it was finally answered */
function renderLearnReview() {
  const list = $("reviewList");
  list.innerHTML = "";
  const byId = new Map();
  state.order.forEach((q, i) => {
    const a = state.answers[i];
    if (a !== null || !byId.has(q.id)) byId.set(q.id, { q, a }); // last answer wins
  });
  [...byId.values()].forEach(({ q, a }) => {
    const cleared = a === q.a;
    const item = document.createElement("div");
    item.className = "review-item is-" + (cleared ? "correct" : "wrong");
    const verdict = cleared
      ? `<span class="review-verdict ok">${icon("i-check-c")}cleared</span>`
      : `<span class="review-verdict bad">${icon("i-x-c")}still to master</span>`;
    let optsHtml = "";
    q.o.forEach((text, j) => {
      if (j !== q.a && j !== a) return;
      const cls = j === q.a ? "answer" : "yours";
      const tag = j === q.a ? icon("i-check") + "correct answer" : icon("i-x") + "your answer";
      optsHtml += `<div class="review-opt ${cls}"><span class="opt-letter">${LETTERS[j]}</span><span>${escapeHtml(text)}</span><span class="tag">${tag}</span></div>`;
    });
    if (a === null) {
      optsHtml += `<div class="review-opt" style="border-style:dashed"><span class="opt-letter">–</span><span>not replayed this session</span><span class="tag">${icon("i-minus-c")}pending</span></div>`;
    }
    item.innerHTML = `
      <div class="review-q">
        <span class="review-qnum">Q${q.id + 1}</span>
        <span>${escapeHtml(q.q)}</span>
        ${verdict}
      </div>
      <div class="review-opts">${optsHtml}</div>`;
    list.appendChild(item);
  });
}

function retryWrong() {
  const wrongQs = state.order.filter((q, i) => state.answers[i] !== q.a);
  if (!wrongQs.length) return;
  const mod = { index: -1, name: state.module ? state.module.name : "retry", from: 0, to: wrongQs.length, questions: wrongQs };
  // sim retries run in the regular quiz interface — the timed two-part format is for full exams only
  const cfg = { ...state.config, count: wrongQs.length, minutes: null, shuffleQ: false, sim: false };
  startSession(mod, cfg, "retry", wrongQs);
}

/* ————————————————————————————————————————————————
   LEARN FROM MISTAKES
   every question answered incorrectly joins the bank;
   a learn session replays them until each one is
   answered correctly — then it leaves the bank.
—————————————————————————————————————————————— */
function startLearnSession() {
  const entries = mistakeEntries();
  if (!entries.length) return;
  const qs = entries.map((e) => e.q);
  const mod = { index: -3, name: "Learn from Mistakes", from: 1, to: qs.length, questions: qs, icon: "i-bulb" };
  const cfg = { count: qs.length, minutes: null, shuffleQ: true, shuffleOpts: true, mode: "learn" };
  startSession(mod, cfg, "learn");
}

/* ————————————————————————————————————————————————
   HISTORY · PERFORMANCE
—————————————————————————————————————————————— */
const KIND_META = {
  module: { icon: "i-book", label: "Module" },
  sim:    { icon: "i-monitor", label: "Simulator" },
  retry:  { icon: "i-rotate", label: "Retry" },
  learn:  { icon: "i-bulb", label: "Mistakes" },
};

function fmtWhen(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    + " · " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
function fmtDay(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ---------- history ---------- */
function renderHistory() {
  const h = getHistory().slice().reverse(); // newest first
  $("historySub").textContent = h.length
    ? h.length + " recorded session" + (h.length === 1 ? "" : "s") + " · newest first"
    : "Finish any module, retry or simulator exam and it will appear here.";
  $("clearHistoryBtn").hidden = !h.length;
  const list = $("historyList");
  list.innerHTML = "";
  if (!h.length) {
    list.innerHTML = `<div class="page-empty">${icon("i-history")}<span>No exam results yet.</span></div>`;
    return;
  }
  h.forEach((rec) => {
    const meta = KIND_META[rec.kind] || KIND_META.module;
    const stampText = rec.kind === "learn"
      ? (rec.passed ? "Cleared" : "Partial")
      : (rec.passed ? "Pass" : "Fail");
    const item = document.createElement("div");
    item.className = "history-item" + (rec.passed ? " is-pass" : " is-fail");
    item.innerHTML = `
      <span class="history-ic">${icon(meta.icon)}</span>
      <span class="history-main">
        <span class="history-name">${escapeHtml(rec.name)}
          <span class="history-kind mono">${meta.label}${rec.kind !== "learn" && rec.mode ? " · " + rec.mode : ""}</span></span>
        <span class="history-meta mono">${icon("i-clock")} ${fmtTime(rec.duration || 0)} · ${rec.correct}/${rec.total} correct${rec.skipped ? " · " + rec.skipped + " skipped" : ""}</span>
      </span>
      <span class="history-score">
        <span class="history-pct">${rec.pct}%</span>
        ${rec.points !== null && rec.points !== undefined ? `<span class="history-pts mono">${rec.points} pts</span>` : ""}
        <span class="history-when mono">${fmtWhen(rec.ts)}</span>
      </span>
      <span class="history-stamp ${rec.passed ? "ok" : "bad"}">${stampText}</span>`;
    list.appendChild(item);
  });
}

/* ---------- performance ---------- */
function perfTile(ic, value, label) {
  return `<div class="perf-tile">
    <span class="perf-tile-ic">${icon(ic)}</span>
    <span class="perf-tile-val mono">${value}</span>
    <span class="perf-tile-label">${label}</span>
  </div>`;
}

function renderPerformance() {
  const h = getHistory();
  const tiles = $("perfTiles");
  if (!h.length) {
    tiles.innerHTML = `<div class="page-empty">${icon("i-trend")}<span>Take your first exam and your performance will build up here.</span></div>`;
    $("perfTrend").innerHTML = "";
    $("perfModules").innerHTML = "";
    $("perfSim").innerHTML = "";
    $("perfSub").textContent = "no sessions recorded yet";
    return;
  }
  const answered = h.reduce((s, r) => s + r.correct + r.wrong, 0);
  const correctSum = h.reduce((s, r) => s + r.correct, 0);
  const accuracy = answered ? Math.round((100 * correctSum) / answered) : 0;
  const avgPct = Math.round(h.reduce((s, r) => s + r.pct, 0) / h.length);
  const bestPct = Math.max(...h.map((r) => r.pct));
  const totalTime = h.reduce((s, r) => s + (r.duration || 0), 0);
  $("perfSub").textContent = h.length + " sessions · " + fmtTime(totalTime) + " total practice time";
  tiles.innerHTML =
    perfTile("i-clipboard", h.length, "sessions taken") +
    perfTile("i-target", accuracy + "%", "overall accuracy") +
    perfTile("i-award", avgPct + "%", "average score") +
    perfTile("i-zap", bestPct + "%", "best result") +
    perfTile("i-check-c", answered, "questions answered") +
    perfTile("i-clock", fmtTime(totalTime), "time practiced");
  renderTrend(h.slice(-24)); // chronological order
  renderPerfModules(h);
  renderPerfSim(h);
}

/* score-over-time SVG line chart (chronological) */
function renderTrend(recs) {
  const el = $("perfTrend");
  if (recs.length < 2) {
    el.innerHTML = `<div class="page-empty small">${icon("i-trend")}<span>Take at least two sessions to see your trend.</span></div>`;
    return;
  }
  const W = 640, H = 190, PADX = 40, PADY = 16;
  const iw = W - PADX * 2, ih = H - PADY * 2;
  const pts = recs.map((r, i) => ({
    x: PADX + (iw * i) / (recs.length - 1),
    y: PADY + ih * (1 - r.pct / 100),
    r,
  }));
  const line = pts.map((p) => p.x.toFixed(1) + "," + p.y.toFixed(1)).join(" ");
  const dots = pts.map((p, i) =>
    `<circle class="trend-dot${i === pts.length - 1 ? " is-last" : ""}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4"><title>${escapeHtml(p.r.name)} — ${p.r.pct}%</title></circle>`
  ).join("");
  el.innerHTML = `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Score trend over time">
    <line class="trend-grid" x1="${PADX}" y1="${PADY}" x2="${PADX + iw}" y2="${PADY}"/>
    <line class="trend-grid" x1="${PADX}" y1="${PADY + ih / 2}" x2="${PADX + iw}" y2="${PADY + ih / 2}"/>
    <line class="trend-grid" x1="${PADX}" y1="${PADY + ih}" x2="${PADX + iw}" y2="${PADY + ih}"/>
    <text class="trend-label" x="${PADX - 8}" y="${PADY + 4}">100</text>
    <text class="trend-label" x="${PADX - 8}" y="${PADY + ih / 2 + 4}">50</text>
    <text class="trend-label" x="${PADX - 8}" y="${PADY + ih + 4}">0</text>
    <polyline class="trend-line" points="${line}"/>${dots}
  </svg>
  <p class="trend-cap mono">${escapeHtml(recs[0].name)} → ${escapeHtml(recs[recs.length - 1].name)} · last ${recs.length} sessions (hover for details)</p>`;
}

/* best score per module as horizontal bars */
function renderPerfModules(h) {
  const el = $("perfModules");
  const byMod = new Map();
  h.forEach((r) => {
    if (r.kind !== "module" || r.modIndex === null || r.modIndex === undefined || r.modIndex < 0) return;
    const cur = byMod.get(r.modIndex) || { best: 0, count: 0 };
    cur.best = Math.max(cur.best, r.pct);
    cur.count++;
    byMod.set(r.modIndex, cur);
  });
  if (!byMod.size) {
    el.innerHTML = `<div class="page-empty small">${icon("i-layers")}<span>No module results yet.</span></div>`;
    return;
  }
  el.innerHTML = [...byMod.entries()].sort((a, b) => a[0] - b[0]).map(([idx, m]) => `
    <div class="mod-bar-row">
      <span class="mod-bar-name">Module ${idx + 1}</span>
      <span class="mod-bar"><span class="mod-bar-fill" style="width:${m.best}%"></span></span>
      <span class="mod-bar-val mono">${m.best}%</span>
      <span class="mod-bar-count mono">${m.count}×</span>
    </div>`).join("");
}

/* full simulator exam summary */
function renderPerfSim(h) {
  const el = $("perfSim");
  const sims = h.filter((r) => r.kind === "sim");
  if (!sims.length) {
    el.innerHTML = `<div class="page-empty small">${icon("i-monitor")}<span>No full simulator exams yet — launch one from the home screen.</span></div>`;
    return;
  }
  const bestPts = Math.max(...sims.map((r) => r.points || 0));
  const avgPts = Math.round(sims.reduce((s, r) => s + (r.points || 0), 0) / sims.length);
  const passRate = Math.round((100 * sims.filter((r) => r.passed).length) / sims.length);
  el.innerHTML = `
    <div class="sim-stat-row"><span>Attempts</span><strong class="mono">${sims.length}</strong></div>
    <div class="sim-stat-row"><span>Average points</span><strong class="mono">${avgPts} / 800</strong></div>
    <div class="sim-stat-row"><span>Best points</span><strong class="mono">${bestPts} / 800</strong></div>
    <div class="sim-stat-row"><span>Pass rate (536+)</span><strong class="mono">${passRate}%</strong></div>`;
}

/* ---------- mistakes view ---------- */
function renderMistakes() {
  const entries = mistakeEntries();
  const totalCleared = getMistakes().cleared;
  const hero = $("mistakeHero");
  if (!entries.length) {
    hero.innerHTML = `<div class="mistake-hero-card is-empty">${icon("i-award")}
      <div class="mistake-hero-text">
        <h3>Nothing to fix — great work!</h3>
        <p>Answer a module or simulator question incorrectly and it will appear here automatically,
        ready to replay until you get it right.${totalCleared ? " You have mastered " + totalCleared + " question" + (totalCleared === 1 ? "" : "s") + " so far." : ""}</p>
      </div></div>`;
  } else {
    hero.innerHTML = `<div class="mistake-hero-card">
      <div class="mistake-hero-count">
        <span class="mono">${entries.length}</span>
        <span>question${entries.length === 1 ? "" : "s"} to master</span>
      </div>
      <div class="mistake-hero-note">${icon("i-bulb")}<span>Each session asks your wrong questions one by one —
      answer correctly and the question leaves the list for good; miss it and it comes back at the end until you've got it.
      <strong>${totalCleared ? totalCleared + " mastered so far." : ""}</strong></span></div>
      <button class="btn btn-gold" id="startLearnBtn" type="button"><span>Start learning session</span>${icon("i-arrow-right")}</button>
    </div>`;
    $("startLearnBtn").addEventListener("click", startLearnSession);
  }
  const list = $("mistakeList");
  list.innerHTML = entries.map((e) => `
    <div class="mistake-item">
      <span class="mistake-badge mono">${e.n}× wrong</span>
      <span class="mistake-q">${escapeHtml(e.q.q)}</span>
      <span class="mistake-when mono">last ${fmtDay(e.t)}</span>
    </div>`).join("");
}

/* ---------- events ---------- */
$("prevBtn").addEventListener("click", () => navigate(-1));
$("nextBtn").addEventListener("click", () => navigate(1));
$("finishBtn").addEventListener("click", confirmFinish);
$("modalCancel").addEventListener("click", () => { $("modal").hidden = true; });
$("modalOk").addEventListener("click", () => {
  if (modalAction === "break") startBreak(false);
  else if (modalAction === "exit") abortSim();
  else if (modalAction === "clearHistory") {
    saveJSON(HISTORY_KEY, []);
    $("modal").hidden = true;
    renderHistory();
    modalAction = "finish";
  } else finish();
});
$("setupStart").addEventListener("click", startFromSetup);
$("setupCancel").addEventListener("click", () => { $("setupModal").hidden = true; });
$("customTimeMin").addEventListener("input", () => {
  // typing in the minutes field selects the Custom segment and clears errors
  selectSeg("time", "custom");
  $("customTimeMin").classList.remove("is-error");
  $("customTimeErr").hidden = true;
});
$("quitBtn").addEventListener("click", () => { state.finished = true; renderHome(); showView("home"); });
$("paletteBtn").addEventListener("click", () => { $("palette").hidden = !$("palette").hidden; });
$("paletteClose").addEventListener("click", () => { $("palette").hidden = true; });
$("brandLink").addEventListener("click", (e) => {
  e.preventDefault();
  state.finished = true;
  renderHome(); showView("home");
});
$("retakeBtn").addEventListener("click", () => {
  if (state.from === "learn") startLearnSession();
  else if (state.from === "retry") startSession(state.module, state.config, "retry", state.order.map((q) => shuffleOptions(q)));
  else startSession(state.module, state.config, "module");
});
$("backHomeBtn").addEventListener("click", () => { renderHome(); showView("home"); });
$("retryWrongBtn").addEventListener("click", retryWrong);

/* progress hub + new views */
$("hubHistory").addEventListener("click", () => { renderHistory(); showView("history"); });
$("hubPerformance").addEventListener("click", () => { renderPerformance(); showView("performance"); });
$("hubMistakes").addEventListener("click", () => { renderMistakes(); showView("mistakes"); });
const goHome = () => { renderHome(); showView("home"); };
$("historyBack").addEventListener("click", goHome);
$("perfBack").addEventListener("click", goHome);
$("mistakesBack").addEventListener("click", goHome);
$("clearHistoryBtn").addEventListener("click", () => {
  $("modalTitle").textContent = "Clear exam history?";
  $("modalBody").textContent = "All recorded exam results will be removed. Your best module scores and mistake bank are not affected.";
  modalAction = "clearHistory";
  $("modalOk").querySelector("span").textContent = "Clear history";
  $("modal").hidden = false;
  $("modalCancel").focus();
});
$("reviewFilters").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-f]");
  if (!btn) return;
  [...$("reviewFilters").children].forEach((c) => c.classList.toggle("is-active", c === btn));
  renderReview(btn.dataset.f);
});

document.addEventListener("keydown", (e) => {
  if (!$("setupModal").hidden) {
    if (e.key === "Escape") $("setupModal").hidden = true;
    if (e.key === "Enter") startFromSetup();
    return;
  }
  if (!$("importModal").hidden) {
    if (e.key === "Escape") $("importModal").hidden = true;
    return;
  }
  if (!$("simSetupModal").hidden) {
    if (e.key === "Escape") $("simSetupModal").hidden = true;
    if (e.key === "Enter") startSimFromSetup();
    return;
  }
  if (!$("simHelpModal").hidden) {
    if (e.key === "Escape" || e.key === "Enter") $("simHelpModal").hidden = true;
    return;
  }
  // simulator keyboard shortcuts (official interface: mouse-driven, keys as a convenience)
  if (!$("viewSimulator").hidden) {
    if (e.key === "ArrowRight") simNavigate(1);
    else if (e.key === "ArrowLeft") simNavigate(-1);
    else if (/^[1-5]$/.test(e.key)) simSelect(parseInt(e.key, 10) - 1);
    else if (/^[a-eA-E]$/.test(e.key) && e.target === document.body) simSelect(e.key.toLowerCase().charCodeAt(0) - 97);
    else if (e.key === "Escape") { closeSimReview(); closeSimSettings(); }
    return;
  }
  if (views.quiz.hidden) return;
  if (e.key === "ArrowRight") navigate(1);
  else if (e.key === "ArrowLeft") navigate(-1);
  else if (/^[1-5]$/.test(e.key)) selectOption(parseInt(e.key, 10) - 1);
  else if (/^[a-eA-E]$/.test(e.key) && e.target === document.body) selectOption(e.key.toLowerCase().charCodeAt(0) - 97);
});

/* ————————————————————————————————————————————————
   PROMETRIC EXAM SIMULATOR
   faithful SCFHS Prometric interface: two parts of 100
   questions with an untimed break between, mouse answering,
   back/next navigation, flag for review, countdown timer per
   part, highlight + strikethrough tools, section review
   screen, display settings themes.
   Scoring: 4 points per question — 536 / 800 to pass.
—————————————————————————————————————————————— */
const SIM_NAME_KEY = "prometric_sim_name";
const SIM_THEME_KEY = "prometric_sim_theme";
const SIM_PART_SIZE = 100;
const SIM_TOTAL_QUESTIONS = 200;   // two parts × 100
const SIM_POINTS_PER_Q = 4;
const SIM_PASS_POINTS = 536;
const SIM_BANK = {
  index: -2,
  name: "Prometric Exam Simulator",
  from: 1,
  to: QUESTIONS.length,
  questions: QUESTIONS,
  icon: "i-monitor",
};
const THEME_LABELS = {
  "default": "Black text with gray background",
  "blue": "Blue text with gray background",
  "dark-gray": "Dark gray text with gray background",
  "yellow": "Black text with yellow background",
  "light-gray": "White text with gray background",
  "pink": "Black text with pink background",
  "black": "White text with black background",
};

const sim = {
  active: false,
  part: 1,        // current exam part (1 or 2)
  totalElapsed: 0,// seconds spent on part 1 (break is untimed)
  breakActive: false,
  flags: [],      // per question: flagged for review
  snapshots: [],  // per question: saved HTML (preserves highlights/strikes across navigation)
  dirty: false,   // current question has unsaved annotations
  theme: "default",
  toastTimer: 0,
};

function simActive() { return sim.active && !$("viewSimulator").hidden; }
function simPartOffset() { return (sim.part - 1) * SIM_PART_SIZE; }
function simPartLength() { return Math.min(SIM_PART_SIZE, state.order.length - simPartOffset()); }

/* ---------- setup modal ---------- */
function openSimSetup() {
  const tWrap = $("simSetupTime");
  tWrap.innerHTML = "";
  [[30, "30 min"], [60, "1 hour"], [120, "2 hours"], ["custom", "Custom…"]]
    .forEach(([v, label]) => tWrap.appendChild(segBtn("simtime", v, label)));
  selectSeg("simtime", 120);
  $("simShuffleQ").checked = true;
  $("simShuffleOpts").checked = true;
  $("simCandInput").value = localStorage.getItem(SIM_NAME_KEY) || "";
  $("simSetupModal").hidden = false;
  $("simSetupStart").focus();
}

function startSimFromSetup() {
  const timeRaw = readSeg("simtime");
  let minutes = null;
  if (timeRaw === "custom") {
    const v = parseInt($("simCustomTimeMin").value, 10);
    if (!v || v < 1 || v > 600) {
      $("simCustomTimeErr").hidden = false;
      $("simCustomTimeMin").classList.add("is-error");
      $("simCustomTimeMin").focus();
      return;
    }
    minutes = v;
  } else {
    minutes = parseInt(timeRaw, 10);
  }
  const config = {
    count: SIM_TOTAL_QUESTIONS,
    minutes: minutes, // per part
    shuffleQ: $("simShuffleQ").checked,
    shuffleOpts: $("simShuffleOpts").checked,
    mode: "exam", // answers stay changeable until the part ends — official behaviour
    sim: true,
  };
  const candName = $("simCandInput").value.trim();
  try {
    if (candName) localStorage.setItem(SIM_NAME_KEY, candName);
    else localStorage.removeItem(SIM_NAME_KEY);
  } catch {}
  $("simSetupModal").hidden = true;
  startSession(SIM_BANK, config, "module");
}

/* ---------- begin / leave ---------- */
function simBegin() {
  sim.active = true;
  sim.part = 1;
  sim.totalElapsed = 0;
  sim.breakActive = false;
  const n = state.order.length;
  sim.flags = new Array(n).fill(false);
  sim.snapshots = new Array(n).fill(null);
  sim.dirty = false;
  document.body.style.overflow = "hidden"; // the exam fills the screen — no page scroll behind it
  applySimTheme(localStorage.getItem(SIM_THEME_KEY) || "default");
  $("simCandidate").textContent = localStorage.getItem(SIM_NAME_KEY) || "Candidate";
  $("simBreak").hidden = true;
  buildSimSidebar();
  buildSimQGrid();
  simRender();
}

function hideSimChrome() {
  document.body.style.overflow = "";
  $("viewSimulator").hidden = true;
  closeSimReview();
  closeSimSettings();
  $("simTooltip").hidden = true;
  $("simToast").hidden = true;
  $("simBreak").hidden = true;
}

function abortSim() {
  $("modal").hidden = true;
  hideSimChrome();
  sim.active = false;
  state.finished = true;
  renderHome();
  showView("home");
}

/* ---------- rendering ---------- */
function simRender() {
  const q = state.order[state.idx];
  const qText = $("simQText");
  const optsEl = $("simOpts");

  $("simQNum").textContent = state.idx - simPartOffset() + 1; // numbering restarts each part
  $("simSectionNum").textContent = sim.part;

  // restore saved annotations for this question, or render fresh
  const snap = sim.snapshots[state.idx];
  if (snap) {
    qText.innerHTML = snap.q;
    optsEl.innerHTML = snap.opts;
  } else {
    qText.innerHTML = escapeHtml(q.q);
    optsEl.innerHTML = q.o.map((t, j) =>
      `<div class="sim-option" data-j="${j}"><span class="sim-option-label">${LETTERS[j]}</span><span class="sim-option-text">${escapeHtml(t)}</span></div>`
    ).join("");
  }
  sim.dirty = false;

  const sel = state.answers[state.idx];
  [...optsEl.querySelectorAll(".sim-option")].forEach((el, j) => {
    el.classList.toggle("is-selected", sel === j);
    el.addEventListener("click", () => simSelect(j));
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      el.classList.toggle("is-struck");
      sim.dirty = true;
    });
  });

  $("simBackBtn").disabled = state.idx === simPartOffset();
  $("simNextBtn").disabled = state.idx === simPartOffset() + simPartLength() - 1;
  updateSimFlagBtn();
  simUpdateSidebar();
  simUpdateQGrid();
  simUpdateProgress();
  // keep the current question's number visible in the strip
  const btn = $("simSidebar").children[state.idx - simPartOffset()];
  if (btn) btn.scrollIntoView({ block: "nearest" });
}

/* select an answer with the mouse — stays changeable until the part ends */
function simSelect(j) {
  if (state.finished || !simActive() || sim.breakActive) return;
  if (state.answers[state.idx] === j) return;
  state.answers[state.idx] = j;
  const optsEl = $("simOpts");
  [...optsEl.querySelectorAll(".sim-option")].forEach((el, k) => el.classList.toggle("is-selected", k === j));
  simUpdateSidebar();
  simUpdateQGrid();
  simUpdateProgress();
}

function simNavigate(delta) {
  if (sim.breakActive) return; // break screen is up — no navigation
  const offset = simPartOffset();
  const next = state.idx + delta;
  if (next < offset || next >= offset + simPartLength()) return; // navigation stays inside the current part
  simGoTo(next);
}

function simGoTo(i) {
  if (i === state.idx) return;
  saveSimSnapshot(state.idx);
  state.idx = i;
  simRender();
}

/* preserve highlights/strikes by snapshotting the question's HTML when leaving it */
function saveSimSnapshot(i) {
  if (!sim.dirty) return;
  sim.snapshots[i] = { q: $("simQText").innerHTML, opts: $("simOpts").innerHTML };
  sim.dirty = false;
}

function simTick(left) {
  const t = $("simTimer");
  t.textContent = left === null ? fmtTime(state.elapsed) : fmtTime(left);
  t.classList.toggle("is-low", left !== null && left <= 300);
}

function simUpdateProgress() {
  const offset = simPartOffset();
  const len = simPartLength();
  let answered = 0;
  for (let i = offset; i < offset + len; i++) {
    if (state.answers[i] !== null) answered++;
  }
  const pct = len ? Math.round((100 * answered) / len) : 0;
  $("simProgressFill").style.width = pct + "%";
  $("simProgressText").textContent = "Progress " + pct + "%";
}

/* ---------- question-number strip (current part only) ---------- */
function buildSimSidebar() {
  const wrap = $("simSidebar");
  wrap.innerHTML = "";
  const offset = simPartOffset(), len = simPartLength();
  for (let i = offset; i < offset + len; i++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sim-qbtn";
    b.textContent = i - offset + 1;
    b.addEventListener("click", () => simGoTo(i));
    wrap.appendChild(b);
  }
}

function simUpdateSidebar() {
  const offset = simPartOffset();
  [...$("simSidebar").children].forEach((b, k) => {
    b.classList.toggle("is-answered", state.answers[offset + k] !== null);
    b.classList.toggle("is-flagged", sim.flags[offset + k]);
    b.classList.toggle("is-current", offset + k === state.idx);
  });
}

/* ---------- flag for review ---------- */
function toggleSimFlag() {
  if (!simActive()) return;
  sim.flags[state.idx] = !sim.flags[state.idx];
  updateSimFlagBtn();
  simUpdateSidebar();
  simUpdateQGrid();
  showToast(sim.flags[state.idx]
    ? "Question " + (state.idx + 1) + " flagged for review"
    : "Question " + (state.idx + 1) + " flag removed");
}

function updateSimFlagBtn() {
  $("simFlagBtn").classList.toggle("is-flagged", !!sim.flags[state.idx]);
}

/* ---------- section review sidebar ---------- */
function openSimReview() {
  simUpdateQGrid();
  $("simReviewOverlay").hidden = false;
  $("simReview").classList.add("is-open");
  $("simReview").setAttribute("aria-hidden", "false");
}
function closeSimReview() {
  $("simReviewOverlay").hidden = true;
  $("simReview").classList.remove("is-open");
  $("simReview").setAttribute("aria-hidden", "true");
}

function buildSimQGrid() {
  const grid = $("simQGrid");
  grid.innerHTML = "";
  const offset = simPartOffset(), len = simPartLength();
  for (let i = offset; i < offset + len; i++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sim-qbtn";
    b.textContent = i - offset + 1;
    b.addEventListener("click", () => { closeSimReview(); simGoTo(i); });
    grid.appendChild(b);
  }
}

function simUpdateQGrid() {
  const offset = simPartOffset();
  const fUn = $("simFUnatt").checked, fAtt = $("simFAtt").checked, fFlag = $("simFFlag").checked;
  const anyFilter = fUn || fAtt || fFlag;
  [...$("simQGrid").children].forEach((b, k) => {
    const i = offset + k;
    b.classList.toggle("is-answered", state.answers[i] !== null);
    b.classList.toggle("is-flagged", sim.flags[i]);
    b.classList.toggle("is-current", i === state.idx);
    const match = (!anyFilter) ||
      (fUn && state.answers[i] === null) ||
      (fAtt && state.answers[i] !== null) ||
      (fFlag && sim.flags[i]);
    b.style.display = match ? "" : "none";
  });
}

/* ---------- break between the two parts ---------- */
function startBreak(auto) {
  $("modal").hidden = true;
  // bank part-1 time, freeze the countdown, show the untimed break
  sim.totalElapsed += Math.floor((Date.now() - state.startedAt) / 1000);
  sim.breakActive = true;
  hideSimTooltip();
  closeSimReview();
  closeSimSettings();
  const len = simPartLength();
  let answered = 0;
  for (let i = 0; i < len; i++) {
    if (state.answers[i] !== null) answered++;
  }
  const flagged = sim.flags.slice(0, len).filter(Boolean).length;
  $("simBreakMsg").textContent = auto
    ? "Part 1 — time expired. Your Part 1 answers have been submitted."
    : "You have completed Part 1 of the exam.";
  $("simBreakStats").textContent =
    "Part 1: " + answered + " of " + len + " answered" + (flagged ? " · " + flagged + " flagged" : "") +
    " · Part 2: " + len + " questions · " + fmtTime((state.config.minutes || 0) * 60);
  $("simBreakContinue").textContent = "Begin Part 2";
  $("simBreak").hidden = false;
}

function beginPart2() {
  $("simBreak").hidden = true;
  sim.breakActive = false;
  sim.part = 2;
  state.startedAt = Date.now(); // fresh per-part timer
  state.elapsed = 0;
  buildSimSidebar();
  buildSimQGrid();
  state.idx = simPartOffset();
  $("simTimer").textContent = fmtTime((state.config.minutes || 0) * 60);
  $("simTimer").classList.remove("is-low");
  simRender();
}

/* ---------- display settings (color themes) ---------- */
function openSimSettings() {
  $("simSettings").classList.add("is-open");
  $("simSettings").setAttribute("aria-hidden", "false");
}
function closeSimSettings() {
  $("simSettings").classList.remove("is-open");
  $("simSettings").setAttribute("aria-hidden", "true");
}

function applySimTheme(theme) {
  sim.theme = THEME_LABELS[theme] ? theme : "default";
  $("simMain").dataset.theme = sim.theme;
  $("simThemePreview").dataset.theme = sim.theme;
  $("simThemePreview").textContent = THEME_LABELS[sim.theme];
  document.querySelectorAll(".sim-theme-option").forEach((el) => {
    el.classList.toggle("is-selected", el.dataset.theme === sim.theme);
  });
  try { localStorage.setItem(SIM_THEME_KEY, sim.theme); } catch {}
}

/* ---------- highlight tool (select text → highlighter appears) ---------- */
function hideSimTooltip() { $("simTooltip").hidden = true; }

function onSimMouseUp(e) {
  if (!simActive()) return;
  if ($("simTooltip").contains(e.target)) return;
  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : "";
  if (!text || !sel.rangeCount || !$("simContent").contains(sel.anchorNode)) {
    hideSimTooltip();
    return;
  }
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  const tip = $("simTooltip");
  tip.hidden = false;
  const x = Math.min(Math.max(8, rect.left + rect.width / 2 - 22), window.innerWidth - 52);
  const y = Math.max(8, rect.top - 52);
  tip.style.left = x + "px";
  tip.style.top = y + "px";
}

function highlightSelection() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.toString().trim()) return;
  const range = sel.getRangeAt(0);
  if (!$("simContent").contains(range.commonAncestorContainer)) return;
  const mark = document.createElement("mark");
  mark.className = "sim-hl";
  try {
    range.surroundContents(mark);
  } catch {
    // selection crosses element boundaries — wrap its contents instead
    mark.appendChild(range.extractContents());
    range.insertNode(mark);
  }
  sel.removeAllRanges();
  hideSimTooltip();
  sim.dirty = true;
}

/* ---------- toast ---------- */
function showToast(msg) {
  const t = $("simToast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(sim.toastTimer);
  sim.toastTimer = setTimeout(() => { t.hidden = true; }, 1900);
}

/* ---------- simulator events ---------- */
$("simLaunchBtn").addEventListener("click", openSimSetup);
$("simSetupStart").addEventListener("click", startSimFromSetup);
$("simSetupCancel").addEventListener("click", () => { $("simSetupModal").hidden = true; });
$("simCustomTimeMin").addEventListener("input", () => {
  selectSeg("simtime", "custom");
  $("simCustomTimeMin").classList.remove("is-error");
  $("simCustomTimeErr").hidden = true;
});
$("simBackBtn").addEventListener("click", () => simNavigate(-1));
$("simNextBtn").addEventListener("click", () => simNavigate(1));
$("simFinishBtn").addEventListener("click", confirmFinish);
$("simFlagBtn").addEventListener("click", toggleSimFlag);
$("simBreakContinue").addEventListener("click", beginPart2);
$("simExitBtn").addEventListener("click", () => {
  $("modalTitle").textContent = "Exit the exam?";
  $("modalBody").textContent = "Your answers in this session will be discarded.";
  modalAction = "exit";
  $("modalOk").querySelector("span").textContent = "Exit exam";
  $("modal").hidden = false;
  $("modalCancel").focus();
});
$("simReviewBtn").addEventListener("click", () => {
  $("simReview").classList.contains("is-open") ? closeSimReview() : openSimReview();
});
$("simReviewClose").addEventListener("click", closeSimReview);
$("simReviewOverlay").addEventListener("click", closeSimReview);
[$("simFUnatt"), $("simFAtt"), $("simFFlag")].forEach((c) => c.addEventListener("change", simUpdateQGrid));
$("simFClear").addEventListener("click", () => {
  $("simFUnatt").checked = $("simFAtt").checked = $("simFFlag").checked = false;
  simUpdateQGrid();
});
$("simSettingsBtn").addEventListener("click", () => {
  $("simSettings").classList.contains("is-open") ? closeSimSettings() : openSimSettings();
});
$("simSettingsClose").addEventListener("click", closeSimSettings);
$("simHelpBtn").addEventListener("click", () => { $("simHelpModal").hidden = false; });
$("simHelpClose").addEventListener("click", () => { $("simHelpModal").hidden = true; });
$("simThemePreview").addEventListener("click", () => applySimTheme("default"));
document.querySelectorAll(".sim-theme-option").forEach((el) => {
  el.addEventListener("click", () => applySimTheme(el.dataset.theme));
});
document.addEventListener("mouseup", onSimMouseUp);
$("simHlBtn").addEventListener("mousedown", (e) => e.preventDefault()); // keep the text selected
$("simHlBtn").addEventListener("click", highlightSelection);
$("simContent").addEventListener("scroll", hideSimTooltip);
document.addEventListener("mousedown", (e) => {
  if (!$("simTooltip").hidden && !$("simTooltip").contains(e.target)) hideSimTooltip();
});

/* ————————————————————————————————————————————————
   IMPORT QUESTIONS — txt · Word (.docx) · PDF → new module
   everything is parsed on-device; nothing is uploaded.
—————————————————————————————————————————————— */
const importState = { questions: [], fileName: "" };

/* generic toast (works outside the simulator too) */
function notify(msg) {
  let t = document.getElementById("appToast");
  if (!t) {
    t = document.createElement("div");
    t.id = "appToast";
    t.className = "app-toast mono";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("is-on");
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => t.classList.remove("is-on"), 2800);
}

/* ---------- minimal zip reader (for .docx) ---------- */
async function inflateRaw(data) {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Response(new Blob([data]).stream().pipeThrough(ds));
  return new Uint8Array(await stream.arrayBuffer());
}
async function readZip(buf) {
  if (typeof DecompressionStream === "undefined") {
    throw "This browser can't unpack Office files (DecompressionStream missing) — try a .txt or .pdf instead";
  }
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65536); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw "This .docx file looks corrupted (not a valid zip)";
  const count = dv.getUint16(eocd + 10, true);
  let ptr = dv.getUint32(eocd + 16, true);
  const td = new TextDecoder(), out = {};
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(ptr, true) !== 0x02014b50) break;
    const method = dv.getUint16(ptr + 10, true);
    const compSize = dv.getUint32(ptr + 20, true);
    const nameLen = dv.getUint16(ptr + 28, true);
    const extraLen = dv.getUint16(ptr + 30, true);
    const commLen = dv.getUint16(ptr + 32, true);
    const lho = dv.getUint32(ptr + 42, true);
    const name = td.decode(u8.subarray(ptr + 46, ptr + 46 + nameLen));
    const lNameLen = dv.getUint16(lho + 26, true);
    const lExtraLen = dv.getUint16(lho + 28, true);
    const dataStart = lho + 30 + lNameLen + lExtraLen;
    const data = u8.subarray(dataStart, dataStart + compSize);
    out[name] = method === 0 ? data : await inflateRaw(data);
    ptr += 46 + nameLen + extraLen + commLen;
  }
  return out;
}
function decodeXmlEntities(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&amp;/g, "&");
}
async function docxToText(buf) {
  const files = await readZip(buf);
  const xmlBytes = files["word/document.xml"];
  if (!xmlBytes) throw "Not a readable .docx — if it is an old .doc file, save it as .docx, .pdf or .txt first";
  const xml = new TextDecoder().decode(xmlBytes);
  const paras = xml.split(/<w:p[ >]/).slice(1);
  return paras.map((p) => {
    let s = "";
    const re = /<w:t[^>]*>([\s\S]*?)<\/w:t>|<w:br[^>]*\/?>/g;
    let m;
    while ((m = re.exec(p))) s += m[1] === undefined ? "\n" : decodeXmlEntities(m[1]);
    return s;
  }).join("\n");
}

/* ---------- pdf text extraction (vendored pdf.js, loaded on first use) ---------- */
let pdfJsPromise = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve();
  if (pdfJsPromise) return pdfJsPromise;
  pdfJsPromise = new Promise((resolve, reject) => {
    const worker = document.createElement("script");
    worker.src = "pdf.worker.min.js?v=1";
    const main = document.createElement("script");
    main.src = "pdf.min.js?v=1";
    main.onload = () => {
      if (!window.pdfjsLib) { reject("pdf.js failed to initialise"); return; }
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "pdf.worker.min.js?v=1";
      resolve();
    };
    main.onerror = () => reject("pdf.js failed to load");
    document.head.appendChild(worker);
    document.head.appendChild(main);
  });
  return pdfJsPromise;
}
async function pdfToText(buf) {
  await loadPdfJs();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    let lastY = null, cur = "";
    for (const it of tc.items) {
      if (!it.str) continue;
      const y = Math.round(it.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 2 && cur.trim()) {
        lines.push(cur.trim());
        cur = "";
      }
      cur += it.str + (it.hasEOL ? "\n" : " ");
      lastY = y;
    }
    if (cur.trim()) lines.push(cur.trim());
    lines.push("");
  }
  return lines.join("\n");
}

/* ---------- flexible MCQ parser ---------- */
function mcqLetterToIdx(ch) {
  if (!ch) return null;
  const ARABIC = { "ا": 0, "أ": 0, "إ": 0, "آ": 0, "ب": 1, "ج": 2, "د": 3, "ه": 4 };
  const c = ch.toUpperCase();
  if (c >= "A" && c <= "E") return c.charCodeAt(0) - 65;
  if (c >= "1" && c <= "5") return +c - 1;
  if (ARABIC[ch] !== undefined) return ARABIC[ch];
  return null;
}
function parseMCQText(text) {
  const OPT_RE = /^(?:[*•·\-–—]\s*)?\(?([A-Ea-e])[).:\-–—]\s*(.+)$/;
  const NUMQ_RE = /^(?:Q(?:ues|uestion)?\.?\s*)?(\d{1,3})\s*[).:\-–]\s*(.+)$/i;
  const ANS_RE = /(?:correct\s*answer|answer|ans|key)\s*(?:is)?\s*[:\-–—=]?\s*\(?([A-Ea-e1-5])\)?\s*\.?\s*$/i;
  const ANS_AR_RE = /(?:الإجابة|الاجابة|إجابة|اجابة)(?:\s*الصحيحة)?\s*[:\-–—]?\s*([أ-يa-eA-E1-5])/;
  const ANS_BARE_RE = /^\(?([A-Ea-e])\)?[.:]?$/;
  const INLINE_CORRECT = /\s*[\(\[✓*]*\s*(?:correct(?:\s*answer)?|✓)\s*[\)\]]*\s*$/i;

  const lines = String(text).split(/\r\n|\r|\n/)
    .map((l) => l.replace(/[\u00a0\u200e\u200f\u202a-\u202e]/g, " ").replace(/[\t ]+/g, " ").trim())
    .filter((l) => l && !/^page \d+(\s*of\s*\d+)?$/i.test(l) && !/^\d+\s*\|\s*\d+$/.test(l));

  // numbered-question documents: drop the preamble (titles, links) before Q1
  const numCount = lines.reduce((s, l) => s + (NUMQ_RE.test(l) ? 1 : 0), 0);
  let useLines = lines;
  if (numCount >= 2) {
    const firstNum = lines.findIndex((l) => NUMQ_RE.test(l));
    if (firstNum > 0) useLines = lines.slice(firstNum);
  }

  const questions = [];
  let cur = null, skipped = 0;
  const start = () => { cur = { qLines: [], opts: [], answerIdx: null }; };
  function close() {
    if (!cur) return;
    const qText = cur.qLines.join(" ").replace(/\s+/g, " ").trim();
    const opts = cur.opts.map((o) => o.text.replace(/\s+/g, " ").trim()).filter(Boolean);
    if (qText && opts.length >= 2) {
      let a = cur.answerIdx;
      if (a !== null && (a < 0 || a >= Math.min(opts.length, 5))) a = null;
      questions.push({ q: qText, o: opts.slice(0, 5), a });
    } else if (qText || opts.length) {
      skipped++;
    }
    cur = null;
  }

  for (const line of useLines) {
    // answer lines: "Answer: B" · "Correct answer — C" · "الإجابة: ب" · bare "B"
    let m = line.match(ANS_RE);
    if (!m) m = line.match(ANS_AR_RE);
    if (!m) m = line.match(ANS_BARE_RE);
    if (m) {
      const idx = mcqLetterToIdx(m[1]);
      if (cur && idx !== null) cur.answerIdx = idx;
      continue;
    }
    // "(correct)" marker on an option line
    let work = line, inlineAns = false;
    if (INLINE_CORRECT.test(work)) { inlineAns = true; work = work.replace(INLINE_CORRECT, " ").trim(); if (!work) continue; }

    let om = work.match(OPT_RE);
    if (!om && cur && cur.qLines.length) om = work.match(/^[*•\-–—]\s+(.+)$/); // "- option" style
    const qm = work.match(NUMQ_RE);
    // a numbered line starts a new question only once the previous one has its options
    if (qm && cur && cur.opts.length >= 2) {
      close(); start();
      cur.qLines.push(qm[2].trim());
      continue;
    }
    if (om && cur && cur.qLines.length) {
      cur.opts.push({ text: om[2] !== undefined ? om[2].trim() : om[1].trim() });
      if (inlineAns) cur.answerIdx = cur.opts.length - 1;
      continue;
    }
    if (!cur) start();
    if (cur.opts.length) {
      // wrapped option continuation
      cur.opts[cur.opts.length - 1].text += " " + work;
      if (inlineAns) cur.answerIdx = cur.opts.length - 1;
    } else {
      cur.qLines.push(qm ? qm[2].trim() : work);
    }
  }
  close();
  return { questions, skipped };
}

/* ---------- import modal ---------- */
function openImport() {
  importState.questions = [];
  importState.fileName = "";
  $("importDropText").innerHTML = "<strong>Choose a file</strong> or drag it here";
  $("importFile").value = "";
  $("importPaste").value = "";
  $("importName").value = "";
  $("importSummary").hidden = true;
  $("importPreview").hidden = true;
  $("importPreview").innerHTML = "";
  $("importSave").disabled = true;
  renderImportManage();
  $("importModal").hidden = false;
  $("importDrop").focus();
}

function renderImportManage() {
  const c = getCustom();
  const wrap = $("importManage"), list = $("importManageList");
  wrap.hidden = !c.modules.length;
  list.innerHTML = c.modules.map((m) => `
    <div class="import-manage-row">
      ${icon("i-import")}
      <span class="import-manage-name">${escapeHtml(m.name)}</span>
      <span class="import-manage-count mono">${m.questions.length} Q</span>
      <button class="import-manage-del" type="button" data-del="${m.id}">${icon("i-trash")}delete</button>
    </div>`).join("");
}

async function handleImportFile(file) {
  if (!file) return;
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  $("importDropText").innerHTML = "Reading <strong>" + escapeHtml(file.name) + "</strong>…";
  try {
    let text;
    if (ext === "txt" || ext === "text" || file.type === "text/plain") {
      text = await file.text();
    } else if (ext === "docx") {
      text = await docxToText(await file.arrayBuffer());
    } else if (ext === "pdf") {
      text = await pdfToText(await file.arrayBuffer());
    } else if (ext === "doc") {
      throw "Old .doc format — please save the file as .docx, .pdf or .txt first";
    } else {
      throw "Unsupported file type ." + ext + " — use .txt, .docx or .pdf";
    }
    importState.fileName = file.name.replace(/\.[^.]+$/, "").slice(0, 40);
    importParsed(text);
  } catch (err) {
    importFail(typeof err === "string" ? err : (err && err.message) || "Could not read this file");
  }
}

function importFail(msg) {
  importState.questions = [];
  $("importDropText").innerHTML = "<strong>Choose a file</strong> or drag it here";
  const s = $("importSummary");
  s.hidden = false;
  s.className = "import-summary is-warn";
  s.textContent = msg;
  $("importPreview").hidden = true;
  $("importSave").disabled = true;
}

function importParsed(text) {
  const res = parseMCQText(text);
  importState.questions = res.questions;
  if (!($("importName").value.trim()) && importState.fileName) {
    $("importName").value = importState.fileName;
  }
  renderImportPreview();
}

function renderImportPreview() {
  const qs = importState.questions;
  const s = $("importSummary");
  s.hidden = false;
  if (!qs.length) {
    s.className = "import-summary is-warn";
    s.textContent = "No questions detected — check the format: numbered question, A) B) C) D) options, then Answer: X.";
    $("importPreview").hidden = true;
    $("importSave").disabled = true;
    return;
  }
  const noAns = qs.filter((q) => q.a === null).length;
  s.className = "import-summary" + (noAns ? " is-warn" : "");
  s.innerHTML = icon("i-check-c") + " " + qs.length + " question" + (qs.length === 1 ? "" : "s") + " detected · " +
    (noAns ? noAns + " without a keyed answer (will default to A — fix below)" : "all answers keyed");
  const list = $("importPreview");
  list.hidden = false;
  list.innerHTML = qs.map((q, i) => {
    const opts = q.o.map((t, j) =>
      `<span class="${q.a === j ? "is-correct-opt" : ""}">${LETTERS[j]}) ${escapeHtml(t)}</span>`).join("");
    const sel = q.o.slice(0, 5).map((_, j) =>
      `<option value="${j}"${q.a === j ? " selected" : ""}>${LETTERS[j]}</option>`).join("");
    return `<div class="import-q${q.a === null ? " is-noans" : ""}">
      <div class="import-q-text">${i + 1}. ${escapeHtml(q.q)}</div>
      <div class="import-q-opts">${opts}</div>
      <div class="import-q-foot">
        <span>correct answer</span>
        <select data-qidx="${i}"><option value="-1">—</option>${sel}</select>
        ${q.a === null ? '<span class="import-noans-tag">no answer found — defaults to A</span>' : ""}
      </div>
    </div>`;
  }).join("");
  $("importSave").disabled = false;
}

function saveImportedModule() {
  const qs = importState.questions;
  if (!qs.length) return;
  const c = getCustom();
  const name = $("importName").value.trim() || "Imported module " + (c.modules.length + 1);
  const modId = Date.now();
  const questions = qs.map((q) => ({
    q: q.q,
    o: q.o.slice(0, 5),
    a: q.a === null || q.a < 0 ? 0 : q.a,
    id: c.nextId++,
  }));
  c.modules.push({ id: modId, name, questions });
  saveCustom(c);
  MODULES.push({
    index: MODULES.length, name, from: 1, to: questions.length,
    questions, icon: "i-import", custom: true, customId: modId,
  });
  $("importModal").hidden = true;
  renderHome();
  showView("home");
  notify("Imported " + questions.length + " questions as “" + name + "”");
}

function deleteCustomModule(id) {
  const c = getCustom();
  const idx = c.modules.findIndex((m) => m.id === id);
  if (idx < 0) return;
  const name = c.modules[idx].name;
  c.modules.splice(idx, 1);
  saveCustom(c);
  // rebuild the module list: keep the official modules, re-append the rest
  const officialCount = Math.ceil(QUESTIONS.length / MODULE_SIZE);
  while (MODULES.length > officialCount) MODULES.pop();
  addCustomModulesTo(c);
  renderImportManage();
  renderHome();
  notify("Deleted imported module “" + name + "”");
}

/* ————————————————————————————————————————————————
   EXPORT EXAM RESULT AS PDF — self-contained generator
—————————————————————————————————————————————— */
const PDF_W = 595.28, PDF_H = 841.89, PDF_MARGIN = 52;

/* keep PDF strings to WinAnsi-safe ASCII */
function pdfClean(s) {
  return String(s)
    .replace(/[\u2018\u2019\u201B]/g, "'").replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-").replace(/\u2026/g, "...")
    .replace(/\u2022/g, "-").replace(/\t/g, "  ");
}
function pdfEscape(s) {
  let out = "";
  for (const ch of pdfClean(s)) {
    const c = ch.codePointAt(0);
    if (ch === "(" || ch === ")" || ch === "\\") out += "\\" + ch;
    else if (c >= 32 && c <= 126) out += ch;
    else if (c > 32 && c <= 255) out += ch;
    else out += "?";
  }
  return out;
}
function pdfTextWidth(s, size) {
  let w = 0;
  for (const ch of pdfClean(s)) {
    const c = ch.codePointAt(0);
    let f;
    if (c >= 65 && c <= 90) f = 0.70;
    else if (c >= 97 && c <= 122) f = "iljtf".includes(ch) ? 0.30 : ("mw".includes(ch) ? 0.86 : 0.53);
    else if (c >= 48 && c <= 57) f = 0.556;
    else if (ch === " ") f = 0.28;
    else if (".,:;'!|".includes(ch)) f = 0.28;
    else if ("()[]".includes(ch)) f = 0.36;
    else if (ch === "-" || ch === "\u2013" || ch === "\u2014") f = 0.42;
    else f = 0.58;
    w += f * size;
  }
  return w;
}
function pdfWrap(text, size, width) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const cand = line ? line + " " + w : w;
    if (!line || pdfTextWidth(cand, size) <= width) line = cand;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function collectReport() {
  const isLearn = state.from === "learn";
  const byId = new Map();
  if (isLearn) {
    state.order.forEach((q, i) => {
      const a = state.answers[i];
      if (a !== null || !byId.has(q.id)) byId.set(q.id, { q, a });
    });
  }
  const entries = isLearn ? [...byId.values()] : state.order.map((q, i) => ({ q, a: state.answers[i] }));
  let correct = 0, wrong = 0, skipped = 0;
  entries.forEach(({ q, a }) => {
    if (a === null) skipped++;
    else if (a === q.a) correct++;
    else wrong++;
  });
  const total = isLearn ? state.learn.initial : entries.length;
  const pct = total ? Math.round((100 * correct) / total) : 0;
  const isSim = !isLearn && state.config && state.config.sim && state.from !== "retry";
  const points = isSim ? correct * SIM_POINTS_PER_Q : null;
  const passed = isSim ? points >= SIM_PASS_POINTS : pct >= 60;
  return {
    kind: isLearn ? "learn" : isSim ? "sim" : state.from,
    title: isLearn ? "Learn from Mistakes" : (state.module ? state.module.name : "Exam"),
    mode: isLearn ? "learn" : state.mode,
    date: new Date(),
    duration: isSim ? sim.totalElapsed + state.elapsed : state.elapsed,
    timedOut: state.timedOut,
    correct, wrong, skipped, total, pct, points, passed,
    questions: entries.map(({ q, a }, i) => ({
      n: i + 1,
      q: q.q,
      o: q.o,
      your: a,
      correct: q.a,
    })),
  };
}

function buildResultPdfBytes() {
  const rep = collectReport();
  const pages = [];
  let ops = [];
  let y = PDF_H - PDF_MARGIN;
  const CONTENT_W = PDF_W - PDF_MARGIN * 2;
  const newPage = () => { pages.push(ops); ops = []; y = PDF_H - PDF_MARGIN; };
  const need = (h) => { if (y - h < PDF_MARGIN + 26) newPage(); };
  const drawText = (str, size, font, x, yy, rgb) => {
    if (rgb) ops.push(rgb + " rg");
    ops.push("BT /" + font + " " + size + " Tf 1 0 0 1 " + x.toFixed(2) + " " + yy.toFixed(2) + " Tm (" + pdfEscape(str) + ") Tj ET");
    if (rgb) ops.push("0 0 0 rg");
  };
  const para = (str, size, font, rgb, indent) => {
    pdfWrap(str, size, CONTENT_W - (indent || 0)).forEach((ln) => {
      need(size + 4);
      drawText(ln, size, font, PDF_MARGIN + (indent || 0), y - size, rgb);
      y -= size + 4;
    });
  };
  const rule = (gap) => {
    need(10);
    ops.push("0.79 0.64 0.15 rg " + PDF_MARGIN + " " + (y - 2).toFixed(2) + " " + CONTENT_W.toFixed(2) + " 1.5 re f");
    ops.push("0 0 0 rg");
    y -= gap;
  };
  const GREEN = "0.18 0.49 0.31", RED = "0.71 0.26 0.18", GOLD = "0.66 0.51 0.1", SOFT = "0.42 0.39 0.33";

  // header
  drawText("Prometric Prep — Exam Report", 16, "F2", PDF_MARGIN, y - 16);
  y -= 22;
  ops.push("0.79 0.64 0.15 rg " + PDF_MARGIN + " " + y.toFixed(2) + " " + CONTENT_W.toFixed(2) + " 2 re f");
  ops.push("0 0 0 rg");
  y -= 14;
  const when = rep.date;
  para(rep.title + "  ·  " + rep.mode + " mode", 11.5, "F2", null, 0);
  para("Date: " + when.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) +
    "   ·   Time: " + when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) +
    "   ·   Duration: " + fmtTime(rep.duration) + (rep.timedOut ? " (time expired)" : ""), 9.5, "F1", SOFT, 0);
  y -= 4;

  // score block
  need(84);
  const scoreLine = "Score: " + rep.correct + " / " + rep.total + "  (" + rep.pct + "%)" +
    (rep.points !== null ? "   ·   " + rep.points + " / " + (rep.total * SIM_POINTS_PER_Q) + " points" : "") +
    "   —   " + (rep.passed ? "PASS" : "FAIL");
  para(scoreLine, 13, "F2", rep.passed ? GREEN : RED, 0);
  para("Correct " + rep.correct + "   ·   Incorrect " + rep.wrong + "   ·   Skipped " + rep.skipped, 10, "F1", SOFT, 0);
  rule(12);

  // questions & answers
  para("Questions & Answers", 12.5, "F2", null, 0);
  y -= 2;
  const KIND_LABEL = { learn: ["Cleared", "Still wrong", "Pending"], other: ["Correct", "Incorrect", "Skipped"] };
  const L = rep.kind === "learn" ? KIND_LABEL.learn : KIND_LABEL.other;
  rep.questions.forEach((item) => {
    const status = item.your === null ? "skip" : item.your === item.correct ? "ok" : "bad";
    const label = status === "ok" ? L[0] : status === "bad" ? L[1] : L[2];
    const rgb = status === "ok" ? GREEN : status === "bad" ? RED : SOFT;
    need(34);
    para("Q" + item.n + " — " + label, 10, "F2", rgb, 0);
    para(item.q, 10.5, "F1", null, 14);
    item.o.forEach((optText, j) => {
      const isCorrect = j === item.correct, isYours = j === item.your;
      let suffix = "";
      if (isCorrect && isYours) suffix = "   [correct answer · your answer]";
      else if (isCorrect) suffix = "   [correct answer]";
      else if (isYours) suffix = "   [your answer]";
      const line = LETTERS[j] + ") " + optText + suffix;
      const c = isCorrect ? GREEN : isYours ? RED : null;
      pdfWrap(line, 9.5, CONTENT_W - 26).forEach((ln, k) => {
        need(13.5);
        drawText(ln, 9.5, isCorrect ? "F2" : "F1", PDF_MARGIN + 26, y - 9.5, k === 0 ? c : null);
        y -= 13.5;
      });
    });
    y -= 8;
  });

  // answer key
  need(60);
  rule(4);
  para("Answer Key", 12.5, "F2", null, 0);
  let row = "";
  const keyRows = [];
  rep.questions.forEach((item) => {
    row += "Q" + item.n + ": " + (item.correct >= 0 && item.correct < item.o.length ? LETTERS[item.correct] : "-") + "    ";
    if (((item.n) % 6) === 0) { keyRows.push(row); row = ""; }
  });
  if (row.trim()) keyRows.push(row);
  keyRows.forEach((r) => para(r.trim(), 10, "F1", null, 0));

  pages.push(ops);

  // page footers
  pages.forEach((p, i) => {
    const label = "Page " + (i + 1) + " of " + pages.length;
    const x = (PDF_W - pdfTextWidth(label, 8)) / 2;
    p.push("BT /F1 8 Tf 1 0 0 1 " + x.toFixed(2) + " 30 Tm (" + pdfEscape(label) + ") Tj ET");
  });

  return { bytes: assemblePdf(pages), rep };
}

function assemblePdf(pages) {
  const objs = [];
  const firstContent = 5;
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = "<< /Type /Pages /Kids [" + pages.map((_, i) => (firstContent + i * 2 + 1) + " 0 R").join(" ") + "] /Count " + pages.length + " >>";
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  pages.forEach((content, i) => {
    const cNum = firstContent + i * 2, pNum = cNum + 1;
    const streamBody = content.join("\n");
    objs[cNum] = "<< /Length " + streamBody.length + " >>\nstream\n" + streamBody + "\nendstream";
    objs[pNum] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents " + cNum + " 0 R >>";
  });
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = pdf.length;
    pdf += i + " 0 obj\n" + objs[i] + "\nendobj\n";
  }
  const xref = pdf.length;
  pdf += "xref\n0 " + objs.length + "\n0000000000 65535 f \n";
  for (let i = 1; i < objs.length; i++) pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  pdf += "trailer\n<< /Size " + objs.length + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF";
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}

function bytesToB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  }
  return btoa(s);
}

async function savePdfBytes(bytes, filename) {
  // 1) Windows desktop app — native Save As dialog
  try {
    if (window.pywebview && window.pywebview.api && window.pywebview.api.save_pdf) {
      const r = await window.pywebview.api.save_pdf(filename, bytesToB64(bytes));
      return !!r;
    }
  } catch {}
  // 2) Android app — saves into Downloads via the JavascriptInterface bridge
  try {
    if (window.AndroidSaver && window.AndroidSaver.savePdf) {
      window.AndroidSaver.savePdf(filename, bytesToB64(bytes));
      return true;
    }
  } catch {}
  // 3) browser — plain download
  try {
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch {}
  return false;
}

async function exportResultsPdf() {
  if (!state.finished) return;
  const btn = $("exportPdfBtn").querySelector("span");
  const original = btn.textContent;
  btn.textContent = "Building PDF…";
  try {
    const { bytes, rep } = buildResultPdfBytes();
    const safe = rep.title.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "Exam";
    const filename = "Prometric-Report-" + safe + "-" + rep.date.toISOString().slice(0, 10) + ".pdf";
    const ok = await savePdfBytes(bytes, filename);
    btn.textContent = ok ? "Exported ✓" : "Export cancelled";
  } catch (err) {
    btn.textContent = "Export failed";
  }
  setTimeout(() => { btn.textContent = original; }, 2400);
}

/* ---------- import & export events ---------- */
$("hubImport").addEventListener("click", openImport);
$("importClose").addEventListener("click", () => { $("importModal").hidden = true; });
$("importDrop").addEventListener("click", () => $("importFile").click());
$("importDrop").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") $("importFile").click(); });
$("importFile").addEventListener("change", (e) => handleImportFile(e.target.files && e.target.files[0]));
["dragover", "dragenter"].forEach((ev) => $("importDrop").addEventListener(ev, (e) => {
  e.preventDefault();
  $("importDrop").classList.add("is-over");
}));
["dragleave", "drop"].forEach((ev) => $("importDrop").addEventListener(ev, (e) => {
  e.preventDefault();
  $("importDrop").classList.remove("is-over");
}));
$("importDrop").addEventListener("drop", (e) => {
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) handleImportFile(f);
});
$("importParsePaste").addEventListener("click", () => {
  const t = $("importPaste").value.trim();
  if (!t) { notify("Paste some questions first"); return; }
  importState.fileName = "";
  importParsed(t);
});
$("importPreview").addEventListener("change", (e) => {
  const sel = e.target.closest("select[data-qidx]");
  if (!sel) return;
  const q = importState.questions[+sel.dataset.qidx];
  if (q) q.a = sel.value === "-1" ? null : +sel.value;
  renderImportPreview();
});
$("importSave").addEventListener("click", saveImportedModule);
$("importManageList").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-del]");
  if (!btn) return;
  deleteCustomModule(+btn.dataset.del);
});
$("exportPdfBtn").addEventListener("click", exportResultsPdf);

/* ---------- boot ---------- */
function animateHomeStats() {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelectorAll("[data-count]").forEach((el) => {
    const target = parseInt(el.dataset.count, 10);
    if (reduce || !target) { el.textContent = el.dataset.count; return; }
    const t0 = performance.now(), dur = 900;
    (function frame(t) {
      const p = Math.min(1, (t - t0) / dur);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(frame);
    })(t0);
  });
}
animateHomeStats();
renderHome();
showView("home");

/* PWA service worker */
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
