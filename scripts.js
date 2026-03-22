const WARERA_PROXY_URL =
  window.WARERA_PROXY_URL || "https://war-era-tools-proxy.samoetools.workers.dev";

const DEFAULT_START_DATE = "2026-03-11";
const COUNTRY_ID = "683ddd2c24b5a2e114af1612";
const LIMIT = 100;
const DEFAULT_TARGET_AMOUNT = 1000;
const LEADERBOARD_SIZE = 10;

const userCache = new Map();
let fundraiserChart = null;
let incomeChart = null;
let Official = false;
let todoSyncStarted = false;

const TRANSACTION_TYPES = [
  "applicationFee",
  "trading",
  "itemMarket",
  "donation"
];

const OFFICIAL_KEY_STORAGE = "official_key_cache";

const todoItems = [];
const TODO_BYPASS_ACCESS = false;

document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.getElementById("theme-toggle");
  const todoInput = document.getElementById("todo-text");
  const officialInput = document.getElementById("official-key");
  const officialVisibility = document.getElementById("official-visibility");
  const accessInput = document.getElementById("access-input");
  if (!toggle) return;

  const stored = localStorage.getItem("theme");
  if (stored === "dark" || stored === null) {
    document.body.classList.add("dark");
    toggle.checked = true;
    if (stored === null) {
      localStorage.setItem("theme", "dark");
    }
  }

  toggle.addEventListener("change", () => {
    if (toggle.checked) {
      document.body.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.body.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
    if (incomeChart) {
      const totalDataset = incomeChart.data.datasets.find((ds) => ds.label === "total");
      if (totalDataset) {
        totalDataset.borderColor = document.body.classList.contains("dark") ? "#ffffff" : "#111111";
      }
      incomeChart.update();
    }
  });

  if (todoInput) {
    todoInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        addTodo();
      }
    });
  }

  if (officialInput) {
    const cachedKey = localStorage.getItem(OFFICIAL_KEY_STORAGE);
    if (cachedKey !== null) {
      officialInput.value = cachedKey;
    }
    officialInput.addEventListener("input", () => {
      localStorage.setItem(OFFICIAL_KEY_STORAGE, officialInput.value);
      evaluateOfficialKey();
    });
  }

  const setKeyHidden = (hidden) => {
    if (accessInput) accessInput.classList.toggle("key-hidden", hidden);
    if (officialVisibility) {
      officialVisibility.classList.toggle("is-hidden", hidden);
      officialVisibility.setAttribute("aria-label", hidden ? "Show key" : "Hide key");
    }
  };

  setKeyHidden(false);

  if (officialVisibility && officialInput) {
    officialVisibility.addEventListener("click", () => {
      const isHidden = accessInput ? accessInput.classList.contains("key-hidden") : false;
      setKeyHidden(!isHidden);
    });
  }

  evaluateOfficialKey();

  const todoList = document.getElementById("todo-list");
  if (todoList) {
    todoList.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement)) return;
      const itemId = target.dataset.id;
      if (!itemId) return;
      if (!TestForAccess("Guest")) return;
      updateTodoStatus(itemId, target.value);
    });

    todoList.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement)) return;
      if (target.dataset.action !== "delete") return;
      const itemId = target.dataset.id;
      if (!itemId) return;
      if (!TestForAccess("Guest")) return;
      deleteTodoItem(itemId);
    });
  }
});

function setOfficialState(isOfficial) {
  Official = isOfficial;
  const status = document.getElementById("official-status");
  const todoBoard = document.getElementById("todo-board");

  if (Official) {
    if (status) status.textContent = "Confirmed. Welcome.";
    if (todoBoard) todoBoard.classList.remove("hidden");
    if (!todoSyncStarted) {
      startTodoSync();
      todoSyncStarted = true;
    }
  } else {
    if (status) status.textContent = "incorrect key.";
    if (todoBoard) todoBoard.classList.add("hidden");
    stopTodoSync();
    todoSyncStarted = false;
    todoItems.length = 0;
    renderTodoList();
  }
}

let officialCheckId = 0;

async function evaluateOfficialKey() {
  const input = document.getElementById("official-key");
  const keyValue = input ? input.value : "";
  const status = document.getElementById("official-status");
  const runId = (officialCheckId += 1);

  if (!keyValue) {
    setOfficialState(false);
    return;
  }

  if (status) status.textContent = "Checking key...";

  try {
    const result = await postWarera("official", { key: keyValue });
    if (runId !== officialCheckId) return;
    setOfficialState(Boolean(result && result.ok));
  } catch (err) {
    if (runId !== officialCheckId) return;
    setOfficialState(false);
    if (status) status.textContent = "Key check failed.";
  }
}

function getOfficialKeyInput() {
  const input = document.getElementById("official-key");
  return input ? input.value : "";
}

let todoSyncTimer = null;

function startTodoSync() {
  if (todoSyncTimer) return;
  fetchTodos();
  todoSyncTimer = setInterval(fetchTodos, 15000);
}

function stopTodoSync() {
  if (todoSyncTimer) {
    clearInterval(todoSyncTimer);
    todoSyncTimer = null;
  }
}

async function fetchTodos() {
  if (!Official) return;
  const status = document.getElementById("todo-status-text");
  const key = getOfficialKeyInput();
  try {
    const data = await postWarera("todo.list", { key });
    const items = Array.isArray(data && data.items) ? data.items : [];
    todoItems.length = 0;
    for (const item of items) {
      todoItems.push({
        id: item.id,
        text: item.text || "",
        status: item.status || "todo"
      });
    }
    if (status) status.textContent = "Synced.";
    renderTodoList();
  } catch (err) {
    if (status) status.textContent = `Sync error: ${err.message}`;
  }
}

async function createTodo(text, statusValue) {
  const key = getOfficialKeyInput();
  await postWarera("todo.add", { key, text, status: statusValue });
  await fetchTodos();
}

async function updateTodoStatus(id, statusValue) {
  const key = getOfficialKeyInput();
  await postWarera("todo.update", { key, id, status: statusValue });
  await fetchTodos();
}

async function deleteTodoItem(id) {
  const key = getOfficialKeyInput();
  await postWarera("todo.delete", { key, id });
  await fetchTodos();
}

function TestForAccess(argument1) {
  if (TODO_BYPASS_ACCESS) return true;
  if (argument1 === "Admin") return Official;
  return Official;
}

function addTodo() {
  const input = document.getElementById("todo-text");
  const statusSelect = document.getElementById("todo-status");
  const status = document.getElementById("todo-status-text");
  if (!input) return;

  const text = input.value.trim();
  if (!text) return;

  const nextStatus = (statusSelect && statusSelect.value) || "todo";

  if (!TestForAccess("Guest")) {
    if (status) status.textContent = "Access denied.";
    return;
  }

  createTodo(text, nextStatus)
    .then(() => {
      input.value = "";
    })
    .catch((err) => {
      if (status) status.textContent = `Add failed: ${err.message}`;
    });
}

function renderTodoList() {
  const list = document.getElementById("todo-list");
  if (!list) return;

  list.innerHTML = "";
  for (const item of todoItems) {
    const li = document.createElement("li");
    li.className = `todo-item ${item.status}`;

    const text = document.createElement("span");
    text.className = "todo-text";
    text.textContent = item.text;

    const select = document.createElement("select");
    select.dataset.id = item.id;
    select.innerHTML = `
      <option value="todo">To Do</option>
      <option value="in-progress">In Progress</option>
      <option value="done">Done</option>
    `;
    select.value = item.status;

    const del = document.createElement("button");
    del.type = "button";
    del.dataset.action = "delete";
    del.dataset.id = item.id;
    del.textContent = "Delete";

    li.appendChild(text);
    li.appendChild(select);
    li.appendChild(del);
    list.appendChild(li);
  }
}

function parseCursor(cursorStr) {
  if (!cursorStr) return null;
  const dt = new Date(cursorStr);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function parseCreatedAt(createdAtStr) {
  if (!createdAtStr) return null;
  const dt = new Date(createdAtStr);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function formatMoney(value) {
  return Number(value || 0).toFixed(2);
}

function parseExcludedUsernames(raw) {
  if (!raw) return new Set();
  const items = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.toLowerCase());
  return new Set(items);
}

async function postWarera(endpoint, input) {
  if (WARERA_PROXY_URL.includes("YOUR_WORKER_SUBDOMAIN")) {
    throw new Error("War Era proxy URL is not configured.");
  }

  const response = await fetch(WARERA_PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint, input })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Proxy failed (${response.status}): ${text}`);
  }

  return response.json();
}

async function getUsername(userId) {
  if (!userId) return "unknown";
  if (userCache.has(userId)) return userCache.get(userId);

  let username = userId;
  try {
    const body = await postWarera("user", { userId });
    const data = body?.result?.data || {};
    username = data.username || userId;
  } catch (err) {
    username = userId;
  }

  userCache.set(userId, username);
  return username;
}

async function fetchTransactions(startDatetime, expectedPages, onProgress) {
  const allItems = [];
  let cursor = null;
  let page = 1;
  const nowUtc = new Date();

  while (true) {
    const inputPayload = {
      limit: LIMIT,
      countryId: COUNTRY_ID,
      transactionType: "donation"
    };

    if (cursor) {
      inputPayload.cursor = cursor;
    }

    const body = await postWarera("transaction", inputPayload);
    const data = body?.result?.data || {};
    const payload = typeof data === "object" && data !== null ? (data.json || data) : data;
    const items = payload?.items || [];
    const nextCursor = payload?.nextCursor || null;

    allItems.push(...items);
    if (typeof onProgress === "function") {
      onProgress({
        page,
        fetched: items.length,
        total: allItems.length,
        expectedPages
      });
    }

    if (!nextCursor) break;

    const nextCursorDt = parseCursor(nextCursor);
    if (nextCursorDt && nextCursorDt < startDatetime) break;

    cursor = nextCursor;
    page += 1;
  }

  const filteredItems = allItems.filter((tx) => {
    const createdAt = parseCreatedAt(tx?.createdAt);
    return createdAt && createdAt >= startDatetime && createdAt <= nowUtc;
  });

  return filteredItems;
}

async function Fundraiser() {
  const status = document.getElementById("fundraiser-status");
  const output = document.getElementById("fundraiser-output");
  const chartCanvas = document.getElementById("fundraiser-chart");
  const startInput = document.getElementById("fundraiser-start");
  const targetInput = document.getElementById("fundraiser-target");
  const excludeInput = document.getElementById("fundraiser-exclude");
  const progressBar = document.getElementById("fundraiser-progress");
  const progressText = document.getElementById("fundraiser-progress-text");

  if (status) status.textContent = "Loading...";
  if (output) output.textContent = "";
  if (progressBar) progressBar.style.width = "0%";
  if (progressText) progressText.textContent = "Starting...";

  try {
    const startValue = (startInput && startInput.value) || DEFAULT_START_DATE;
    const targetValue = parseInt((targetInput && targetInput.value) || DEFAULT_TARGET_AMOUNT, 10);

    const startDatetime = new Date(`${startValue}T00:00:00.000Z`);
    const targetAmount = Number.isNaN(targetValue) ? DEFAULT_TARGET_AMOUNT : targetValue;

    if (Number.isNaN(startDatetime.getTime())) {
      throw new Error("Invalid start date. Please use yyyy-mm-dd.");
    }

    const nowUtc = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    const daysSinceStart = Math.max(1, Math.ceil((nowUtc - startDatetime) / dayMs));
    const expectedPages = daysSinceStart * 10;

    const filteredItems = await fetchTransactions(startDatetime, expectedPages, (info) => {
      if (status) {
        status.textContent = `Loading... page ${info.page}/${info.expectedPages} (fetched ${info.total})`;
      }
      if (progressBar && info.expectedPages) {
        const pct = Math.min(100, Math.max(1, Math.round((info.page / info.expectedPages) * 100)));
        progressBar.style.width = `${pct}%`;
      }
      if (progressText && info.expectedPages) {
        const pct = Math.min(100, Math.max(1, Math.round((info.page / info.expectedPages) * 100)));
        progressText.textContent = `Estimate: ${pct}%`;
      }
    });

    const totalsByPerson = new Map();
    const txCountByPerson = new Map();

    for (const tx of filteredItems) {
      const donorId = tx?.buyerId || "unknown";
      const amount = Number(tx?.money || 0) || 0;

      totalsByPerson.set(donorId, (totalsByPerson.get(donorId) || 0) + amount);
      txCountByPerson.set(donorId, (txCountByPerson.get(donorId) || 0) + 1);
    }

    const ranked = Array.from(totalsByPerson.entries()).sort((a, b) => b[1] - a[1]);

    const chronologicalItems = filteredItems
      .slice()
      .sort((a, b) => {
        const aTime = parseCreatedAt(a?.createdAt) || new Date(8640000000000000);
        const bTime = parseCreatedAt(b?.createdAt) || new Date(8640000000000000);
        return aTime - bTime;
      });

    const donorRunningTotal = new Map();
    const reachedAtByPerson = new Map();

    for (const tx of chronologicalItems) {
      const donorId = tx?.buyerId || "unknown";
      const amount = Number(tx?.money || 0) || 0;
      const before = donorRunningTotal.get(donorId) || 0;

      donorRunningTotal.set(donorId, before + amount);

      if (!reachedAtByPerson.has(donorId) && before < targetAmount && before + amount >= targetAmount) {
        reachedAtByPerson.set(donorId, tx?.createdAt || null);
      }
    }

    let winnerId = null;
    let winnerReachedAt = null;

    for (const [donorId, reachedAt] of reachedAtByPerson.entries()) {
      const reachedDt = parseCreatedAt(reachedAt) || new Date(8640000000000000);
      if (!winnerReachedAt || reachedDt < winnerReachedAt) {
        winnerId = donorId;
        winnerReachedAt = reachedDt;
      }
    }

    const totalsAtWinner = new Map();
    if (winnerReachedAt) {
      for (const tx of chronologicalItems) {
        const createdAt = parseCreatedAt(tx?.createdAt);
        if (!createdAt) continue;
        if (createdAt > winnerReachedAt) break;

        const donorId = tx?.buyerId || "unknown";
        const amount = Number(tx?.money || 0) || 0;
        totalsAtWinner.set(donorId, (totalsAtWinner.get(donorId) || 0) + amount);
      }
    }

    const competitorCount = Math.max(LEADERBOARD_SIZE - 1, 0);
    const competitors = winnerReachedAt
      ? Array.from(totalsAtWinner.entries())
          .filter(([donorId]) => donorId !== winnerId)
          .sort((a, b) => b[1] - a[1])
          .slice(0, competitorCount)
      : [];

    let topIds = [];
    if (winnerId && winnerReachedAt) {
      topIds = [winnerId, ...competitors.map(([donorId]) => donorId)];
    } else {
      topIds = ranked.slice(0, LEADERBOARD_SIZE).map(([donorId]) => donorId);
    }

    const lines = [];
    lines.push(`Final transaction count: ${filteredItems.length}`);
    lines.push(`Unique donors: ${ranked.length}`);

    if (winnerId && winnerReachedAt) {
      const winnerName = await getUsername(winnerId);
      lines.push("");
      lines.push(`First to ${targetAmount.toFixed(2)}: ${winnerName} (${winnerId})`);
      lines.push(`Reached at: ${winnerReachedAt.toISOString()}`);
      lines.push("");
      lines.push(`${competitorCount} closest competitors at that time:`);

      for (const [donorId, total] of competitors) {
        const username = await getUsername(donorId);
        const donations = txCountByPerson.get(donorId) || 0;
        lines.push(`${username} (${donorId}): total_at_win=${formatMoney(total)}, donations=${donations}`);
      }
    } else {
      lines.push("");
      lines.push(`No one reached ${targetAmount.toFixed(2)} in the selected period.`);

      if (topIds.length > 0) {
        lines.push("");
        lines.push(`Top ${LEADERBOARD_SIZE} donors by total in the period:`);
        for (const donorId of topIds) {
        const username = await getUsername(donorId);
        const total = totalsByPerson.get(donorId) || 0;
        const donations = txCountByPerson.get(donorId) || 0;
        lines.push(`${username} (${donorId}): total=${formatMoney(total)}, donations=${donations}`);
      }
    }
    }

    if (status) status.textContent = "Ready";
    if (progressBar) progressBar.style.width = "100%";
    if (progressText) progressText.textContent = "Estimate: 100%";
    if (output) output.textContent = lines.join("\n");

    const excludedNames = parseExcludedUsernames(excludeInput && excludeInput.value);
    const usernameById = new Map();
    for (const donorId of topIds) {
      usernameById.set(donorId, await getUsername(donorId));
    }

    const visibleTopIds = topIds.filter((donorId) => {
      const username = usernameById.get(donorId) || "";
      return !excludedNames.has(username.toLowerCase());
    });

    if (chartCanvas && visibleTopIds.length > 0 && window.Chart) {
      const series = new Map();
      const running = new Map();
      const palette = [
        "#1b6ef3",
        "#e24b5b",
        "#1f9d6c",
        "#f39c12",
        "#8e44ad",
        "#16a085",
        "#d35400",
        "#2c3e50",
        "#c0392b",
        "#7f8c8d"
      ];

      for (const donorId of visibleTopIds) {
        series.set(donorId, [{ x: startDatetime, y: 0 }]);
        running.set(donorId, 0);
      }

      for (const tx of chronologicalItems) {
        const createdAt = parseCreatedAt(tx?.createdAt);
        if (!createdAt) continue;

        const donorId = tx?.buyerId || "unknown";
        if (!series.has(donorId)) continue;

        const amount = Number(tx?.money || 0) || 0;
        const nextValue = (running.get(donorId) || 0) + amount;
        running.set(donorId, nextValue);
        series.get(donorId).push({ x: createdAt, y: nextValue });
      }

      const datasets = [];
      for (let i = 0; i < visibleTopIds.length; i += 1) {
        const donorId = visibleTopIds[i];
        const label = usernameById.get(donorId) || (await getUsername(donorId));
        const data = series.get(donorId) || [];
        const isWinner = winnerId && donorId === winnerId && winnerReachedAt;
        const baseColor = palette[i % palette.length];

        datasets.push({
          label: isWinner ? `First to ${targetAmount.toFixed(0)}: ${label}` : label,
          data,
          stepped: true,
          borderWidth: isWinner ? 3 : 1.5,
          borderColor: isWinner ? "#111111" : baseColor,
          backgroundColor: "transparent"
        });
      }

      if (fundraiserChart) {
        fundraiserChart.destroy();
      }

      fundraiserChart = new Chart(chartCanvas, {
        type: "line",
        data: { datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              type: "time",
              time: {
                tooltipFormat: "yyyy-MM-dd HH:mm"
              },
              title: {
                display: true,
                text: "Time (UTC)"
              }
            },
            y: {
              title: {
                display: true,
                text: "Cumulative Donations"
              }
            }
          },
          plugins: {
            legend: {
              position: "top"
            },
            title: {
              display: true,
              text: winnerReachedAt
                ? `Top ${LEADERBOARD_SIZE} Donor Race (First to ${targetAmount})`
                : `Top ${LEADERBOARD_SIZE} Donor Race (No one reached ${targetAmount})`
            }
          }
        }
      });
    }
  } catch (err) {
    if (status) status.textContent = "Failed to load data.";
    if (output) output.textContent = String(err);
  }
}

function Income() {
  const status = document.getElementById("income-status");
  const output = document.getElementById("income-output");
  const chartCanvas = document.getElementById("income-chart");
  const weeksInput = document.getElementById("income-weeks");
  const progressEls = {
    applicationFee: {
      bar: document.getElementById("income-progress-applicationFee"),
      text: document.getElementById("income-progress-text-applicationFee")
    },
    trading: {
      bar: document.getElementById("income-progress-trading"),
      text: document.getElementById("income-progress-text-trading")
    },
    itemMarket: {
      bar: document.getElementById("income-progress-itemMarket"),
      text: document.getElementById("income-progress-text-itemMarket")
    },
    donation: {
      bar: document.getElementById("income-progress-donation"),
      text: document.getElementById("income-progress-text-donation")
    }
  };

  if (status) status.textContent = "Loading...";
  if (output) output.textContent = "";
  for (const txType of TRANSACTION_TYPES) {
    const { bar, text } = progressEls[txType] || {};
    if (bar) bar.style.width = "0%";
    if (text) text.textContent = "Estimate: 0%";
  }

  const nowUtc = new Date();
  const weeksBack = parseInt((weeksInput && weeksInput.value) || "10", 10);
  const safeWeeksBack = Number.isNaN(weeksBack) ? 10 : Math.max(1, weeksBack);
  const startDatetime = new Date(nowUtc.getTime() - safeWeeksBack * 7 * 24 * 60 * 60 * 1000);
  const expectedPages = safeWeeksBack * 3;

  const parseCreatedAtFlexible = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") {
      let seconds = value;
      if (seconds > 1e12) seconds = seconds / 1000;
      const dt = new Date(seconds * 1000);
      return Number.isNaN(dt.getTime()) ? null : dt;
    }
    if (typeof value === "string") {
      const raw = value.trim();
      if (!raw) return null;
      if (/^\d+$/.test(raw)) {
        const num = Number(raw);
        return parseCreatedAtFlexible(num);
      }
      const dt = new Date(raw);
      return Number.isNaN(dt.getTime()) ? null : dt;
    }
    return null;
  };

  const getCreatedAt = (tx) => {
    const keys = ["createdAt", "created_at", "createdAtMs", "createdAtUnix", "timestamp"];
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(tx, key)) {
        return parseCreatedAtFlexible(tx[key]);
      }
    }
    return null;
  };

  const extractItems = (data) => {
    const result = data?.result || {};
    const dataNode = result?.data || {};
    const payloadNode = typeof dataNode === "object" && dataNode !== null ? (dataNode.json || dataNode) : dataNode;
    if (typeof payloadNode === "object" && payloadNode !== null) {
      const items = Array.isArray(payloadNode.items) ? payloadNode.items : [];
      const nextCursor = payloadNode.nextCursor || null;
      return { items, nextCursor };
    }
    return { items: [], nextCursor: null };
  };

  const weekEdges = [];
  for (let i = 0; i <= safeWeeksBack; i += 1) {
    weekEdges.push(new Date(startDatetime.getTime() + i * 7 * 24 * 60 * 60 * 1000));
  }

  const weekLabels = [];
  for (let i = 0; i < safeWeeksBack; i += 1) {
    weekLabels.push(`${safeWeeksBack - i}w ago`);
  }

  const weeklyIncomeTotal = new Array(safeWeeksBack).fill(0);
  const summary = {};

  const setProgress = (txType, pct) => {
    const safePct = Math.min(100, Math.max(0, Math.round(pct)));
    const { bar, text } = progressEls[txType] || {};
    if (bar) bar.style.width = `${safePct}%`;
    if (text) text.textContent = `Estimate: ${safePct}%`;
  };

  const setPreviousComplete = (currentIndex) => {
    for (let i = 0; i < currentIndex; i += 1) {
      setProgress(TRANSACTION_TYPES[i], 100);
    }
  };

  const fetchType = async (txType) => {
    const itemsCollected = [];
    let cursor = null;
    let page = 1;

    while (true) {
      const payload = {
        limit: 100,
        countryId: COUNTRY_ID,
        transactionType: txType
      };
      if (cursor) payload.cursor = cursor;

      const data = await postWarera("transaction", payload);
      const { items, nextCursor } = extractItems(data);
      itemsCollected.push(...items);

      if (status) {
        status.textContent = `Loading... ${txType} page ${page} (total ${itemsCollected.length})`;
      }
      setProgress(txType, (page / expectedPages) * 100);

      if (!nextCursor) break;
      cursor = nextCursor;
      page += 1;
    }

    let parsedCount = 0;
    let totalIncome = 0;
    const filtered = [];

    for (const tx of itemsCollected) {
      const createdAt = getCreatedAt(tx);
      if (createdAt) parsedCount += 1;
      if (createdAt && createdAt >= startDatetime) {
        if (txType === "trading" && tx?.buyerCountryId === COUNTRY_ID) {
          continue;
        }
        filtered.push(tx);
      }
    }

    if (parsedCount === 0 && itemsCollected.length > 0) {
      filtered.push(...itemsCollected);
    }

    const weeklyIncome = new Array(safeWeeksBack).fill(0);

    for (const tx of filtered) {
      let amount = Number(tx?.money || 0);
      if (Number.isNaN(amount)) amount = 0;
      totalIncome += amount;

      const createdAt = getCreatedAt(tx);
      if (createdAt && createdAt >= startDatetime && createdAt <= nowUtc) {
        const index = Math.floor((createdAt - startDatetime) / (7 * 24 * 60 * 60 * 1000));
        if (index >= 0 && index < safeWeeksBack) {
          weeklyIncome[index] += amount;
          weeklyIncomeTotal[index] += amount;
        }
      }
    }

    summary[txType] = {
      fetched: itemsCollected.length,
      since_start: filtered.length,
      filter_applied: parsedCount > 0,
      income_total: Math.round(totalIncome * 100) / 100
    };

    return { weeklyIncome };
  };

  const run = async () => {
    try {
      const weeklyByType = {};

      for (let i = 0; i < TRANSACTION_TYPES.length; i += 1) {
        const txType = TRANSACTION_TYPES[i];
        setPreviousComplete(i);
        const { weeklyIncome } = await fetchType(txType);
        weeklyByType[txType] = weeklyIncome;
        setProgress(txType, 100);
      }

      if (status) status.textContent = "Ready";

      if (output) {
        output.textContent = JSON.stringify(
          {
            start_datetime_utc: startDatetime.toISOString(),
            summary
          },
          null,
          2
        );
      }

      if (chartCanvas && window.Chart) {
        const palette = ["#1b6ef3", "#e24b5b", "#1f9d6c", "#f39c12"];
        const datasets = TRANSACTION_TYPES.map((txType, i) => ({
          label: txType,
          data: weeklyByType[txType] || new Array(safeWeeksBack).fill(0),
          backgroundColor: palette[i % palette.length]
        }));

        datasets.push({
          label: "total",
          data: weeklyIncomeTotal,
          type: "line",
          borderColor: document.body.classList.contains("dark") ? "#ffffff" : "#111111",
          borderWidth: 2,
          fill: false,
          tension: 0.2
        });

        if (incomeChart) {
          incomeChart.destroy();
        }

        incomeChart = new Chart(chartCanvas, {
          type: "bar",
          data: {
            labels: weekLabels,
            datasets
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              y: {
                title: {
                  display: true,
                  text: "Income"
                }
              }
            },
            plugins: {
              title: {
                display: true,
                text: "Weekly Income - Total and by Type"
              }
            }
          }
        });
      }
    } catch (err) {
      if (status) status.textContent = "Failed to load data.";
      if (output) output.textContent = String(err);
    }
  };

  run();
}
