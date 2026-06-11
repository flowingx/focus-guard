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
      }

      .card {
        width: min(340px, calc(100vw - 36px));
        border: 2px solid #44475a;
        border-radius: 8px;
        background: #282a36;
        box-shadow: 8px 8px 0 #ff5555;
        color: #f8f8f2;
        padding: 16px;
        transition:
          opacity 160ms ease,
          transform 160ms ease;
      }

      .card.is-compact {
        opacity: 0.78;
        transform: translateY(8px);
      }

      .eyebrow {
        margin: 0 0 6px;
        color: #ff5555;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.12em;
      }

      .title {
        margin: 0;
        color: #f8f8f2;
        font-size: 18px;
        font-weight: 800;
        line-height: 1.25;
      }

      .target {
        margin: 8px 0 14px;
        color: #c9c9d1;
        font-size: 13px;
        overflow-wrap: anywhere;
      }

      .actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      button {
        min-height: 36px;
        border: 2px solid #44475a;
        border-radius: 6px;
        background: #1f2029;
        color: #f8f8f2;
        cursor: pointer;
        font: inherit;
        font-size: 13px;
        font-weight: 800;
      }

      button.primary {
        background: #8be9fd;
        color: #191b1f;
      }

      button:hover {
        box-shadow: 3px 3px 0 #bd93f9;
        transform: translate(-1px, -1px);
      }

      .close {
        position: absolute;
        top: 8px;
        right: 8px;
        min-width: 28px;
        min-height: 28px;
        padding: 0;
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
  shadow.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => host.remove());
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
      host.remove();
    });
  });

  document.documentElement.append(host);

  setTimeout(() => {
    shadow.querySelector(".card")?.classList.add("is-compact");
  }, 8000);
}
