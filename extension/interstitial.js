const params = new URLSearchParams(location.search);
const target = params.get("target") ?? "";
const originalUrl = params.get("url") ?? "";

document.getElementById("target").textContent = originalUrl ?? target ?? "";

init();

async function init() {
  const response = await chrome.runtime.sendMessage({
    type: "get_intent_prompt",
    target,
  });
  const candidates = response?.candidates ?? [];

  document.getElementById("custom-minutes").value = response?.defaultMinutes ?? 20;
  renderCandidates(candidates);
}

function renderCandidates(candidates) {
  const container = document.getElementById("candidate-list");

  if (candidates.length === 0) {
    container.innerHTML = '<p class="empty">第一次来这里，先写清楚目的。</p>';
    return;
  }

  container.innerHTML = "";

  for (const candidate of candidates) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "candidate";
    button.innerHTML = `<span><em>${categoryLabel(candidate.category)}</em>${escapeHtml(candidate.reason)}</span><strong>${candidate.minutes} 分钟</strong>`;
    button.addEventListener("click", () =>
      submitIntent(
        candidate.reason,
        candidate.minutes,
        false,
        candidate.category,
        candidate.expiryAction,
      ),
    );
    container.append(button);
  }
}

document.getElementById("intent-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const reason = document.getElementById("custom-reason").value.trim();
  const minutes = Number(document.getElementById("custom-minutes").value);
  const category = document.getElementById("intent-category").value;
  const saveCandidate = document.getElementById("save-candidate").checked;

  if (!reason || !Number.isFinite(minutes) || minutes <= 0) {
    return;
  }

  await submitIntent(reason, minutes, saveCandidate, category, expiryActionForCategory(category));
});

async function submitIntent(reason, minutes, saveCandidate, category, expiryAction) {
  await chrome.runtime.sendMessage({
    type: "submit_intent",
    target,
    reason,
    minutes,
    saveCandidate,
    category,
    expiryAction,
    originalUrl,
  });

  location.href = originalUrl;
}

function categoryLabel(category) {
  return category === "play" ? "玩" : "学";
}

function expiryActionForCategory(category) {
  return "check_in";
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[char];
  });
}
