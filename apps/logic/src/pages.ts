// The demo pages, served by the Worker: a phone simulator for farmers, Felix's
// live dashboard, and /demo, which shows both side by side.
//
// The pages hold no data. They ask for the admin token once (kept in this
// browser only) and call the JSON routes with it. All farmer-supplied text is
// put into the page as text nodes, never as HTML.
//
// Client code avoids template literals so it can live inside these TypeScript
// template strings without escaping.

// Colours from the Felix app's "Warm Paper" tokens (apps/mobile/design/tokens.css).
const STYLE = `
:root {
  color-scheme: light;
  --bg: #F3F0E7; --surface: #FBFAF6; --surface-2: #EDE9DF; --surface-3: #E4DFD2;
  --text: #1C1B16; --muted: #4A473E; --hairline: rgba(28, 27, 22, 0.12);
  --primary: #1D5233; --on-primary: #FFFFFF; --primary-soft: #C7E7D1; --on-primary-soft: #0A2C18;
  --ink: #1E1F1A; --on-ink: #EFECE1; --on-ink-muted: #B7B2A3;
  --red: #A31C12; --red-soft: #FBD9D4; --on-red-soft: #4C0B06;
  --amber: #8A5300; --amber-soft: #FAE3BC; --on-amber-soft: #432700;
  --slate: #455360; --slate-soft: #DCE3EA; --on-slate-soft: #1C2831;
  --blue: #1A4E72; --blue-soft: #D3E6F3; --on-blue-soft: #082D44;
  --green: #18663A; --green-soft: #C7E7D1; --on-green-soft: #0A2C18;
  --bubble-in: #D7EEDC; --bubble-out: #FFFFFF;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, system-ui, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --bg: #141510; --surface: #1A1B16; --surface-2: #232420; --surface-3: #2C2E28;
    --text: #ECE9DE; --muted: #C2BEAF; --hairline: rgba(236, 233, 222, 0.14);
    --primary: #8ED3A3; --on-primary: #032E17; --primary-soft: #2A5740; --on-primary-soft: #CAEFD6;
    --ink: #23241E; --on-ink: #ECE9DE; --on-ink-muted: #C2BEAF;
    --red: #FF9186; --red-soft: #6B1C14; --on-red-soft: #FFD8D2;
    --amber: #F0B855; --amber-soft: #5A3E0B; --on-amber-soft: #FBDFAE;
    --slate: #A9B7C5; --slate-soft: #33404B; --on-slate-soft: #DCE3EA;
    --blue: #8FC3E8; --blue-soft: #1B3D55; --on-blue-soft: #D3E6F3;
    --green: #7ACB95; --green-soft: #22503A; --on-green-soft: #C3EBD1;
    --bubble-in: #24452F; --bubble-out: #2C2E28;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body { background: var(--bg); color: var(--text); font: 400 15px/1.45 var(--font); -webkit-font-smoothing: antialiased; }
button, select, input { font: inherit; color: inherit; }
button { cursor: pointer; }
.btn { border: 1px solid var(--hairline); background: var(--surface); border-radius: 999px; padding: 8px 14px; font-weight: 600; font-size: 14px; }
.btn:hover { background: var(--surface-2); }
.btn.primary { background: var(--primary); color: var(--on-primary); border-color: transparent; }
.btn.danger { color: var(--red); }
.btn:disabled { opacity: .5; cursor: progress; }
select, input[type=text], input[type=password] { background: var(--surface); border: 1px solid var(--hairline); border-radius: 12px; padding: 8px 12px; min-width: 0; }
.gate { position: fixed; inset: 0; display: grid; place-items: center; background: var(--bg); padding: 16px; z-index: 10; }
.gate form { background: var(--surface); border: 1px solid var(--hairline); border-radius: 24px; padding: 28px; width: min(380px, 100%); display: grid; gap: 12px; }
.gate h1 { margin: 0; font-size: 20px; }
.gate p { margin: 0; color: var(--muted); font-size: 14px; }
.brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; letter-spacing: -0.01em; }
.brand i { width: 22px; height: 22px; border-radius: 7px; background: var(--primary); display: inline-block; position: relative; }
.brand i::after { content: ""; position: absolute; inset: 6px 5px 5px 6px; border-radius: 50% 0; background: var(--on-primary); transform: rotate(-45deg); opacity: .9; }
.muted { color: var(--muted); }
.toast { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); background: var(--ink); color: var(--on-ink); padding: 10px 16px; border-radius: 999px; font-size: 14px; opacity: 0; transition: opacity .2s; pointer-events: none; max-width: calc(100% - 32px); }
.toast.show { opacity: 1; }
`;

// Shared client helpers: the token gate, API calls and a small DOM builder.
const CLIENT = `
var TOKEN_KEY = "fieldwise-admin-token";
var token = null;
function readToken() {
  var m = location.hash.match(/token=([^&]+)/);
  if (m) {
    token = decodeURIComponent(m[1]);
    try { localStorage.setItem(TOKEN_KEY, token); } catch (e) {}
    history.replaceState(null, "", location.pathname + location.search);
    return token;
  }
  try { token = localStorage.getItem(TOKEN_KEY); } catch (e) { token = null; }
  return token;
}
function gate(onReady) {
  if (readToken()) return onReady();
  var input = el("input", { type: "password", placeholder: "Admin token", autocomplete: "off", required: true });
  var form = el("form", {},
    el("div", { class: "brand" }, el("i"), "FieldWise"),
    el("h1", {}, "Enter the admin token"),
    el("p", {}, "It stays in this browser. It is the ADMIN_TOKEN set on the Worker."),
    input,
    el("button", { class: "btn primary", type: "submit" }, "Continue"));
  var box = el("div", { class: "gate" }, form);
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    token = input.value.trim();
    try { localStorage.setItem(TOKEN_KEY, token); } catch (err) {}
    box.remove();
    onReady();
  });
  document.body.appendChild(box);
  input.focus();
}
function forgetToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
  location.reload();
}
function api(path, body) {
  var opts = { method: body === undefined ? "GET" : "POST", headers: { Authorization: "Bearer " + token } };
  if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
  return fetch(path, opts).then(function (r) {
    if (r.status === 401) { forgetToken(); throw new Error("Wrong admin token"); }
    return r.json().then(function (data) {
      if (!r.ok) throw new Error(data.error || ("HTTP " + r.status));
      return data;
    });
  });
}
function el(tag, attrs) {
  var node = document.createElement(tag);
  for (var k in attrs || {}) {
    if (attrs[k] === false || attrs[k] == null) continue;
    if (k === "on") for (var ev in attrs.on) node.addEventListener(ev, attrs.on[ev]);
    else node.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
  }
  for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
  return node;
}
function append(node, child) {
  if (child == null || child === false) return;
  if (Array.isArray(child)) { child.forEach(function (c) { append(node, c); }); return; }
  node.appendChild(typeof child === "object" ? child : document.createTextNode(String(child)));
}
var toastTimer;
function toast(text) {
  var t = document.querySelector(".toast") || document.body.appendChild(el("div", { class: "toast", role: "status" }));
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove("show"); }, 3500);
}
function store(key, value) {
  try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch (e) { return null; }
}
`;

function page(title: string, css: string, body: string, script: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${STYLE}${css}</style>
</head>
<body>
${body}
<script>${CLIENT}${script}</script>
</body>
</html>`;
}

export const simulatorPage = page(
  "FieldWise Phone",
  `
body { min-height: 100vh; display: grid; place-items: start center; padding: 16px; }
.wrap { width: min(380px, 100%); display: grid; gap: 12px; }
.pick { display: flex; gap: 8px; align-items: center; }
.pick select { flex: 1; }
.phone { background: var(--ink); border-radius: 40px; padding: 12px; box-shadow: 0 20px 50px rgba(0,0,0,.18); }
.screen { background: var(--surface-2); border-radius: 30px; overflow: hidden; display: flex; flex-direction: column; height: min(680px, calc(100vh - 120px)); min-height: 460px; }
.status { display: flex; justify-content: space-between; padding: 10px 22px 4px; font-size: 12px; font-weight: 600; }
.chat-head { display: flex; align-items: center; gap: 10px; padding: 8px 16px 10px; border-bottom: 1px solid var(--hairline); background: var(--surface); }
.avatar { width: 36px; height: 36px; border-radius: 50%; background: var(--primary); color: var(--on-primary); display: grid; place-items: center; font-weight: 700; }
.chat-head b { display: block; font-size: 15px; }
.chat-head span { font-size: 12px; color: var(--muted); }
.thread { flex: 1; overflow-y: auto; padding: 14px 12px; display: flex; flex-direction: column; gap: 6px; }
.bubble { max-width: 85%; padding: 8px 12px 6px; border-radius: 16px; font-size: 14px; white-space: pre-wrap; overflow-wrap: anywhere; box-shadow: 0 1px 1px rgba(0,0,0,.06); }
.bubble.out { align-self: flex-start; background: var(--bubble-out); border-top-left-radius: 4px; }
.bubble.in { align-self: flex-end; background: var(--bubble-in); border-top-right-radius: 4px; }
.bubble small { display: block; font-size: 11px; color: var(--muted); text-align: right; margin-top: 2px; }
.bubble.failed { outline: 1.5px solid var(--red); }
.bubble small.err { color: var(--red); text-align: left; }
.bubble .cap { display: block; font-size: 12px; font-weight: 600; color: var(--primary); margin-bottom: 2px; }
.empty { margin: auto; text-align: center; color: var(--muted); font-size: 14px; padding: 24px; }
.quick { display: flex; gap: 8px; padding: 8px 12px 0; flex-wrap: wrap; }
.quick button { flex: 1; border: 1px solid var(--hairline); background: var(--surface); color: var(--primary); border-radius: 999px; padding: 9px 12px; font-weight: 600; }
.compose { display: flex; gap: 8px; padding: 10px 12px 14px; }
.compose input { flex: 1; border-radius: 999px; }
.compose button { width: 42px; height: 42px; border-radius: 50%; border: 0; background: var(--primary); color: var(--on-primary); font-weight: 700; }
.note { font-size: 12px; color: var(--muted); text-align: center; }
`,
  `<main class="wrap">
  <div class="pick"><label for="farmer" class="muted" style="font-size:13px">Farmer</label><select id="farmer"></select></div>
  <div class="phone"><div class="screen">
    <div class="status"><span id="clock">9:41</span><span>FieldWise</span></div>
    <div class="chat-head"><div class="avatar">F</div><div><b>FieldWise</b><span id="sub">Simulator</span></div></div>
    <div class="thread" id="thread" aria-live="polite"></div>
    <div class="quick" id="quick"></div>
    <form class="compose" id="compose"><input type="text" id="text" placeholder="Type 1, 2, yes, inde…" autocomplete="off" aria-label="Reply"><button type="submit" aria-label="Send">➤</button></form>
  </div></div>
  <p class="note" id="note">Simulated phone. Messages here never leave FieldWise.</p>
</main>`,
  `
var farmers = [], current = null, lastCount = -1, sending = false;
var TICKS = { sent: "✓", delivered: "✓✓", read: "✓✓ read" };
var select = document.getElementById("farmer");
var thread = document.getElementById("thread");
var quick = document.getElementById("quick");

function render(messages) {
  // Redraw when a message arrives or a delivery tick changes.
  var key = messages.length + ":" + messages.map(function (m) { return m.status || ""; }).join(",");
  if (key === lastCount) return;
  lastCount = key;
  thread.textContent = "";
  if (!messages.length) {
    append(thread, el("div", { class: "empty" }, "No messages yet.", el("br"), "Raise a flag from the dashboard, or send a message."));
  }
  messages.forEach(function (m) {
    var lines = m.body.split("\\n");
    var cap = /·\\s\\d+\\s(of|mwa)\\s8$/.test(lines[0]) ? lines.shift() : null;
    var time = new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    var tick = TICKS[m.status] || "";
    append(thread, el("div", { class: "bubble " + m.direction + (m.status === "failed" ? " failed" : "") },
      cap && el("span", { class: "cap" }, cap), lines.join("\\n"),
      el("small", {}, time + (tick ? " " + tick : "")),
      m.status === "failed" && el("small", { class: "err" }, "Not delivered: " + (m.error || "unknown error"))));
  });
  thread.scrollTop = thread.scrollHeight;
  quick.textContent = "";
  var last = messages[messages.length - 1];
  if (last && last.direction === "out") {
    last.body.split("\\n").forEach(function (line) {
      var m = line.match(/^(\\d)\\s(.+)$/);
      if (m) append(quick, el("button", { type: "button", on: { click: function () { send(m[1]); } } }, m[2]));
    });
  }
}

function refresh() {
  if (!current) return;
  api("/farmers/" + encodeURIComponent(current.id) + "/messages").then(function (d) { render(d.messages); }).catch(function () {});
}

function send(text) {
  if (!current || sending || !text.trim()) return;
  sending = true;
  api("/inbound", { phone: current.phone, text: text }).then(refresh).catch(function (e) { toast(e.message); })
    .then(function () { sending = false; });
}

function choose(id) {
  current = farmers.filter(function (f) { return f.id === id; })[0] || farmers[0];
  if (!current) return;
  store("fieldwise-sim-farmer", current.id);
  select.value = current.id;
  document.getElementById("sub").textContent = current.name + " · " + current.crop + (current.channel === "whatsapp" ? " · WhatsApp" : "");
  document.getElementById("note").textContent = current.channel === "whatsapp"
    ? "Mirror of this farmer's real WhatsApp chat. Replies typed here go to FieldWise as theirs."
    : "Simulated phone. Messages here never leave FieldWise.";
  lastCount = -1;
  refresh();
}

document.getElementById("compose").addEventListener("submit", function (e) {
  e.preventDefault();
  var input = document.getElementById("text");
  send(input.value);
  input.value = "";
});
select.addEventListener("change", function () { choose(select.value); });
setInterval(function () {
  document.getElementById("clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}, 10000);

gate(function () {
  api("/farmers").then(function (d) {
    farmers = d.farmers;
    farmers.forEach(function (f) {
      append(select, el("option", { value: f.id }, f.name + " · " + f.crop + (f.farm_name ? " · " + f.farm_name : "")));
    });
    var wanted = new URLSearchParams(location.search).get("farmer") || store("fieldwise-sim-farmer");
    choose(wanted);
    setInterval(refresh, 2000);
  }).catch(function (e) { toast(e.message); });
});
`,
);

export const dashboardPage = page(
  "Felix Priority List",
  `
.top { position: sticky; top: 0; z-index: 2; background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--hairline); }
.top-in { max-width: 1240px; margin: 0 auto; padding: 12px 16px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.top h1 { font-size: 16px; margin: 0; font-weight: 600; }
.top .sp { flex: 1; }
.live { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); }
.live::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--green); box-shadow: 0 0 0 3px var(--green-soft); }
.live.stale::before { background: var(--amber); box-shadow: 0 0 0 3px var(--amber-soft); }
main { max-width: 1240px; margin: 0 auto; padding: 16px; display: grid; gap: 16px; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.stat { background: var(--surface); border: 1px solid var(--hairline); border-radius: 20px; padding: 14px 16px; }
.stat b { display: block; font-size: 28px; line-height: 1.1; font-weight: 650; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
.stat span { font-size: 13px; color: var(--muted); }
.stat.alert b { color: var(--red); }
.grid { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px; align-items: start; }
@media (max-width: 900px) { .grid { grid-template-columns: minmax(0, 1fr); } }
h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 4px 0 10px; font-weight: 600; }
.list { display: grid; gap: 10px; }
.card { background: var(--surface); border: 1px solid var(--hairline); border-radius: 20px; padding: 14px 16px 14px 20px; position: relative; overflow: hidden; }
.card::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 5px; background: var(--rank, var(--surface-3)); }
.card.changed { animation: flash 1.6s ease-out; }
@keyframes flash { from { box-shadow: 0 0 0 3px var(--rank-soft, var(--primary-soft)); } to { box-shadow: 0 0 0 0 transparent; } }
.r-go_now { --rank: var(--red); --rank-soft: var(--red-soft); }
.r-this_week { --rank: var(--amber); --rank-soft: var(--amber-soft); }
.r-no_response { --rank: var(--slate); --rank-soft: var(--slate-soft); }
.r-recheck { --rank: var(--blue); --rank-soft: var(--blue-soft); }
.r-waiting { --rank: var(--surface-3); --rank-soft: var(--surface-2); }
.r-none { --rank: var(--green); --rank-soft: var(--green-soft); }
.head { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.head .name { font-weight: 700; letter-spacing: .02em; }
.head .farm { color: var(--muted); font-size: 13px; }
.head .chip { margin-left: auto; }
.chip { display: inline-flex; align-items: center; gap: 4px; border-radius: 999px; padding: 3px 10px; font-size: 12px; font-weight: 650; white-space: nowrap; }
.chip.go_now { background: var(--red-soft); color: var(--on-red-soft); }
.chip.this_week { background: var(--amber-soft); color: var(--on-amber-soft); }
.chip.no_response { background: var(--slate-soft); color: var(--on-slate-soft); }
.chip.recheck { background: var(--blue-soft); color: var(--on-blue-soft); }
.chip.waiting { background: var(--surface-2); color: var(--muted); }
.chip.none { background: var(--green-soft); color: var(--on-green-soft); }
.tag { display: inline-block; border: 1px solid var(--hairline); border-radius: 999px; padding: 1px 8px; font-size: 12px; color: var(--muted); }
.verdict { margin: 8px 0 4px; display: flex; gap: 6px 10px; flex-wrap: wrap; align-items: center; font-size: 15px; }
.verdict .arrow { color: var(--muted); }
.verdict .say { font-weight: 650; }
.verdict .wrong { background: var(--ink); color: var(--on-ink); border-radius: 6px; padding: 1px 7px; font-size: 12px; font-weight: 650; }
.answers { font: 12.5px/1.5 var(--mono); color: var(--muted); background: var(--surface-2); border-radius: 10px; padding: 6px 10px; margin: 6px 0; overflow-wrap: anywhere; }
.meta { font-size: 13px; color: var(--muted); display: flex; gap: 6px 12px; flex-wrap: wrap; }
.notes { margin: 6px 0 0; padding-left: 18px; font-size: 13.5px; }
.notes li { margin: 2px 0; }
.bar { height: 6px; border-radius: 999px; background: var(--surface-2); overflow: hidden; margin-top: 6px; width: 140px; }
.bar i { display: block; height: 100%; background: var(--primary); border-radius: 999px; }
.panel { background: var(--surface); border: 1px solid var(--hairline); border-radius: 20px; padding: 16px; display: grid; gap: 10px; }
.panel + .panel { margin-top: 16px; }
.controls { display: flex; gap: 8px; flex-wrap: wrap; }
.controls select { width: 100%; }
.rows { display: grid; gap: 8px; font-size: 14px; }
.row { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; }
.row .n { font-variant-numeric: tabular-nums; font-weight: 650; }
.meter { grid-column: 1 / -1; height: 5px; background: var(--surface-2); border-radius: 999px; overflow: hidden; margin-top: -4px; }
.meter i { display: block; height: 100%; border-radius: 999px; }
table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
th { text-align: left; font-weight: 600; color: var(--muted); font-size: 12px; padding: 4px 0; }
td { padding: 6px 0; border-top: 1px solid var(--hairline); font-variant-numeric: tabular-nums; }
td + td, th + th { text-align: right; padding-left: 8px; }
.empty { background: var(--surface); border: 1px dashed var(--hairline); border-radius: 20px; padding: 28px; text-align: center; color: var(--muted); }
.quiet { font-size: 13px; color: var(--muted); }
.legend { font-size: 12.5px; color: var(--muted); }
`,
  `<header class="top"><div class="top-in">
  <span class="brand"><i></i>FieldWise</span>
  <h1>Felix · Kasungu priority list</h1>
  <span class="sp"></span>
  <label class="muted" style="font-size:13px">Window <select id="days"><option value="7">7 days</option><option value="14" selected>14 days</option><option value="30">30 days</option></select></label>
  <span class="live" id="live">Live</span>
</div></header>
<main>
  <section class="stats" id="stats" aria-label="Summary"></section>
  <div class="grid">
    <section aria-labelledby="list-h"><h2 id="list-h">Farms to visit, most urgent first</h2><div class="list" id="list"></div><p class="quiet" id="unflagged"></p></section>
    <aside>
      <div class="panel" id="demo">
        <h2 style="margin:0">Demo controls</h2>
        <select id="target" aria-label="Which farm"><option value="">All farms</option></select>
        <div class="controls">
          <button class="btn primary" data-act="wet" type="button">Wet spell</button>
          <button class="btn" data-act="dry" type="button">Dry spell</button>
          <button class="btn" data-act="check" type="button">Real forecast check</button>
          <button class="btn" data-act="sweep" type="button">Send reminders</button>
          <button class="btn danger" data-act="reset" type="button">Reset demo</button>
        </div>
        <p class="legend">Wet and dry spells run made-up weather through the real rules. Flags they raise are tagged “Scenario”. A dry spell re-arms alerts, so the next wet spell fires again.</p>
      </div>
      <div class="panel"><h2 style="margin:0">Outcomes</h2><div class="rows" id="outcomes"></div></div>
      <div class="panel"><h2 style="margin:0">By disease</h2><div id="diseases"></div></div>
      <div class="panel"><h2 style="margin:0">What the answers say</h2><div class="rows" id="says"></div></div>
    </aside>
  </div>
</main>`,
  `
var RANK_LABEL = { go_now: "Go now", this_week: "Go this week", no_response: "No response: chase", recheck: "Re-check at next forecast", waiting: "Waiting for answers", none: "No action" };
var OUTCOMES = [
  ["confirmed_urgent", "Confirmed, urgent", "var(--red)"],
  ["confirmed", "Confirmed", "var(--amber)"],
  ["wrong_flag", "Wrong flag caught", "var(--ink)"],
  ["early_signs", "Early signs", "var(--blue)"],
  ["clear", "Clear", "var(--green)"]
];
var STATE_LABEL = { answered: "Answered", answering: "Answering", waiting: "Alert sent, no answers yet", no_response: "Silent after a reminder" };
var farmers = [], seen = {}, firstLoad = true, lastOk = 0;
var days = document.getElementById("days");
days.value = store("fieldwise-days") || "14";

function shortName(name) {
  var w = name.trim().split(/\\s+/);
  if (w.length < 2) return name.toUpperCase();
  var last = w.pop();
  return last.toUpperCase() + " " + w.map(function (x) { return x[0].toUpperCase() + "."; }).join(" ");
}
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
function when(iso) {
  var d = new Date(iso);
  return d.toLocaleDateString([], { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function pct(x) { return x == null ? "–" : Math.round(x * 100) + "%"; }

function stat(value, label, alert) { return el("div", { class: "stat" + (alert ? " alert" : "") }, el("b", {}, value), el("span", {}, label)); }

function card(f) {
  var r = f.report;
  var verdict = el("div", { class: "verdict" }, el("span", {}, "Flagged: ", el("b", {}, f.flagged)));
  if (r && r.answersSay.length) {
    append(verdict, [el("span", { class: "arrow" }, "→"), el("span", {}, "Answers say: ", el("span", { class: "say" }, r.answersSay.join(" + ")))]);
    if (r.outcome === "wrong_flag") append(verdict, el("span", { class: "wrong" }, "Wrong flag"));
  } else if (r && r.likelyWrongFlag) {
    append(verdict, [el("span", { class: "arrow" }, "→"), el("span", { class: "say" }, "Answers point away from the flag")]);
  }
  var progress = f.state === "answered" ? "Answered" : f.state === "answering" ? "Answering " + f.answered + " of 8" + (f.provisional ? " · provisional" : "") : STATE_LABEL[f.state];
  var notes = (r && r.notes) || [];
  var key = JSON.stringify([f.flag_id, f.rank, f.answered, f.state, f.also.length]);
  var node = el("article", { class: "card r-" + f.rank, "data-key": key },
    el("div", { class: "head" },
      el("span", { class: "name" }, shortName(f.farmer.name)),
      el("span", { class: "tag" }, cap(f.farmer.crop)),
      f.farmer.farm_name && el("span", { class: "farm" }, f.farmer.farm_name),
      f.source === "scenario" && el("span", { class: "tag" }, "Scenario"),
      el("span", { class: "chip " + f.rank }, RANK_LABEL[f.rank])),
    verdict,
    el("div", { class: "meta" }, el("span", {}, progress), f.state === "answering" && el("span", { class: "bar", "aria-hidden": "true" }, el("i", { style: "width:" + Math.round(f.answered / 8 * 100) + "%" }))),
    r && r.answerLine && el("div", { class: "answers" }, r.answerLine),
    el("div", { class: "meta" }, f.conditions && el("span", {}, f.conditions), el("span", {}, "Flagged " + when(f.raised_at) + (f.reason !== "new" ? " (" + f.reason + ")" : ""))),
    notes.length > 0 && el("ul", { class: "notes" }, notes.map(function (n) { return el("li", {}, n); })),
    f.also.length > 0 && el("div", { class: "meta", style: "margin-top:6px" }, "Also flagged: " + f.also.map(function (a) { return a.flagged + " (" + RANK_LABEL[a.rank].toLowerCase() + ")"; }).join(", ")));
  if (!firstLoad && seen[f.farmer.id] !== key) node.classList.add("changed");
  seen[f.farmer.id] = key;
  return node;
}

function draw(priority, summary) {
  var stats = document.getElementById("stats");
  stats.textContent = "";
  append(stats, [
    stat(summary.flagged_farms + " / " + summary.farmers, "farms flagged"),
    stat(summary.urgent, "need a visit now", summary.urgent > 0),
    stat(pct(summary.response_rate), "farmers answered"),
    stat(summary.outcomes.wrong_flag, "wrong flags caught by Q4"),
    stat(summary.states.no_response, "silent after a reminder")
  ]);

  var list = document.getElementById("list");
  list.textContent = "";
  if (!priority.farms.length) append(list, el("div", { class: "empty" }, "No farms flagged in this window. Try a wet spell from the demo controls."));
  priority.farms.forEach(function (f) { append(list, card(f)); });

  var flagged = {};
  priority.farms.forEach(function (f) { flagged[f.farmer.id] = true; });
  var rest = farmers.filter(function (f) { return !flagged[f.id]; });
  document.getElementById("unflagged").textContent = rest.length ? "Not flagged: " + rest.map(function (f) { return f.name + " (" + f.crop + ")"; }).join(", ") + "." : "";

  var answered = summary.states.answered || 0;
  var outcomes = document.getElementById("outcomes");
  outcomes.textContent = "";
  OUTCOMES.forEach(function (o) {
    var n = summary.outcomes[o[0]];
    append(outcomes, el("div", { class: "row" }, el("span", {}, o[1]), el("span", { class: "n" }, n),
      el("div", { class: "meter" }, el("i", { style: "background:" + o[2] + ";width:" + (answered ? Math.round(n / answered * 100) : 0) + "%" }))));
  });
  append(outcomes, el("p", { class: "legend", style: "margin:4px 0 0" }, answered + " answered · " + summary.states.answering + " answering · " + summary.states.waiting + " waiting"));

  var diseases = document.getElementById("diseases");
  diseases.textContent = "";
  if (!summary.by_disease.length) append(diseases, el("p", { class: "quiet", style: "margin:0" }, "No flags yet."));
  else append(diseases, el("table", {},
    el("thead", {}, el("tr", {}, el("th", {}, "Flag"), el("th", {}, "Flags"), el("th", {}, "Confirmed"), el("th", {}, "Wrong"))),
    el("tbody", {}, summary.by_disease.map(function (d) {
      return el("tr", {}, el("td", {}, cap(d.name)), el("td", {}, d.flags), el("td", {}, d.confirmed), el("td", {}, d.wrong_flag));
    }))));

  var says = document.getElementById("says");
  says.textContent = "";
  if (!summary.answers_say.length) append(says, el("p", { class: "quiet", style: "margin:0" }, "Nothing confirmed yet."));
  var top = summary.answers_say.length ? summary.answers_say[0].count : 1;
  summary.answers_say.forEach(function (a) {
    append(says, el("div", { class: "row" }, el("span", {}, cap(a.problem)), el("span", { class: "n" }, a.count),
      el("div", { class: "meter" }, el("i", { style: "background:var(--primary);width:" + Math.round(a.count / top * 100) + "%" }))));
  });
  firstLoad = false;
}

function refresh() {
  var q = "?days=" + days.value;
  Promise.all([api("/felix/priority" + q), api("/felix/summary" + q)]).then(function (res) {
    draw(res[0], res[1]);
    lastOk = Date.now();
  }).catch(function () {});
}
setInterval(function () {
  var live = document.getElementById("live");
  var age = Math.round((Date.now() - lastOk) / 1000);
  live.classList.toggle("stale", age > 10);
  live.textContent = lastOk ? (age < 5 ? "Live" : "Updated " + age + " s ago") : "Connecting";
}, 1000);

function busy(on) { document.querySelectorAll("#demo button").forEach(function (b) { b.disabled = on; }); }

function scenario(weather) {
  var id = document.getElementById("target").value;
  // One farm per request keeps each request inside D1's free-plan query limit.
  var ids = id ? [id] : farmers.map(function (f) { return f.id; });
  var alerts = 0;
  return ids.reduce(function (p, fid) {
    return p.then(function () {
      return api("/demo/scenario", { weather: weather, farmer_id: fid }).then(function (d) {
        alerts += d.results.filter(function (r) { return r.alert; }).length;
        refresh();
      });
    });
  }, Promise.resolve()).then(function () {
    toast(cap(weather) + " spell on " + ids.length + " farm" + (ids.length > 1 ? "s" : "") + ": " + alerts + " alert" + (alerts === 1 ? "" : "s") + " sent.");
  });
}

var ACTIONS = {
  wet: function () { return scenario("wet"); },
  dry: function () { return scenario("dry"); },
  check: function () {
    return api("/checks/run", {}).then(function (d) {
      var flags = d.results.filter(function (r) { return r.status === "flag"; }).length;
      var watch = d.results.filter(function (r) { return r.status === "watch"; }).length;
      var alerts = d.results.filter(function (r) { return r.alert; }).length;
      toast("Real forecast: " + flags + " flag, " + watch + " watch, " + alerts + " new alert" + (alerts === 1 ? "" : "s") + ".");
    });
  },
  sweep: function () {
    return api("/sweep", {}).then(function (d) { toast(d.reminded + " reminded, " + d.noResponse + " marked no response, " + d.rechecks + " re-asked."); });
  },
  reset: function () {
    if (!confirm("Delete every flag, answer and message? Farmers stay.")) return Promise.resolve();
    seen = {}; firstLoad = true;
    return api("/demo/reset", { confirm: "reset" }).then(function () { toast("Demo reset."); });
  }
};
document.querySelectorAll("#demo button").forEach(function (b) {
  b.addEventListener("click", function () {
    busy(true);
    ACTIONS[b.getAttribute("data-act")]().catch(function (e) { toast(e.message); }).then(function () { busy(false); refresh(); });
  });
});
days.addEventListener("change", function () { store("fieldwise-days", days.value); firstLoad = true; refresh(); });

gate(function () {
  api("/farmers").then(function (d) {
    farmers = d.farmers;
    var target = document.getElementById("target");
    farmers.forEach(function (f) { append(target, el("option", { value: f.id }, f.name + " · " + f.crop)); });
    refresh();
    setInterval(refresh, 3000);
  }).catch(function (e) { toast(e.message); });
});
`,
);

export const demoPage = page(
  "FieldWise Live Demo",
  `
body { height: 100vh; display: flex; flex-direction: column; }
.bar { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--hairline); flex-wrap: wrap; }
.bar .sp { flex: 1; }
.bar a { color: var(--primary); font-size: 14px; font-weight: 600; text-decoration: none; }
.panes { flex: 1; display: grid; grid-template-columns: 420px minmax(0, 1fr); min-height: 0; }
.panes iframe { width: 100%; height: 100%; border: 0; display: block; }
.panes iframe + iframe { border-left: 1px solid var(--hairline); }
@media (max-width: 900px) {
  body { height: auto; }
  .panes { grid-template-columns: minmax(0, 1fr); }
  .panes iframe { height: 820px; }
  .panes iframe + iframe { border-left: 0; border-top: 1px solid var(--hairline); }
}
`,
  `<div class="bar"><span class="brand"><i></i>FieldWise</span><span class="muted">Farmer's phone, left. Felix's dashboard, right.</span><span class="sp"></span><a href="/sim" target="_blank" rel="noopener">Phone only</a><a href="/dashboard" target="_blank" rel="noopener">Dashboard only</a></div>
<div class="panes" id="panes"></div>`,
  `
gate(function () {
  // The token goes in the fragment, which is never sent to the server, in case
  // this browser blocks storage.
  var hash = "#token=" + encodeURIComponent(token);
  var panes = document.getElementById("panes");
  append(panes, [
    el("iframe", { src: "/sim" + hash, title: "Farmer's phone" }),
    el("iframe", { src: "/dashboard" + hash, title: "Felix's dashboard" })
  ]);
});
`,
);
