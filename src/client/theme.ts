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
}
`;
