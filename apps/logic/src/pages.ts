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
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='6' fill='%231D5233'/%3E%3Cpath fill='%23fff' d='M19 5c-7 0-12 3.5-13 9.6-.2 1.2-.2 2.5 0 3.8l1.4-.3c-.1-.9-.1-1.9 0-2.8C9.5 13.4 12 10.8 15.5 9c-3 2.1-5.2 4.6-6.4 7.7C14.8 17.1 19 12.6 19 5Z'/%3E%3C/svg%3E">
<style>${STYLE}${css}</style>
</head>
<body>
${body}
<script>${CLIENT}${script}</script>
</body>
</html>`;
}

// A phone frame shared by the farmer's and Felix's phones: bezel, status bar,
// a notification banner that slides down, and a buzz. Each phone sets
// --screen-bg, --screen-text, --bar-bg, --bar-text and --banner-icon.
const PHONE_CSS = `
body { min-height: 100vh; display: grid; place-items: start center; padding: 16px; }
.wrap { width: min(390px, 100%); display: grid; gap: 12px; }
.phone { position: relative; background: #0E0F0C; border-radius: 52px; padding: 12px; box-shadow: 0 0 0 2px #2A2B27 inset, 0 30px 60px rgba(0,0,0,.25); }
.phone.buzz { animation: buzz .5s ease-in-out; }
@keyframes buzz { 0%,100% { transform: none; } 20% { transform: translateX(-3px) rotate(-.6deg); } 40% { transform: translateX(3px) rotate(.6deg); } 60% { transform: translateX(-2px); } 80% { transform: translateX(2px); } }
.island { position: absolute; top: 22px; left: 50%; transform: translateX(-50%); width: 104px; height: 30px; background: #000; border-radius: 20px; z-index: 5; }
.screen { position: relative; background: var(--screen-bg); border-radius: 42px; overflow: hidden; display: flex; flex-direction: column; height: min(760px, calc(100vh - 110px)); min-height: 520px; color: var(--screen-text); }
.statusbar { display: flex; justify-content: space-between; align-items: center; padding: 16px 30px 6px; font-size: 14px; font-weight: 600; background: var(--bar-bg); color: var(--bar-text); }
.statusbar .sys { display: flex; gap: 5px; align-items: center; }
.statusbar svg { display: block; fill: currentColor; }
.banner { position: absolute; top: 56px; left: 10px; right: 10px; z-index: 6; background: rgba(250,250,250,.94); color: #111; backdrop-filter: blur(16px); border-radius: 18px; padding: 10px 14px 12px; box-shadow: 0 10px 30px rgba(0,0,0,.25); transform: translateY(calc(-100% - 80px)); opacity: 0; transition: transform .45s cubic-bezier(.2,.9,.25,1.1), opacity .2s; }
.banner.show { transform: none; opacity: 1; }
.banner .app { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #555; margin-bottom: 3px; }
.banner .app i { width: 18px; height: 18px; border-radius: 5px; background: var(--banner-icon); display: inline-block; }
.banner .app span { margin-left: auto; }
.banner b { display: block; font-size: 14px; }
.banner p { margin: 1px 0 0; font-size: 13.5px; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
`;

/** The phone's bezel, status bar and (hidden) notification banner, from the given app. */
const phoneTop = (app: string) => `<div class="phone" id="phone"><div class="island"></div><div class="screen">
    <div class="statusbar"><span id="clock">9:41</span><span class="sys" aria-hidden="true">
      <svg width="17" height="11" viewBox="0 0 17 11"><rect x="0" y="7" width="3" height="4" rx="1"/><rect x="4.5" y="5" width="3" height="6" rx="1"/><rect x="9" y="2.5" width="3" height="8.5" rx="1"/><rect x="13.5" y="0" width="3" height="11" rx="1"/></svg>
      <svg width="15" height="11" viewBox="0 0 15 11"><path d="M7.5 2.2c2.2 0 4.2.9 5.7 2.3l1.1-1.1A9.6 9.6 0 0 0 7.5.6 9.6 9.6 0 0 0 .7 3.4l1.1 1.1a8 8 0 0 1 5.7-2.3Zm0 3.2c1.3 0 2.5.5 3.4 1.3l1.1-1.1a6.4 6.4 0 0 0-9 0l1.1 1.1c.9-.8 2.1-1.3 3.4-1.3Zm0 3.1c.5 0 .9.2 1.2.5L7.5 10.2 6.3 9c.3-.3.7-.5 1.2-.5Z"/></svg>
      <svg width="26" height="12" viewBox="0 0 26 12"><rect x=".5" y=".5" width="22" height="11" rx="3" fill="none" stroke="currentColor" opacity=".45"/><rect x="2" y="2" width="16" height="8" rx="1.8"/><rect x="23.5" y="4" width="1.8" height="4" rx=".9" opacity=".45"/></svg>
    </span></div>
    <div class="banner" id="banner" aria-live="polite"><div class="app"><i></i>${app}<span>now</span></div><b id="banner-title"></b><p id="banner-text"></p></div>`;

const phoneBottom = `</div></div>`;

const PHONE_CLIENT = `
var bannerTimer;
/** A notification sliding down from the top, with a buzz. */
function banner(title, text) {
  document.getElementById("banner-title").textContent = title;
  document.getElementById("banner-text").textContent = text;
  var b = document.getElementById("banner");
  b.classList.add("show");
  var phone = document.getElementById("phone");
  phone.classList.remove("buzz");
  void phone.offsetWidth;
  phone.classList.add("buzz");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(function () { b.classList.remove("show"); }, 5000);
}
function tickClock() {
  document.getElementById("clock").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\\s?[AP]M$/i, "");
}
tickClock();
setInterval(tickClock, 10000);
`;

// A phone drawn like a WhatsApp chat, for presenting. Same flow as WhatsApp:
// questions arrive with reply buttons inside the bubble, a tap sends the
// button's label and its screen, ticks go sent -> delivered -> read, and a
// banner slides down when FieldWise messages first.
export const simulatorPage = page(
  "FieldWise Phone",
  PHONE_CSS + `
:root {
  --wa-head: #008069; --wa-on-head: #FFFFFF; --wa-wall: #EFEAE2; --wa-in: #FFFFFF; --wa-out: #D9FDD3;
  --wa-text: #111B21; --wa-meta: #667781; --wa-button: #027EB5; --wa-tick: #53BDEB; --wa-chip: #FFFFFF;
  --wa-notice: #FFEECD; --wa-on-notice: #54656F; --wa-input: #FFFFFF; --wa-bar: #F0F2F5; --wa-send: #00A884;
  --wa-doodle: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140' viewBox='0 0 140 140'%3E%3Cg fill='none' stroke='%23000' stroke-opacity='.045' stroke-width='1.6' stroke-linecap='round'%3E%3Cpath d='M18 34c8-14 26-14 30 0-6 13-23 13-30 0zM33 34h-12'/%3E%3Cpath d='M98 18v22M98 26c-7-6-13-4-15 1M98 31c7-6 13-4 15 1'/%3E%3Ccircle cx='112' cy='92' r='9'/%3E%3Cpath d='M112 76v-5M112 113v-5M128 92h-5M101 92h-5'/%3E%3Cpath d='M20 98q9-12 18 0t18 0'/%3E%3Cpath d='M64 124c6-10 18-10 22 0-4 9-17 9-22 0z'/%3E%3Cpath d='M62 62l6 10 6-10z'/%3E%3C/g%3E%3C/svg%3E");
}
@media (prefers-color-scheme: dark) {
  :root {
    --wa-head: #202C33; --wa-on-head: #E9EDEF; --wa-wall: #0B141A; --wa-in: #202C33; --wa-out: #005C4B;
    --wa-text: #E9EDEF; --wa-meta: #8696A0; --wa-button: #53BDEB; --wa-chip: #182229;
    --wa-notice: #182229; --wa-on-notice: #FFD279; --wa-input: #2A3942; --wa-bar: #1F2C34; --wa-send: #00A884;
    --wa-doodle: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140' viewBox='0 0 140 140'%3E%3Cg fill='none' stroke='%23fff' stroke-opacity='.05' stroke-width='1.6' stroke-linecap='round'%3E%3Cpath d='M18 34c8-14 26-14 30 0-6 13-23 13-30 0zM33 34h-12'/%3E%3Cpath d='M98 18v22M98 26c-7-6-13-4-15 1M98 31c7-6 13-4 15 1'/%3E%3Ccircle cx='112' cy='92' r='9'/%3E%3Cpath d='M112 76v-5M112 113v-5M128 92h-5M101 92h-5'/%3E%3Cpath d='M20 98q9-12 18 0t18 0'/%3E%3Cpath d='M64 124c6-10 18-10 22 0-4 9-17 9-22 0z'/%3E%3Cpath d='M62 62l6 10 6-10z'/%3E%3C/g%3E%3C/svg%3E");
  }
}
.screen { --screen-bg: var(--wa-wall); --screen-text: var(--wa-text); --bar-bg: var(--wa-head); --bar-text: var(--wa-on-head); --banner-icon: #25D366; }
.pick { display: flex; gap: 8px; align-items: center; }
.pick select { flex: 1; font-size: 14px; }
.wa-head { display: flex; align-items: center; gap: 8px; padding: 6px 12px 10px 6px; background: var(--wa-head); color: var(--wa-on-head); }
.wa-head .back { font-size: 26px; line-height: 1; padding: 0 2px 2px 4px; opacity: .95; }
.avatar { width: 38px; height: 38px; border-radius: 50%; background: #E7F3EC; display: grid; place-items: center; flex: none; }
.avatar svg { width: 22px; height: 22px; }
.who { flex: 1; min-width: 0; }
.who b { display: flex; align-items: center; gap: 4px; font-size: 16px; font-weight: 600; }
.who b svg { width: 15px; height: 15px; flex: none; }
.who span { display: block; font-size: 12.5px; opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wa-head .icons { display: flex; gap: 18px; padding-right: 6px; }
.wa-head .icons svg { width: 20px; height: 20px; fill: currentColor; display: block; }
.thread { flex: 1; overflow-y: auto; padding: 10px 14px 8px; display: flex; flex-direction: column; gap: 3px; background-color: var(--wa-wall); background-image: var(--wa-doodle); background-size: 140px 140px; scroll-behavior: smooth; }
.chip { align-self: center; background: var(--wa-chip); color: var(--wa-meta); font-size: 12px; padding: 5px 12px; border-radius: 8px; margin: 6px 0; box-shadow: 0 1px .5px rgba(11,20,26,.13); text-transform: uppercase; letter-spacing: .02em; }
.notice { align-self: center; max-width: 88%; background: var(--wa-notice); color: var(--wa-on-notice); font-size: 12px; line-height: 1.4; padding: 6px 10px; border-radius: 8px; text-align: center; margin-bottom: 8px; box-shadow: 0 1px .5px rgba(11,20,26,.13); }
.msg { max-width: 82%; display: flex; flex-direction: column; margin-top: 4px; }
.msg.from-fw { align-self: flex-start; }
.msg.from-me { align-self: flex-end; }
.msg.cont { margin-top: 1px; }
.bubble { position: relative; padding: 6px 8px 8px 9px; border-radius: 8px; font-size: 14.2px; line-height: 1.38; white-space: pre-wrap; overflow-wrap: anywhere; box-shadow: 0 1px .5px rgba(11,20,26,.13); }
.from-fw .bubble { background: var(--wa-in); border-top-left-radius: 0; }
.from-me .bubble { background: var(--wa-out); border-top-right-radius: 0; }
.from-fw:not(.cont) .bubble::before, .from-me:not(.cont) .bubble::before { content: ""; position: absolute; top: 0; width: 8px; height: 13px; }
.from-fw:not(.cont) .bubble::before { left: -8px; background: var(--wa-in); clip-path: polygon(100% 0, 0 0, 100% 100%); }
.from-me:not(.cont) .bubble::before { right: -8px; background: var(--wa-out); clip-path: polygon(0 0, 100% 0, 0 100%); }
.from-fw.cont .bubble { border-top-left-radius: 8px; }
.from-me.cont .bubble { border-top-right-radius: 8px; }
.has-buttons .bubble { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
.bubble b.head { display: block; font-weight: 700; margin-bottom: 2px; }
.meta { float: right; margin: 6px 0 -4px 10px; font-size: 11px; color: var(--wa-meta); display: inline-flex; gap: 3px; align-items: center; position: relative; top: 2px; }
.meta svg { width: 16px; height: 11px; }
.tick { fill: var(--wa-meta); }
.tick.read { fill: var(--wa-tick); }
.tick .two { opacity: 1; }
.tick.sent .two { opacity: 0; }
.fresh .tick { animation: tick-read 1.6s steps(1) forwards; }
.fresh .tick .two { animation: tick-two 1.6s steps(1) forwards; }
@keyframes tick-two { 0% { opacity: 0; } 35% { opacity: 1; } 100% { opacity: 1; } }
@keyframes tick-read { 0% { fill: var(--wa-meta); } 75% { fill: var(--wa-tick); } 100% { fill: var(--wa-tick); } }
.buttons { display: flex; flex-direction: column; gap: 2px; margin-top: 2px; }
.buttons button { background: var(--wa-in); color: var(--wa-button); border: 0; padding: 10px; font-size: 14.5px; font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 1px .5px rgba(11,20,26,.13); }
.buttons button:last-child { border-radius: 0 0 8px 8px; }
.buttons button svg { width: 15px; height: 15px; fill: currentColor; }
.buttons button:active { filter: brightness(.95); }
.failed .bubble { outline: 1.5px solid var(--red); }
.err { font-size: 11.5px; color: var(--red); margin-top: 3px; }
.typing .bubble { display: flex; gap: 4px; padding: 12px 14px; }
.typing i { width: 7px; height: 7px; border-radius: 50%; background: var(--wa-meta); animation: dot 1.2s infinite; }
.typing i:nth-child(2) { animation-delay: .15s; }
.typing i:nth-child(3) { animation-delay: .3s; }
@keyframes dot { 0%, 60%, 100% { opacity: .35; transform: none; } 30% { opacity: 1; transform: translateY(-3px); } }
.empty { margin: auto; text-align: center; color: var(--wa-meta); font-size: 13.5px; padding: 24px; background: var(--wa-chip); border-radius: 10px; }
.wa-input { display: flex; gap: 6px; align-items: flex-end; padding: 6px 8px 22px; background: transparent; }
.field { flex: 1; display: flex; align-items: center; gap: 8px; background: var(--wa-input); border-radius: 24px; padding: 4px 12px; box-shadow: 0 1px .5px rgba(11,20,26,.13); }
.field svg { width: 22px; height: 22px; fill: var(--wa-meta); flex: none; }
.field input { flex: 1; border: 0; background: transparent; padding: 8px 0; font-size: 15px; color: var(--wa-text); outline: none; border-radius: 0; }
.send { width: 46px; height: 46px; border-radius: 50%; border: 0; background: var(--wa-send); display: grid; place-items: center; flex: none; }
.send svg { width: 22px; height: 22px; fill: #fff; }
.note { font-size: 12px; color: var(--muted); text-align: center; margin: 0; }
`,
  `<main class="wrap">
  <div class="pick"><label for="farmer" class="muted" style="font-size:13px">Farmer</label><select id="farmer"></select></div>
  ${phoneTop("WhatsApp")}
    <header class="wa-head">
      <span class="back" aria-hidden="true">‹</span>
      <div class="avatar" aria-hidden="true"><svg viewBox="0 0 24 24"><path fill="#1D5233" d="M20 4c-8 0-14 4-15 11-.2 1.4-.2 2.9 0 4.4l1.6-.3c-.1-1.1-.1-2.2 0-3.2C9 14 12 11 16 9c-3.4 2.4-6 5.3-7.4 8.8 6.6.5 11.4-4.7 11.4-13.8Z"/></svg></div>
      <div class="who"><b>FieldWise <svg viewBox="0 0 18 18" aria-label="Business account"><path fill="#25D366" d="M9 0l2.2 1.6 2.7-.2.9 2.6 2.4 1.3-.6 2.7L18 9l-1.4 2 .6 2.7-2.4 1.3-.9 2.6-2.7-.2L9 18l-2.2-1.6-2.7.2-.9-2.6-2.4-1.3.6-2.7L0 9l1.4-2-.6-2.7L3.2 3l.9-2.6 2.7.2Z"/><path fill="#fff" d="M7.7 12.3 4.6 9.2l1.2-1.2 1.9 1.9 4.5-4.5 1.2 1.2Z"/></svg></b><span id="sub">Business account</span></div>
      <span class="icons" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M15 8v8H5V8h10m1-2H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4V7a1 1 0 0 0-1-1Z"/></svg>
        <svg viewBox="0 0 24 24"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2Z"/></svg>
      </span>
    </header>
    <div class="thread" id="thread" aria-live="polite"></div>
    <form class="wa-input" id="compose">
      <label class="field"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18.2a8.2 8.2 0 1 1 0-16.4 8.2 8.2 0 0 1 0 16.4ZM8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm7 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM12 17.5c2.3 0 4.3-1.4 5.1-3.5H6.9c.8 2.1 2.8 3.5 5.1 3.5Z"/></svg><input type="text" id="text" placeholder="Message" autocomplete="off" aria-label="Reply"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6H10v9.5a2.5 2.5 0 0 0 5 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6h-1.5Z"/></svg></label>
      <button class="send" type="submit" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2Z"/></svg></button>
    </form>
  ${phoneBottom}
  <p class="note" id="note">Simulated WhatsApp chat. Messages here never leave FieldWise.</p>
</main>`,
  PHONE_CLIENT + `
var farmers = [], current = null, lastKey = null, lastMaxId = 0, sending = false, firstDraw = true;
var seenIds = {};
var select = document.getElementById("farmer");
var thread = document.getElementById("thread");
var HEADER = /^.+ · \\d+ (of|mwa) 8$/;
var OPTION = /^(\\d+) (.+)$/;
var NS = "http://www.w3.org/2000/svg";

function svgIcon(viewBox, paths, cls) {
  var svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", viewBox);
  if (cls) svg.setAttribute("class", cls);
  paths.forEach(function (p) {
    var path = document.createElementNS(NS, "path");
    path.setAttribute("d", p[0]);
    if (p[1]) path.setAttribute("class", p[1]);
    svg.appendChild(path);
  });
  return svg;
}
function ticks(status) {
  // One tick, then two, then blue: the farmer's own messages, as WhatsApp shows them.
  return svgIcon("0 0 16 11", [["M11.1.6 4.4 7.3 1.6 4.5.5 5.6l3.9 3.9L12.2 1.7Z"], ["M15.2.6 8.5 7.3l-.7-.7-1.1 1.1 1.8 1.8L16.3 1.7Z", "two"]], "tick " + status);
}
function replyIcon() { return svgIcon("0 0 24 24", [["M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11Z"]]); }
function time(iso) { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }

/** Splits a logged question into its header, text and buttons. */
function parse(m) {
  var lines = m.body.split("\\n");
  var head = HEADER.test(lines[0]) ? lines.shift() : null;
  var options = [];
  if (m.screen) {
    while (lines.length && OPTION.test(lines[lines.length - 1])) options.unshift(lines.pop().match(OPTION)[2]);
  }
  return { head: head, text: lines.join("\\n"), options: options };
}

function bubbleFor(m, prev) {
  var mine = m.direction === "in";
  var cont = prev && prev.direction === m.direction;
  var p = mine ? { head: null, text: m.body, options: [] } : parse(m);
  var fresh = mine && !firstDraw && !seenIds[m.id];
  var status = m.status === "failed" ? "" : "read";
  var meta = el("span", { class: "meta" }, time(m.at), mine && ticks(fresh ? "sent" : status));
  var wrap = el("div", { class: "msg " + (mine ? "from-me" : "from-fw") + (cont ? " cont" : "") + (p.options.length ? " has-buttons" : "") + (fresh ? " fresh" : "") + (m.status === "failed" ? " failed" : "") },
    el("div", { class: "bubble" }, p.head && el("b", { class: "head" }, p.head), p.text, meta));
  if (p.options.length) {
    append(wrap, el("div", { class: "buttons" }, p.options.map(function (label) {
      return el("button", { type: "button", on: { click: function () { send(label, m.screen); } } }, replyIcon(), label);
    })));
  }
  if (m.status === "failed") append(wrap, el("div", { class: "err" }, "Not delivered: " + (m.error || "unknown error")));
  return wrap;
}

function render(messages, pending) {
  thread.textContent = "";
  append(thread, el("div", { class: "chip" }, "Today"));
  append(thread, el("div", { class: "notice" }, "FieldWise sends farm advice for Kasungu. Messages here are simulated and never leave FieldWise."));
  if (!messages.length && !pending) append(thread, el("div", { class: "empty" }, "No messages yet. Fire a wet spell from the dashboard."));
  var prev = null;
  messages.forEach(function (m) { append(thread, bubbleFor(m, prev)); prev = m; });
  if (pending) {
    append(thread, bubbleFor({ id: "pending", direction: "in", body: pending, at: new Date().toISOString() }, prev));
    append(thread, el("div", { class: "msg from-fw typing" }, el("div", { class: "bubble" }, el("i"), el("i"), el("i"))));
  }
  messages.forEach(function (m) { seenIds[m.id] = true; });
  thread.scrollTop = thread.scrollHeight;
  firstDraw = false;
}

function refresh() {
  if (!current || sending) return;
  var id = current.id;
  api("/farmers/" + encodeURIComponent(id) + "/messages").then(function (d) {
    if (!current || current.id !== id || sending) return;
    var msgs = d.messages;
    var key = msgs.length + ":" + msgs.map(function (m) { return m.id + (m.status || ""); }).join(",");
    if (key === lastKey) return;
    // FieldWise writing first (an alert, a reminder): ring the phone.
    var fresh = msgs.filter(function (m) { return m.id > lastMaxId; });
    if (lastKey !== null && fresh.length && fresh[0].direction === "out") banner("FieldWise", fresh[0].body.split("\\n")[0].replace(/^FieldWise:\\s*/, ""));
    lastKey = key;
    lastMaxId = msgs.length ? msgs[msgs.length - 1].id : 0;
    render(msgs);
  }).catch(function () {});
}

function send(text, screen) {
  if (!current || sending || !String(text).trim()) return;
  sending = true;
  document.getElementById("sub").textContent = "typing…";
  // Show the farmer's message and FieldWise typing at once, then the real reply.
  api("/farmers/" + encodeURIComponent(current.id) + "/messages").then(function (d) { render(d.messages, text); }).catch(function () {});
  var started = Date.now();
  var body = { phone: current.phone, text: text };
  if (screen) body.screen = screen;
  api("/inbound", body).catch(function (e) { toast(e.message); }).then(function () {
    setTimeout(function () {
      sending = false;
      document.getElementById("sub").textContent = "Business account";
      refresh();
    }, Math.max(0, 900 - (Date.now() - started)));
  });
}

function choose(id) {
  current = farmers.filter(function (f) { return f.id === id; })[0] || farmers[0];
  if (!current) return;
  // Farmers without a smartphone get the keypad phone.
  if (current.channel === "ussd") {
    location.replace("/phone?farmer=" + encodeURIComponent(current.id) + "#token=" + encodeURIComponent(token));
    return;
  }
  store("fieldwise-sim-farmer", current.id);
  select.value = current.id;
  lastKey = null; lastMaxId = 0; firstDraw = true; seenIds = {};
  document.getElementById("note").textContent = current.channel === "whatsapp"
    ? "Mirror of this farmer's real WhatsApp chat. Replies typed here go to FieldWise as theirs."
    : "Simulated WhatsApp chat for " + current.name + ". Messages here never leave FieldWise.";
  refresh();
}

document.getElementById("compose").addEventListener("submit", function (e) {
  e.preventDefault();
  var input = document.getElementById("text");
  send(input.value);
  input.value = "";
});
select.addEventListener("change", function () { choose(select.value); });

gate(function () {
  api("/farmers").then(function (d) {
    farmers = d.farmers;
    farmers.forEach(function (f) {
      append(select, el("option", { value: f.id }, f.name + " · " + (f.channel === "ussd" ? "keypad phone" : "WhatsApp")));
    });
    choose(new URLSearchParams(location.search).get("farmer") || store("fieldwise-sim-farmer"));
    setInterval(refresh, 1500);
  }).catch(function (e) { toast(e.message); });
});
`,
);

// A basic keypad phone, for the 9 in 10 farmers without a smartphone. Dial
// the FieldWise code to answer questions or use the menu (USSD, through the
// same /ussd route Africa's Talking calls); alerts and Felix's messages
// arrive as SMS. The screen holds what a real USSD screen does, and a session
// left idle times out, as networks do.
export const featurePhonePage = page(
  "FieldWise Feature Phone",
  `
body { min-height: 100vh; display: grid; place-items: start center; padding: 16px; }
.wrap { width: min(340px, 100%); display: grid; gap: 12px; }
.pick { display: flex; gap: 8px; align-items: center; }
.pick select { flex: 1; font-size: 14px; }
.handset { position: relative; background: linear-gradient(160deg, #3A3E45, #1E2024 60%); border-radius: 44px 44px 56px 56px; padding: 26px 22px 30px; box-shadow: 0 0 0 2px #15171A inset, 0 1px 0 3px rgba(255,255,255,.04) inset, 0 30px 60px rgba(0,0,0,.28); }
.handset.buzz { animation: buzz .5s ease-in-out; }
@keyframes buzz { 0%,100% { transform: none; } 20% { transform: translateX(-3px) rotate(-.6deg); } 40% { transform: translateX(3px) rotate(.6deg); } 60% { transform: translateX(-2px); } 80% { transform: translateX(2px); } }
.speaker { width: 70px; height: 6px; border-radius: 3px; background: #0E0F11; margin: 0 auto 10px; box-shadow: 0 1px 0 rgba(255,255,255,.06); }
.maker { text-align: center; color: #9AA0A8; font-size: 11px; letter-spacing: .3em; font-weight: 700; margin-bottom: 10px; }
.lcd { background: #EEF2E6; color: #16200F; border-radius: 10px; height: 300px; display: flex; flex-direction: column; box-shadow: 0 0 0 4px #0B0C0E, 0 0 0 5px #4A4F57, inset 0 2px 8px rgba(0,0,0,.18); overflow: hidden; font: 500 14.5px/1.32 var(--font); }
.lcd .bar { display: flex; align-items: center; gap: 6px; padding: 5px 9px 4px; font-size: 11.5px; font-weight: 700; border-bottom: 1px solid rgba(22,32,15,.18); }
.lcd .bar .op { flex: 1; text-align: center; }
.lcd .bar svg { display: block; fill: currentColor; }
.lcd .view { flex: 1; overflow-y: auto; padding: 8px 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
.lcd .soft { display: flex; justify-content: space-between; padding: 4px 10px 6px; font-weight: 700; font-size: 13px; border-top: 1px solid rgba(22,32,15,.18); min-height: 27px; }
.lcd .soft span:nth-child(2) { opacity: .7; }
.idle { height: 100%; display: grid; place-items: center; text-align: center; gap: 4px; align-content: center; }
.idle .clock { font-size: 40px; font-weight: 300; letter-spacing: -.02em; line-height: 1; }
.idle .date { font-size: 13px; opacity: .75; }
.idle .env { margin-top: 14px; display: inline-flex; gap: 6px; align-items: center; font-weight: 700; background: #16200F; color: #EEF2E6; padding: 4px 10px; border-radius: 6px; }
.dialed { font-size: 26px; font-weight: 600; text-align: right; word-break: break-all; padding-top: 30px; letter-spacing: .02em; }
.title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; opacity: .65; margin-bottom: 4px; }
.reply { margin-top: 8px; border: 1.5px solid #16200F; border-radius: 4px; padding: 3px 6px; min-height: 26px; font-weight: 700; }
.reply::after { content: "|"; animation: blink 1s steps(1) infinite; margin-left: 1px; font-weight: 400; }
@keyframes blink { 50% { opacity: 0; } }
.wait { height: 100%; display: grid; place-items: center; text-align: center; }
.wait i { display: block; width: 26px; height: 26px; margin: 0 auto 8px; border: 3px solid rgba(22,32,15,.2); border-top-color: #16200F; border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.sms-meta { font-size: 11.5px; opacity: .7; margin-bottom: 4px; }
.count { font-size: 12px; opacity: .6; margin-left: auto; }
.keys { margin-top: 18px; display: grid; gap: 9px; }
.nav { display: grid; grid-template-columns: 1fr 1fr 1.1fr 1fr 1fr; gap: 8px; align-items: center; }
.key { border: 0; border-radius: 14px; background: linear-gradient(#4A4F57, #33373D); color: #EDEFF2; box-shadow: 0 2px 0 #121316, 0 0 0 1px rgba(255,255,255,.05) inset; height: 42px; display: grid; place-items: center; font-weight: 700; font-size: 18px; line-height: 1; padding: 0; user-select: none; }
.key:active, .key.down { transform: translateY(2px); box-shadow: 0 0 0 #121316, 0 0 0 1px rgba(255,255,255,.05) inset; filter: brightness(1.15); }
.key small { display: block; font-size: 9px; letter-spacing: .12em; font-weight: 600; opacity: .7; margin-top: 2px; }
.key.soft-k { height: 30px; font-size: 0; }
.key.soft-k::before { content: ""; width: 22px; height: 3px; border-radius: 2px; background: #C8CCD2; }
.key.ok { border-radius: 50%; height: 50px; width: 50px; justify-self: center; font-size: 13px; }
.key.call { background: linear-gradient(#2E8B4E, #1F6B3A); }
.key.end { background: linear-gradient(#B4392E, #8C2A22); }
.key svg { width: 20px; height: 20px; fill: currentColor; }
.pad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px; }
.pad .key { height: 46px; display: block; padding-top: 7px; }
.quick { display: flex; gap: 8px; }
.quick .btn { flex: 1; }
.note { font-size: 12px; color: var(--muted); text-align: center; margin: 0; }
`,
  `<main class="wrap">
  <div class="pick"><label for="farmer" class="muted" style="font-size:13px">Farmer</label><select id="farmer"></select></div>
  <div class="handset" id="phone">
    <div class="speaker" aria-hidden="true"></div>
    <div class="maker" aria-hidden="true">FIELDPHONE</div>
    <div class="lcd" role="region" aria-label="Phone screen">
      <div class="bar" aria-hidden="true">
        <svg width="16" height="11" viewBox="0 0 16 11"><rect x="0" y="8" width="3" height="3"/><rect x="4.3" y="5.5" width="3" height="5.5"/><rect x="8.6" y="3" width="3" height="8"/><rect x="12.9" y="0" width="3" height="11"/></svg>
        <span class="op" id="op">Airtel MW</span>
        <span id="time">9:41</span>
        <svg width="22" height="11" viewBox="0 0 22 11"><rect x=".5" y=".5" width="18" height="10" rx="2" fill="none" stroke="currentColor"/><rect x="2" y="2" width="12" height="7"/><rect x="19.5" y="3.5" width="2" height="4"/></svg>
      </div>
      <div class="view" id="view" aria-live="polite"></div>
      <div class="soft" id="soft"><span id="soft-l"></span><span id="soft-c"></span><span id="soft-r"></span></div>
    </div>
    <div class="keys">
      <div class="nav">
        <button class="key soft-k" type="button" data-key="L" aria-label="Left soft key"></button>
        <button class="key call" type="button" data-key="CALL" aria-label="Call"><svg viewBox="0 0 24 24"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2Z"/></svg></button>
        <button class="key ok" type="button" data-key="OK" aria-label="OK">OK</button>
        <button class="key end" type="button" data-key="END" aria-label="End"><svg viewBox="0 0 24 24"><path d="M12 9c-1.6 0-3.2.3-4.6.7v3.1c0 .4-.2.7-.6.9-1 .5-1.9 1.1-2.7 1.8-.2.2-.4.3-.7.3s-.5-.1-.7-.3L.3 13.1A1 1 0 0 1 0 12.4c0-.3.1-.5.3-.7A16.9 16.9 0 0 1 12 7c4.5 0 8.6 1.7 11.7 4.6.2.2.3.5.3.7 0 .3-.1.5-.3.7l-2.4 2.4c-.2.2-.4.3-.7.3s-.5-.1-.7-.3c-.8-.7-1.7-1.3-2.7-1.8-.3-.2-.6-.5-.6-.9V9.7C15.2 9.3 13.6 9 12 9Z"/></svg></button>
        <button class="key soft-k" type="button" data-key="R" aria-label="Right soft key"></button>
      </div>
      <div class="pad" id="pad"></div>
    </div>
  </div>
  <div class="quick"><button class="btn primary" type="button" id="quick-dial"></button><button class="btn" type="button" id="quick-sms">Messages</button></div>
  <p class="note" id="note">Simulated keypad phone. USSD and SMS here never leave FieldWise.</p>
</main>`,
  `
var CODE = "*384*123#";
var TIMEOUT_MS = 120000;
var KEYS = [["1", ""], ["2", "abc"], ["3", "def"], ["4", "ghi"], ["5", "jkl"], ["6", "mno"], ["7", "pqrs"], ["8", "tuv"], ["9", "wxyz"], ["*", "+"], ["0", "_"], ["#", ""]];
var farmers = [], current = null, view = "idle", dialed = "", input = "", screen = "", session = null, inputs = [];
var sms = [], readAt = 0, lastSmsId = null, timer = null, busy = false;
var select = document.getElementById("farmer");
var viewEl = document.getElementById("view");
document.getElementById("quick-dial").textContent = "Dial " + CODE;

function soft(l, c, r) {
  document.getElementById("soft-l").textContent = l || "";
  document.getElementById("soft-c").textContent = c || "";
  document.getElementById("soft-r").textContent = r || "";
}
function clock() { return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }); }
function seenKey() { return "fieldwise-sms-seen-" + (current ? current.id : ""); }
function unread() {
  var seen = Number(store(seenKey()) || 0);
  return sms.filter(function (m) { return m.id > seen; }).length;
}
function buzz() {
  var p = document.getElementById("phone");
  p.classList.remove("buzz"); void p.offsetWidth; p.classList.add("buzz");
}

function draw() {
  document.getElementById("time").textContent = clock();
  viewEl.textContent = "";
  if (view === "idle") {
    var n = unread();
    append(viewEl, el("div", { class: "idle" },
      el("div", { class: "clock" }, clock()),
      el("div", { class: "date" }, new Date().toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })),
      n > 0 && el("div", { class: "env" }, "✉ " + n + " new message" + (n > 1 ? "s" : ""))));
    soft(n > 0 ? "Read" : "Messages", "", "Names");
  } else if (view === "dial") {
    append(viewEl, el("div", { class: "dialed" }, dialed));
    soft("Call", "", "Clear");
  } else if (view === "wait") {
    append(viewEl, el("div", { class: "wait" }, el("div", {}, el("i"), "USSD code running...")));
    soft("", "", "");
  } else if (view === "ussd") {
    append(viewEl, [screen, el("div", { class: "reply", "aria-label": "Your reply" }, input)]);
    soft("Send", "", input ? "Clear" : "Cancel");
  } else if (view === "ended") {
    append(viewEl, screen);
    soft("OK", "", "");
  } else if (view === "inbox") {
    if (!sms.length) { append(viewEl, el("div", { class: "wait" }, "No messages")); soft("", "", "Back"); return; }
    var m = sms[sms.length - 1 - readAt];
    append(viewEl, [
      el("div", { class: "sms-meta" }, el("b", {}, "FieldWise"), " · " + new Date(m.at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }), el("span", { class: "count" }, " " + (readAt + 1) + "/" + sms.length)),
      m.body]);
    soft(readAt < sms.length - 1 ? "Older" : "", "", "Back");
  }
  viewEl.scrollTop = 0;
}

function resetTimer() {
  clearTimeout(timer);
  timer = setTimeout(function () {
    if (view !== "ussd") return;
    session = null;
    screen = "USSD session timed out. Please dial again.";
    view = "ended";
    draw();
  }, TIMEOUT_MS);
}

function ussd(text) {
  busy = true;
  view = "wait"; draw();
  var started = Date.now();
  fetch("/ussd", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: session, serviceCode: CODE, phoneNumber: current.phone, text: text })
  }).then(function (r) {
    if (r.status === 401) { forgetToken(); throw new Error("Wrong admin token"); }
    return r.text();
  }).then(function (reply) {
    setTimeout(function () {
      busy = false;
      screen = reply.slice(4);
      if (reply.indexOf("CON ") === 0) { view = "ussd"; resetTimer(); }
      else { view = "ended"; session = null; clearTimeout(timer); }
      draw();
    }, Math.max(0, 700 - (Date.now() - started)));
  }).catch(function (e) {
    busy = false;
    toast(e.message);
    screen = "Connection problem or invalid MMI code.";
    view = "ended"; session = null;
    draw();
  });
}

function startUssd() {
  session = "sim_" + Math.random().toString(36).slice(2, 12);
  inputs = [];
  input = "";
  dialed = "";
  ussd("");
}

function press(k) {
  if (!current || busy) return;
  if (k === "END") {
    clearTimeout(timer); session = null; input = ""; dialed = ""; view = "idle"; draw(); return;
  }
  if (view === "idle") {
    if (k === "L") { view = "inbox"; readAt = 0; markRead(); }
    else if (k.length === 1) { view = "dial"; dialed = k; }
  } else if (view === "dial") {
    if (k === "CALL" || k === "L" || k === "OK") {
      if (dialed === CODE) return startUssd();
      screen = /^\\*.*#$/.test(dialed) ? "Connection problem or invalid MMI code." : "Calls are off in this demo. Dial " + CODE + ".";
      view = "ended";
    } else if (k === "R") { dialed = dialed.slice(0, -1); if (!dialed) view = "idle"; }
    else if (k.length === 1 && dialed.length < 20) dialed += k;
  } else if (view === "ussd") {
    if (k === "L" || k === "OK" || k === "CALL") {
      if (!input) return;
      inputs.push(input);
      input = "";
      return ussd(inputs.join("*"));
    }
    if (k === "R") {
      if (input) input = input.slice(0, -1);
      else { session = null; clearTimeout(timer); view = "idle"; }
    } else if (k.length === 1 && input.length < 20) input += k;
    resetTimer();
  } else if (view === "ended") {
    if (k === "L" || k === "OK") view = "idle";
  } else if (view === "inbox") {
    if (k === "L" && readAt < sms.length - 1) readAt++;
    else if (k === "R" || k === "OK") view = "idle";
  }
  draw();
}

function markRead() {
  if (sms.length) store(seenKey(), String(sms[sms.length - 1].id));
}

KEYS.forEach(function (k) {
  append(document.getElementById("pad"), el("button", { class: "key", type: "button", "data-key": k[0], "aria-label": k[0] }, k[0], el("small", {}, k[1] || " ")));
});
document.querySelectorAll("[data-key]").forEach(function (b) {
  b.addEventListener("click", function () { press(b.getAttribute("data-key")); });
});
var KEYMAP = { Enter: "OK", Backspace: "R", Escape: "END" };
document.addEventListener("keydown", function (e) {
  if (e.target === select || e.metaKey || e.ctrlKey || e.altKey) return;
  var k = KEYMAP[e.key] || (/^[0-9*#]$/.test(e.key) ? e.key : null);
  if (!k) return;
  e.preventDefault();
  var b = document.querySelector('[data-key="' + k + '"]');
  if (b) { b.classList.add("down"); setTimeout(function () { b.classList.remove("down"); }, 120); }
  press(k);
});
document.getElementById("quick-dial").addEventListener("click", function () {
  if (!current || busy) return;
  clearTimeout(timer);
  startUssd();
});
document.getElementById("quick-sms").addEventListener("click", function () {
  if (!current || busy) return;
  view = "inbox"; readAt = 0; markRead(); draw();
});

function refresh() {
  if (!current) return;
  var id = current.id;
  api("/farmers/" + encodeURIComponent(id) + "/messages").then(function (d) {
    if (!current || current.id !== id) return;
    sms = d.messages.filter(function (m) { return m.direction === "out" && m.kind === "sms"; });
    var newest = sms.length ? sms[sms.length - 1].id : 0;
    if (lastSmsId !== null && newest > lastSmsId) buzz();
    lastSmsId = newest;
    if (view === "idle") draw();
    if (view === "inbox") markRead();
  }).catch(function () {});
}

function choose(id) {
  var next = farmers.filter(function (f) { return f.id === id; })[0] || farmers.filter(function (f) { return f.channel === "ussd"; })[0] || farmers[0];
  if (!next) return;
  if (next.channel !== "ussd") {
    location.replace("/sim?farmer=" + encodeURIComponent(next.id) + "#token=" + encodeURIComponent(token));
    return;
  }
  current = next;
  store("fieldwise-sim-farmer", current.id);
  select.value = current.id;
  clearTimeout(timer);
  view = "idle"; session = null; input = ""; dialed = ""; sms = []; lastSmsId = null;
  document.getElementById("note").textContent = "Simulated keypad phone for " + current.name + ". USSD and SMS here never leave FieldWise.";
  draw();
  refresh();
}
select.addEventListener("change", function () { choose(select.value); });
setInterval(function () { if (view === "idle") draw(); else document.getElementById("time").textContent = clock(); }, 15000);

gate(function () {
  api("/farmers").then(function (d) {
    farmers = d.farmers;
    farmers.forEach(function (f) {
      append(select, el("option", { value: f.id }, f.name + " · " + (f.channel === "ussd" ? "keypad phone" : "WhatsApp")));
    });
    choose(new URLSearchParams(location.search).get("farmer") || store("fieldwise-sim-farmer"));
    setInterval(refresh, 1500);
  }).catch(function (e) { toast(e.message); });
});
`,
);

// Felix's phone, drawn like the Felix app (its "Warm Paper" colours). It reads
// the same priority list as the dashboard and sends a push notification when
// flags go out, when an answer turns urgent, and when a farmer finishes.
export const officerPage = page(
  "Felix Phone",
  PHONE_CSS + `
.screen { --screen-bg: var(--bg); --screen-text: var(--text); --bar-bg: var(--bg); --bar-text: var(--text); --banner-icon: var(--primary); }
.pick { display: flex; gap: 8px; align-items: center; min-height: 38px; font-size: 13px; color: var(--muted); }
.pick b { color: var(--text); font-weight: 600; }
.app-head { display: flex; align-items: center; gap: 10px; padding: 6px 18px 10px; }
.app-head .me { width: 38px; height: 38px; border-radius: 50%; background: var(--primary); color: var(--on-primary); display: grid; place-items: center; font-weight: 700; }
.app-head .hi { flex: 1; min-width: 0; }
.app-head .hi b { display: block; font-size: 17px; letter-spacing: -0.01em; }
.app-head .hi span { font-size: 12.5px; color: var(--muted); }
.bell { position: relative; width: 40px; height: 40px; border-radius: 50%; background: var(--surface); border: 1px solid var(--hairline); display: grid; place-items: center; }
.bell svg { width: 20px; height: 20px; fill: var(--text); }
.bell .badge { position: absolute; top: -3px; right: -3px; min-width: 19px; height: 19px; padding: 0 5px; border-radius: 999px; background: var(--red); color: #fff; font-size: 11px; font-weight: 700; display: grid; place-items: center; transform: scale(0); transition: transform .25s cubic-bezier(.2,.9,.25,1.3); }
.bell .badge.on { transform: scale(1); }
.body { flex: 1; overflow-y: auto; padding: 4px 14px 12px; display: grid; gap: 10px; align-content: start; grid-auto-rows: max-content; }
.hero { background: var(--ink); color: var(--on-ink); border-radius: 24px; padding: 16px 18px; display: grid; gap: 4px; }
.hero small { color: var(--on-ink-muted); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; font-weight: 600; }
.hero b { font-size: 34px; line-height: 1.05; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.hero span { font-size: 13.5px; color: var(--on-ink-muted); }
.hero.urgent b { color: #FF9186; }
.section { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); font-weight: 600; margin: 6px 4px 0; }
.visit { background: var(--surface); border: 1px solid var(--hairline); border-radius: 18px; padding: 11px 14px 11px 16px; position: relative; overflow: hidden; text-align: left; width: 100%; display: grid; gap: 3px; }
.visit .toggle { background: none; border: 0; padding: 0; text-align: left; display: grid; gap: 3px; width: 100%; color: inherit; }
.acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.acts button, .acts a { border: 1px solid var(--hairline); background: var(--surface-2); color: var(--text); border-radius: 999px; padding: 5px 10px; font-size: 12px; font-weight: 600; text-decoration: none; }
.acts button.primary { background: var(--primary); color: var(--on-primary); border-color: transparent; }
.acts .sent { font-size: 12px; color: var(--green); font-weight: 600; align-self: center; }
.call { background: var(--blue-soft); color: var(--on-blue-soft); border-radius: 18px; padding: 10px 14px; display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; align-items: center; }
.call b { font-size: 14px; }
.call span { font-size: 12.5px; grid-column: 1; }
.call .acts { grid-column: 2; grid-row: 1 / span 2; margin: 0; }
.visit::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--rank, var(--surface-3)); }
.visit.changed { animation: flash 1.6s ease-out; }
@keyframes flash { from { box-shadow: 0 0 0 3px var(--rank-soft, var(--primary-soft)); } to { box-shadow: 0 0 0 0 transparent; } }
.r-go_now { --rank: var(--red); --rank-soft: var(--red-soft); }
.r-this_week { --rank: var(--amber); --rank-soft: var(--amber-soft); }
.r-no_response { --rank: var(--slate); --rank-soft: var(--slate-soft); }
.r-recheck { --rank: var(--blue); --rank-soft: var(--blue-soft); }
.r-waiting { --rank: var(--surface-3); --rank-soft: var(--surface-2); }
.r-none { --rank: var(--green); --rank-soft: var(--green-soft); }
.visit .top { display: flex; gap: 6px; align-items: center; }
.visit .top b { font-size: 14.5px; letter-spacing: .01em; }
.visit .top .crop { font-size: 12px; color: var(--muted); }
.visit .top .chip { margin-left: auto; }
.chip { border-radius: 999px; padding: 2px 9px; font-size: 11.5px; font-weight: 650; white-space: nowrap; }
.chip.go_now { background: var(--red-soft); color: var(--on-red-soft); }
.chip.this_week { background: var(--amber-soft); color: var(--on-amber-soft); }
.chip.no_response { background: var(--slate-soft); color: var(--on-slate-soft); }
.chip.recheck { background: var(--blue-soft); color: var(--on-blue-soft); }
.chip.waiting { background: var(--surface-2); color: var(--muted); }
.chip.none { background: var(--green-soft); color: var(--on-green-soft); }
.visit .why { font-size: 13.5px; }
.visit .why em { font-style: normal; font-weight: 650; }
.visit .state { font-size: 12px; color: var(--muted); }
.visit .more { display: none; margin-top: 6px; font-size: 12.5px; gap: 6px; }
.visit.open .more { display: grid; }
.visit .answers { font: 11.5px/1.5 var(--mono); color: var(--muted); background: var(--surface-2); border-radius: 10px; padding: 6px 8px; overflow-wrap: anywhere; }
.visit ul { margin: 0; padding-left: 16px; }
.calm { text-align: center; color: var(--muted); font-size: 14px; padding: 36px 16px; }
.calm b { display: block; color: var(--text); font-size: 16px; margin-bottom: 4px; }
.tabbar { margin: 0 14px 18px; background: var(--ink); border-radius: 999px; display: flex; justify-content: space-around; padding: 10px 6px; }
.tabbar span { display: grid; justify-items: center; gap: 2px; font-size: 10.5px; color: var(--on-ink-muted); }
.tabbar span.on { color: var(--on-ink); }
.tabbar svg { width: 20px; height: 20px; fill: currentColor; }
.note { font-size: 12px; color: var(--muted); text-align: center; margin: 0; }
`,
  `<main class="wrap">
  <div class="pick"><b>Felix</b> · extension officer, Kasungu</div>
  ${phoneTop("FieldWise")}
    <div class="app-head">
      <div class="me" aria-hidden="true">F</div>
      <div class="hi"><b id="greeting">Good morning, Felix</b><span id="area">Kasungu</span></div>
      <div class="bell" aria-label="Notifications"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22a2.5 2.5 0 0 0 2.5-2.5h-5A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.8V3.5a1.5 1.5 0 0 0-3 0v.7A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z"/></svg><span class="badge" id="badge"></span></div>
    </div>
    <div class="body" id="body"></div>
    <nav class="tabbar" aria-hidden="true">
      <span class="on"><svg viewBox="0 0 24 24"><path d="M12 3 3 10v11h6v-6h6v6h6V10Z"/></svg>Home</span>
      <span><svg viewBox="0 0 24 24"><path d="M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2Zm6 0v14m6-12v14" fill="none" stroke="currentColor" stroke-width="2"/></svg>Farms</span>
      <span><svg viewBox="0 0 24 24"><path d="M4 20V10h3v10Zm6.5 0V4h3v16Zm6.5 0v-7h3v7Z"/></svg>Insights</span>
      <span><svg viewBox="0 0 24 24"><path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4.4 0-8 2.2-8 5v2h16v-2c0-2.8-3.6-5-8-5Z"/></svg>Profile</span>
    </nav>
  ${phoneBottom}
  <p class="note">Felix's app, simulated. Updates as farmers answer.</p>
</main>`,
  PHONE_CLIENT + `
var RANK_LABEL = { go_now: "Go now", this_week: "This week", no_response: "No reply: chase", recheck: "Re-check", waiting: "Waiting", none: "No action" };
var seen = null, seenCalls = null, cards = {}, openId = null, farmCount = 0, advice = [], composing = null, sentTo = {};

function shortName(name) {
  var w = name.trim().split(/\\s+/);
  if (w.length < 2) return name.toUpperCase();
  var last = w.pop();
  return last.toUpperCase() + " " + w.map(function (x) { return x[0].toUpperCase() + "."; }).join(" ");
}
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
function list(items) { return items.length > 1 ? items.slice(0, -1).join(", ") + " and " + items[items.length - 1] : items[0]; }

/** What the answers mean, in one line for Felix. */
function verdict(f) {
  var r = f.report;
  if (!r) return "Flagged for " + f.flagged + ". Waiting for the farmer.";
  var say = list(r.answersSay);
  switch (r.outcome) {
    case "confirmed_urgent": return "Go now: " + say + " confirmed and spreading.";
    case "confirmed": return (r.urgent ? "Go now: " : "Visit this week: ") + say + " confirmed.";
    case "wrong_flag": return (r.urgent ? "Go now: " : "Visit this week: ") + "answers point to " + say + ", not " + f.flagged + ".";
    case "early_signs": return "Early signs only. Re-check at the next forecast.";
    default: return r.recheckInDays ? "Nothing seen yet. Ask again in " + r.recheckInDays + " days." : "All clear: nothing found.";
  }
}

function visit(f) {
  var r = f.report;
  var why = r && r.answersSay.length
    ? el("div", { class: "why" }, "Flagged " + f.flagged + " → ", el("em", {}, list(r.answersSay)))
    : el("div", { class: "why" }, "Flagged " + f.flagged);
  var state = f.state === "answered" ? "Answered" : f.state === "answering" ? "Answering, " + f.answered + " of 8" + (f.provisional ? " so far" : "")
    : f.state === "no_response" ? "No reply after a reminder" : f.queued ? "Alert sent, farmer hasn't started it yet" : "Alert sent, no answers yet";
  var node = el("div", { class: "visit r-" + f.rank + (openId === f.flag_id ? " open" : "") });
  append(node, el("button", { type: "button", class: "toggle", "aria-expanded": openId === f.flag_id ? "true" : "false",
      on: { click: function () { openId = openId === f.flag_id ? null : f.flag_id; node.classList.toggle("open"); } } },
    el("div", { class: "top" }, el("b", {}, shortName(f.farmer.name)), el("span", { class: "crop" }, cap(f.crop)), el("span", { class: "chip " + f.rank }, RANK_LABEL[f.rank])),
    why,
    el("div", { class: "state" }, f.source === "farmer" ? "Farmer reported this · " + state : state)));
  append(node, [
    f.also.length > 0 && el("div", { class: "state" }, "Also: " + f.also.map(function (a) {
      return cap(a.crop) + ": " + a.flagged + (a.state === "answered" ? " (answered)" : a.state === "answering" ? " (answering)" : "");
    }).join(", ")),
    el("div", { class: "more" },
      el("div", {}, verdict(f)),
      r && r.answerLine && el("div", { class: "answers" }, r.answerLine),
      f.conditions && el("div", { class: "state" }, f.conditions),
      r && r.notes.length > 0 && el("ul", {}, r.notes.map(function (n) { return el("li", {}, n); })),
      replies(f.farmer))]);
  return node;
}

/** Felix's buttons under a farm: call, a ready-made reply, or his own words. */
function replies(farmer) {
  var first = farmer.name.split(" ")[0];
  var by = farmer.channel === "ussd" ? "SMS" : "WhatsApp";
  if (sentTo[farmer.id]) return el("div", { class: "acts" }, el("span", { class: "sent" }, "Sent to " + first + " by " + by + ": " + sentTo[farmer.id]));
  if (composing === farmer.id) {
    return el("div", { class: "acts" }, advice.map(function (a) {
      return el("button", { type: "button", on: { click: function () { message(farmer, { advice: a.id }, a.label); } } }, a.label);
    }), el("button", { type: "button", on: { click: function () {
      var text = prompt("Message to " + farmer.name + " (by " + by + ", 300 characters at most)");
      if (text && text.trim()) message(farmer, { text: text }, "your message");
    } } }, "Write…"), el("button", { type: "button", on: { click: function () { composing = null; refresh(); } } }, "Cancel"));
  }
  return el("div", { class: "acts" },
    el("button", { type: "button", class: "primary", on: { click: function () { composing = farmer.id; refresh(); } } }, "Message " + first),
    farmer.phone && el("a", { href: "tel:" + farmer.phone }, "Call " + farmer.phone));
}

function message(farmer, body, label) {
  api("/farmers/" + encodeURIComponent(farmer.id) + "/messages", body).then(function () {
    composing = null;
    sentTo[farmer.id] = label;
    setTimeout(function () { delete sentTo[farmer.id]; refresh(); }, 4000);
    refresh();
  }).catch(function (e) { toast(e.message); });
}

function callCard(c) {
  var mins = Math.max(0, Math.round((Date.now() - Date.parse(c.requested_at)) / 60000));
  return el("div", { class: "call" },
    el("b", {}, "Call " + c.farmer.name),
    el("span", {}, (c.farmer.farm_name ? c.farmer.farm_name + " · " : "") + "asked " + (mins < 1 ? "just now" : mins < 60 ? mins + " min ago" : Math.round(mins / 60) + " h ago")),
    el("div", { class: "acts" },
      el("a", { href: "tel:" + c.farmer.phone }, "Call"),
      el("button", { type: "button", on: { click: function () {
        api("/felix/callbacks/" + encodeURIComponent(c.id) + "/done", {}).then(refresh).catch(function (e) { toast(e.message); });
      } } }, "Done")));
}

function draw(farms, calls) {
  var body = document.getElementById("body");
  body.textContent = "";
  var urgent = farms.filter(function (f) { return f.rank === "go_now"; });
  var badge = document.getElementById("badge");
  badge.textContent = urgent.length + calls.length;
  badge.classList.toggle("on", urgent.length + calls.length > 0);
  if (calls.length) {
    append(body, el("div", { class: "section" }, "Call back"));
    calls.forEach(function (c) { append(body, callCard(c)); });
  }
  if (!farms.length) {
    append(body, el("div", { class: "calm" }, el("b", {}, "No farms flagged"), "The forecast doesn't favour disease on any of your farms this week."));
    return;
  }
  var next = farms[0];
  append(body, el("div", { class: "hero" + (urgent.length ? " urgent" : "") },
    el("small", {}, urgent.length ? "Visit now" : "Flagged farms"),
    el("b", {}, urgent.length ? urgent.length : farms.length),
    el("span", {}, "Next: " + shortName(next.farmer.name) + " · " + cap(next.crop) + " · " + RANK_LABEL[next.rank])));
  append(body, el("div", { class: "section" }, "Your visits"));
  farms.forEach(function (f) {
    var key = [f.rank, f.state, f.answered].join("|");
    var node = visit(f);
    if (cards[f.flag_id] !== undefined && cards[f.flag_id] !== key) node.classList.add("changed");
    cards[f.flag_id] = key;
    append(body, node);
  });
}

/** The one notification worth sending for what changed since the last look. */
function notify(farms, calls) {
  var callIds = {};
  calls.forEach(function (c) { callIds[c.id] = true; });
  var newCall = seenCalls && calls.filter(function (c) { return !seenCalls[c.id]; })[0];
  seenCalls = callIds;
  if (newCall) banner("Call back · " + shortName(newCall.farmer.name), newCall.farmer.name + " asked you to call them on " + newCall.farmer.phone + ".");
  var now = {};
  var names = {};
  farms.forEach(function (f) {
    now[f.flag_id] = { state: f.state, rank: f.rank };
    names[f.flag_id] = f.flagged;
    f.also.forEach(function (a) { now[a.flag_id] = { state: a.state, rank: a.rank }; names[a.flag_id] = a.flagged; });
  });
  if (seen && !newCall) {
    var finished = farms.filter(function (f) { return f.state === "answered" && seen[f.flag_id] && seen[f.flag_id].state !== "answered"; });
    var turnedUrgent = farms.filter(function (f) { return f.rank === "go_now" && f.state !== "answered" && (!seen[f.flag_id] || seen[f.flag_id].rank !== "go_now"); });
    var raised = Object.keys(now).filter(function (id) { return !seen[id]; });
    if (finished.length) {
      var f = finished[0];
      banner(shortName(f.farmer.name) + " · " + cap(f.crop), verdict(f));
    } else if (turnedUrgent.length) {
      var u = turnedUrgent[0];
      banner("Urgent · " + shortName(u.farmer.name) + " · " + cap(u.crop),
        "Answers so far point to " + list(u.report.answersSay) + ". Go now.");
    } else if (raised.length && farms.some(function (f) { return f.source === "farmer" && raised.indexOf(f.flag_id) !== -1; })) {
      var rep = farms.filter(function (f) { return f.source === "farmer" && raised.indexOf(f.flag_id) !== -1; })[0];
      banner("Farmer report · " + shortName(rep.farmer.name), rep.farmer.name + " reported a problem with their " + rep.crop + " and is answering the questions.");
    } else if (raised.length) {
      var farmsRaised = farms.filter(function (f) {
        return raised.indexOf(f.flag_id) !== -1 || f.also.some(function (a) { return raised.indexOf(a.flag_id) !== -1; });
      });
      var one = farmsRaised[0];
      banner("Weather alert · Kasungu", farmsRaised.length === 1
        ? shortName(one.farmer.name) + "'s crops flagged for " + list(raised.map(function (id) { return names[id]; }).sort()) + ". The farmer has been asked to check."
        : raised.length + " disease flags on " + farmsRaised.length + " farms. Farmers have been asked to check their crops.");
    }
  }
  seen = now;
}

function refresh() {
  api("/felix/priority?days=14").then(function (d) {
    notify(d.farms, d.callbacks || []);
    draw(d.farms, d.callbacks || []);
  }).catch(function () {});
}

function greet() {
  var h = new Date().getHours();
  document.getElementById("greeting").textContent = (h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening") + ", Felix";
}
greet();

gate(function () {
  api("/farmers").then(function (d) {
    farmCount = d.farmers.length;
    document.getElementById("area").textContent = "Kasungu · " + farmCount + " farms";
  }).catch(function () {});
  api("/felix/advice").then(function (d) { advice = d.advice; }).catch(function () {});
  refresh();
  setInterval(refresh, 2000);
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
.panel textarea { background: var(--surface); border: 1px solid var(--hairline); border-radius: 12px; padding: 8px 12px; font: inherit; resize: vertical; min-height: 64px; color: inherit; }
.callrow { display: flex; gap: 8px; align-items: center; font-size: 14px; }
.callrow span { flex: 1; min-width: 0; }
.callrow small { display: block; color: var(--muted); font-size: 12.5px; }
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
      <div class="panel"><h2 style="margin:0">Call back</h2><div class="rows" id="calls"></div></div>
      <div class="panel" id="broadcast">
        <h2 style="margin:0">Message all farmers</h2>
        <select id="b-advice" aria-label="Ready-made message"><option value="">Write my own…</option></select>
        <textarea id="b-text" maxlength="300" placeholder="e.g. Heavy rain is forecast this week. Check your plants on Thursday."></textarea>
        <button class="btn primary" type="button" id="b-send">Send to every farmer</button>
        <p class="legend">Goes by SMS to keypad phones and by WhatsApp to smartphones, from Felix. Demo farmers' messages stay in FieldWise.</p>
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
  var progress = f.state === "answered" ? "Answered" : f.state === "answering" ? "Answering " + f.answered + " of 8" + (f.provisional ? " · provisional" : "")
    : f.queued && f.state === "waiting" ? "Alert sent, farmer hasn't started it yet" : STATE_LABEL[f.state];
  var notes = (r && r.notes) || [];
  var key = JSON.stringify([f.flag_id, f.rank, f.answered, f.state, f.also.length]);
  var node = el("article", { class: "card r-" + f.rank, "data-key": key },
    el("div", { class: "head" },
      el("span", { class: "name" }, shortName(f.farmer.name)),
      el("span", { class: "tag" }, cap(f.crop)),
      f.farmer.farm_name && el("span", { class: "farm" }, f.farmer.farm_name),
      f.source === "scenario" && el("span", { class: "tag" }, "Scenario"),
      f.source === "farmer" && el("span", { class: "tag" }, "Farmer report"),
      el("span", { class: "chip " + f.rank }, RANK_LABEL[f.rank])),
    verdict,
    el("div", { class: "meta" }, el("span", {}, progress), f.state === "answering" && el("span", { class: "bar", "aria-hidden": "true" }, el("i", { style: "width:" + Math.round(f.answered / 8 * 100) + "%" }))),
    r && r.answerLine && el("div", { class: "answers" }, r.answerLine),
    el("div", { class: "meta" }, f.conditions && el("span", {}, f.conditions), el("span", {}, "Flagged " + when(f.raised_at) + (f.reason !== "new" ? " (" + f.reason + ")" : ""))),
    notes.length > 0 && el("ul", { class: "notes" }, notes.map(function (n) { return el("li", {}, n); })),
    f.also.length > 0 && el("div", { class: "meta", style: "margin-top:6px" }, "Also flagged: " + f.also.map(function (a) { return cap(a.crop) + ": " + a.flagged + " (" + RANK_LABEL[a.rank].toLowerCase() + ")"; }).join(", ")));
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
    stat(summary.states.no_response, "silent after a reminder"),
    stat(summary.farmer_reports, "reported by farmers"),
    stat((priority.callbacks || []).length, "asked for a call", (priority.callbacks || []).length > 0)
  ]);

  var calls = document.getElementById("calls");
  calls.textContent = "";
  if (!(priority.callbacks || []).length) append(calls, el("p", { class: "quiet", style: "margin:0" }, "Nobody is waiting for a call."));
  (priority.callbacks || []).forEach(function (c) {
    append(calls, el("div", { class: "callrow" },
      el("span", {}, c.farmer.name, el("small", {}, c.farmer.phone + " · asked " + when(c.requested_at))),
      el("button", { class: "btn", type: "button", on: { click: function () {
        api("/felix/callbacks/" + encodeURIComponent(c.id) + "/done", {}).then(refresh).catch(function (e) { toast(e.message); });
      } } }, "Done")));
  });

  var list = document.getElementById("list");
  list.textContent = "";
  if (!priority.farms.length) append(list, el("div", { class: "empty" }, "No farms flagged in this window. Try a wet spell from the demo controls."));
  priority.farms.forEach(function (f) { append(list, card(f)); });

  var flagged = {};
  priority.farms.forEach(function (f) { flagged[f.farmer.id] = true; });
  var rest = farmers.filter(function (f) { return !flagged[f.id]; });
  document.getElementById("unflagged").textContent = rest.length ? "Not flagged: " + rest.map(function (f) { return f.name; }).join(", ") + "." : "";

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

var adviceSel = document.getElementById("b-advice"), adviceText = document.getElementById("b-text"), adviceList = [];
adviceSel.addEventListener("change", function () {
  var a = adviceList.filter(function (x) { return x.id === adviceSel.value; })[0];
  adviceText.value = a ? a.text.en : "";
  adviceText.disabled = !!a;
});
document.getElementById("b-send").addEventListener("click", function () {
  var body = adviceSel.value ? { advice: adviceSel.value } : { text: adviceText.value };
  if (!adviceSel.value && !adviceText.value.trim()) return toast("Write a message first.");
  if (!confirm("Send this to every farmer?")) return;
  var b = document.getElementById("b-send");
  b.disabled = true;
  api("/felix/broadcast", body).then(function (d) {
    toast("Sent to " + d.sent + " farmers.");
    adviceText.value = ""; adviceSel.value = ""; adviceText.disabled = false;
  }).catch(function (e) { toast(e.message); }).then(function () { b.disabled = false; });
});

gate(function () {
  api("/farmers").then(function (d) {
    farmers = d.farmers;
    var target = document.getElementById("target");
    farmers.forEach(function (f) { append(target, el("option", { value: f.id }, f.name)); });
    api("/felix/advice").then(function (a) {
      adviceList = a.advice;
      adviceList.forEach(function (x) { append(adviceSel, el("option", { value: x.id }, x.label)); });
    }).catch(function () {});
    refresh();
    // Same pace as Felix's phone, so both update together on stage.
    setInterval(refresh, 2000);
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
.controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.controls select { max-width: 240px; }
.panes { flex: 1; display: grid; grid-template-columns: 420px 420px minmax(0, 1fr); min-height: 0; }
.panes iframe { width: 100%; height: 100%; border: 0; display: block; }
.panes iframe + iframe { border-left: 1px solid var(--hairline); }
@media (max-width: 1300px) {
  body { height: auto; }
  .panes { grid-template-columns: 1fr 1fr; }
  .panes iframe { height: 880px; }
  .panes iframe:last-child { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--hairline); }
}
@media (max-width: 860px) {
  .panes { grid-template-columns: minmax(0, 1fr); }
  .panes iframe + iframe { border-left: 0; border-top: 1px solid var(--hairline); }
}
`,
  `<div class="bar"><span class="brand"><i></i>FieldWise</span>
  <span class="controls" id="controls">
    <select id="target" aria-label="Which farm"><option value="">All farms</option></select>
    <button class="btn primary" type="button" data-act="wet">Wet spell</button>
    <button class="btn" type="button" data-act="dry">Dry spell</button>
    <button class="btn danger" type="button" data-act="reset">Reset</button>
  </span>
  <span class="sp"></span><a href="/phone" target="_blank" rel="noopener">Keypad phone</a><a href="/sim" target="_blank" rel="noopener">WhatsApp phone</a><a href="/officer" target="_blank" rel="noopener">Felix's phone</a><a href="/dashboard" target="_blank" rel="noopener">Dashboard</a></div>
<div class="panes" id="panes"></div>`,
  `
gate(function () {
  // The token goes in the fragment, which is never sent to the server, in case
  // this browser blocks storage.
  var hash = "#token=" + encodeURIComponent(token);
  var panes = document.getElementById("panes");
  append(panes, [
    el("iframe", { src: "/sim" + hash, title: "Farmer's phone" }),
    el("iframe", { src: "/officer" + hash, title: "Felix's phone" }),
    el("iframe", { src: "/dashboard" + hash, title: "Felix's dashboard" })
  ]);
  var target = document.getElementById("target");
  var farmers = [];
  api("/farmers").then(function (d) {
    farmers = d.farmers;
    farmers.forEach(function (f) { append(target, el("option", { value: f.id }, f.name)); });
    // Follow the farmer shown on the phone, so a wet spell lands on that phone.
    var shown = store("fieldwise-sim-farmer");
    if (shown) target.value = shown;
  }).catch(function (e) { toast(e.message); });

  function scenario(weather) {
    // One farm per request keeps each request inside D1's free-plan query limit.
    var ids = target.value ? [target.value] : farmers.map(function (f) { return f.id; });
    var alerts = 0;
    return ids.reduce(function (p, id) {
      return p.then(function () {
        return api("/demo/scenario", { weather: weather, farmer_id: id }).then(function (d) {
          alerts += d.results.filter(function (r) { return r.alert; }).length;
        });
      });
    }, Promise.resolve()).then(function () {
      toast((weather === "wet" ? "Wet" : "Dry") + " spell: " + alerts + " alert" + (alerts === 1 ? "" : "s") + " sent.");
    });
  }
  var actions = {
    wet: function () { return scenario("wet"); },
    dry: function () { return scenario("dry"); },
    reset: function () {
      if (!confirm("Delete every flag, answer and message? Farmers stay.")) return Promise.resolve();
      return api("/demo/reset", { confirm: "reset" }).then(function () {
        toast("Demo reset.");
        // Reload the panes so each starts clean.
        panes.querySelectorAll("iframe").forEach(function (f) { f.src = f.src.split("#")[0] + hash; });
      });
    }
  };
  document.querySelectorAll("#controls button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll("#controls button").forEach(function (x) { x.disabled = true; });
      actions[b.getAttribute("data-act")]().catch(function (e) { toast(e.message); }).then(function () {
        document.querySelectorAll("#controls button").forEach(function (x) { x.disabled = false; });
      });
    });
  });
});
`,
);
