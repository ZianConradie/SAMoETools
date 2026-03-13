const TRANSACTIONS_URL = "https://api2.warera.io/trpc/transaction.getPaginatedTransactions";
const USER_URL = "https://api2.warera.io/trpc/user.getUserLite";
const API_KEY = "wae_36ef4d1a77db9a232e60b6cc6fcdbc96100e156d0fa7888a95d21a99d9376517";

const DEFAULT_START_DATE = "2026-03-11";
const COUNTRY_ID = "683ddd2c24b5a2e114af1612";
const LIMIT = 100;
const DEFAULT_TARGET_AMOUNT = 1000;
const LEADERBOARD_SIZE = 10;

const userCache = new Map();
let fundraiserChart = null;

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

async function getUsername(userId) {
  if (!userId) return "unknown";
  if (userCache.has(userId)) return userCache.get(userId);

  let username = userId;
  try {
    const response = await fetch(USER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": API_KEY
      },
      body: JSON.stringify({ userId })
    });

    if (!response.ok) {
      throw new Error(`User lookup failed (${response.status})`);
    }

    const body = await response.json();
    const data = body?.result?.data || {};
    username = data.username || userId;
  } catch (err) {
    username = userId;
  }

  userCache.set(userId, username);
  return username;
}

async function fetchTransactions(startDatetime, onProgress) {
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

    const params = new URLSearchParams({
      input: JSON.stringify(inputPayload)
    });

    const response = await fetch(`${TRANSACTIONS_URL}?${params.toString()}`, {
      headers: { "X-API-Key": API_KEY }
    });

    if (!response.ok) {
      throw new Error(`Transaction fetch failed (${response.status})`);
    }

    const body = await response.json();
    const data = body?.result?.data || {};
    const payload = typeof data === "object" && data !== null ? (data.json || data) : data;
    const items = payload?.items || [];
    const nextCursor = payload?.nextCursor || null;

    allItems.push(...items);
    if (typeof onProgress === "function") {
      onProgress({
        page,
        fetched: items.length,
        total: allItems.length
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

  if (status) status.textContent = "Loading...";
  if (output) output.textContent = "";

  try {
    const startValue = (startInput && startInput.value) || DEFAULT_START_DATE;
    const targetValue = parseInt((targetInput && targetInput.value) || DEFAULT_TARGET_AMOUNT, 10);

    const startDatetime = new Date(`${startValue}T00:00:00.000Z`);
    const targetAmount = Number.isNaN(targetValue) ? DEFAULT_TARGET_AMOUNT : targetValue;

    if (Number.isNaN(startDatetime.getTime())) {
      throw new Error("Invalid start date. Please use yyyy-mm-dd.");
    }

    const filteredItems = await fetchTransactions(startDatetime, (info) => {
      if (status) {
        status.textContent = `Loading... page ${info.page} (fetched ${info.total})`;
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
    if (output) output.textContent = lines.join("\n");

    if (chartCanvas && topIds.length > 0 && window.Chart) {
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

      for (const donorId of topIds) {
        series.set(donorId, [{ x: startDatetime, y: 0 }]);
        running.set(donorId, 0);
      }

      for (const tx of chronologicalItems) {
        const createdAt = parseCreatedAt(tx?.createdAt);
        if (!createdAt) continue;
        if (winnerReachedAt && createdAt > winnerReachedAt) break;

        const donorId = tx?.buyerId || "unknown";
        if (!series.has(donorId)) continue;

        const amount = Number(tx?.money || 0) || 0;
        const nextValue = (running.get(donorId) || 0) + amount;
        running.set(donorId, nextValue);
        series.get(donorId).push({ x: createdAt, y: nextValue });
      }

      const datasets = [];
      for (let i = 0; i < topIds.length; i += 1) {
        const donorId = topIds[i];
        const label = await getUsername(donorId);
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
