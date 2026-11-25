/** Settings-only styles. Host tokens supply the surface, text, and borders in both themes. */
export const SETTINGS_CSS = `
.gtfa-settings {
  container:gtfa-settings / inline-size;
  --gtfa-ink:var(--dsw-alias-label-primary,#0f172a);
  --gtfa-muted:var(--dsw-alias-label-secondary,#475569);
  --gtfa-quiet:var(--dsw-alias-label-tertiary,#94a3b8);
  --gtfa-surface:var(--dsw-alias-bg-layer-1,#fff);
  --gtfa-line:var(--dsw-alias-border-l4,#e5eaf2);
  --gtfa-soft:color-mix(in srgb,var(--gtfa-ink) 3%,var(--gtfa-surface));
  --gtfa-hover:color-mix(in srgb,var(--gtfa-ink) 5.5%,var(--gtfa-surface));
  --gtfa-accent:#2563eb;
  --gtfa-accent-hover:#1d4ed8;
  --gtfa-accent-soft:color-mix(in srgb,var(--gtfa-accent) 8%,var(--gtfa-surface));
  --gtfa-green:var(--dsw-alias-state-success-primary,#059669);
  --gtfa-green-soft:color-mix(in srgb,var(--gtfa-green) 9%,var(--gtfa-surface));
  --gtfa-warn:var(--dsw-alias-state-warning-primary,#b45309);
  --gtfa-warn-soft:color-mix(in srgb,var(--gtfa-warn) 9%,var(--gtfa-surface));
  --gtfa-error:var(--dsw-alias-state-error-primary,#dc2626);
  --gtfa-error-soft:color-mix(in srgb,var(--gtfa-error) 9%,var(--gtfa-surface));
  --gtfa-save-surface:color-mix(in srgb,var(--gtfa-surface) 95%,transparent);
  --gtfa-save-border:color-mix(in srgb,var(--gtfa-accent) 28%,var(--gtfa-line));
  --gtfa-save-shadow:0 8px 28px rgba(15,23,42,.12),0 2px 6px rgba(15,23,42,.05);
  color:var(--gtfa-ink); font-size:13px; line-height:1.5;
  -webkit-font-smoothing:antialiased;
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
.gtfa-section-heading { display:flex; align-items:center; gap:9px; }
.gtfa-section-icon { display:flex; align-items:center; justify-content:center; width:28px; height:28px; flex-shrink:0; color:var(--gtfa-accent); background:var(--gtfa-accent-soft); border-radius:8px; }
.gtfa-section input:hover,.gtfa-section select:not(:disabled):hover,.gtfa-advanced input:hover,.gtfa-advanced select:not(:disabled):hover { border-color:color-mix(in srgb,var(--gtfa-accent) 45%,var(--gtfa-line))!important; }
.gtfa-settings input:disabled,.gtfa-settings select:disabled { opacity:.55; cursor:not-allowed; }
.gtfa-toggle-field { display:flex; justify-content:space-between; align-items:center; gap:18px; padding:12px 14px; border:1px solid var(--gtfa-line); border-radius:10px; background:var(--gtfa-soft); }
.gtfa-toggle-field p { margin-top:2px!important; }
.gtfa-test-help { display:flex; flex-wrap:wrap; justify-content:space-between; gap:4px 14px; font-size:11px; line-height:1.55; color:var(--gtfa-quiet); margin:0; }
.gtfa-privacy-note { display:flex; align-items:center; gap:6px; font-size:11px; line-height:1.5; color:var(--gtfa-quiet); margin:0; }
.gtfa-public-details { margin:0!important; border-top:1px solid var(--gtfa-line); padding-top:10px; }
.gtfa-public-details>div { padding-top:10px; }
.gtfa-actor-picker { margin:0; padding:12px 15px 14px; border-top:1px solid var(--gtfa-line); }
.gtfa-picker-heading { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:8px; font-size:12px; font-weight:550; }
.gtfa-picker-heading>span { display:flex; align-items:center; gap:7px; }
.gtfa-picker-heading small { margin-left:3px; font-size:10px; font-weight:400; color:var(--gtfa-muted); }
.gtfa-actor-choices { display:grid; gap:8px; max-height:300px; overflow-y:auto; padding:3px; margin:-3px; }
.gtfa-actor-choice { display:flex; align-items:center; gap:11px; width:100%; min-width:0; padding:11px 13px; border:1px solid var(--gtfa-line); border-radius:10px; background:var(--gtfa-surface); color:var(--gtfa-ink); text-align:left; cursor:pointer; transition:border-color .15s,background .15s; }
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
.gtfa-actor-build.outdated { color:var(--gtfa-warn); background:var(--gtfa-warn-soft); border-radius:999px; padding:2px 8px; font-weight:550; }
.gtfa-actor-build.building { color:var(--gtfa-warn); background:var(--gtfa-warn-soft); }
.gtfa-actor-build.failed { color:var(--gtfa-error); background:var(--gtfa-error-soft); }
.gtfa-actor-radio { display:flex; align-items:center; justify-content:center; width:18px; height:18px; padding:0; flex-shrink:0; border:1px solid var(--gtfa-line); border-radius:50%!important; }
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
.gtfa-advanced { border:1px solid var(--gtfa-line); border-radius:14px; background:var(--gtfa-surface); box-shadow:0 1px 2px rgba(15,23,42,.03); }
.gtfa-advanced>div { margin-left:20px; margin-right:20px; }
.gtfa-route-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
.gtfa-route-card { text-align:left; min-width:0; transition:background .15s,border-color .15s; }
.gtfa-route-card:not(:disabled):hover { border-color:color-mix(in srgb,var(--gtfa-accent) 45%,var(--gtfa-line))!important; }
.gtfa-route-card:disabled { opacity:.5; }
.gtfa-route-title { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
.gtfa-route-radio { width:14px; height:14px; border:1.5px solid var(--gtfa-line); border-radius:50%; }
.gtfa-route-card[aria-selected=true] .gtfa-route-radio { background:var(--gtfa-accent); border-color:var(--gtfa-accent); box-shadow:inset 0 0 0 3px var(--gtfa-surface); }
.gtfa-recommended { color:#fff; background:var(--gtfa-accent); border-radius:4px; padding:1px 5px; font-size:10px; font-weight:600; }
.gtfa-status-icon { width:30px; height:30px; border-radius:8px; display:flex; align-items:center; justify-content:center; flex-shrink:0; background:var(--gtfa-green-soft); color:var(--gtfa-green); }
.gtfa-status-icon.neutral { color:var(--gtfa-muted); background:var(--gtfa-hover); }
.gtfa-status-icon.login { color:var(--gtfa-accent); background:var(--gtfa-accent-soft); }
.gtfa-connection-actions { display:flex; align-items:center; gap:7px; margin-left:auto; flex-shrink:0; }
.gtfa-connection-top { display:flex; align-items:center; gap:11px; padding:12px 15px; }
.gtfa-connection-copy { min-width:0; }
.gtfa-connection-title { font-size:13px; font-weight:600; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.gtfa-connection-subtitle { margin:2px 0 0; font-size:11.5px; color:var(--gtfa-muted); line-height:1.45; }
.gtfa-account-menu { position:relative; }
.gtfa-account-menu>summary { list-style:none; cursor:pointer; padding:6px; border:1px solid var(--gtfa-line); border-radius:8px; background:var(--gtfa-surface); }
.gtfa-account-menu>summary::-webkit-details-marker { display:none; }
.gtfa-account-menu>div { position:absolute; right:0; top:36px; z-index:4; min-width:156px; padding:5px; border:1px solid var(--gtfa-line); border-radius:10px; background:var(--gtfa-surface); box-shadow:0 12px 32px rgba(15,23,42,.14); }
.gtfa-account-menu button { width:100%; text-align:left; border:0; border-radius:6px; background:none; color:inherit; padding:8px 10px; font-size:12px; cursor:pointer; }
.gtfa-account-menu button:not(:disabled):hover { background:var(--gtfa-hover); }
.gtfa-oauth-foot { padding:0 16px 14px; display:grid; gap:8px; }
.gtfa-oauth-code-row { display:flex; flex-wrap:wrap; align-items:center; gap:10px; }
.gtfa-free-credit,.gtfa-usage-banner { --gtfa-card-ink:var(--gtfa-ink); --gtfa-card-muted:var(--gtfa-muted); --gtfa-card-accent:var(--gtfa-accent); --gtfa-card-line:var(--gtfa-line); --gtfa-card-progress:var(--gtfa-accent); --gtfa-card-warning:#d97706; --gtfa-card-error:#dc2626; position:relative; isolation:isolate; overflow:hidden; container:gtfa-credit / inline-size; margin:0; padding:12px 15px; border:0; border-top:1px solid var(--gtfa-card-line); border-radius:0; color:var(--gtfa-card-ink); background:var(--gtfa-surface); }
.gtfa-free-credit-copy { position:relative; z-index:1; width:100%; }
.gtfa-credit-eyebrow { display:block; color:var(--gtfa-card-muted); font-size:10.5px; font-weight:600; letter-spacing:.8px; }
.gtfa-credit-value { display:flex; align-items:baseline; flex-wrap:wrap; gap:10px; margin-top:6px; }
.gtfa-credit-value strong { color:var(--gtfa-card-accent); font-size:30px; font-weight:720; letter-spacing:-.03em; line-height:1.15; font-variant-numeric:tabular-nums; }
.gtfa-credit-value>span { color:var(--gtfa-card-ink); font-size:13.5px; font-weight:550; }
.gtfa-free-credit-estimate { margin:5px 0 12px; font-size:12px; color:var(--gtfa-card-muted); }
.gtfa-free-credit-copy small { display:block; margin-top:9px; font-size:10.5px; color:var(--gtfa-quiet); }
.gtfa-free-credit-actions { display:flex; align-items:center; gap:14px; font-size:12px; }
.gtfa-settings a.gtfa-credit-cta { display:inline-flex; align-items:center; padding:7px 14px; border-radius:8px; background:var(--gtfa-card-accent); color:#fff; font-weight:600; text-decoration:none; }
.gtfa-settings a.gtfa-credit-cta:hover { background:#1d4ed8; }
.gtfa-settings a.gtfa-credit-pricing { color:var(--gtfa-card-muted); text-decoration:none; }
.gtfa-settings a.gtfa-credit-pricing:hover { text-decoration:underline; }
.gtfa-free-credit a:focus-visible,.gtfa-usage-banner button:focus-visible,.gtfa-usage-banner summary:focus-visible { outline-color:var(--gtfa-card-accent); }
.gtfa-credit-art { display:none; }
@container gtfa-credit (max-width:340px) {
  .gtfa-credit-value { gap:8px; }
  .gtfa-credit-value strong { font-size:26px; }
  .gtfa-credit-value>span { font-size:12.5px; }
}
.gtfa-defaults-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
.gtfa-choice-field { display:grid; align-content:start; min-width:0; }
.gtfa-choice-field>label:not(.gtfa-sr-only) { margin-bottom:6px; font-size:12px; font-weight:550; }
.gtfa-choice { --gtfa-choice-accent:color-mix(in srgb,var(--gtfa-accent) 70%,var(--gtfa-ink)); position:relative; min-width:0; }
.gtfa-choice-control { display:flex; align-items:center; min-width:0; gap:8px; min-height:38px; padding:4px 8px; border:1px solid var(--gtfa-line); border-radius:9px; background:var(--gtfa-surface); transition:border-color .15s,box-shadow .15s; }
.gtfa-choice:not(.disabled):hover .gtfa-choice-control { border-color:color-mix(in srgb,var(--gtfa-accent) 45%,var(--gtfa-line)); }
.gtfa-choice.open:not(.disabled) .gtfa-choice-control,.gtfa-choice:not(.disabled):focus-within .gtfa-choice-control { border-color:var(--gtfa-accent); box-shadow:0 0 0 3px color-mix(in srgb,var(--gtfa-accent) 9%,transparent); }
.gtfa-choice.disabled { opacity:.55; }
.gtfa-choice-icon { display:flex; align-items:center; justify-content:center; width:24px; height:24px; flex-shrink:0; border-radius:6px; background:var(--gtfa-accent-soft); color:var(--gtfa-accent); }
.gtfa-choice input { width:100%; min-width:0; min-height:26px; padding:0; background:transparent; border:0; border-radius:0; color:var(--gtfa-ink); font:inherit; font-size:12.5px; outline:none!important; box-shadow:none; }
.gtfa-choice input::placeholder { color:var(--gtfa-quiet); font-size:12px; }
.gtfa-choice-toggle { display:flex; align-items:center; justify-content:center; width:26px; height:28px; padding:0; flex-shrink:0; background:none; border:0; border-radius:5px; color:var(--gtfa-muted); cursor:pointer; }
.gtfa-choice.open .gtfa-choice-toggle>svg { transform:rotate(180deg); }
.gtfa-choice-popover { position:absolute; z-index:20; left:0; right:0; top:calc(100% + 7px); padding:5px; border:1px solid var(--gtfa-line); border-radius:12px; background:var(--gtfa-surface); box-shadow:0 16px 40px rgba(15,23,42,.14),0 2px 6px rgba(15,23,42,.06); animation:gtfa-pop .14s cubic-bezier(.16,1,.3,1); }
@keyframes gtfa-pop { from { opacity:0; transform:translateY(-4px) scale(.985); } to { opacity:1; transform:translateY(0) scale(1); } }
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
.gtfa-usage-header { position:relative; z-index:1; display:flex; align-items:center; gap:10px; margin-bottom:6px; }
.gtfa-usage-header>.gtfa-credit-eyebrow { margin-right:auto; text-transform:uppercase; letter-spacing:1.2px; }
.gtfa-usage-state { position:relative; z-index:1; display:flex; align-items:center; flex-wrap:wrap; gap:10px; min-height:72px; padding:10px 0; color:var(--gtfa-card-ink); font-size:12px; }
.gtfa-usage-state>p { flex:1; min-width:120px; margin:0; max-width:540px; }
.gtfa-usage-banner .gtfa-usage-retry { background:var(--gtfa-surface)!important; border-color:var(--gtfa-card-line)!important; color:var(--gtfa-card-ink)!important; }
.gtfa-usage-plan { padding:2px 8px; border:1px solid var(--gtfa-card-line); background:var(--gtfa-surface); border-radius:6px; font-size:10.5px; font-weight:550; color:var(--gtfa-card-muted); }
.gtfa-usage-banner .gtfa-usage-refresh { width:27px; min-width:27px; height:27px; padding:0!important; background:var(--gtfa-surface)!important; border-color:var(--gtfa-card-line)!important; color:var(--gtfa-card-ink)!important; }
.gtfa-usage-banner .gtfa-usage-refresh:not(:disabled):hover { background:var(--gtfa-hover)!important; }
.gtfa-usage-content { position:relative; z-index:1; max-width:100%; }
.gtfa-usage-cycle { font-size:11px; color:var(--gtfa-card-muted); }
.gtfa-usage-total { display:flex; flex-wrap:wrap; align-items:baseline; gap:8px; margin:2px 0 8px; font-variant-numeric:tabular-nums; }
.gtfa-usage-total>strong { color:var(--gtfa-card-accent); font-size:24px; line-height:1.15; font-weight:720; letter-spacing:-.03em; }
.gtfa-usage-limit { font-size:14.5px; color:var(--gtfa-card-muted); letter-spacing:-.02em; white-space:nowrap; }
.gtfa-usage-limit>span { margin-right:3px; color:var(--gtfa-quiet); font-size:13px; font-weight:400; }
.gtfa-usage-progress { height:5px; overflow:hidden; border-radius:6px; background:color-mix(in srgb,var(--gtfa-accent) 12%,var(--gtfa-surface)); }
.gtfa-usage-progress>div { height:100%; border-radius:6px; transition:width 180ms ease; }
.gtfa-usage-balance { display:flex; justify-content:space-between; flex-wrap:wrap; gap:5px 12px; margin-top:6px; font-size:11px; color:var(--gtfa-card-muted); font-variant-numeric:tabular-nums; }
.gtfa-usage-balance>span:first-child { color:var(--gtfa-card-ink); }
.gtfa-usage-balance>span.over-limit { color:var(--gtfa-card-error); }
.gtfa-usage-details { position:relative; z-index:1; margin-top:9px; padding-top:8px; border-top:1px solid var(--gtfa-card-line); font-size:11px; color:var(--gtfa-card-muted); }
.gtfa-usage-details>summary { width:fit-content; cursor:pointer; color:var(--gtfa-card-muted); font-size:10px; }
.gtfa-usage-detail-grid { display:grid; grid-template-columns:1fr 1fr; gap:6px 16px; padding-top:12px; }
.gtfa-usage-banner .gtfa-usage-detail-grid p { color:var(--gtfa-card-muted)!important; }
.gtfa-usage-banner:has(.gtfa-usage-details[open]) .gtfa-usage-art { opacity:.12; }
@container gtfa-credit (max-width:540px) {
  .gtfa-usage-content { max-width:100%; }
  .gtfa-usage-art { right:-70px; opacity:.16; }
}
@container gtfa-credit (max-width:340px) {
  .gtfa-usage-total>strong { font-size:24px; }
  .gtfa-usage-limit { font-size:14px; }
  .gtfa-usage-header { gap:7px; }
  .gtfa-usage-art { opacity:.1; }
}
.gtfa-advanced>summary { list-style:none; cursor:pointer; }
.gtfa-advanced>summary::-webkit-details-marker { display:none; }
.gtfa-advanced[open]>summary .gtfa-advanced-chevron { transform:rotate(180deg); }
.gtfa-advanced-tabs { display:inline-flex; gap:2px; padding:3px; border-radius:9px; background:var(--gtfa-soft); margin:0 20px 16px; }
.gtfa-advanced-tabs button { padding:5px 12px; border:0; border-radius:6px; background:transparent; color:var(--gtfa-muted); cursor:pointer; font-size:12px; font-weight:500; transition:all .14s; }
.gtfa-advanced-tabs button[aria-selected=true] { color:var(--gtfa-ink); font-weight:600; background:var(--gtfa-surface); box-shadow:0 1px 2px rgba(15,23,42,.08); }
.gtfa-advanced-panel { display:grid; gap:14px; }
.gtfa-baseline-heading { display:flex; align-items:center; justify-content:space-between; gap:16px; }
.gtfa-baseline-heading .gtfa-section-heading { min-width:0; }
.gtfa-baseline-toggle { display:flex; align-items:center; gap:10px; flex-shrink:0; color:var(--gtfa-muted); font-size:11.5px; }
.gtfa-baseline-toggle button:disabled { opacity:.5; }
.gtfa-baseline-catalog { min-width:0; border:1px solid var(--gtfa-line); border-radius:11px; background:var(--gtfa-soft); overflow:hidden; }
.gtfa-catalog-top { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:13px 15px; background:var(--gtfa-surface); }
.gtfa-catalog-meta { min-width:0; display:grid; gap:4px; }
.gtfa-catalog-title-row { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
.gtfa-catalog-title-row h4,.gtfa-custom-baseline-title { margin:0; font-size:12.5px; font-weight:600; color:var(--gtfa-ink); }
.gtfa-catalog-badge { display:inline-flex; align-items:center; padding:1.5px 7px; border-radius:999px; background:var(--gtfa-hover); color:var(--gtfa-muted); font-size:10.5px; font-weight:550; font-variant-numeric:tabular-nums; }
.gtfa-catalog-badge.synced { background:var(--gtfa-green-soft); color:var(--gtfa-green); }
.gtfa-catalog-sub { margin:0; display:flex; align-items:center; flex-wrap:wrap; gap:3px 6px; color:var(--gtfa-muted); font-size:11px; line-height:1.5; }
.gtfa-catalog-sub a { color:var(--gtfa-accent); text-decoration:none; font-weight:500; }
.gtfa-catalog-sub a:hover { text-decoration:underline; }
.gtfa-catalog-sep { color:var(--gtfa-quiet); }
.gtfa-catalog-actions { flex-shrink:0; display:flex; align-items:center; }
.gtfa-catalog-sync { display:inline-flex; align-items:center; gap:5px; padding:5px 10px; min-height:29px; border:1px solid var(--gtfa-line); border-radius:7px; background:var(--gtfa-surface); color:var(--gtfa-ink); font-size:11.5px; font-weight:550; cursor:pointer; }
.gtfa-catalog-sync:not(:disabled):hover { border-color:color-mix(in srgb,var(--gtfa-accent) 45%,var(--gtfa-line)); background:var(--gtfa-soft); }
.gtfa-catalog-feedback { margin:0; padding:7px 15px; border-top:1px solid var(--gtfa-line); font-size:11px; line-height:1.45; }
.gtfa-catalog-feedback.ok { background:var(--gtfa-green-soft); color:var(--gtfa-green); }
.gtfa-catalog-feedback.error { background:color-mix(in srgb,#dc2626 7%,var(--gtfa-surface)); color:var(--dsw-alias-state-error-primary,#dc2626); }
.gtfa-catalog-details { border-top:1px solid var(--gtfa-line); }
.gtfa-catalog-summary { list-style:none; display:flex; align-items:center; gap:8px; padding:9px 15px; cursor:pointer; font-size:11.5px; font-weight:550; color:var(--gtfa-muted); transition:background .12s,color .12s; }
.gtfa-catalog-summary::-webkit-details-marker { display:none; }
.gtfa-catalog-summary:hover { background:var(--gtfa-hover); color:var(--gtfa-ink); }
.gtfa-catalog-summary-label { white-space:nowrap; }
.gtfa-catalog-regions { display:flex; align-items:center; flex-wrap:wrap; gap:4px; }
.gtfa-catalog-chip { padding:1px 6px; border-radius:4px; background:var(--gtfa-surface); border:1px solid var(--gtfa-line); color:var(--gtfa-muted); font-size:10px; font-weight:500; }
.gtfa-catalog-chevron { margin-left:auto; color:var(--gtfa-quiet); display:flex; transition:transform .15s; }
.gtfa-catalog-details[open] .gtfa-catalog-chevron { transform:rotate(180deg); }
.gtfa-catalog-body { background:var(--gtfa-surface); border-top:1px solid var(--gtfa-line); }
.gtfa-catalog-toolbar { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:9px 14px; border-bottom:1px solid var(--gtfa-line); background:var(--gtfa-soft); }
.gtfa-catalog-count { font-size:11px; color:var(--gtfa-muted); font-variant-numeric:tabular-nums; }
.gtfa-catalog-filter { width:176px; max-width:100%; }
.gtfa-catalog-scroll { max-height:272px; overflow-y:auto; overscroll-behavior:contain; scrollbar-width:thin; }
.gtfa-catalog-table { width:100%; table-layout:fixed; border-collapse:collapse; font-size:11.5px; }
.gtfa-catalog-table th,.gtfa-catalog-table td { padding:7px 14px; border-top:1px solid var(--gtfa-line); text-align:left; overflow-wrap:anywhere; line-height:1.4; }
.gtfa-catalog-table thead th { position:sticky; top:0; z-index:1; border-top:0; background:var(--gtfa-soft); color:var(--gtfa-muted); font-size:10.5px; font-weight:500; box-shadow:0 1px 0 var(--gtfa-line); }
.gtfa-catalog-table tbody tr:first-child th,.gtfa-catalog-table tbody tr:first-child td { border-top:0; }
.gtfa-catalog-table tbody tr:hover { background:var(--gtfa-soft); }
.gtfa-catalog-table th:first-child { width:31%; font-weight:500; }
.gtfa-catalog-table th:nth-child(2) { width:41%; }
.gtfa-catalog-table th:nth-child(3) { width:28%; }
.gtfa-catalog-table td:nth-child(2) { font-family:var(--ds-font-family-code,Menlo,monospace); }
.gtfa-catalog-window { margin-inline-start:6px; color:var(--gtfa-muted); white-space:nowrap; }
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
.gtfa-save-bar { position:static; }
.gtfa-save-bar.active { position:sticky; bottom:12px; z-index:4; border-color:var(--gtfa-save-border)!important; background:var(--gtfa-save-surface)!important; box-shadow:var(--gtfa-save-shadow); backdrop-filter:blur(10px); }
.gtfa-save-state { display:flex; align-items:center; gap:7px; font-size:11.5px; color:var(--gtfa-quiet); margin-right:auto; }
.gtfa-save-state.dirty { color:var(--dsw-alias-state-warning-primary,#d97706); font-weight:550; }
.gtfa-sr-only { position:absolute; width:1px; height:1px; margin:-1px; padding:0; overflow:hidden; clip:rect(0,0,0,0); border:0; white-space:nowrap; }
.gtfa-settings .gtfa-button { transition:background .14s,border-color .14s; }
.gtfa-settings .gtfa-button:not(:disabled):hover { filter:brightness(.97); }
.gtfa-diagnostic {
  --diag-positive:var(--gtfa-green);
  --diag-negative:var(--dsw-alias-state-error-primary,#dc2626);
  --diag-warning:var(--dsw-alias-state-warning-primary,#d97706);
  --diag-tone:var(--diag-positive);
  margin-top:4px; border:1px solid var(--gtfa-line); border-radius:12px;
  overflow:hidden; background:var(--gtfa-surface); color:var(--gtfa-ink);
}
.gtfa-diagnostic.negative { --diag-tone:var(--diag-negative); }
.gtfa-diagnostic.warning { --diag-tone:var(--diag-warning); }
.gtfa-diagnostic.pending { --diag-tone:var(--gtfa-accent); }
.gtfa-diagnostic.quiet { --diag-tone:var(--gtfa-muted); }
.gtfa-diagnostic-heading { display:flex; align-items:center; gap:10px; padding:13px 16px; }
.gtfa-diagnostic-symbol { display:flex; align-items:center; justify-content:center; width:30px; height:30px; border-radius:8px; flex-shrink:0; color:var(--diag-tone); background:color-mix(in srgb,var(--diag-tone) 10%,var(--gtfa-surface)); }
.gtfa-diagnostic-heading-copy { display:grid; gap:2px; min-width:0; }
.gtfa-diagnostic-heading-copy>h4 { margin:0; font-size:13px; line-height:1.45; font-weight:650; }
.gtfa-diagnostic-heading-copy>span { font-size:11px; color:var(--gtfa-muted); }
.gtfa-diagnostic-badge { margin-left:auto; color:var(--diag-tone); background:color-mix(in srgb,var(--diag-tone) 10%,var(--gtfa-surface)); border-radius:6px; padding:2px 8px; font-size:10.5px; font-weight:550; white-space:nowrap; }
.gtfa-diagnostic-network { display:flex; gap:10px; align-items:center; padding:10px 16px; background:var(--gtfa-soft); border-top:1px solid var(--gtfa-line); border-bottom:1px solid var(--gtfa-line); font-size:11.5px; }
.gtfa-diagnostic-label { display:flex; gap:6px; align-items:center; color:var(--gtfa-muted); }
.gtfa-diagnostic-network-state { display:flex; gap:4px; align-items:center; color:var(--gtfa-muted); font-weight:550; }
.gtfa-diagnostic-network-state.positive { color:var(--diag-positive); }
.gtfa-diagnostic-network-state.negative { color:var(--diag-negative); }
.gtfa-diagnostic-network-meta { margin-left:auto; color:var(--gtfa-muted); font-size:11px; font-variant-numeric:tabular-nums; }
.gtfa-diagnostic-table-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 16px 8px; font-size:11.5px; font-weight:600; }
.gtfa-diagnostic-table-heading>span+span { color:var(--gtfa-muted); font-size:11px; font-weight:400; }
.gtfa-diagnostic-table { width:100%; border-collapse:collapse; text-align:left; font-size:12px; }
.gtfa-diagnostic-table th,.gtfa-diagnostic-table td { padding:9px 16px; line-height:1.45; }
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
.gtfa-actor-update-row { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px 12px; margin-top:10px; }
.gtfa-actor-update-row .gtfa-picker-meta { margin:0; }
.gtfa-runtime-note { display:flex; align-items:center; gap:8px; margin:0; padding:12px 20px; color:var(--gtfa-muted); font-size:11px; border-top:1px solid var(--gtfa-line); }
.gtfa-runtime-note svg { flex:none; }
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
  .gtfa-usage-banner { margin:0; padding:14px; }
  .gtfa-usage-detail-grid { grid-template-columns:1fr; }
  .gtfa-actor-choice { gap:9px; padding:11px; flex-wrap:wrap; }
  .gtfa-actor-choice-icon { display:none; }
  .gtfa-actor-choice-copy { min-width:100px; }
  .gtfa-advanced-tabs { gap:2px; margin:0 18px 14px; }
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
.gtfa-update-banner { border:1px solid var(--gtfa-line); border-radius:14px; background:var(--gtfa-surface); overflow:hidden; margin-bottom:14px; box-shadow:0 1px 2px rgba(15,23,42,.03); }
.gtfa-settings:not(.gtfa-dashboard) .gtfa-update-banner { margin-bottom:0; }
.gtfa-update-row { display:flex; align-items:center; gap:11px; padding:12px 16px; flex-wrap:wrap; }
.gtfa-update-icon { width:30px; height:30px; border-radius:8px; flex:none; display:inline-flex; align-items:center; justify-content:center; background:var(--gtfa-accent-soft); color:var(--gtfa-accent); }
.gtfa-update-banner.warn .gtfa-update-icon { background:var(--gtfa-warn-soft); color:var(--gtfa-warn); }
.gtfa-update-banner.neutral .gtfa-update-icon { background:var(--gtfa-green-soft); color:var(--gtfa-green); }
.gtfa-update-copy { flex:1; min-width:190px; display:grid; gap:2px; }
.gtfa-update-title { display:flex; align-items:center; flex-wrap:wrap; gap:7px; font-size:13px; font-weight:600; color:var(--gtfa-ink); }
.gtfa-update-sub { margin:0; font-size:11.5px; color:var(--gtfa-muted); line-height:1.45; }
.gtfa-ver-pill { display:inline-flex; align-items:center; gap:4px; padding:1.5px 7px; border-radius:999px; font-size:10.5px; font-weight:550; font-variant-numeric:tabular-nums; background:var(--gtfa-accent-soft); color:var(--gtfa-accent); }
.gtfa-ver-pill.warn { background:var(--gtfa-warn-soft); color:var(--gtfa-warn); }
.gtfa-ver-pill.ok { background:var(--gtfa-green-soft); color:var(--gtfa-green); }
.gtfa-update-actions { display:flex; align-items:center; gap:7px; flex-wrap:wrap; margin-left:auto; }
.gtfa-update-btn { display:inline-flex; align-items:center; justify-content:center; gap:5px; height:30px; padding:0 12px; border:1px solid var(--gtfa-line); border-radius:8px; background:var(--gtfa-surface); color:var(--gtfa-ink); font-size:12px; font-weight:550; cursor:pointer; text-decoration:none; white-space:nowrap; transition:border-color .14s,background .14s,color .14s; }
.gtfa-settings a.gtfa-update-btn { color:var(--gtfa-ink); text-decoration:none; }
.gtfa-update-btn:not(:disabled):hover { border-color:color-mix(in srgb,var(--gtfa-accent) 44%,var(--gtfa-line)); background:var(--gtfa-hover); }
.gtfa-update-btn.primary { background:var(--gtfa-accent); border-color:var(--gtfa-accent); color:#fff; }
.gtfa-update-btn.primary:not(:disabled):hover { background:var(--gtfa-accent-hover); border-color:var(--gtfa-accent-hover); }
.gtfa-update-btn.ghost { border-color:transparent; background:transparent; color:var(--gtfa-muted); padding:0 7px; }
.gtfa-update-btn.ghost:not(:disabled):hover { background:var(--gtfa-hover); color:var(--gtfa-ink); }
.gtfa-update-btn.icon-only { width:28px; height:28px; padding:0; }
.gtfa-update-drawer { border-top:1px solid var(--gtfa-line); background:var(--gtfa-soft); padding:12px 16px; display:grid; gap:10px; }
.gtfa-update-highlights { margin:0; padding-left:16px; font-size:11.5px; color:var(--gtfa-muted); display:grid; gap:3px; line-height:1.5; }
.gtfa-update-cmd { display:flex; align-items:center; gap:8px; padding:7px 9px; border-radius:8px; background:var(--gtfa-surface); border:1px solid var(--gtfa-line); font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; font-size:11.5px; color:var(--gtfa-ink); }
.gtfa-update-cmd code { flex:1; min-width:0; overflow-x:auto; white-space:nowrap; scrollbar-width:none; }
.gtfa-update-drawer-foot { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:6px 12px; font-size:11px; color:var(--gtfa-muted); line-height:1.45; }
.gtfa-update-drawer-foot a { color:var(--gtfa-accent); text-decoration:none; font-weight:550; }
.gtfa-update-drawer-foot a:hover { text-decoration:underline; }
.gtfa-update-feedback { margin:0; padding:7px 16px; border-top:1px solid var(--gtfa-line); font-size:11px; color:var(--gtfa-muted); background:var(--gtfa-soft); }
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
