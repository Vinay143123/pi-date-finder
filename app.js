const els = {
  form: document.querySelector("#searchForm"),
  input: document.querySelector("#dateInput"),
  inputStatus: document.querySelector("#inputStatus"),
  searchButton: document.querySelector("#searchButton"),
  depthButtons: Array.from(document.querySelectorAll(".depth-option")),
  deeperButton: document.querySelector("#deeperButton"),
  stopButton: document.querySelector("#stopButton"),
  meterFill: document.querySelector("#meterFill"),
  cachedLabel: document.querySelector("#cachedLabel"),
  targetLabel: document.querySelector("#targetLabel"),
  resultNumber: document.querySelector("#resultNumber"),
  dateChip: document.querySelector("#dateChip"),
  digitWindow: document.querySelector("#digitWindow"),
  matchLabel: document.querySelector("#matchLabel"),
  checkedLabel: document.querySelector("#checkedLabel"),
  cacheLabel: document.querySelector("#cacheLabel"),
  canvas: document.querySelector("#digitCanvas")
};

const CACHE_KEY = "pi-date-finder-cache-v1";
const CACHE_LIMIT = 1200000;
const INITIAL_PI_SAMPLE = "14159265358979323846264338327950288419716939937510";

let piDigits = "";
let generatorState = null;
let selectedDepth = 50000;
let currentTerm = "";
let currentDateLabel = "";
let activeJobId = 0;
let activeTarget = selectedDepth;
let isSearching = false;
let cacheWritable = true;

const worker = makePiWorker();
loadCache();
syncLabels();
drawIdleSample();
startDigitCanvas();

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const parsed = parseDateTerm(els.input.value);
  if (!parsed.ok) {
    setStatus(parsed.message, true);
    setResultIdle();
    return;
  }

  currentTerm = parsed.term;
  currentDateLabel = parsed.label;
  activeTarget = Math.max(selectedDepth, piDigits.length);
  runSearch(activeTarget);
});

els.input.addEventListener("input", () => {
  const digitsOnly = els.input.value.replace(/\D/g, "").slice(0, 8);
  if (els.input.value !== digitsOnly) els.input.value = digitsOnly;

  if (digitsOnly.length === 0) {
    setStatus("Waiting for an 8 digit date.");
    return;
  }

  if (digitsOnly.length < 8) {
    setStatus(`${8 - digitsOnly.length} more digit${8 - digitsOnly.length === 1 ? "" : "s"} needed.`);
    return;
  }

  const parsed = parseDateTerm(digitsOnly);
  setStatus(parsed.ok ? parsed.label : parsed.message, !parsed.ok);
});

els.depthButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectedDepth = Number(button.dataset.depth);
    activeTarget = Math.max(selectedDepth, piDigits.length);
    els.depthButtons.forEach((item) => item.classList.toggle("is-selected", item === button));
    syncLabels();
  });
});

els.deeperButton.addEventListener("click", () => {
  selectedDepth = Math.min(Math.max(selectedDepth * 2, 100000), 5000000);
  activeTarget = Math.max(selectedDepth, piDigits.length + 50000);
  els.depthButtons.forEach((item) => item.classList.remove("is-selected"));
  syncLabels();

  if (currentTerm) runSearch(activeTarget);
});

els.stopButton.addEventListener("click", () => {
  activeJobId += 1;
  worker.postMessage({ type: "cancel" });
  isSearching = false;
  toggleBusy(false);
  setStatus("Search stopped.");
  updateMatchLabels("Stopped", piDigits.length);
});

worker.addEventListener("message", (event) => {
  const message = event.data;
  if (message.jobId !== activeJobId && message.type !== "ready") return;

  if (message.type === "chunk") {
    piDigits += message.digits;
    generatorState = message.state;
    saveCacheSoon();
    syncLabels();

    const foundIndex = findTerm(currentTerm);
    if (foundIndex >= 0) {
      activeJobId += 1;
      worker.postMessage({ type: "cancel" });
      showFound(foundIndex);
      isSearching = false;
      toggleBusy(false);
      return;
    }
  }

  if (message.type === "done") {
    generatorState = message.state;
    saveCacheSoon.flush();
    isSearching = false;
    toggleBusy(false);

    const foundIndex = findTerm(currentTerm);
    if (foundIndex >= 0) {
      showFound(foundIndex);
    } else {
      showNotFound();
    }
  }
});

function runSearch(target) {
  const cachedIndex = findTerm(currentTerm);
  els.dateChip.textContent = currentDateLabel;
  if (cachedIndex >= 0) {
    showFound(cachedIndex);
    return;
  }

  if (piDigits.length >= target) {
    showNotFound();
    return;
  }

  activeJobId += 1;
  isSearching = true;
  toggleBusy(true);
  setStatus(`Searching ${formatNumber(target)} decimal places.`);
  updateMatchLabels("Scanning", piDigits.length);
  worker.postMessage({
    type: "generate",
    jobId: activeJobId,
    target,
    state: generatorState,
    currentLength: piDigits.length
  });
}

function findTerm(term) {
  if (!term) return -1;
  return piDigits.indexOf(term);
}

function showFound(index) {
  const place = index + 1;
  els.resultNumber.textContent = formatNumber(place);
  els.matchLabel.textContent = "Found";
  els.checkedLabel.textContent = `${formatNumber(Math.max(piDigits.length, index + currentTerm.length))} decimals`;
  setStatus(`${currentDateLabel} starts at place ${formatNumber(place)} after the decimal.`);
  renderDigitWindow(index);
  syncLabels();
}

function showNotFound() {
  els.resultNumber.textContent = "--";
  els.matchLabel.textContent = "Not in range";
  els.checkedLabel.textContent = `${formatNumber(piDigits.length)} decimals`;
  setStatus(`${currentDateLabel} was not found in the first ${formatNumber(piDigits.length)} decimals.`);
  drawIdleSample();
  syncLabels();
}

function setResultIdle() {
  currentTerm = "";
  currentDateLabel = "";
  els.resultNumber.textContent = "--";
  els.dateChip.textContent = "No date selected";
  els.matchLabel.textContent = "Not searched";
  els.checkedLabel.textContent = `${formatNumber(piDigits.length)} decimals`;
  drawIdleSample();
  syncLabels();
}

function renderDigitWindow(index) {
  const start = Math.max(0, index - 22);
  const end = Math.min(piDigits.length, index + currentTerm.length + 22);
  const before = piDigits.slice(start, index);
  const match = piDigits.slice(index, index + currentTerm.length);
  const after = piDigits.slice(index + currentTerm.length, end);
  const prefix = start > 0 ? "..." : "pi = 3.";
  const suffix = end < piDigits.length ? "..." : "";

  els.digitWindow.replaceChildren(
    span(prefix, "muted"),
    document.createTextNode(before),
    span(match, "match-highlight"),
    document.createTextNode(after),
    span(suffix, "muted")
  );
}

function drawIdleSample() {
  els.digitWindow.replaceChildren(
    span("pi = 3.", "muted"),
    document.createTextNode(piDigits.slice(0, 54) || INITIAL_PI_SAMPLE)
  );
}

function span(text, className) {
  const node = document.createElement("span");
  node.className = className;
  node.textContent = text;
  return node;
}

function updateMatchLabels(label, checked) {
  els.matchLabel.textContent = label;
  els.checkedLabel.textContent = `${formatNumber(checked)} decimals`;
}

function setStatus(text, isError = false) {
  els.inputStatus.textContent = text;
  els.inputStatus.style.color = isError ? "#a4311f" : "";
}

function toggleBusy(busy) {
  els.searchButton.disabled = busy;
  els.stopButton.disabled = !busy;
  els.deeperButton.disabled = busy && !currentTerm;
}

function syncLabels() {
  const target = Math.max(activeTarget, selectedDepth);
  const progress = target > 0 ? Math.min(100, (piDigits.length / target) * 100) : 0;
  els.meterFill.style.width = `${progress.toFixed(2)}%`;
  els.cachedLabel.textContent = `Cached ${formatNumber(piDigits.length)} decimals`;
  els.targetLabel.textContent = `Target ${formatNumber(target)}`;
  els.cacheLabel.textContent = cacheWritable ? "Local cache" : "Session only";
  if (!isSearching) els.checkedLabel.textContent = `${formatNumber(piDigits.length)} decimals`;
}

function parseDateTerm(value) {
  const term = String(value).trim();
  if (!/^\d{8}$/.test(term)) {
    return { ok: false, message: "Use exactly 8 digits." };
  }

  const day = Number(term.slice(0, 2));
  const month = Number(term.slice(2, 4));
  const year = Number(term.slice(4, 8));

  if (year < 1 || month < 1 || month > 12) {
    return { ok: false, message: "That date is outside the supported calendar." };
  }

  const days = daysInMonth(month, year);
  if (day < 1 || day > days) {
    return { ok: false, message: "That date does not exist." };
  }

  return {
    ok: true,
    term,
    label: `${pad(day)}/${pad(month)}/${String(year).padStart(4, "0")}`
  };
}

function daysInMonth(month, year) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function pad(number) {
  return String(number).padStart(2, "0");
}

function formatNumber(number) {
  return new Intl.NumberFormat("en-US").format(number);
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) {
      generatorState = null;
      return;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1 || typeof parsed.digits !== "string") {
      generatorState = null;
      return;
    }

    piDigits = parsed.digits;
    generatorState = parsed.state || null;
  } catch {
    piDigits = "";
    generatorState = null;
    cacheWritable = false;
  }
}

const saveCacheSoon = debounce(() => {
  if (!cacheWritable) return;

  try {
    const digitsToStore = piDigits.length > CACHE_LIMIT ? piDigits.slice(0, CACHE_LIMIT) : piDigits;
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        version: 1,
        digits: digitsToStore,
        state: piDigits.length > CACHE_LIMIT ? null : generatorState
      })
    );
  } catch {
    cacheWritable = false;
    syncLabels();
  }
}, 350);

function debounce(fn, wait) {
  let timer = 0;
  const wrapped = (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
  wrapped.flush = () => {
    window.clearTimeout(timer);
    fn();
  };
  return wrapped;
}

function makePiWorker() {
  const source = `
    let cancelled = false;

    self.onmessage = (event) => {
      const message = event.data;

      if (message.type === "cancel") {
        cancelled = true;
        return;
      }

      if (message.type === "generate") {
        cancelled = false;
        let state = reviveState(message.state);
        let currentLength = message.currentLength || 0;
        const target = message.target;
        const jobId = message.jobId;
        const chunkSize = currentLength < 100000 ? 1600 : 900;

        while (!cancelled && currentLength < target) {
          let digits = "";
          const limit = Math.min(chunkSize, target - currentLength);

          for (let i = 0; i < limit; i += 1) {
            digits += nextDecimalDigit(state);
          }

          currentLength += digits.length;
          self.postMessage({
            type: "chunk",
            jobId,
            digits,
            state: freezeState(state),
            currentLength
          });
        }

        if (!cancelled) {
          self.postMessage({
            type: "done",
            jobId,
            state: freezeState(state),
            currentLength
          });
        }
      }
    };

    function makeInitialState() {
      return {
        q: 1n,
        r: 0n,
        t: 1n,
        k: 1n,
        n: 3n,
        l: 3n,
        integerConsumed: false
      };
    }

    function reviveState(saved) {
      if (!saved) return makeInitialState();
      return {
        q: BigInt(saved.q),
        r: BigInt(saved.r),
        t: BigInt(saved.t),
        k: BigInt(saved.k),
        n: BigInt(saved.n),
        l: BigInt(saved.l),
        integerConsumed: Boolean(saved.integerConsumed)
      };
    }

    function freezeState(state) {
      return {
        q: state.q.toString(),
        r: state.r.toString(),
        t: state.t.toString(),
        k: state.k.toString(),
        n: state.n.toString(),
        l: state.l.toString(),
        integerConsumed: state.integerConsumed
      };
    }

    function nextDecimalDigit(state) {
      while (true) {
        const digit = nextPiDigit(state);
        if (state.integerConsumed) return digit;
        state.integerConsumed = true;
      }
    }

    function nextPiDigit(state) {
      while (true) {
        if (4n * state.q + state.r - state.t < state.n * state.t) {
          const digit = state.n;
          const q = state.q;
          const r = state.r;
          const t = state.t;
          state.q = 10n * q;
          state.r = 10n * (r - digit * t);
          state.n = (10n * (3n * q + r)) / t - 10n * digit;
          return digit.toString();
        }

        const q = state.q;
        const r = state.r;
        const t = state.t;
        const k = state.k;
        const l = state.l;
        state.q = q * k;
        state.r = (2n * q + r) * l;
        state.t = t * l;
        state.k = k + 1n;
        state.n = (q * (7n * k + 2n) + r * l) / (t * l);
        state.l = l + 2n;
      }
    }
  `;

  const blob = new Blob([source], { type: "text/javascript" });
  return new Worker(URL.createObjectURL(blob));
}

function startDigitCanvas() {
  const canvas = els.canvas;
  const context = canvas.getContext("2d");
  let width = 0;
  let height = 0;
  let columns = [];
  const sample = (INITIAL_PI_SAMPLE + "2718281828459045235360287471352662497757").split("");

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    const count = Math.max(18, Math.floor(width / 44));
    columns = Array.from({ length: count }, (_, index) => ({
      x: (index + 0.5) * (width / count),
      y: Math.random() * height,
      speed: 0.18 + Math.random() * 0.42,
      offset: Math.floor(Math.random() * sample.length)
    }));
  }

  function frame() {
    context.clearRect(0, 0, width, height);
    context.fillStyle = "rgba(21, 23, 25, 0.08)";
    context.font = "700 20px ui-monospace, SFMono-Regular, Consolas, monospace";
    context.textAlign = "center";

    columns.forEach((column) => {
      column.y += column.speed;
      if (column.y > height + 40) column.y = -120;

      for (let row = 0; row < 9; row += 1) {
        const y = column.y + row * 34;
        const digit = sample[(column.offset + row) % sample.length];
        context.fillText(digit, column.x, y);
      }
    });

    requestAnimationFrame(frame);
  }

  window.addEventListener("resize", resize);
  resize();
  frame();
}
