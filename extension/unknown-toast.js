chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "show_unknown_site_prompt") {
    return;
  }

  showUnknownSitePrompt(message);
});

function showUnknownSitePrompt(message) {
  document.getElementById("focus-guard-unknown-toast")?.remove();

  const host = document.createElement("div");
  host.id = "focus-guard-unknown-toast";
  const shadow = host.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483647;
        font-family: Aptos, "Segoe UI", sans-serif;
        animation: slideIn 300ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
      }

      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateY(12px) scale(0.98);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      @keyframes slideOut {
        from {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
        to {
          opacity: 0;
          transform: translateY(12px) scale(0.98);
        }
      }

      .card {
        width: min(340px, calc(100vw - 36px));
        border: 1px solid rgba(68, 71, 90, 0.5);
        border-radius: 12px;
        background: rgba(40, 42, 54, 0.95);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 85, 85, 0.1);
        color: #f8f8f2;
        padding: 18px;
        transition:
          opacity 250ms ease,
          transform 250ms cubic-bezier(0.34, 1.56, 0.64, 1);
      }

      .card.is-compact {
        opacity: 0.78;
        transform: translateY(6px) scale(0.98);
      }

      .eyebrow {
        margin: 0 0 8px;
        color: #ff5555;
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }

      .title {
        margin: 0;
        color: #f8f8f2;
        font-size: 16px;
        font-weight: 700;
        line-height: 1.3;
        letter-spacing: -0.01em;
      }

      .target {
        margin: 10px 0 16px;
        color: #c9c9d1;
        font-size: 13px;
        line-height: 1.5;
        overflow-wrap: anywhere;
      }

      .actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      button {
        min-height: 36px;
        border: 1px solid rgba(68, 71, 90, 0.5);
        border-radius: 8px;
        background: rgba(31, 32, 41, 0.8);
        color: #f8f8f2;
        cursor: pointer;
        font: inherit;
        font-size: 13px;
        font-weight: 700;
        transition:
          transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1),
          box-shadow 200ms ease,
          background-color 200ms ease;
      }

      button.primary {
        background: #8be9fd;
        color: #191b1f;
      }

      button:hover {
        box-shadow: 0 2px 8px rgba(189, 147, 249, 0.3);
        transform: translateY(-1px);
      }

      button:active {
        transform: translateY(0);
        box-shadow: none;
      }

      .close {
        position: absolute;
        top: 10px;
        right: 10px;
        min-width: 28px;
        min-height: 28px;
        padding: 0;
        background: transparent;
        border: none;
        color: #6272a4;
        font-size: 18px;
        line-height: 1;
        opacity: 0.6;
      }

      .close:hover {
        opacity: 1;
        color: #f8f8f2;
        box-shadow: none;
        transform: none;
      }
    </style>
    <section class="card" role="dialog" aria-label="Focus Guard 新网站提示">
      <button class="close" type="button" data-close>×</button>
      <p class="eyebrow">FOCUS GUARD</p>
      <h2 class="title">这个网站要加入规则吗？</h2>
      <p class="target"></p>
      <div class="actions">
        <button class="primary" type="button" data-decision="control">管控</button>
        <button type="button" data-decision="ignore">白名单</button>
        <button type="button" data-decision="temporary">本次放行</button>
        <button type="button" data-close>关闭</button>
      </div>
    </section>
  `;

  shadow.querySelector(".target").textContent = message.originalUrl ?? message.target ?? "";
  function removeWithAnimation() {
    host.style.animation = "slideOut 200ms ease forwards";
    host.addEventListener("animationend", () => host.remove(), { once: true });
  }

  shadow.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", removeWithAnimation);
  });
  shadow.querySelectorAll("[data-decision]").forEach((button) => {
    button.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({
        type: "add_unknown_site_decision",
        decision: button.dataset.decision,
        target: message.target,
        originalUrl: message.originalUrl,
        source: "toast",
      });
      removeWithAnimation();
    });
  });

  document.documentElement.append(host);

  setTimeout(() => {
    shadow.querySelector(".card")?.classList.add("is-compact");
  }, 8000);
}
