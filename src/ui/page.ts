export interface PageOptions { shell?: 'browser' | 'desktop'; daemon?: boolean; }

/**
 * The dashboard is one self-contained page (served under a strict CSP), built from the design tokens in
 * `styles`: colors, type scale, spacing, radii, elevation, and motion, with light and dark themes.
 */
export function dashboardPage(version = '0.1.8', options: PageOptions = {}): string {
  const boot = JSON.stringify({ cwd: process.cwd(), daemon: Boolean(options.daemon), shell: options.shell ?? 'browser' }).replace(/</g, '\\u003c');
  return String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark">
<title>Cloudflare Tunnel Kit v${escapeAttribute(version)}</title>
<style>${styles}</style></head>
<body class="shell-${options.shell === 'desktop' ? 'desktop' : 'browser'}">
${icons}
<header class="topbar">
  <div class="brand"><span class="logo"><svg class="i" aria-hidden="true"><use href="#i-cloud"/></svg></span><b>Cloudflare Tunnel Kit</b><span class="ver">v${escapeAttribute(version)}</span></div>
  <div class="service ${options.daemon ? 'on' : 'off'}" title="${options.daemon ? 'Tunnels keep running when this window closes.' : 'Tunnels stop when the terminal running cftunnel ui --foreground closes.'}"><i class="dot"></i>${options.daemon ? 'Background service' : 'Foreground mode'}</div>
  <div class="top-actions">
    <button class="btn ghost" data-action="doctor" title="Run system checks"><svg class="i" aria-hidden="true"><use href="#i-activity"/></svg><span>System check</span></button>
    <button class="btn ghost" data-action="settings" title="Settings"><svg class="i" aria-hidden="true"><use href="#i-sliders"/></svg><span>Settings</span></button>
    <div class="menu-anchor"><button class="btn primary" data-action="new-menu" aria-haspopup="menu" aria-expanded="false"><svg class="i" aria-hidden="true"><use href="#i-plus"/></svg><span>New tunnel</span></button>
      <div class="menu" id="new-menu" role="menu" hidden>
        <button role="menuitem" data-new="quick"><svg class="i" aria-hidden="true"><use href="#i-bolt"/></svg><span><b>Quick Tunnel</b><small>Temporary trycloudflare.com URL. No account needed.</small></span></button>
        <button role="menuitem" data-new="named"><svg class="i" aria-hidden="true"><use href="#i-globe"/></svg><span><b>Custom domain</b><small>Your own hostname through a Cloudflare account.</small></span></button>
      </div>
    </div>
  </div>
</header>
<main class="main">
  <div id="env-banner"></div>
  <section class="panel">
    <div class="panel-head">
      <div><h1>Your tunnels</h1><p class="muted" id="summary">Saved projects · stored only on this machine</p></div>
      <div class="head-actions">
        <button class="btn secondary sm" data-action="start-all" disabled>Start all</button>
        <button class="btn secondary sm" data-action="stop-all" disabled>Stop all</button>
        <button class="btn ghost sm icon-only" data-action="refresh" aria-label="Refresh" title="Refresh"><svg class="i" aria-hidden="true"><use href="#i-refresh"/></svg></button>
      </div>
    </div>
    <div class="list" id="projects"><div class="skeleton"></div><div class="skeleton"></div></div>
  </section>
  <section class="panel compact" aria-labelledby="env-title">
    <div class="panel-head"><h2 id="env-title">Environment</h2><button class="btn ghost sm" data-action="doctor">Run checks</button></div>
    <div class="checks" id="checks"><div class="check"><i class="dot"></i><div><b>Not checked yet</b><span>Checks run when the page opens.</span></div></div></div>
  </section>
</main>

<div id="wizard" class="drawer" aria-hidden="true"><div class="drawer-overlay" data-close></div><section class="drawer-panel" role="dialog" aria-modal="true" aria-labelledby="wizard-title" tabindex="-1">
  <div class="drawer-head"><div><h2 id="wizard-title">Create a tunnel</h2><p class="muted" id="wizard-subtitle">Step-by-step setup</p></div><button class="close" data-close aria-label="Close"><svg class="i" aria-hidden="true"><use href="#i-x"/></svg></button></div>
  <ol class="stepper"><li class="active">Details</li><li>Review</li><li>Run</li></ol>
  <div class="drawer-body"><form id="setup-form" novalidate>
    <div id="fields">
      <div class="field"><label for="f-name">Project name</label><input id="f-name" name="displayName" required placeholder="My local app"></div>
      <div class="field"><label for="f-path">Project folder</label><input id="f-path" name="projectPath" required value="${escapeAttribute(process.cwd())}"><p class="hint">Used to name and find the project. Nothing is written here.</p></div>
      <div class="field"><label for="f-url">Local application URL</label><input id="f-url" name="localUrl" required value="http://127.0.0.1:8000"><p class="hint">The app must be running when the tunnel starts.</p></div>
      <div id="named-fields" class="hidden">
        <div class="grid2"><div class="field"><label for="f-tunnel">Tunnel name</label><input id="f-tunnel" name="tunnelName" placeholder="my-project"></div><div class="field"><label for="f-host">Public hostname</label><input id="f-host" name="hostname" placeholder="dev.example.com"></div></div>
        <div class="field"><label for="account-select">Cloudflare account</label><select name="accountId" id="account-select"></select><p class="hint">The root domain must be managed by this account. <a href="#" data-open-settings="accounts">Manage accounts</a></p></div>
      </div>
      <div class="field"><label for="f-profile">Project type</label><select id="f-profile" name="profile"><option value="custom">Custom</option><option value="laravel">Laravel</option></select></div>
    </div>
    <div id="review" class="hidden"><div class="review"><b>Review changes</b><ul id="effects"></ul></div><div class="notice info" id="named-notice">A custom domain setup uses the selected Cloudflare account. Existing DNS records are never overwritten automatically.</div></div>
    <div id="running" class="hidden"><div id="result" class="result-box"><span class="spinner" aria-hidden="true"></span>Running validated workflow…</div></div>
  </form></div>
  <div class="drawer-foot"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="continue">Review changes</button></div>
</section></div>

<div id="settings" class="drawer" aria-hidden="true"><div class="drawer-overlay" data-close-settings></div><section class="drawer-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabindex="-1">
  <div class="drawer-head"><div><h2 id="settings-title">Settings</h2><p class="muted">${options.daemon ? 'Saved on this machine and applied by the background service.' : 'Foreground mode: tunnels stop when this terminal closes. Run cftunnel daemon start to keep them running.'}</p></div><button class="close" data-close-settings aria-label="Close settings"><svg class="i" aria-hidden="true"><use href="#i-x"/></svg></button></div>
  <nav class="tabs" id="settings-tabs" role="tablist"></nav>
  <div class="drawer-body" id="settings-body">Loading…</div>
</section></div>

<div class="toast hidden" id="toast" role="status" aria-live="polite"></div>
<script id="boot" type="application/json">${boot}</script>
<script>${script}</script>
</body></html>`;
}

function escapeAttribute(value: string): string { return value.replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]!); }

const styles = String.raw`
:root{
  color-scheme:light dark;
  --font:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Inter,system-ui,sans-serif;
  --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace;
  --fs-xs:12px;--fs-sm:13px;--fs-md:14px;--fs-lg:16px;--fs-xl:20px;--fs-2xl:24px;
  --sp-1:4px;--sp-2:8px;--sp-3:12px;--sp-4:16px;--sp-5:20px;--sp-6:24px;--sp-8:32px;
  --r-sm:6px;--r-md:8px;--r-lg:12px;--r-full:999px;
  --bg:#f5f6f8;--surface:#ffffff;--surface-2:#f2f4f7;--surface-3:#e9ecf1;--border:#e2e5ea;--border-strong:#cdd2da;
  --text:#14171c;--text-2:#545d6b;--text-3:#8b93a0;
  --accent:#2463eb;--accent-hover:#1c51c8;--accent-soft:#e9effd;--accent-text:#1c51c8;--on-accent:#fff;
  --success:#15803d;--success-soft:#e6f5ea;--warning:#a35a00;--warning-soft:#fcf1df;--danger:#c92a2a;--danger-soft:#fdeceb;
  --brand:#f48120;--scrim:rgba(15,18,24,.45);
  --shadow-sm:0 1px 2px rgba(16,24,40,.06);--shadow-md:0 6px 20px rgba(16,24,40,.10);--shadow-lg:0 24px 60px rgba(16,24,40,.22);
  --focus:0 0 0 3px rgba(36,99,235,.35);
  --dur:160ms;--ease:cubic-bezier(.2,.8,.2,1);
}
@media (prefers-color-scheme:dark){:root{
  --bg:#0e1014;--surface:#16191f;--surface-2:#1c2028;--surface-3:#252a33;--border:#272c35;--border-strong:#383e4a;
  --text:#e9ecf2;--text-2:#a4acba;--text-3:#717a89;
  --accent:#5c8dff;--accent-hover:#7ba3ff;--accent-soft:#1a2540;--accent-text:#a3bfff;--on-accent:#0b1020;
  --success:#4ade80;--success-soft:#11291a;--warning:#f5b544;--warning-soft:#2e230e;--danger:#ff7b7b;--danger-soft:#341617;
  --scrim:rgba(0,0,0,.6);--shadow-sm:0 1px 2px rgba(0,0,0,.4);--shadow-md:0 8px 24px rgba(0,0,0,.45);--shadow-lg:0 24px 60px rgba(0,0,0,.6);
  --focus:0 0 0 3px rgba(92,141,255,.45);
}}
*{box-sizing:border-box}
html,body{margin:0}
body{font:var(--fs-md)/1.5 var(--font);color:var(--text);background:var(--bg);-webkit-font-smoothing:antialiased}
button,input,select{font:inherit;color:inherit}
a{color:var(--accent-text);text-decoration:none}a:hover{text-decoration:underline}
h1,h2,h3{margin:0;letter-spacing:-.01em}
h1{font-size:var(--fs-xl);font-weight:650}h2{font-size:var(--fs-lg);font-weight:650}
code,pre{font-family:var(--mono);font-size:var(--fs-xs)}
.muted{color:var(--text-2);margin:2px 0 0;font-size:var(--fs-sm)}
.hidden{display:none!important}
.i{width:16px;height:16px;flex:none;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
:focus-visible{outline:none;box-shadow:var(--focus)}

.btn{display:inline-flex;align-items:center;justify-content:center;gap:var(--sp-2);height:34px;padding:0 var(--sp-3);border:1px solid transparent;border-radius:var(--r-md);font-size:var(--fs-sm);font-weight:600;cursor:pointer;white-space:nowrap;transition:background var(--dur) var(--ease),border-color var(--dur) var(--ease),color var(--dur) var(--ease)}
.btn:disabled{opacity:.45;cursor:default}
.btn.sm{height:28px;padding:0 10px;font-size:var(--fs-xs)}
.btn.primary{background:var(--accent);color:var(--on-accent)}.btn.primary:not(:disabled):hover{background:var(--accent-hover)}
.btn.secondary{background:var(--surface);border-color:var(--border-strong)}.btn.secondary:not(:disabled):hover{background:var(--surface-2)}
.btn.ghost{background:transparent;color:var(--text-2)}.btn.ghost:not(:disabled):hover{background:var(--surface-3);color:var(--text)}
.btn.danger{background:var(--danger-soft);color:var(--danger)}.btn.danger:not(:disabled):hover{background:var(--danger);color:#fff}
.btn.icon-only{width:34px;padding:0}.btn.sm.icon-only{width:28px}

.badge{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 var(--sp-2);border-radius:var(--r-full);font-size:var(--fs-xs);font-weight:600;background:var(--surface-3);color:var(--text-2);white-space:nowrap}
.badge.success{background:var(--success-soft);color:var(--success)}.badge.warning{background:var(--warning-soft);color:var(--warning)}.badge.danger{background:var(--danger-soft);color:var(--danger)}
.tag{font-size:var(--fs-xs);color:var(--text-2);background:var(--surface-2);border:1px solid var(--border);border-radius:var(--r-sm);padding:0 6px;white-space:nowrap}
.dot{width:8px;height:8px;border-radius:50%;background:var(--text-3);flex:none}
.dot.ok,.service.on .dot{background:var(--success);box-shadow:0 0 0 3px var(--success-soft)}
.dot.warn{background:var(--warning)}.dot.bad{background:var(--danger)}

.switch{position:relative;display:inline-block;width:34px;height:20px;flex:none;cursor:pointer}
.switch input{position:absolute;opacity:0;width:100%;height:100%;margin:0;cursor:pointer}
.switch i{position:absolute;inset:0;border-radius:var(--r-full);background:var(--border-strong);transition:background var(--dur) var(--ease)}
.switch i:before{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:var(--shadow-sm);transition:transform var(--dur) var(--ease)}
.switch input:checked+i{background:var(--success)}.switch input:checked+i:before{transform:translateX(14px)}
.switch input:focus-visible+i{box-shadow:var(--focus)}.switch input:disabled+i{opacity:.4}

.field{display:grid;gap:6px;margin-bottom:var(--sp-4)}
.field label,label.label{font-size:var(--fs-sm);font-weight:600}
input,select{height:36px;width:100%;padding:0 var(--sp-3);border:1px solid var(--border-strong);border-radius:var(--r-md);background:var(--surface);outline:none;transition:border-color var(--dur) var(--ease)}
input:focus,select:focus{border-color:var(--accent);box-shadow:var(--focus)}
input[aria-invalid=true]{border-color:var(--danger)}
.hint{margin:0;font-size:var(--fs-xs);color:var(--text-2)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-3)}

.notice{display:block;padding:var(--sp-3);border-radius:var(--r-md);font-size:var(--fs-sm);background:var(--surface-2);border:1px solid var(--border)}
.notice.info{background:var(--accent-soft);border-color:transparent}
.notice.warning{background:var(--warning-soft);border-color:transparent;color:var(--text)}
.notice.danger{background:var(--danger-soft);border-color:transparent;color:var(--text)}
.notice b{display:block}

.topbar{position:sticky;top:0;z-index:10;height:56px;display:flex;align-items:center;gap:var(--sp-4);padding:0 var(--sp-6);background:color-mix(in srgb,var(--surface) 86%,transparent);backdrop-filter:saturate(1.6) blur(14px);border-bottom:1px solid var(--border)}
.brand{display:flex;align-items:center;gap:var(--sp-2);font-size:var(--fs-md)}
.logo{width:28px;height:28px;border-radius:var(--r-md);display:grid;place-items:center;background:var(--brand);color:#fff}.logo .i{width:16px;height:16px;fill:#fff;stroke:none}
.ver{font-size:var(--fs-xs);color:var(--text-3)}
.service{display:flex;align-items:center;gap:var(--sp-2);font-size:var(--fs-xs);color:var(--text-2);padding:0 var(--sp-2);height:24px;border-radius:var(--r-full);background:var(--surface-2)}
.service.off .dot{background:var(--warning)}
.top-actions{margin-left:auto;display:flex;align-items:center;gap:var(--sp-1)}

.menu-anchor{position:relative}
.menu{position:absolute;right:0;top:calc(100% + 6px);z-index:20;min-width:240px;padding:var(--sp-1);background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);box-shadow:var(--shadow-md)}
.menu button{display:flex;gap:var(--sp-3);align-items:flex-start;width:100%;padding:var(--sp-2) var(--sp-3);border:0;border-radius:var(--r-md);background:transparent;text-align:left;cursor:pointer;font-size:var(--fs-sm)}
.menu button:hover,.menu button:focus-visible{background:var(--surface-2)}
.menu button .i{margin-top:2px;color:var(--text-2)}
.menu small{display:block;color:var(--text-2);font-size:var(--fs-xs)}
.menu .danger{color:var(--danger)}.menu .danger .i{color:var(--danger)}
.menu hr{border:0;border-top:1px solid var(--border);margin:var(--sp-1) 0}

.main{max-width:1040px;margin:0 auto;padding:var(--sp-6);display:grid;gap:var(--sp-4)}
.panel{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);box-shadow:var(--shadow-sm)}
.panel-head{display:flex;align-items:center;justify-content:space-between;gap:var(--sp-4);padding:var(--sp-4) var(--sp-5)}
.panel.compact .panel-head{padding-bottom:var(--sp-2)}
.head-actions{display:flex;gap:var(--sp-2);align-items:center}

.list{border-top:1px solid var(--border)}
.row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--sp-2) var(--sp-4);align-items:center;padding:var(--sp-3) var(--sp-5);border-bottom:1px solid var(--border)}
.row:last-child{border-bottom:0}
.row:hover{background:color-mix(in srgb,var(--surface-2) 60%,transparent)}
.row-main{display:flex;gap:var(--sp-3);align-items:flex-start;min-width:0}
.row-main>.dot{margin-top:7px}
.row-text{min-width:0;display:grid;gap:2px}
.row-title{display:flex;align-items:center;gap:var(--sp-2);flex-wrap:wrap}
.row-title b{font-size:var(--fs-md);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row-meta{display:flex;align-items:center;gap:var(--sp-2);font-size:var(--fs-sm);color:var(--text-2);min-width:0}
.row-meta a,.row-meta code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.row-meta .arrow{color:var(--text-3)}
.copy{border:0;background:transparent;color:var(--text-3);cursor:pointer;padding:2px;border-radius:var(--r-sm);display:inline-flex}.copy:hover{color:var(--text);background:var(--surface-3)}
.row-side{display:flex;align-items:center;gap:var(--sp-3)}
.autostart{display:flex;align-items:center;gap:var(--sp-2);font-size:var(--fs-xs);color:var(--text-2);cursor:pointer}
.row-extra{grid-column:1/-1;display:grid;gap:var(--sp-3)}
.row-extra:empty{display:none}
.details{background:var(--surface-2);border:1px solid var(--border);border-radius:var(--r-md);padding:var(--sp-3) var(--sp-4);display:grid;gap:var(--sp-3)}
.kv{display:grid;grid-template-columns:150px 1fr;gap:6px var(--sp-3);font-size:var(--fs-sm)}.kv>span{color:var(--text-2)}
.details pre,.result-box pre{margin:0;max-height:220px;overflow:auto;padding:var(--sp-3);border-radius:var(--r-md);background:#0d1117;color:#d6deeb;white-space:pre-wrap;word-break:break-all}
.empty-state{padding:var(--sp-8) var(--sp-5);text-align:center}
.empty-state p{color:var(--text-2);margin:var(--sp-1) 0 var(--sp-5)}
.choices{display:grid;grid-template-columns:repeat(2,minmax(0,280px));justify-content:center;gap:var(--sp-3)}
.choice{display:grid;gap:var(--sp-1);text-align:left;padding:var(--sp-4);border:1px solid var(--border);border-radius:var(--r-lg);background:var(--surface);cursor:pointer;transition:border-color var(--dur) var(--ease),box-shadow var(--dur) var(--ease)}
.choice:hover{border-color:var(--accent);box-shadow:var(--shadow-md)}
.choice .i{width:20px;height:20px;color:var(--accent)}.choice small{color:var(--text-2);font-size:var(--fs-sm)}
.skeleton{height:58px;margin:var(--sp-3) var(--sp-5);border-radius:var(--r-md);background:linear-gradient(90deg,var(--surface-2),var(--surface-3),var(--surface-2));background-size:200% 100%;animation:shimmer 1.2s infinite}
@keyframes shimmer{to{background-position:-200% 0}}

.checks{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:var(--sp-2) var(--sp-4);padding:0 var(--sp-5) var(--sp-4)}
.check{display:flex;gap:var(--sp-2);align-items:flex-start;font-size:var(--fs-sm)}.check .dot{margin-top:6px}
.check b{display:block;font-weight:600}.check span{color:var(--text-2);font-size:var(--fs-xs)}
#env-banner:empty{display:none}

.drawer{position:fixed;inset:0;z-index:30;visibility:hidden;pointer-events:none}
.drawer.open{visibility:visible;pointer-events:auto}
.drawer-overlay{position:absolute;inset:0;background:var(--scrim);opacity:0;transition:opacity 200ms var(--ease)}
.drawer.open .drawer-overlay{opacity:1}
.drawer-panel{position:absolute;top:0;right:0;height:100%;width:min(560px,100vw);background:var(--surface);box-shadow:var(--shadow-lg);transform:translateX(100%);transition:transform 240ms var(--ease);display:flex;flex-direction:column;outline:none}
.drawer.open .drawer-panel{transform:none}
.drawer-head{display:flex;justify-content:space-between;align-items:flex-start;gap:var(--sp-4);padding:var(--sp-5) var(--sp-6) var(--sp-3)}
.drawer-body{flex:1;overflow:auto;padding:var(--sp-4) var(--sp-6) var(--sp-6)}
.drawer-foot{display:flex;justify-content:flex-end;gap:var(--sp-2);padding:var(--sp-3) var(--sp-6);border-top:1px solid var(--border)}
.close{width:32px;height:32px;display:grid;place-items:center;border:0;border-radius:var(--r-md);background:transparent;color:var(--text-2);cursor:pointer}.close:hover{background:var(--surface-3);color:var(--text)}
.stepper{display:flex;gap:var(--sp-2);list-style:none;margin:0;padding:0 var(--sp-6)}
.stepper li{flex:1;font-size:var(--fs-xs);font-weight:600;color:var(--text-3);padding-top:var(--sp-2);border-top:3px solid var(--surface-3)}
.stepper li.active{color:var(--accent-text);border-color:var(--accent)}
.review{background:var(--surface-2);border-radius:var(--r-md);padding:var(--sp-4);margin-bottom:var(--sp-3)}
.review ul{margin:var(--sp-2) 0 0;padding-left:var(--sp-5)}.review li{margin:2px 0}
.result-box{display:grid;gap:var(--sp-3);font-size:var(--fs-sm)}
.result-box .url-line{display:flex;gap:var(--sp-2);align-items:center;flex-wrap:wrap}
.result-box details summary{cursor:pointer;color:var(--text-2);font-size:var(--fs-xs)}
.spinner{display:inline-block;width:14px;height:14px;border-radius:50%;border:2px solid var(--border-strong);border-top-color:var(--accent);animation:spin .8s linear infinite;vertical-align:-2px;margin-right:var(--sp-2)}
@keyframes spin{to{transform:rotate(360deg)}}

.tabs{display:flex;gap:2px;margin:0 var(--sp-6);padding:3px;background:var(--surface-2);border-radius:var(--r-md);overflow-x:auto}
.tab{flex:1;height:28px;padding:0 var(--sp-2);border:0;border-radius:var(--r-sm);background:transparent;color:var(--text-2);font-size:var(--fs-xs);font-weight:600;cursor:pointer;white-space:nowrap}
.tab.active{background:var(--surface);color:var(--text);box-shadow:var(--shadow-sm)}
.setting{display:flex;justify-content:space-between;align-items:center;gap:var(--sp-5);padding:var(--sp-3) 0;border-bottom:1px solid var(--border)}
.setting:last-child{border-bottom:0}
.setting b{display:block;font-size:var(--fs-sm);font-weight:600}.setting span{display:block;color:var(--text-2);font-size:var(--fs-xs)}
.setting input:not([type=checkbox]),.setting select{width:200px;flex:none}
.group-title{font-size:var(--fs-xs);font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-3);margin:var(--sp-5) 0 var(--sp-2)}
.account{border:1px solid var(--border);border-radius:var(--r-md);padding:var(--sp-3) var(--sp-4);margin:var(--sp-2) 0;display:grid;gap:var(--sp-2)}
.account-top{display:flex;justify-content:space-between;align-items:center;gap:var(--sp-2)}
.account code{color:var(--text-2)}
.row-actions{display:flex;flex-wrap:wrap;gap:var(--sp-2);align-items:center}
.login-box{background:var(--surface-2);border-radius:var(--r-md);padding:var(--sp-3);margin:var(--sp-3) 0;font-size:var(--fs-sm);word-break:break-all;display:grid;gap:var(--sp-2)}

.toast{position:fixed;left:50%;bottom:var(--sp-6);transform:translateX(-50%);z-index:40;max-width:min(520px,calc(100vw - 32px));display:flex;gap:var(--sp-2);align-items:center;padding:10px var(--sp-4);border-radius:var(--r-md);background:var(--text);color:var(--bg);font-size:var(--fs-sm);box-shadow:var(--shadow-md)}
.toast.error{background:var(--danger);color:#fff}

@media (max-width:760px){
  .topbar{padding:0 var(--sp-4)}.top-actions .btn.ghost span,.service{display:none}
  .main{padding:var(--sp-4)}.row{grid-template-columns:1fr}.row-side{justify-content:space-between}
  .choices,.grid2{grid-template-columns:1fr}.kv{grid-template-columns:1fr}
  .setting{flex-wrap:wrap}.setting input:not([type=checkbox]),.setting select{width:100%}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

// Stroke icons in the style of Feather (MIT). Referenced with <use href="#i-name">.
const icons = String.raw`<svg width="0" height="0" style="position:absolute" aria-hidden="true">
<symbol id="i-cloud" viewBox="0 0 24 24"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></symbol>
<symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
<symbol id="i-sliders" viewBox="0 0 24 24"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></symbol>
<symbol id="i-activity" viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></symbol>
<symbol id="i-refresh" viewBox="0 0 24 24"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></symbol>
<symbol id="i-more" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></symbol>
<symbol id="i-copy" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></symbol>
<symbol id="i-external" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/></symbol>
<symbol id="i-play" viewBox="0 0 24 24"><path d="M6 4l14 8-14 8z"/></symbol>
<symbol id="i-stop" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1.5"/></symbol>
<symbol id="i-rotate" viewBox="0 0 24 24"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></symbol>
<symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></symbol>
<symbol id="i-trash" viewBox="0 0 24 24"><path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></symbol>
<symbol id="i-x" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></symbol>
<symbol id="i-check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></symbol>
<symbol id="i-alert" viewBox="0 0 24 24"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01"/></symbol>
<symbol id="i-bolt" viewBox="0 0 24 24"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></symbol>
<symbol id="i-globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></symbol>
</svg>`;

const script = String.raw`
const boot=JSON.parse(document.getElementById('boot').textContent);
let token='',projects=[],accountsCache=null,mode='quick',stage=0,plan=null,running=false,wizardTrigger=null,settingsTab='general',loginPoll=null,openMenu=null;
const projectErrors={},openDetails=new Set(),busy={};
const q=(s,root)=>(root||document).querySelector(s),qa=(s,root)=>[...(root||document).querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=name=>'<svg class="i" aria-hidden="true"><use href="#i-'+name+'"/></svg>';

async function api(url,options={}){const headers={'content-type':'application/json',...(options.headers||{})};if(token)headers['x-confirmation-token']=token;const r=await fetch(url,{...options,headers});const body=await r.json().catch(()=>({error:'Invalid server response'}));if(!r.ok)throw new Error(body.error||body.issues?.[0]?.reason||'Request failed');return body}
function toast(message,kind,ms){const el=q('#toast');el.className='toast'+(kind==='error'?' error':'');el.innerHTML=icon(kind==='error'?'alert':'check')+'<span>'+esc(message)+'</span>';clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.add('hidden'),ms||(kind==='error'?6000:2800))}
function describeError(e){e=e||{};return {title:e.title||e.reason||e.summary||e.code||'The workflow failed.',detail:[e.title?e.summary:'',e.fix,(e.remediationSteps||[]).join(' ')].filter(Boolean).join(' ')}}
async function copy(text){try{await navigator.clipboard.writeText(text||'');toast('Tunnel URL copied')}catch{toast('Copy failed. Select the URL manually.','error')}}

/* ---------- accounts ---------- */
async function loadAccounts(){try{accountsCache=await api('/api/accounts')}catch{accountsCache={accounts:[]}}return accountsCache}
function accountOptions(selected,includeLegacy){const list=(accountsCache&&accountsCache.accounts)||[];let html=list.map(a=>'<option value="'+esc(a.id)+'"'+(a.id===selected?' selected':'')+'>'+esc(a.label)+(a.isDefault?' (default)':'')+'</option>').join('');if(includeLegacy||!list.length)html+='<option value=""'+(!selected?' selected':'')+'>System login (~/.cloudflared/cert.pem)</option>';return html}
async function fillAccountSelect(){const data=await loadAccounts();q('#account-select').innerHTML=accountOptions(data.defaultAccountId||'',true)}

/* ---------- project list ---------- */
async function load(){if(!accountsCache)await loadAccounts();try{const data=await api('/api/projects');projects=data.projects||[];render()}catch(e){q('#projects').innerHTML='<div class="empty-state"><b>Could not load projects</b><p>'+esc(e.message)+'</p><button class="btn secondary" data-action="refresh">Try again</button></div>'}}
function render(){
  const live=projects.filter(p=>p.status==='Running').length;
  q('#summary').textContent=projects.length?(live+' of '+projects.length+' running · Saved projects stored only on this machine'):'Saved projects · stored only on this machine';
  q('[data-action="start-all"]').disabled=!projects.length||live===projects.length;
  q('[data-action="stop-all"]').disabled=!live;
  const kept={};for(const id of openDetails){const box=q('[data-details="'+CSS.escape(id)+'"]');if(box)kept[id]=box.innerHTML}
  q('#projects').innerHTML=projects.length?projects.map(row).join(''):emptyState();
  for(const id of openDetails){const box=q('[data-details="'+CSS.escape(id)+'"]');if(box&&kept[id])box.innerHTML=kept[id];renderDetails(id)}
}
function emptyState(){return '<div class="empty-state"><h2>No tunnels yet</h2><p>Share a local app with a temporary URL or connect your own domain.</p><div class="choices"><button class="choice" data-new="quick">'+icon('bolt')+'<b>Quick Tunnel</b><small>Temporary trycloudflare.com URL. No account needed.</small></button><button class="choice" data-new="named">'+icon('globe')+'<b>Custom domain</b><small>Your own hostname through a Cloudflare account.</small></button></div></div>'}
function statusBadge(p){if(busy[p.id])return '<span class="badge"><span class="spinner" aria-hidden="true"></span>'+esc(busy[p.id])+'</span>';if(p.status==='Running')return '<span class="badge success">Running</span>';if(p.status==='Needs attention')return '<span class="badge warning">Needs attention</span>';if(projectErrors[p.id])return '<span class="badge danger">Failed</span>';return '<span class="badge">Stopped</span>'}
function row(p){
  const isRunning=p.status==='Running',dot=isRunning?'ok':projectErrors[p.id]?'bad':p.status==='Needs attention'?'warn':'';
  const url=p.publicUrl?'<a href="'+esc(p.publicUrl)+'" target="_blank" rel="noreferrer">'+esc(p.publicUrl.replace(/^https?:\/\//,''))+'</a><button class="copy" data-copy-url="'+esc(p.publicUrl)+'" aria-label="Copy URL" title="Copy URL">'+icon('copy')+'</button><span class="arrow">→</span>':(p.kind==='named'&&p.hostname?'<span>'+esc(p.hostname)+'</span><span class="arrow">→</span>':'');
  const action=busy[p.id]?'<button class="btn secondary sm" disabled>'+esc(busy[p.id])+'</button>':isRunning?'<button class="btn secondary sm" data-project="'+esc(p.id)+'" data-command="stop">'+icon('stop')+'Stop</button>':'<button class="btn primary sm" data-project="'+esc(p.id)+'" data-command="start">'+icon('play')+'Start</button>';
  const failure=projectErrors[p.id]&&!isRunning?'<div class="notice danger" role="alert"><b>'+esc(projectErrors[p.id].title)+'</b>'+esc(projectErrors[p.id].detail)+'</div>':'';
  return '<article class="row" data-row="'+esc(p.id)+'">'
   +'<div class="row-main"><i class="dot '+dot+'"></i><div class="row-text"><div class="row-title"><b>'+esc(p.displayName)+'</b><span class="tag">'+(p.kind==='named'?'Custom domain':'Quick Tunnel')+'</span>'+(p.accountLabel?'<span class="tag">'+esc(p.accountLabel)+'</span>':'')+'</div>'
   +'<div class="row-meta">'+url+'<code>'+esc(p.localUrl||p.path)+'</code></div></div></div>'
   +'<div class="row-side"><label class="autostart" title="Start this project when the background service launches"><span class="switch"><input type="checkbox" data-autostart-project="'+esc(p.id)+'"'+(p.autoStart?' checked':'')+' aria-label="Start '+esc(p.displayName)+' with the service"><i></i></span>Auto-start</label>'+statusBadge(p)+action
   +'<div class="menu-anchor"><button class="btn ghost sm icon-only" data-row-menu="'+esc(p.id)+'" aria-label="More actions for '+esc(p.displayName)+'" aria-haspopup="menu">'+icon('more')+'</button></div></div>'
   +'<div class="row-extra">'+failure+'<div class="details hidden" data-details="'+esc(p.id)+'"></div></div></article>';
}
function rowMenu(p){const isRunning=p.status==='Running';return '<div class="menu" role="menu">'
  +(isRunning?'<button role="menuitem" data-project="'+esc(p.id)+'" data-command="restart">'+icon('rotate')+'<span>Restart</span></button>':'')
  +'<button role="menuitem" data-project="'+esc(p.id)+'" data-command="retry">'+icon('refresh')+'<span>Retry setup</span></button>'
  +'<button role="menuitem" data-action="details" data-project="'+esc(p.id)+'">'+icon('info')+'<span>'+(openDetails.has(p.id)?'Hide details':'Details')+'</span></button>'
  +(p.publicUrl?'<button role="menuitem" data-open-url="'+esc(p.publicUrl)+'">'+icon('external')+'<span>Open public URL</span></button>':'')
  +'<hr><button role="menuitem" class="danger" data-project="'+esc(p.id)+'" data-command="remove-local">'+icon('trash')+'<span>Remove local<small>Cloudflare resources are kept</small></span></button></div>'}

async function runCommand(id,command){
  if(command==='remove-local'&&!confirm('Remove this project from the local dashboard? Cloudflare tunnel and DNS resources will not be deleted.'))return;
  busy[id]={start:'Starting…',stop:'Stopping…',retry:'Retrying…',restart:'Restarting…','remove-local':'Removing…'}[command]||'Working…';delete projectErrors[id];render();
  try{const result=await api('/api/projects/'+encodeURIComponent(id)+'/'+command,{method:'POST',body:'{}'});if(result&&result.state==='failed'){projectErrors[id]=describeError(result.error);toast(projectErrors[id].title,'error')}else if(command==='start'||command==='restart'||command==='retry')toast('Tunnel is running')}
  catch(err){projectErrors[id]={title:err.message,detail:''};toast(err.message,'error')}
  finally{delete busy[id];await load()}
}

async function renderDetails(id){
  const box=q('[data-details="'+CSS.escape(id)+'"]');if(!box)return;box.classList.remove('hidden');
  if(!box.innerHTML)box.innerHTML='<span class="muted"><span class="spinner" aria-hidden="true"></span>Loading details…</span>';
  try{const project=await api('/api/projects/'+encodeURIComponent(id));const health=project.health||{},tunnel=project.tunnel||{};const p=projects.find(x=>x.id===id)||{};
    let html='<div class="kv"><span>Local process</span><b>'+esc(health.localProcess||'unknown')+'</b><span>Cloudflare connector</span><b>'+esc(health.cloudflareConnector||'unknown')+'</b><span>Public hostname</span><b>'+esc(health.publicHostname||'unchecked')+'</b><span>Project folder</span><code>'+esc(project.path)+'</code>'+(tunnel.name?'<span>Tunnel</span><code>'+esc(tunnel.name)+'</code>':'')+'</div>';
    if(tunnel.kind==='named')html+='<div class="setting"><div><b>Cloudflare account</b><span>Changing it creates a new tunnel in that account on the next start.</span></div><select data-project-account="'+esc(id)+'" data-current="'+esc(p.accountId||'')+'">'+accountOptions(p.accountId||'',true)+'</select></div>';
    html+='<pre aria-label="Connector logs">'+esc(project.logs||'No logs recorded.')+'</pre>';box.innerHTML=html}
  catch(e){box.innerHTML='<div class="notice danger">'+esc(e.message)+'</div>'}
}
function toggleDetails(id){if(openDetails.has(id)){openDetails.delete(id);const box=q('[data-details="'+CSS.escape(id)+'"]');if(box){box.classList.add('hidden');box.innerHTML=''}}else{openDetails.add(id);renderDetails(id)}}

/* ---------- environment ---------- */
async function doctor(){try{const data=await api('/api/doctor');const dot=s=>s==='passed'?'ok':s==='failed'?'bad':s==='warning'?'warn':'';q('#checks').innerHTML=data.checks.map(c=>'<div class="check"><i class="dot '+dot(c.state)+'"></i><div><b>'+esc(c.name)+'</b><span>'+esc(c.detail)+'</span></div></div>').join('');const failed=data.checks.filter(c=>c.state==='failed');q('#env-banner').innerHTML=failed.length?'<div class="notice danger" role="alert"><b>'+esc(failed.map(c=>c.name).join(', ')+' needs attention')+'</b>'+esc(failed.map(c=>c.detail).join(' '))+'</div>':''}catch(e){toast(e.message,'error')}}

/* ---------- menus ---------- */
function closeMenus(){qa('.menu').forEach(m=>{if(m.id==='new-menu')m.hidden=true;else m.remove()});qa('[aria-expanded="true"]').forEach(b=>b.setAttribute('aria-expanded','false'));openMenu=null}
function toggleNewMenu(button){const menu=q('#new-menu');const open=menu.hidden;closeMenus();if(open){menu.hidden=false;button.setAttribute('aria-expanded','true');openMenu=menu;menu.querySelector('button').focus()}}
function toggleRowMenu(button){const id=button.dataset.rowMenu;const already=button.parentElement.querySelector('.menu');closeMenus();if(already)return;const p=projects.find(x=>x.id===id);if(!p)return;button.insertAdjacentHTML('afterend',rowMenu(p));openMenu=button.nextElementSibling;button.setAttribute('aria-expanded','true');openMenu.querySelector('button').focus()}

/* ---------- create wizard ---------- */
function openWizard(nextMode,trigger){closeMenus();mode=nextMode;stage=0;plan=null;wizardTrigger=trigger;q('#setup-form').reset();q('[name=projectPath]').value=boot.cwd;q('[name=localUrl]').value='http://127.0.0.1:8000';q('#named-fields').classList.toggle('hidden',mode!=='named');q('#named-notice').classList.toggle('hidden',mode!=='named');q('#wizard-title').textContent=mode==='named'?'Set up a custom domain':'Create a Quick Tunnel';q('#wizard-subtitle').textContent=mode==='named'?'Cloudflare account, tunnel, DNS, and connector':'No Cloudflare login required';if(mode==='named')fillAccountSelect();showStage();const drawer=q('#wizard');drawer.classList.add('open');drawer.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';q('.drawer-panel',drawer).focus();setTimeout(()=>q('[name=displayName]').focus(),250)}
function closeWizard(){if(running)return;const drawer=q('#wizard');drawer.classList.remove('open');drawer.setAttribute('aria-hidden','true');document.body.style.overflow='';if(wizardTrigger?.focus)wizardTrigger.focus();wizardTrigger=null}
function canClose(target){if(running)return false;const overlay=q('#wizard .drawer-overlay');return target===overlay||Boolean(target.closest?.('#wizard [data-close]'))}
function showStage(){q('#fields').classList.toggle('hidden',stage!==0);q('#review').classList.toggle('hidden',stage!==1);q('#running').classList.toggle('hidden',stage!==2);qa('.stepper li').forEach((el,i)=>el.classList.toggle('active',i<=stage));q('#continue').textContent=stage===0?'Review changes':stage===1?'Confirm and run':'Done';q('#continue').disabled=stage===2&&running}
function values(){const data=Object.fromEntries(new FormData(q('#setup-form')));return {...data,profile:data.profile||'custom'}}
function validate(data){let first=null;const mark=(name,bad)=>{const el=q('[name='+name+']');el.setAttribute('aria-invalid',bad?'true':'false');if(bad&&!first)first=el};mark('displayName',!data.displayName);mark('localUrl',!/^https?:\/\//.test(data.localUrl||''));if(mode==='named'){mark('tunnelName',!data.tunnelName);mark('hostname',!data.hostname)}if(first){first.focus();throw new Error(mode==='named'&&(!data.tunnelName||!data.hostname)?'Tunnel name and public hostname are required.':'Check the highlighted fields.')}}
function resultHtml(result){let html='';if(result&&result.state==='succeeded'){html='<div class="notice info"><b>'+icon('check')+' Tunnel is live</b>'+(result.publicUrl?'<div class="url-line"><a href="'+esc(result.publicUrl)+'" target="_blank" rel="noreferrer">'+esc(result.publicUrl)+'</a><button type="button" class="btn secondary sm" data-copy-url="'+esc(result.publicUrl)+'">'+icon('copy')+'Copy URL</button></div>':'')+'</div>'}else{const d=describeError(result&&result.error);html='<div class="notice danger"><b>'+esc(d.title)+'</b>'+esc(d.detail)+'</div>'}return html+'<details><summary>Technical details</summary><pre>'+esc(JSON.stringify(result,null,2))+'</pre></details>'}
async function next(){try{if(stage===0){const data=values();validate(data);plan=await api('/api/plans/'+mode,{method:'POST',body:JSON.stringify(data)});q('#effects').innerHTML=plan.effects.map(x=>'<li>'+esc(x)+'</li>').join('');stage=1;showStage()}else if(stage===1){stage=2;running=true;showStage();q('#result').innerHTML='<span><span class="spinner" aria-hidden="true"></span>Running validated workflow…</span>';const result=await api('/api/execute',{method:'POST',body:JSON.stringify({planId:plan.id,confirmations:plan.confirmations})});q('#result').innerHTML=resultHtml(result);if(result.state==='failed'&&result.projectId)projectErrors[result.projectId]=describeError(result.error);await load()}else closeWizard()}catch(e){if(stage===2)q('#result').innerHTML=resultHtml({state:'failed',error:{title:e.message}});toast(e.message,'error')}finally{if(stage===2){running=false;showStage()}}}

/* ---------- settings ---------- */
const settingsTabs=[['general','General'],['tunnels','Tunnels'],['accounts','Accounts'],['cloudflared','cloudflared'],['notifications','Notifications'],['updates','Updates']];
function openSettings(tab,trigger){closeMenus();settingsTab=tab||settingsTab;const d=q('#settings');d.classList.add('open');d.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';q('.drawer-panel',d).focus();d._trigger=trigger;renderSettings()}
function closeSettings(){const d=q('#settings');d.classList.remove('open');d.setAttribute('aria-hidden','true');document.body.style.overflow='';if(loginPoll){clearInterval(loginPoll);loginPoll=null}if(d._trigger&&d._trigger.focus)d._trigger.focus();accountsCache=null;load()}
function toggle(attr,checked,label,hint){return '<div class="setting"><div><b>'+esc(label)+'</b>'+(hint?'<span>'+esc(hint)+'</span>':'')+'</div><span class="switch"><input type="checkbox" '+attr+(checked?' checked':'')+' aria-label="'+esc(label)+'"><i></i></span></div>'}
function field(def,value){if(def.key==='defaultAccountId')return '';const hint=def.hint;if(def.type==='boolean')return toggle('data-setting="'+def.key+'"',value,def.label,hint);let input;if(def.type==='enum')input='<select data-setting="'+def.key+'" aria-label="'+esc(def.label)+'">'+def.values.map(v=>'<option'+(v===value?' selected':'')+'>'+esc(v)+'</option>').join('')+'</select>';else if(def.type==='integer')input='<input type="number" data-setting="'+def.key+'" min="'+def.min+'" max="'+def.max+'" value="'+esc(value)+'" aria-label="'+esc(def.label)+'">';else input='<input type="text" data-setting="'+def.key+'" value="'+esc(value)+'" placeholder="Auto-detect" aria-label="'+esc(def.label)+'">';return '<div class="setting"><div><b>'+esc(def.label)+'</b>'+(hint?'<span>'+esc(hint)+'</span>':'')+'</div>'+input+'</div>'}
async function renderSettings(){q('#settings-tabs').innerHTML=settingsTabs.map(t=>'<button class="tab'+(t[0]===settingsTab?' active':'')+'" role="tab" aria-selected="'+(t[0]===settingsTab)+'" data-settings-tab="'+t[0]+'">'+t[1]+'</button>').join('');const body=q('#settings-body');const tab=settingsTab;try{let html='';if(tab==='accounts')html=await accountsHtml();else{const data=await api('/api/settings');if(tab==='general')html+=await autostartBlock();html+=data.definitions.filter(d=>d.group===tab).map(d=>field(d,data.values[d.key])).join('');if(tab==='updates'||tab==='cloudflared')html+=await updatesBlock(tab);if(tab==='general'&&boot.daemon)html+='<div class="group-title">Background service</div><div class="row-actions"><button class="btn danger sm" data-service="shutdown">Stop service and all tunnels</button></div>'}if(tab===settingsTab)body.innerHTML=html||'<p class="muted">No settings in this group.</p>'}catch(e){body.innerHTML='<div class="notice danger">'+esc(e.message)+'</div>'}}
async function autostartBlock(){const s=await api('/api/autostart');let html=toggle('data-autostart'+(s.supported?'':' disabled'),s.enabled,'Launch at login',s.detail);if(s.stale)html+='<div class="notice warning"><b>'+esc(s.detail)+'</b><button class="btn secondary sm" data-autostart-repair>Repair</button></div>';return html}
async function updatesBlock(tab){const u=await api('/api/updates');if(tab==='cloudflared'){const c=u.cloudflared||{};return '<div class="group-title">Installed cloudflared</div><div class="kv"><span>Installed</span><b>'+esc(c.current||'unknown')+'</b><span>Latest</span><b>'+esc(c.latest||'not checked')+'</b><span>Location</span><code>'+esc(c.path||'not found on PATH')+'</code></div>'+(c.available?'<div class="notice warning" style="margin-top:12px"><b>A newer cloudflared is available</b>Upgrade with: <code>'+esc(c.hint)+'</code></div>':'')}let html='<div class="group-title">cftunnel</div><div class="kv"><span>Installed</span><b>'+esc(u.current||'unknown')+'</b><span>Latest</span><b>'+esc(u.latest||'not checked')+'</b><span>Last check</span><b>'+esc(u.checkedAt?new Date(u.checkedAt).toLocaleString():'never')+'</b><span>Install type</span><b>'+esc(u.installKind)+'</b></div>';if(u.error)html+='<div class="notice warning" style="margin-top:12px">'+esc(u.error)+'</div>';html+='<div class="row-actions" style="margin-top:16px"><button class="btn secondary sm" data-update="check">Check now</button>';if(u.available&&u.installKind==='global')html+='<button class="btn primary sm" data-update="install"'+(u.installing?' disabled':'')+'>Install '+esc(u.latest)+' and restart</button>';html+='</div>';if(u.available&&u.installKind!=='global')html+='<div class="notice info" style="margin-top:12px">Update this copy with: <code>'+esc(u.installCommand)+'</code></div>';return html}
function accountBadge(a){if(a.certMissing)return '<span class="badge danger">Certificate missing</span>';if(a.status==='ok')return '<span class="badge success">Verified</span>';if(a.status==='auth-failed')return '<span class="badge danger">Sign-in expired</span>';if(a.status==='error')return '<span class="badge warning">Check failed</span>';return '<span class="badge">Not verified</span>'}
async function accountsHtml(){const data=await loadAccounts();let found={candidates:[]};try{found=await api('/api/accounts/discover')}catch{}const fresh=found.candidates.filter(c=>!c.alreadyImported&&!c.duplicateOf);const twins=c=>found.candidates.filter(o=>o.duplicateOf===c.fileName).map(o=>o.fileName);let html='<p class="hint">Each account keeps its own certificate in the app data folder. Signing in here never replaces ~/.cloudflared/cert.pem.</p>';if(fresh.length)html+='<div class="notice info" style="margin-top:12px"><b>Found '+fresh.length+' certificate(s) in ~/.cloudflared</b><div class="row-actions" style="margin:8px 0">'+fresh.map(c=>'<button class="btn secondary sm" data-import="'+esc(c.candidateId)+'">Import '+esc(c.fileName)+(twins(c).length?' · same as '+esc(twins(c).join(', ')):'')+'</button>').join('')+(fresh.length>1?'<button class="btn primary sm" data-import-all>Import all</button>':'')+'</div>Files are copied; the originals stay untouched.</div>';html+=data.accounts.length?data.accounts.map(a=>'<div class="account"><div class="account-top"><b>'+esc(a.label)+(a.isDefault?' · default':'')+'</b>'+accountBadge(a)+'</div><code>'+esc(a.accountTag?'Account '+a.accountTag:'Account ID unknown')+' · '+a.tunnelCount+' tunnel(s)</code><div class="row-actions"><button class="btn secondary sm" data-account="verify" data-id="'+esc(a.id)+'">Verify</button><button class="btn ghost sm" data-account="rename" data-id="'+esc(a.id)+'">Rename</button>'+(a.isDefault?'':'<button class="btn ghost sm" data-account="default" data-id="'+esc(a.id)+'">Make default</button>')+'<button class="btn ghost sm" data-account="relogin" data-id="'+esc(a.id)+'">Sign in again</button><button class="btn danger sm" data-account="remove" data-id="'+esc(a.id)+'">Remove</button></div></div>').join(''):'<div class="empty-state"><b>No Cloudflare accounts connected</b><p>Custom domains need an account. Quick Tunnels do not.</p></div>';return html+'<div id="login-box"></div><div class="row-actions" style="margin-top:12px"><button class="btn primary" data-account="add">'+icon('plus')+'Add Cloudflare account</button></div>'}
async function startLogin(payload){const job=await api('/api/accounts/login',{method:'POST',body:JSON.stringify(payload)});const show=j=>{const box=q('#login-box');if(!box)return;box.innerHTML='<div class="login-box">'+(j.state==='running'?'<b><span class="spinner" aria-hidden="true"></span>Waiting for Cloudflare sign-in…</b><span>Finish the authorization in your browser.</span>'+(j.loginUrl?'<span>Browser did not open? <a href="'+esc(j.loginUrl)+'" target="_blank" rel="noreferrer">Open the Cloudflare sign-in page</a></span>':''):j.state==='succeeded'?'<b>'+icon('check')+' Account connected.</b>':'<b>Sign-in failed.</b><span>'+esc((j.error&&j.error.summary)||'')+'</span>')+'</div>'};show(job);if(loginPoll)clearInterval(loginPoll);loginPoll=setInterval(async()=>{try{const j=await api('/api/accounts/login/'+encodeURIComponent(job.id));show(j);if(j.state!=='running'){clearInterval(loginPoll);loginPoll=null;if(j.state==='succeeded'){toast('Cloudflare account connected');accountsCache=null;renderSettings()}}}catch(e){clearInterval(loginPoll);loginPoll=null;toast(e.message,'error')}},1500)}
async function accountAction(action,id,el){if(action==='add'){q('#login-box').innerHTML='<div class="login-box"><div class="field" style="margin:0"><label for="new-account-label">Account name</label><input id="new-account-label" maxlength="60" placeholder="work, personal, client…"></div><div class="row-actions"><button class="btn primary sm" data-account="add-confirm">Sign in with Cloudflare</button></div></div>';q('#new-account-label').focus();return}if(action==='add-confirm')return startLogin({label:q('#new-account-label').value});if(action==='relogin')return startLogin({accountId:id});if(action==='rename'){const box=el.closest('.account');if(box.querySelector('.rename'))return;const row=document.createElement('div');row.className='row-actions rename';row.innerHTML='<input maxlength="60" aria-label="New account name" style="flex:1"><button class="btn primary sm" data-account="rename-save" data-id="'+esc(id)+'">Save</button>';box.append(row);const input=row.querySelector('input');input.value=box.querySelector('b').textContent.replace(/ · default$/,'');input.focus();return}if(action==='rename-save'){const label=el.parentElement.querySelector('input').value;await api('/api/accounts/'+encodeURIComponent(id)+'/rename',{method:'POST',body:JSON.stringify({label})})}else if(action==='remove'){if(!confirm('Remove this account from the app? The copied certificate is deleted; Cloudflare resources are not touched.'))return;await api('/api/accounts/'+encodeURIComponent(id)+'/remove',{method:'POST',body:'{}'})}else{const r=await api('/api/accounts/'+encodeURIComponent(id)+'/'+action,{method:'POST',body:'{}'});if(action==='verify')toast(r.ok?'Account verified: '+r.tunnelCount+' tunnel(s) visible':(r.error&&r.error.summary)||'Verification failed',r.ok?'':'error')}accountsCache=null;renderSettings()}
async function saveSetting(el){const key=el.dataset.setting;const value=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;try{await api('/api/settings',{method:'POST',body:JSON.stringify({[key]:value})});toast('Saved')}catch(e){toast(e.message,'error');renderSettings()}}

/* ---------- events ---------- */
document.addEventListener('click',async e=>{
  if(canClose(e.target)){closeWizard();return}
  const t=e.target.closest('button,a');
  if(openMenu&&!e.target.closest('.menu')&&!(t&&(t.dataset.rowMenu||t.dataset.action==='new-menu')))closeMenus();
  if(!t)return;
  if(t.dataset.action==='new-menu')return toggleNewMenu(t);
  if(t.dataset.rowMenu)return toggleRowMenu(t);
  if(t.dataset.new)return openWizard(t.dataset.new,t);
  if(t.id==='continue'){e.preventDefault();return next()}
  if(t.dataset.copyUrl!==undefined){e.preventDefault();return copy(t.dataset.copyUrl)}
  if(t.dataset.openUrl){closeMenus();return window.open(t.dataset.openUrl,'_blank','noreferrer')}
  if(t.dataset.action==='refresh')return load();
  if(t.dataset.action==='doctor')return doctor();
  if(t.dataset.action==='start-all'||t.dataset.action==='stop-all'){t.disabled=true;try{await api('/api/projects/'+t.dataset.action,{method:'POST',body:'{}'})}catch(err){toast(err.message,'error')}return load()}
  if(t.dataset.action==='details'&&t.dataset.project){closeMenus();return toggleDetails(t.dataset.project)}
  if(t.dataset.project&&t.dataset.command){closeMenus();return runCommand(t.dataset.project,t.dataset.command)}
});
document.addEventListener('click',async e=>{const el=e.target.closest?.('[data-action="settings"],[data-open-settings],[data-settings-tab],[data-close-settings],[data-account],[data-import],[data-import-all],[data-update],[data-autostart-repair],[data-service]');if(!el)return;if(el.matches('[data-close-settings]')){closeSettings();return}e.preventDefault();try{if(el.dataset.action==='settings')return openSettings('general',el);if(el.dataset.openSettings){if(q('#wizard').classList.contains('open')&&!running)closeWizard();return openSettings(el.dataset.openSettings,el)}if(el.dataset.settingsTab){settingsTab=el.dataset.settingsTab;return renderSettings()}if(el.dataset.account)return accountAction(el.dataset.account,el.dataset.id,el);if(el.dataset.import){await api('/api/accounts/import',{method:'POST',body:JSON.stringify({candidateId:el.dataset.import})});toast('Account imported');accountsCache=null;return renderSettings()}if(el.hasAttribute('data-import-all')){for(const b of qa('[data-import]'))await api('/api/accounts/import',{method:'POST',body:JSON.stringify({candidateId:b.dataset.import})});toast('Accounts imported');accountsCache=null;return renderSettings()}if(el.dataset.update==='check'){el.disabled=true;await api('/api/updates/check',{method:'POST',body:'{}'});return renderSettings()}if(el.dataset.update==='install'){if(!confirm('Install the update now? Running tunnels restart and reconnect in a few seconds.'))return;el.disabled=true;await api('/api/updates/install',{method:'POST',body:'{}'});toast('Update installed. Reconnecting…');setTimeout(()=>location.reload(),6000);return}if(el.hasAttribute('data-autostart-repair')){await api('/api/autostart',{method:'POST',body:JSON.stringify({enabled:true})});toast('Launch at login repaired');return renderSettings()}if(el.dataset.service==='shutdown'){if(!confirm('Stop the background service? All running tunnels will stop.'))return;await api('/api/daemon/shutdown',{method:'POST',body:'{}'});toast('Background service stopped')}}catch(err){toast(err.message,'error');renderSettings()}});
document.addEventListener('change',async e=>{const el=e.target;try{if(el.dataset.setting)return saveSetting(el);if(el.hasAttribute('data-autostart')){await api('/api/autostart',{method:'POST',body:JSON.stringify({enabled:el.checked})});toast(el.checked?'Launch at login turned on':'Launch at login turned off');return renderSettings()}if(el.dataset.autostartProject){await api('/api/projects/'+encodeURIComponent(el.dataset.autostartProject)+'/settings',{method:'POST',body:JSON.stringify({autoStart:el.checked})});toast(el.checked?'Starts with the service':'Auto-start off');const p=projects.find(x=>x.id===el.dataset.autostartProject);if(p)p.autoStart=el.checked;return}if(el.dataset.projectAccount){const id=el.dataset.projectAccount;const body={accountId:el.value};try{await api('/api/projects/'+encodeURIComponent(id)+'/settings',{method:'POST',body:JSON.stringify(body)})}catch(err){if(!/Confirm/.test(err.message))throw err;if(!confirm(err.message+' Continue?')){el.value=el.dataset.current;return}await api('/api/projects/'+encodeURIComponent(id)+'/settings',{method:'POST',body:JSON.stringify({...body,confirmNewTunnel:true})})}toast('Account updated. Start the project to create its tunnel there.');load()}}catch(err){toast(err.message,'error');if(el.type==='checkbox')el.checked=!el.checked;if(el.dataset.projectAccount)el.value=el.dataset.current}});
document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(openMenu){const owner=openMenu.previousElementSibling;closeMenus();owner?.focus?.();return}if(q('#wizard').classList.contains('open')&&!running)closeWizard();else if(q('#settings').classList.contains('open'))closeSettings()});
document.addEventListener('keydown',e=>{if(!openMenu||!['ArrowDown','ArrowUp'].includes(e.key))return;const items=qa('button',openMenu);const index=items.indexOf(document.activeElement);const nextIndex=(index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;items[nextIndex].focus();e.preventDefault()});

api('/api/session').then(x=>{token=x.confirmationToken;load();doctor();const params=new URLSearchParams(location.search);if(params.get('settings'))openSettings(params.get('settings'))}).catch(e=>toast(e.message,'error'));
setInterval(()=>{if(!document.hidden&&!Object.keys(busy).length&&!openMenu)load()},10000);
`;
