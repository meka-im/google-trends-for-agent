/** Settings-only styles. Host tokens supply the surface, text, and borders in both themes. */
export const SETTINGS_CSS = `
.gtfa-settings {
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
  color:var(--gtfa-ink); font-size:13px; line-height:1.5;
}
.gtfa-settings *, .gtfa-settings *::before, .gtfa-settings *::after { box-sizing:border-box; }
.gtfa-settings [hidden] { display:none!important; }
.gtfa-settings button, .gtfa-settings input, .gtfa-settings select { font-family:inherit; }
.gtfa-settings button:focus-visible, .gtfa-settings a:focus-visible,
.gtfa-settings input:focus-visible, .gtfa-settings select:focus-visible,
.gtfa-settings summary:focus-visible { outline:2px solid var(--gtfa-accent); outline-offset:3px; }
.gtfa-settings button:disabled { cursor:default; }
.gtfa-settings a { color:var(--gtfa-accent); }
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
.gtfa-free-credit { position:relative; isolation:isolate; overflow:hidden; container:gtfa-credit / inline-size; margin:0 18px 16px; padding:26px 28px 20px; border:1px solid #2e61e9; border-radius:16px; color:#fff; background:radial-gradient(ellipse at 85% 0%,#4387ff 0%,transparent 58%),linear-gradient(115deg,#123b9d 0%,#2558d5 70%,#2e61e9 100%); }
.gtfa-free-credit::before { content:''; position:absolute; z-index:-1; width:390px; height:390px; top:-290px; left:-120px; border-radius:50%; background:#5c91ff; opacity:.22; }
.gtfa-free-credit-copy { position:relative; z-index:1; width:fit-content; max-width:100%; }
.gtfa-credit-eyebrow { display:block; color:#d9e6ff; font-size:10px; font-weight:600; letter-spacing:1.4px; }
.gtfa-credit-value { display:flex; align-items:baseline; flex-wrap:wrap; gap:12px; margin-top:9px; }
.gtfa-credit-value strong { color:#a9efdf; font-size:58px; font-weight:750; letter-spacing:-2.5px; line-height:1.1; }
.gtfa-credit-value>span { color:#fff; font-size:15px; font-weight:550; }
.gtfa-free-credit-estimate { margin:8px 0 18px; font-size:13px; color:#eef5ff; }
.gtfa-free-credit-copy small { display:block; margin-top:13px; font-size:10px; color:#c7dbff; }
.gtfa-free-credit-actions { display:flex; align-items:center; gap:18px; font-size:12px; }
.gtfa-settings a.gtfa-credit-cta { display:inline-flex; align-items:center; padding:8px 16px; border-radius:7px; background:#a9efdf; color:#123377; font-weight:650; text-decoration:none; }
.gtfa-settings a.gtfa-credit-cta:hover { background:#c7f7ed; }
.gtfa-settings a.gtfa-credit-pricing { color:#eef5ff; text-decoration:none; }
.gtfa-settings a.gtfa-credit-pricing:hover { text-decoration:underline; }
.gtfa-free-credit a:focus-visible { outline-color:#fff; }
.gtfa-credit-art { position:absolute; z-index:0; pointer-events:none; right:-40px; top:-15px; width:310px; height:300px; opacity:.9; mask-image:linear-gradient(90deg,transparent,#000 30%); }
@container gtfa-credit (max-width:540px) {
  .gtfa-credit-art { right:-125px; opacity:.35; mask-image:linear-gradient(90deg,transparent,#000 65%); }
}
@container gtfa-credit (max-width:340px) {
  .gtfa-credit-art { opacity:.16; }
  .gtfa-credit-value { gap:9px; }
  .gtfa-credit-value strong { font-size:48px; }
  .gtfa-credit-value>span { font-size:13px; }
}
.gtfa-defaults-grid { display:grid; grid-template-columns:1fr 1fr; gap:20px; }
.gtfa-defaults-grid select { width:100%; }
.gtfa-usage-row { display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
.gtfa-usage-row .gtfa-progress { width:110px; margin-left:auto; }
.gtfa-usage-details { margin-top:7px; font-size:11px; color:var(--gtfa-muted); }
.gtfa-usage-details>summary { width:fit-content; cursor:pointer; color:var(--gtfa-muted); }
.gtfa-usage-detail-grid { display:grid; grid-template-columns:1fr 1fr; gap:5px 16px; padding-top:10px; }
.gtfa-advanced>summary { list-style:none; cursor:pointer; }
.gtfa-advanced>summary::-webkit-details-marker { display:none; }
.gtfa-advanced[open]>summary .gtfa-advanced-chevron { transform:rotate(180deg); }
.gtfa-advanced-tabs { display:flex; gap:22px; border-bottom:1px solid var(--gtfa-line); margin:0 0 20px; }
.gtfa-advanced-tabs button { padding:8px 0 12px; border:0; border-bottom:2px solid transparent; margin-bottom:-1px; background:none; color:var(--gtfa-muted); cursor:pointer; font-size:12px; }
.gtfa-advanced-tabs button[aria-selected=true] { color:var(--gtfa-accent); border-bottom-color:var(--gtfa-accent); }
.gtfa-advanced-panel { display:grid; gap:18px; }
.gtfa-anchor-scroll { overflow-x:auto; padding:2px 2px 8px; }
.gtfa-anchor-scroll>div { min-width:650px; }
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
@media(max-width:640px) {
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
  .gtfa-usage-detail-grid { grid-template-columns:1fr; }
  .gtfa-usage-row .gtfa-progress { width:64px; }
  .gtfa-advanced-tabs { gap:18px; }
  .gtfa-save-bar { gap:7px!important; padding:13px 0!important; }
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
  }
}
@media(prefers-reduced-motion:reduce) {
  .gtfa-settings *, .gtfa-settings *::before, .gtfa-settings *::after { transition:none!important; }
  .gtfa-diagnostic .spinning>svg { animation:none; }
}
`;
