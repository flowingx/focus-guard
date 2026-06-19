const params = new URLSearchParams(location.search);
const target = params.get("target");
const reason = params.get("reason") || "继续学习";
const originalUrl = params.get("url");
const status = document.getElementById("expired-status");

document.getElementById("expired-target").textContent = originalUrl || target || "";
document.getElementById("expired-reason").textContent = reason;

document.getElementById("continue-study").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({
    type: "extend_session",
    target,
    reason,
    minutes: 10,
    saveCandidate: false,
    category: "study",
    expiryAction: "check_in",
    originalUrl,
  });

  if (originalUrl) {
    location.href = originalUrl;
  } else {
    history.back();
  }
});

document.getElementById("finish-session").addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "close_current_tab" });
  if (!response?.ok) {
    status.textContent = "关闭失败，请手动关闭此标签页";
  }
});
