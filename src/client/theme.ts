/** Settings-only styles. Host tokens supply the surface, text, and borders in both themes. */
export const SETTINGS_CSS = `
.gtfa-settings {
  container:gtfa-settings / inline-size;
  --gtfa-ink:var(--dsw-alias-label-primary,#1a2233);
  --gtfa-muted:var(--dsw-alias-label-secondary,#697386);
  --gtfa-quiet:var(--dsw-alias-label-tertiary,#98a0ae);
  --gtfa-surface:var(--dsw-alias-bg-layer-1,#fff);
  --gtfa-line:var(--dsw-alias-border-l4,#e7eaf0);
  --gtfa-soft:color-mix(in srgb,var(--gtfa-ink) 3%,var(--gtfa-surface));
  --gtfa-hover:color-mix(in srgb,var(--gtfa-ink) 6%,var(--gtfa-surface));
  --gtfa-accent:#2e61e9;
  --gtfa-accent-soft:color-mix(in srgb,var(--gtfa-accent) 7%,var(--gtfa-surface));
  --gtfa-green:var(--dsw-alias-state-success-primary,#238461);
  --gtfa-green-soft:color-mix(in srgb,var(--gtfa-green) 9%,var(--gtfa-surface));
  --gtfa-save-surface:color-mix(in srgb,var(--gtfa-accent) 2%,var(--gtfa-surface));
  --gtfa-save-border:color-mix(in srgb,var(--gtfa-accent) 18%,var(--gtfa-line));
  --gtfa-save-shadow:0 -4px 18px rgba(22,35,66,.08),0 12px 32px rgba(22,35,66,.18);
  color:var(--gtfa-ink); font-size:13px; line-height:1.5;
}
.gtfa-settings *, .gtfa-settings *::before, .gtfa-settings *::after { box-sizing:border-box; }
.gtfa-settings [hidden] { display:none!important; }
.gtfa-settings button, .gtfa-settings input, .gtfa-settings select { font-family:inherit; }
.gtfa-settings button { appearance:none; }
.gtfa-settings button:focus-visible, .gtfa-settings a:focus-visible,
.gtfa-settings input:focus-visible, .gtfa-settings select:focus-visible,
.gtfa-settings summary:focus-visible { outline:2px solid var(--gtfa-accent); outline-offset:3px; }
.gtfa-settings button:disabled { cursor:default; }
.gtfa-settings a { color:var(--gtfa-accent); }
.gtfa-section-heading { display:flex; align-items:center; gap:11px; }
.gtfa-section-icon { display:flex; align-items:center; justify-content:center; width:34px; height:34px; flex-shrink:0; color:var(--gtfa-accent); background:var(--gtfa-accent-soft); border-radius:10px; }
.gtfa-section input:hover,.gtfa-section select:not(:disabled):hover,.gtfa-advanced input:hover,.gtfa-advanced select:not(:disabled):hover { border-color:color-mix(in srgb,var(--gtfa-accent) 45%,var(--gtfa-line))!important; }
.gtfa-settings input:disabled,.gtfa-settings select:disabled { opacity:.55; cursor:not-allowed; }
.gtfa-toggle-field { display:flex; justify-content:space-between; align-items:center; gap:20px; padding:15px 17px; border:1px solid var(--gtfa-line); border-radius:10px; background:var(--gtfa-soft); }
.gtfa-toggle-field p { margin-top:3px!important; }
.gtfa-test-help { display:flex; flex-wrap:wrap; justify-content:space-between; gap:4px 16px; font-size:11px; line-height:1.6; color:var(--gtfa-muted); margin:0; }
.gtfa-privacy-note { display:flex; align-items:center; gap:6px; font-size:10px; line-height:1.5; color:var(--gtfa-muted); margin:0; }
.gtfa-public-details { margin:0!important; border-top:1px solid var(--gtfa-line); padding-top:12px; }
.gtfa-public-details>div { padding-top:12px; }
.gtfa-actor-picker { margin:0 18px 16px; padding:15px 0 0; border-top:1px solid var(--gtfa-line); }
.gtfa-picker-heading { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px; font-size:12px; font-weight:550; }
.gtfa-picker-heading>span { display:flex; align-items:center; gap:7px; }
.gtfa-picker-heading small { margin-left:3px; font-size:10px; font-weight:400; color:var(--gtfa-muted); }
.gtfa-actor-choices { display:grid; gap:8px; max-height:300px; overflow-y:auto; padding:3px; margin:-3px; }
.gtfa-actor-choice { display:flex; align-items:center; gap:12px; width:100%; min-width:0; padding:14px; border:1px solid var(--gtfa-line); border-radius:10px; background:var(--gtfa-surface); color:var(--gtfa-ink); text-align:left; cursor:pointer; transition:border-color .15s,background .15s; }
.gtfa-actor-choice:not(:disabled):hover { border-color:color-mix(in srgb,var(--gtfa-accent) 45%,var(--gtfa-line)); }
.gtfa-actor-choice[aria-checked=true] { border-color:var(--gtfa-accent); background:var(--gtfa-accent-soft); }
.gtfa-actor-choice:disabled { opacity:.6; }
.gtfa-actor-choice-icon { display:flex; align-items:center; justify-content:center; width:34px; height:34px; flex-shrink:0; border-radius:9px; color:var(--gtfa-muted); background:var(--gtfa-hover); }
.gtfa-actor-choice[aria-checked=true] .gtfa-actor-choice-icon { color:var(--gtfa-accent); background:color-mix(in srgb,var(--gtfa-accent) 11%,var(--gtfa-surface)); }
.gtfa-actor-choice-copy { display:grid; min-width:0; flex:1; gap:3px; }
.gtfa-actor-choice-copy strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; font-weight:550; }
.gtfa-actor-choice-copy>span { font-size:10px; color:var(--gtfa-muted); overflow-wrap:anywhere; }
.gtfa-actor-build { display:inline-flex; align-items:center; gap:5px; flex-shrink:0; padding:3px 7px; border-radius:5px; color:var(--gtfa-muted); background:var(--gtfa-hover); font-size:10px; white-space:nowrap; }
.gtfa-actor-build.ready { color:var(--gtfa-green); background:var(--gtfa-green-soft); }
.gtfa-actor-build.building { color:var(--dsw-alias-state-warning-primary,#9a752c); background:color-mix(in srgb,currentColor 8%,var(--gtfa-surface)); }
.gtfa-actor-build.failed { color:var(--dsw-alias-state-error-primary,#c55151); background:color-mix(in srgb,currentColor 8%,var(--gtfa-surface)); }
.gtfa-actor-radio { display:flex; align-items:center; justify-content:center; width:16px; height:16px; flex-shrink:0; border:1px solid var(--gtfa-line); border-radius:50%; }
.gtfa-actor-choice[aria-checked=true] .gtfa-actor-radio { color:#fff; background:var(--gtfa-accent); border-color:var(--gtfa-accent); }
.gtfa-actor-missing { display:flex; align-items:center; gap:7px; color:var(--gtfa-muted); font-size:11px; line-height:1.5; margin:0 0 10px; }
.gtfa-actor-empty-actions { display:flex; align-items:center; flex-wrap:wrap; gap:10px 16px; padding-top:12px; font-size:11px; }
.gtfa-deployment-card { padding:18px; border:1px solid color-mix(in srgb,var(--gtfa-accent) 22%,var(--gtfa-line)); border-radius:10px; background:var(--gtfa-accent-soft); }
.gtfa-deployment-intro { display:flex; align-items:center; gap:12px; }
.gtfa-deployment-icon { display:flex; color:var(--gtfa-accent); flex-shrink:0; }
.gtfa-deployment-intro strong { font-size:12px; font-weight:600; }
.gtfa-deployment-intro p { margin:4px 0 0; font-size:11px; color:var(--gtfa-muted); }
.gtfa-deployment-steps { display:flex; list-style:none; gap:16px; margin:18px 0 0; padding:13px 0 0; border-top:1px solid color-mix(in srgb,var(--gtfa-accent) 12%,var(--gtfa-line)); }
.gtfa-deployment-steps li { display:flex; align-items:center; gap:6px; color:var(--gtfa-quiet); font-size:10px; }
.gtfa-deployment-steps li>span { display:flex; align-items:center; justify-content:center; width:18px; height:18px; border:1px solid var(--gtfa-line); border-radius:50%; font-size:9px; }
.gtfa-deployment-steps li.active { color:var(--gtfa-accent); }
.gtfa-deployment-steps li.active>span { background:var(--gtfa-accent); border-color:var(--gtfa-accent); color:#fff; }
.gtfa-deployment-steps li.done { color:var(--gtfa-green); }
.gtfa-deployment-steps li.done>span { border-color:transparent; background:var(--gtfa-green-soft); }
.gtfa-spin { display:inline-flex; animation:gtfa-spin 1.5s linear infinite; }
@keyframes gtfa-spin { to { transform:rotate(360deg); } }
@media (prefers-reduced-motion:reduce) { .gtfa-spin { animation:none; } }
.gtfa-picker-state { display:flex; align-items:center; gap:11px; padding:14px; border:1px solid var(--gtfa-line); border-radius:9px; background:var(--gtfa-surface); }
.gtfa-picker-state-icon { display:flex; flex-shrink:0; color:var(--gtfa-muted); }
.gtfa-picker-state-copy { min-width:0; flex:1; }
.gtfa-picker-state-copy strong { font-size:12px; font-weight:550; line-height:1.5; }
.gtfa-picker-state-copy p { font-size:11px; line-height:1.5; color:var(--gtfa-muted); margin:4px 0 0; }
.gtfa-picker-state.login { padding:4px 0; border:0; background:none; gap:7px; }
.gtfa-picker-state.login .gtfa-picker-state-copy strong { font-size:11px; font-weight:400; color:var(--gtfa-muted); }
.gtfa-picker-actions { display:grid; justify-items:end; gap:6px; flex-shrink:0; }
.gtfa-text-button { background:none; border:0; padding:3px 0; color:var(--gtfa-accent); font:inherit; font-size:10px; cursor:pointer; }
.gtfa-text-button:disabled { opacity:.5; }
.gtfa-picker-meta { display:flex; align-items:center; gap:5px; font-size:10px; color:var(--gtfa-muted); margin:7px 0 0; }
.gtfa-dot { width:5px; height:5px; border-radius:50%; background:currentColor; display:inline-block; }
.gtfa-advanced { border:1px solid var(--gtfa-line); border-radius:16px; background:var(--gtfa-surface); }
.gtfa-advanced>div { margin-left:24px; margin-right:24px; }
.gtfa-route-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; }
.gtfa-route-card { text-align:left; min-width:0; transition:background .15s,border-color .15s; }
.gtfa-route-card:not(:disabled):hover { border-color:var(--gtfa-accent)!important; }
.gtfa-route-card:disabled { opacity:.5; }
.gtfa-route-title { display:flex; gap:7px; align-items:center; flex-wrap:wrap; }
.gtfa-route-radio { width:14px; height:14px; border:1.5px solid var(--gtfa-line); border-radius:50%; }
.gtfa-route-card[aria-selected=true] .gtfa-route-radio { background:var(--gtfa-accent); border-color:var(--gtfa-accent); box-shadow:inset 0 0 0 3px var(--gtfa-surface); }
.gtfa-recommended { color:#fff; background:var(--gtfa-accent); border-radius:4px; padding:1px 5px; font-size:10px; font-weight:550; }
.gtfa-status-icon { width:32px; height:32px; border-radius:9px; display:flex; align-items:center; justify-content:center; flex-shrink:0; background:var(--gtfa-green-soft); color:var(--gtfa-green); }
.gtfa-status-icon.neutral { color:var(--gtfa-muted); background:var(--gtfa-hover); }
.gtfa-status-icon.login { color:var(--gtfa-accent); background:var(--gtfa-accent-soft); }
.gtfa-connection-actions { display:flex; align-items:center; gap:8px; margin-left:auto; flex-shrink:0; }
.gtfa-connection-top { display:flex; align-items:center; gap:12px; padding:16px 18px; }
.gtfa-connection-copy { min-width:0; }
.gtfa-connection-title { font-size:13px; font-weight:600; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.gtfa-connection-subtitle { margin:4px 0 0; font-size:11px; color:var(--gtfa-muted); line-height:1.5; }
.gtfa-account-menu { position:relative; }
.gtfa-account-menu>summary { list-style:none; cursor:pointer; padding:7px; border:1px solid var(--gtfa-line); border-radius:8px; background:var(--gtfa-surface); }
.gtfa-account-menu>summary::-webkit-details-marker { display:none; }
.gtfa-account-menu>div { position:absolute; right:0; top:38px; z-index:4; min-width:160px; padding:5px; border:1px solid var(--gtfa-line); border-radius:9px; background:var(--gtfa-surface); box-shadow:0 8px 24px rgba(20,30,45,.12); }
.gtfa-account-menu button { width:100%; text-align:left; border:0; border-radius:5px; background:none; color:inherit; padding:9px; font-size:12px; cursor:pointer; }
.gtfa-account-menu button:not(:disabled):hover { background:var(--gtfa-hover); }
.gtfa-oauth-foot { padding:0 18px 15px; display:grid; gap:10px; }
.gtfa-oauth-code-row { display:flex; flex-wrap:wrap; align-items:center; gap:12px; }
.gtfa-free-credit,.gtfa-usage-banner { --gtfa-card-ink:#244773; --gtfa-card-muted:#4d688e; --gtfa-card-accent:#2e61e9; --gtfa-card-line:#c7daf5; --gtfa-card-progress:#7da5e7; --gtfa-card-warning:#bc9146; --gtfa-card-error:#ca7180; position:relative; isolation:isolate; overflow:hidden; container:gtfa-credit / inline-size; margin:0 18px 16px; padding:20px 24px 18px; border:1px solid var(--gtfa-card-line); border-radius:12px; color:var(--gtfa-card-ink); background:radial-gradient(ellipse at 85% 0%,#d8e8ff 0%,transparent 58%),linear-gradient(115deg,#f1f7ff 0%,#e7f1ff 65%,#deebff 100%); }
.gtfa-free-credit::before,.gtfa-usage-banner::before { content:''; position:absolute; z-index:-1; width:390px; height:390px; top:-290px; left:-120px; border-radius:50%; background:#d9e9ff; opacity:.65; }
.gtfa-free-credit-copy { position:relative; z-index:1; width:fit-content; max-width:100%; }
.gtfa-credit-eyebrow { display:block; color:var(--gtfa-card-muted); font-size:10px; font-weight:600; letter-spacing:1.4px; }
.gtfa-credit-value { display:flex; align-items:baseline; flex-wrap:wrap; gap:12px; margin-top:9px; }
.gtfa-credit-value strong { color:var(--gtfa-card-accent); font-size:46px; font-weight:750; letter-spacing:-2px; line-height:1.1; }
.gtfa-credit-value>span { color:var(--gtfa-card-ink); font-size:15px; font-weight:550; }
.gtfa-free-credit-estimate { margin:6px 0 12px; font-size:12px; color:var(--gtfa-card-ink); }
.gtfa-free-credit-copy small { display:block; margin-top:10px; font-size:10px; color:var(--gtfa-card-muted); }
.gtfa-free-credit-actions { display:flex; align-items:center; gap:18px; font-size:12px; }
.gtfa-settings a.gtfa-credit-cta { display:inline-flex; align-items:center; padding:8px 16px; border-radius:7px; background:var(--gtfa-card-accent); color:#fff; font-weight:650; text-decoration:none; }
.gtfa-settings a.gtfa-credit-cta:hover { background:#2556d1; }
.gtfa-settings a.gtfa-credit-pricing { color:var(--gtfa-card-muted); text-decoration:none; }
.gtfa-settings a.gtfa-credit-pricing:hover { text-decoration:underline; }
.gtfa-free-credit a:focus-visible,.gtfa-usage-banner button:focus-visible,.gtfa-usage-banner summary:focus-visible { outline-color:var(--gtfa-card-accent); }
.gtfa-credit-art { position:absolute; z-index:0; pointer-events:none; right:-40px; top:-15px; width:310px; height:300px; opacity:.9; mask-image:linear-gradient(90deg,transparent,#000 30%); }
@container gtfa-credit (max-width:540px) {
  .gtfa-credit-art { right:-125px; opacity:.35; mask-image:linear-gradient(90deg,transparent,#000 65%); }
}
@container gtfa-credit (max-width:340px) {
  .gtfa-credit-art { opacity:.16; }
  .gtfa-credit-value { gap:9px; }
  .gtfa-credit-value strong { font-size:42px; }
  .gtfa-credit-value>span { font-size:13px; }
}
.gtfa-defaults-grid { display:grid; grid-template-columns:1fr 1fr; gap:20px; }
.gtfa-choice-field { display:grid; align-content:start; min-width:0; }
.gtfa-choice-field>label:not(.gtfa-sr-only) { margin-bottom:8px; font-size:12px; font-weight:550; }
.gtfa-choice { --gtfa-choice-accent:color-mix(in srgb,var(--gtfa-accent) 70%,var(--gtfa-ink)); position:relative; min-width:0; }
.gtfa-choice-control { display:flex; align-items:center; min-width:0; gap:9px; min-height:44px; padding:6px 9px; border:1px solid var(--gtfa-line); border-radius:10px; background:var(--gtfa-surface); transition:border-color .15s,box-shadow .15s; }
.gtfa-choice:not(.disabled):hover .gtfa-choice-control { border-color:color-mix(in srgb,var(--gtfa-accent) 45%,var(--gtfa-line)); }
.gtfa-choice.open:not(.disabled) .gtfa-choice-control,.gtfa-choice:not(.disabled):focus-within .gtfa-choice-control { border-color:var(--gtfa-accent); box-shadow:0 0 0 3px color-mix(in srgb,var(--gtfa-accent) 9%,transparent); }
.gtfa-choice.disabled { opacity:.55; }
.gtfa-choice-icon { display:flex; align-items:center; justify-content:center; width:28px; height:28px; flex-shrink:0; border-radius:7px; background:var(--gtfa-accent-soft); color:var(--gtfa-accent); }
.gtfa-choice input { width:100%; min-width:0; min-height:28px; padding:0; background:transparent; border:0; border-radius:0; color:var(--gtfa-ink); font:inherit; font-size:13px; outline:none!important; box-shadow:none; }
.gtfa-choice input::placeholder { color:var(--gtfa-quiet); font-size:12px; }
.gtfa-choice-toggle { display:flex; align-items:center; justify-content:center; width:26px; height:28px; padding:0; flex-shrink:0; background:none; border:0; border-radius:5px; color:var(--gtfa-muted); cursor:pointer; }
.gtfa-choice.open .gtfa-choice-toggle>svg { transform:rotate(180deg); }
.gtfa-choice-popover { position:absolute; z-index:20; left:0; right:0; top:calc(100% + 7px); padding:5px; border:1px solid var(--gtfa-line); border-radius:11px; background:var(--gtfa-surface); box-shadow:0 7px 24px rgba(22,35,66,.13),0 2px 5px rgba(22,35,66,.06); }
.gtfa-choice-popover.above { top:auto; bottom:calc(100% + 7px); }
.gtfa-choice-popover [role=listbox] { overflow-y:auto; overscroll-behavior:contain; scrollbar-width:thin; }
.gtfa-choice-option { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:9px 10px; border-radius:7px; color:var(--gtfa-ink); cursor:pointer; }
.gtfa-choice-option[data-active=true] { background:var(--gtfa-hover); }
.gtfa-choice-option[aria-selected=true] { color:var(--gtfa-choice-accent); background:var(--gtfa-accent-soft); }
.gtfa-choice-option-copy { display:grid; min-width:0; gap:3px; }
.gtfa-choice-option-copy>span:first-child { display:flex; align-items:center; flex-wrap:wrap; gap:6px; font-size:12px; overflow-wrap:anywhere; }
.gtfa-choice-option-copy>span+span { font-size:10px; color:var(--gtfa-muted); line-height:1.5; }
.gtfa-choice-option-copy small { padding:1px 5px; border-radius:4px; color:var(--gtfa-choice-accent); background:color-mix(in srgb,var(--gtfa-accent) 10%,var(--gtfa-surface)); font-size:9px; }
.gtfa-choice-check { color:var(--gtfa-choice-accent); flex-shrink:0; }
.gtfa-choice-empty { margin:0; padding:20px 10px; font-size:12px; color:var(--gtfa-muted); text-align:center; }
.gtfa-choice-hint { margin:6px 0 0; font-size:11px; line-height:1.6; color:var(--gtfa-muted); }
.gtfa-choice-field.compact .gtfa-choice-control { min-height:36px; padding:3px 8px 3px 10px; gap:4px; border-radius:8px; }
.gtfa-choice-field.compact input { font-size:12px; }
.gtfa-choice-field.compact .gtfa-choice-toggle { width:20px; }
.gtfa-choice-field.compact .gtfa-choice-popover { min-width:160px; }
.gtfa-usage-art { right:-24px; top:-26px; width:280px; height:270px; opacity:.64; mask-image:linear-gradient(90deg,transparent,#000 60%); }
.gtfa-usage-header { position:relative; z-index:1; display:flex; align-items:center; gap:10px; margin-bottom:9px; }
.gtfa-usage-header>.gtfa-credit-eyebrow { margin-right:auto; text-transform:uppercase; letter-spacing:1.2px; }
.gtfa-usage-state { position:relative; z-index:1; display:flex; align-items:center; flex-wrap:wrap; gap:10px; min-height:88px; padding:12px 0; color:var(--gtfa-card-ink); font-size:12px; }
.gtfa-usage-state>p { flex:1; min-width:120px; margin:0; max-width:540px; }
.gtfa-usage-banner .gtfa-usage-retry { background:rgba(255,255,255,.55)!important; border-color:var(--gtfa-card-line)!important; color:var(--gtfa-card-ink)!important; }
.gtfa-usage-plan { padding:3px 10px; border:1px solid var(--gtfa-card-line); background:rgba(255,255,255,.55); border-radius:6px; font-size:10px; font-weight:550; color:var(--gtfa-card-muted); }
.gtfa-usage-banner .gtfa-usage-refresh { width:31px; min-width:31px; height:31px; padding:0!important; background:rgba(255,255,255,.55)!important; border-color:var(--gtfa-card-line)!important; color:var(--gtfa-card-ink)!important; }
.gtfa-usage-banner .gtfa-usage-refresh:not(:disabled):hover { background:rgba(255,255,255,.85)!important; }
.gtfa-usage-content { position:relative; z-index:1; max-width:62%; }
.gtfa-usage-cycle { font-size:11px; color:var(--gtfa-card-muted); }
.gtfa-usage-total { display:flex; flex-wrap:wrap; align-items:baseline; gap:10px; margin:3px 0 15px; font-variant-numeric:tabular-nums; }
.gtfa-usage-total>strong { color:var(--gtfa-card-accent); font-size:42px; line-height:1.15; font-weight:750; letter-spacing:-1.8px; }
.gtfa-usage-limit { font-size:20px; color:var(--gtfa-card-ink); letter-spacing:-.4px; white-space:nowrap; }
.gtfa-usage-limit>span { margin-right:3px; color:#7994b9; font-size:17px; font-weight:300; }
.gtfa-usage-progress { height:5px; overflow:hidden; border-radius:5px; background:rgba(46,97,233,.11); }
.gtfa-usage-progress>div { height:100%; border-radius:5px; transition:width 180ms ease; }
.gtfa-usage-balance { display:flex; justify-content:space-between; flex-wrap:wrap; gap:5px 12px; margin-top:8px; font-size:10px; color:var(--gtfa-card-muted); font-variant-numeric:tabular-nums; }
.gtfa-usage-balance>span:first-child { color:var(--gtfa-card-ink); }
.gtfa-usage-balance>span.over-limit { color:#9a4350; }
.gtfa-usage-details { position:relative; z-index:1; margin-top:16px; padding-top:12px; border-top:1px solid rgba(46,97,233,.13); font-size:11px; color:var(--gtfa-card-muted); }
.gtfa-usage-details>summary { width:fit-content; cursor:pointer; color:var(--gtfa-card-muted); font-size:10px; }
.gtfa-usage-detail-grid { display:grid; grid-template-columns:1fr 1fr; gap:6px 16px; padding-top:12px; }
.gtfa-usage-banner .gtfa-usage-detail-grid p { color:var(--gtfa-card-muted)!important; }
.gtfa-usage-banner:has(.gtfa-usage-details[open]) .gtfa-usage-art { opacity:.12; }
@container gtfa-credit (max-width:540px) {
  .gtfa-usage-content { max-width:100%; }
  .gtfa-usage-art { right:-70px; opacity:.16; }
}
@container gtfa-credit (max-width:340px) {
  .gtfa-usage-total>strong { font-size:36px; }
  .gtfa-usage-limit { font-size:17px; }
  .gtfa-usage-header { gap:7px; }
  .gtfa-usage-art { opacity:.1; }
}
.gtfa-advanced>summary { list-style:none; cursor:pointer; }
.gtfa-advanced>summary::-webkit-details-marker { display:none; }
.gtfa-advanced[open]>summary .gtfa-advanced-chevron { transform:rotate(180deg); }
.gtfa-advanced-tabs { display:flex; gap:22px; border-bottom:1px solid var(--gtfa-line); margin:0 0 20px; }
.gtfa-advanced-tabs button { padding:8px 0 12px; border:0; border-bottom:2px solid transparent; margin-bottom:-1px; background:none; color:var(--gtfa-muted); cursor:pointer; font-size:12px; }
.gtfa-advanced-tabs button[aria-selected=true] { color:var(--gtfa-accent); border-bottom-color:var(--gtfa-accent); }
.gtfa-advanced-panel { display:grid; gap:18px; }
.gtfa-baseline-heading { display:flex; align-items:center; justify-content:space-between; gap:20px; }
.gtfa-baseline-heading .gtfa-section-heading { min-width:0; }
.gtfa-baseline-toggle { display:flex; align-items:center; gap:10px; flex-shrink:0; color:var(--gtfa-muted); font-size:11px; }
.gtfa-baseline-toggle button:disabled { opacity:.5; }
.gtfa-baseline-catalog { min-width:0; border:1px solid var(--gtfa-line); border-radius:11px; background:var(--gtfa-surface); }
.gtfa-catalog-heading { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; padding:12px 14px 0; }
.gtfa-catalog-heading h4,.gtfa-custom-baseline-title { margin:0; font-size:12px; font-weight:600; }
.gtfa-catalog-heading h4>span { display:inline-block; margin-left:6px; padding:3px 6px; border-radius:5px; background:var(--gtfa-accent-soft); color:color-mix(in srgb,var(--gtfa-accent) 70%,var(--gtfa-ink)); font-size:10px; font-weight:500; font-variant-numeric:tabular-nums; }
.gtfa-catalog-filter { width:190px; max-width:100%; }
.gtfa-catalog-hint { margin:6px 14px 12px; color:var(--gtfa-muted); font-size:11px; line-height:1.5; }
.gtfa-catalog-table { width:100%; table-layout:fixed; border-collapse:collapse; font-size:11px; }
.gtfa-catalog-table th,.gtfa-catalog-table td { padding:9px 14px; border-top:1px solid var(--gtfa-line); text-align:left; overflow-wrap:anywhere; }
.gtfa-catalog-table thead th { background:var(--gtfa-soft); color:var(--gtfa-muted); font-size:10px; font-weight:400; }
.gtfa-catalog-table th:first-child { width:31%; font-weight:500; }
.gtfa-catalog-table th:nth-child(2) { width:25%; }
.gtfa-catalog-table th:nth-child(3) { width:28%; }
.gtfa-catalog-table th:last-child { width:16%; }
.gtfa-catalog-table td:nth-child(2) { font-family:var(--ds-font-family-code,Menlo,monospace); }
.gtfa-catalog-table td:nth-child(n+3),.gtfa-catalog-table th:nth-child(n+3) { text-align:right; font-variant-numeric:tabular-nums; }
.gtfa-catalog-table td:nth-child(n+3) { white-space:nowrap; }
.gtfa-baseline-editor { border:1px solid var(--gtfa-line); border-radius:11px; }
.gtfa-anchor-grid { display:grid; grid-template-columns:minmax(100px,1fr) minmax(150px,1.2fr) minmax(110px,.7fr) 130px 34px; gap:10px; align-items:center; }
.gtfa-anchor-head { padding:11px 14px; border-radius:11px 11px 0 0; background:var(--gtfa-soft); color:var(--gtfa-muted); font-size:10px; }
.gtfa-anchor-block { padding:10px 14px; border-top:1px solid var(--gtfa-line); }
.gtfa-anchor-block>p[role=alert] { margin-top:7px!important; }
.gtfa-anchor-new { background:color-mix(in srgb,var(--gtfa-accent) 2%,var(--gtfa-surface)); border-top-style:dashed; border-radius:0 0 11px 11px; }
.gtfa-anchor-cell { min-width:0; }
.gtfa-anchor-cell-label { display:none; }
.gtfa-anchor-term { display:block; min-width:0; padding:8px 0; font-size:12px; font-weight:550; font-family:var(--ds-font-family-code,Menlo,monospace); overflow-wrap:anywhere; }
.gtfa-anchor-input { display:block; width:100%; min-width:0; height:36px; padding:6px 10px; border:1px solid var(--gtfa-line); border-radius:8px; background:var(--gtfa-surface); color:var(--gtfa-ink); font:inherit; font-size:12px; }
.gtfa-anchor-input::placeholder { color:var(--gtfa-quiet); }
.gtfa-anchor-input.number { font-variant-numeric:tabular-nums; }
.gtfa-anchor-input[aria-invalid=true] { border-color:var(--dsw-alias-state-error-primary,#c55151); }
.gtfa-anchor-action { display:flex; align-items:center; justify-content:center; width:34px; height:34px; padding:0; border:0; border-radius:8px; background:transparent; color:var(--gtfa-muted); cursor:pointer; }
.gtfa-anchor-action.remove:not(:disabled):hover { color:var(--dsw-alias-state-error-primary,#c55151); background:color-mix(in srgb,currentColor 8%,var(--gtfa-surface)); }
.gtfa-anchor-action.add { color:var(--gtfa-accent); background:var(--gtfa-accent-soft); }
.gtfa-anchor-action.add:not(:disabled):hover { background:color-mix(in srgb,var(--gtfa-accent) 14%,var(--gtfa-surface)); }
.gtfa-anchor-action:disabled { opacity:.35; }
.gtfa-window-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:18px; }
.gtfa-save-state { display:flex; align-items:center; gap:7px; font-size:11px; color:var(--gtfa-quiet); margin-right:auto; }
.gtfa-save-state.dirty { color:var(--dsw-alias-state-warning-primary,#a87921); }
.gtfa-sr-only { position:absolute; width:1px; height:1px; margin:-1px; padding:0; overflow:hidden; clip:rect(0,0,0,0); border:0; white-space:nowrap; }
.gtfa-settings .gtfa-button { transition:background .15s,border-color .15s; }
.gtfa-settings .gtfa-button:not(:disabled):hover { filter:brightness(.96); }
.gtfa-diagnostic {
  --diag-positive:color-mix(in srgb,var(--gtfa-green) 78%,var(--gtfa-ink));
  --diag-negative:var(--dsw-alias-state-error-primary,#b95353);
  --diag-warning:var(--dsw-alias-state-warning-primary,#967327);
  --diag-tone:var(--diag-positive);
  margin-top:16px; border:1px solid var(--gtfa-line); border-radius:13px;
  overflow:hidden; background:var(--gtfa-surface); color:var(--gtfa-ink);
}
.gtfa-diagnostic.negative { --diag-tone:var(--diag-negative); }
.gtfa-diagnostic.warning { --diag-tone:var(--diag-warning); }
.gtfa-diagnostic.pending { --diag-tone:var(--gtfa-accent); }
.gtfa-diagnostic.quiet { --diag-tone:var(--gtfa-muted); }
.gtfa-diagnostic-heading { display:flex; align-items:center; gap:12px; padding:18px 20px; }
.gtfa-diagnostic-symbol { display:flex; align-items:center; justify-content:center; width:36px; height:36px; border-radius:11px; flex-shrink:0; color:var(--diag-tone); background:color-mix(in srgb,var(--diag-tone) 9%,var(--gtfa-surface)); }
.gtfa-diagnostic-heading-copy { display:grid; gap:3px; min-width:0; }
.gtfa-diagnostic-heading-copy>h4 { margin:0; font-size:14px; line-height:1.5; font-weight:600; }
.gtfa-diagnostic-heading-copy>span { font-size:11px; color:var(--gtfa-muted); }
.gtfa-diagnostic-badge { margin-left:auto; color:var(--diag-tone); background:color-mix(in srgb,var(--diag-tone) 8%,var(--gtfa-surface)); border-radius:5px; padding:3px 8px; font-size:10px; font-weight:550; white-space:nowrap; }
.gtfa-diagnostic-network { display:flex; gap:10px; align-items:center; padding:12px 20px; background:var(--gtfa-soft); border-top:1px solid var(--gtfa-line); border-bottom:1px solid var(--gtfa-line); font-size:11px; }
.gtfa-diagnostic-label { display:flex; gap:7px; align-items:center; color:var(--gtfa-muted); }
.gtfa-diagnostic-network-state { display:flex; gap:4px; align-items:center; color:var(--gtfa-muted); }
.gtfa-diagnostic-network-state.positive { color:var(--diag-positive); }
.gtfa-diagnostic-network-state.negative { color:var(--diag-negative); }
.gtfa-diagnostic-network-meta { margin-left:auto; color:var(--gtfa-muted); font-size:10px; font-variant-numeric:tabular-nums; }
.gtfa-diagnostic-table-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:17px 20px 10px; font-size:12px; font-weight:550; }
.gtfa-diagnostic-table-heading>span+span { color:var(--gtfa-muted); font-size:10px; font-weight:400; }
.gtfa-diagnostic-table { width:100%; border-collapse:collapse; text-align:left; font-size:12px; }
.gtfa-diagnostic-table th,.gtfa-diagnostic-table td { padding:11px 20px; line-height:1.5; }
.gtfa-diagnostic-table thead th { color:var(--gtfa-muted); font-size:10px; font-weight:400; padding-top:0; padding-bottom:8px; }
.gtfa-diagnostic-table tbody tr { border-top:1px solid var(--gtfa-line); }
.gtfa-diagnostic-table tbody th { font-weight:550; width:34%; }
.gtfa-diagnostic-table th:not(:first-child),.gtfa-diagnostic-table td { text-align:right; }
.gtfa-diagnostic-table td:last-child { width:22%; }
.gtfa-diagnostic-number { font-variant-numeric:tabular-nums; font-weight:550; }
.gtfa-diagnostic-number.muted { color:var(--gtfa-muted); font-weight:400; }
.gtfa-diagnostic-empty { color:var(--gtfa-quiet); font-weight:400; }
.gtfa-diagnostic-row-state { display:inline-flex; gap:4px; align-items:center; font-size:10px; color:var(--gtfa-muted); white-space:nowrap; }
.gtfa-diagnostic-row-state.positive { color:var(--diag-positive); }
.gtfa-diagnostic-row-state.negative { color:var(--diag-negative); }
.gtfa-diagnostic-row-state.warning { color:var(--diag-warning); }
.gtfa-diagnostic-row-state.quiet,.gtfa-diagnostic-row-state.pending { color:var(--gtfa-quiet); }
.gtfa-diagnostic-note { display:flex; gap:7px; align-items:flex-start; margin:0; padding:12px 20px; border-top:1px solid var(--gtfa-line); color:var(--diag-tone); font-size:11px; line-height:1.6; background:color-mix(in srgb,var(--diag-tone) 3%,var(--gtfa-surface)); }
.gtfa-diagnostic-note>svg { margin-top:2px; }
.gtfa-diagnostic-footer { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 20px; border-top:1px solid var(--gtfa-line); font-size:10px; color:var(--gtfa-muted); }
.gtfa-diagnostic-footer>span { display:flex; gap:6px; align-items:center; }
.gtfa-diagnostic-footer strong { color:var(--gtfa-muted); font-weight:500; font-variant-numeric:tabular-nums; }
.gtfa-diagnostic-footer time { font-variant-numeric:tabular-nums; }
.gtfa-diagnostic .spinning>svg { animation:gtfa-diagnostic-spin 1.4s linear infinite; }
@keyframes gtfa-diagnostic-spin { to { transform:rotate(360deg); } }
@container gtfa-settings (max-width:720px) {
  .gtfa-anchor-head { display:none; }
  .gtfa-anchor-block { padding:14px; }
  .gtfa-anchor-block:nth-child(2) { border-top:0; border-radius:11px 11px 0 0; }
  .gtfa-anchor-grid { grid-template-columns:minmax(0,1fr) minmax(0,1fr) 34px; gap:12px; align-items:end; }
  .gtfa-anchor-cell:nth-child(1) { grid-column:1 / 3; grid-row:1; }
  .gtfa-anchor-cell:nth-child(2) { grid-column:1 / -1; grid-row:2; }
  .gtfa-anchor-cell:nth-child(3) { grid-column:1; grid-row:3; }
  .gtfa-anchor-cell:nth-child(4) { grid-column:2 / -1; grid-row:3; }
  .gtfa-anchor-action { grid-column:3; grid-row:1; }
  .gtfa-anchor-cell-label { display:block; margin-bottom:5px; color:var(--gtfa-muted); font-size:10px; }
  .gtfa-anchor-term { padding:0; min-height:36px; display:flex; align-items:center; }
  .gtfa-baseline-toggle>span { display:none; }
}
@container gtfa-settings (max-width:640px) {
  .gtfa-section { padding:18px!important; }
  .gtfa-advanced>summary { padding:18px!important; }
  .gtfa-advanced>div { margin-left:18px; margin-right:18px; }
  .gtfa-picker-state { flex-wrap:wrap; }
  .gtfa-picker-actions { display:flex; align-items:center; justify-content:flex-end; gap:12px; width:100%; }
  .gtfa-window-grid { grid-template-columns:1fr; gap:16px; }
  .gtfa-catalog-table th,.gtfa-catalog-table td { padding:9px 8px; }
  .gtfa-catalog-table thead th { font-size:9px; }
  .gtfa-route-grid { grid-template-columns:1fr; gap:8px; }
  .gtfa-route-card { display:flex!important; align-items:center; gap:12px!important; padding:13px!important; min-height:68px!important; }
  .gtfa-route-card>.gtfa-route-card-top { display:contents!important; }
  .gtfa-route-card .gtfa-route-radio { margin-left:auto; order:3; flex-shrink:0; }
  .gtfa-route-card .gtfa-route-card-body { flex:1; order:2; }
  .gtfa-route-card .gtfa-route-icon { order:1; }
  .gtfa-defaults-grid { grid-template-columns:1fr; gap:18px; }
  .gtfa-connection-top { flex-wrap:wrap; padding:14px; gap:10px; }
  .gtfa-connection-actions { margin-left:auto; flex-wrap:wrap; }
  .gtfa-connection-copy { flex:1; min-width:150px; }
  .gtfa-oauth-foot { padding:0 14px 14px; }
  .gtfa-usage-banner { margin-left:14px; margin-right:14px; padding:18px; }
  .gtfa-usage-detail-grid { grid-template-columns:1fr; }
  .gtfa-actor-choice { gap:9px; padding:11px; flex-wrap:wrap; }
  .gtfa-actor-choice-icon { display:none; }
  .gtfa-actor-choice-copy { min-width:100px; }
  .gtfa-advanced-tabs { gap:18px; }
  .gtfa-save-bar { gap:7px!important; padding:12px 14px!important; }
  .gtfa-save-bar>button { padding:7px 10px!important; font-size:12px!important; }
  .gtfa-diagnostic-heading { padding:15px; gap:10px; }
  .gtfa-diagnostic-heading-copy>h4 { margin:0; font-size:13px; }
  .gtfa-diagnostic-network { padding:11px 15px; flex-wrap:wrap; gap:7px; }
  .gtfa-diagnostic-table-heading { padding:15px 15px 9px; }
  .gtfa-diagnostic-table th,.gtfa-diagnostic-table td { padding:10px 15px; }
  .gtfa-diagnostic-table tbody th { width:auto; }
  .gtfa-diagnostic-note { padding:12px 15px; }
  .gtfa-diagnostic-footer { padding:11px 15px; flex-wrap:wrap; gap:6px 12px; }
}
@media(prefers-color-scheme:dark) {
  .gtfa-settings {
    --gtfa-ink:var(--dsw-alias-label-primary,#e9edf6);
    --gtfa-muted:var(--dsw-alias-label-secondary,#a2adc0);
    --gtfa-quiet:var(--dsw-alias-label-tertiary,#717e93);
    --gtfa-surface:var(--dsw-alias-bg-layer-1,#1a1f28);
    --gtfa-line:var(--dsw-alias-border-l4,#303847);
    --gtfa-save-shadow:0 -4px 20px rgba(0,0,0,.24),0 12px 36px rgba(0,0,0,.44);
  }
}
@media(prefers-reduced-motion:reduce) {
  .gtfa-settings *, .gtfa-settings *::before, .gtfa-settings *::after { transition:none!important; }
  .gtfa-diagnostic .spinning>svg { animation:none; }
}
`;
