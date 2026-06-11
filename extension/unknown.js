const params = new URLSearchParams(location.search);
const target = params.get("target");
const originalUrl = params.get("url");

document.getElementById("unknown-target").textContent = originalUrl ?? target ?? "";

document.getElementById("add-control").addEventListener("click", async () => {
  await decide("control");
});

document.getElementById("allow-once").addEventListener("click", async () => {
  await decide("temporary");
});

document.getElementById("ignore-site").addEventListener("click", async () => {
  await decide("ignore");
});

async function decide(decision) {
  const response = await chrome.runtime.sendMessage({
    type: "add_unknown_site_decision",
    target,
    originalUrl,
    decision,
  });

  if (response?.nextUrl) {
    location.href = response.nextUrl;
  }
}
