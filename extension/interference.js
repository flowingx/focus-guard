(() => {
  if (document.getElementById("focus-guard-interference-overlay")) {
    return;
  }

  const OVERLAY_ID = "focus-guard-interference-overlay";
  const PRESETS = [
    "放松 5 分钟",
    "查资料/找答案",
    "看网课/学习视频",
    "找灵感",
  ];
  const ALLOW_MINUTES = 5;

  chrome.runtime.sendMessage({ type: "get_ai_detect_context" }, (ctx) => {
    if (chrome.runtime.lastError || !ctx) return;
    showOverlay(ctx);
  });

  function showOverlay(ctx) {
    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.innerHTML = `
      <div id="focus-guard-interference-card">
        <h2>Focus Guard 检测到摸鱼</h2>
        <p>${escapeHtml(ctx.reason || "AI 判断你当前可能在摸鱼")}</p>
        <div class="fg-preset-list">
          ${PRESETS.map((p) => `<span class="fg-preset-tag" data-preset="${escapeHtml(p)}">${escapeHtml(p)}</span>`).join("")}
        </div>
        <input class="fg-reason-input" type="text" placeholder="输入你的理由（AI 会验证是否合理）" maxlength="100" />
        <div class="fg-ai-status"></div>
        <div class="fg-btn-row">
          <button class="fg-btn fg-btn-ghost" id="fg-close-overlay">关闭提示</button>
          <button class="fg-btn fg-btn-primary" id="fg-submit-reason">提交理由</button>
        </div>
      </div>
    `;
    document.documentElement.appendChild(overlay);

    const input = overlay.querySelector(".fg-reason-input");
    const status = overlay.querySelector(".fg-ai-status");
    const submitBtn = overlay.querySelector("#fg-submit-reason");
    const closeBtn = overlay.querySelector("#fg-close-overlay");

    overlay.querySelectorAll(".fg-preset-tag").forEach((tag) => {
      tag.addEventListener("click", () => {
        input.value = tag.dataset.preset;
        input.focus();
      });
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitBtn.click();
    });

    submitBtn.addEventListener("click", async () => {
      const reason = input.value.trim();
      if (!reason) {
        input.focus();
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "验证中...";
      status.textContent = "AI 正在验证你的理由...";
      status.className = "fg-ai-status";

      chrome.runtime.sendMessage(
        { type: "validate_distraction_reason", reason, target: ctx.target },
        (resp) => {
          submitBtn.disabled = false;
          submitBtn.textContent = "提交理由";

          if (chrome.runtime.lastError || !resp) {
            status.textContent = "验证失败，请重试";
            status.className = "fg-ai-status fg-rejected";
            return;
          }

          if (resp.approved) {
            chrome.runtime.sendMessage(
              {
                type: "approve_ai_intervention",
                target: ctx.target,
                reason,
                minutes: ALLOW_MINUTES,
              },
              (intentResp) => {
                if (chrome.runtime.lastError || !intentResp?.ok) {
                  status.textContent = "放行失败，请重试";
                  status.className = "fg-ai-status fg-rejected";
                  return;
                }

                status.textContent = `✅ 理由通过，放行 ${ALLOW_MINUTES} 分钟`;
                status.className = "fg-ai-status fg-approved";
                setTimeout(() => overlay.remove(), 2000);
              },
            );
          } else {
            status.textContent = "❌ " + (resp.message || "理由不合理，请重新说明");
            status.className = "fg-ai-status fg-rejected";
          }
        },
      );
    });

    closeBtn.addEventListener("click", () => {
      overlay.remove();
    });

    input.focus();
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
