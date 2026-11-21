export const DASHBOARD_CSS = `
.gtfa-settings.gtfa-dashboard{
  width:100%;height:100%;min-height:0;max-width:none;overflow:auto;
  background:color-mix(in srgb,var(--gtfa-ink) 2%,var(--gtfa-surface));
  color:var(--gtfa-ink);
  font:13px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI","PingFang SC","Hiragino Sans GB",sans-serif;
  -webkit-font-smoothing:antialiased;
  container:gd / inline-size;
}
.gtfa-dashboard *{box-sizing:border-box}
.gtfa-dashboard [hidden]{display:none!important}
.gtfa-dashboard h1,.gtfa-dashboard h2,.gtfa-dashboard h3,.gtfa-dashboard h4,.gtfa-dashboard p{margin:0}
.gtfa-dashboard button,.gtfa-dashboard input{font:inherit}
.gtfa-dashboard button{cursor:pointer;color:inherit}
.gtfa-dashboard button:disabled{cursor:default;opacity:.45}
.gtfa-dashboard button:focus-visible,.gtfa-dashboard input:focus-visible{outline:2px solid var(--gtfa-accent);outline-offset:2px}

/* Sticky Compact Single-Row Topbar */
.gd-topbar{
  position:sticky;top:0;z-index:25;height:56px;padding:0 24px;
  display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:14px;
  background:color-mix(in srgb,var(--gtfa-surface) 90%,transparent);
  backdrop-filter:blur(12px);
  border-bottom:1px solid var(--gtfa-line);
}
.gd-brand{display:inline-flex;align-items:center;gap:10px;min-width:0}
.gd-brand>svg{flex-shrink:0;border-radius:8px;box-shadow:0 2px 6px rgba(37,99,235,.2)}
.gd-brand h1{font-size:14.5px;font-weight:650;letter-spacing:-.02em;white-space:nowrap}

.gd-tabs{
  display:inline-flex;align-items:center;padding:3px;gap:2px;
  background:var(--gtfa-soft);border-radius:10px;border:0;margin:0;
}
.gd-tabs>button{
  border:0;background:transparent;height:30px;padding:0 16px;border-radius:7px;
  font-size:12.5px;font-weight:500;color:var(--gtfa-muted);
  display:inline-flex;align-items:center;gap:6px;
  transition:color .14s,background .14s,box-shadow .14s;
}
.gd-tabs>button:hover{color:var(--gtfa-ink)}
.gd-tabs>button[aria-selected=true]{
  background:var(--gtfa-surface);color:var(--gtfa-ink);font-weight:600;
  box-shadow:0 1px 2px rgba(15,23,42,.08);
}
.gd-tabs small{font-size:11px;font-weight:500;color:var(--gtfa-quiet);font-variant-numeric:tabular-nums}

.gd-topbar-right{display:inline-flex;align-items:center;justify-content:flex-end;gap:8px}
.gd-route-pill{
  display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 11px;
  border:1px solid var(--gtfa-line);border-radius:999px;background:var(--gtfa-surface);
  font-size:12px;font-weight:500;color:var(--gtfa-muted);white-space:nowrap;
  transition:border-color .14s,color .14s,background .14s;
}
.gd-route-pill:not(:disabled):hover{border-color:color-mix(in srgb,var(--gtfa-accent) 40%,var(--gtfa-line));color:var(--gtfa-ink);background:var(--gtfa-hover)}
.gd-route-dot{width:7px;height:7px;border-radius:50%;background:var(--gtfa-green);box-shadow:0 0 0 3px var(--gtfa-green-soft);flex:none}
.gd-route-dot.warn{background:#d97706;box-shadow:0 0 0 3px color-mix(in srgb,#f59e0b 16%,var(--gtfa-surface))}
.gd-actions{display:flex;align-items:center;gap:8px}

/* Workspace Container */
.gd-workspace{padding:20px 24px 28px;max-width:1320px;margin:0 auto}

/* Buttons & Inputs */
.gd-button,.gd-input{
  height:36px;min-height:36px;max-height:36px;
  border:1px solid var(--gtfa-line);border-radius:8px;
  background:var(--gtfa-surface);color:var(--gtfa-ink);
  font-size:12.5px!important;line-height:20px;
}
.gd-button{
  display:inline-flex;align-items:center;justify-content:center;gap:6px;
  padding:0 13px;font-weight:550;white-space:nowrap;
  transition:border-color .14s,background .14s,color .14s;
}
.gd-button:not(:disabled):hover{border-color:color-mix(in srgb,var(--gtfa-accent) 42%,var(--gtfa-line));background:var(--gtfa-hover)}
.gd-button.primary{background:var(--gtfa-accent);border-color:var(--gtfa-accent);color:#fff}
.gd-button.primary:not(:disabled):hover{background:#1d4ed8;border-color:#1d4ed8}
.gd-button.ghost{border-color:transparent;background:transparent;color:var(--gtfa-muted);padding:0 9px}
.gd-button.ghost:not(:disabled):hover{background:var(--gtfa-soft);color:var(--gtfa-ink);border-color:transparent}
.gd-button.compact{height:32px;min-height:32px;max-height:32px;padding:0 11px;font-size:12px!important}
.gd-input{padding:0 12px;width:100%;min-width:0}
.gd-input::placeholder{color:var(--gtfa-quiet)}

/* Custom Checkbox */
.gd-check{position:relative;display:inline-flex;align-items:center;gap:7px;cursor:pointer;user-select:none;font-size:12px;color:var(--gtfa-muted)}
.gd-check.disabled{opacity:.45;cursor:not-allowed}
.gd-check>input{position:absolute;opacity:0;width:1px;height:1px;margin:0;pointer-events:none}
.gd-check-box{
  width:16px;height:16px;border-radius:5px;border:1.5px solid color-mix(in srgb,var(--gtfa-ink) 24%,var(--gtfa-line));
  background:var(--gtfa-surface);color:#fff;display:inline-flex;align-items:center;justify-content:center;flex:none;
  transition:background .14s,border-color .14s,box-shadow .14s;
}
.gd-check:hover:not(.disabled) .gd-check-box{border-color:var(--gtfa-accent)}
.gd-check>input:focus-visible+.gd-check-box{border-color:var(--gtfa-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--gtfa-accent) 18%,transparent)}
.gd-check-box.checked,.gd-check-box.indeterminate{background:var(--gtfa-accent);border-color:var(--gtfa-accent)}

/* Upgraded ChoicePicker inside Dashboard (preserves 40px height & 0px left padding test contract) */
.gtfa-dashboard .gtfa-choice-field{gap:0;min-width:0}
.gtfa-dashboard .gtfa-choice-field.compact .gtfa-choice-control{
  height:40px;min-height:40px;max-height:40px;padding:0;gap:0;
  border-radius:8px;background:var(--gtfa-surface);
}
.gtfa-dashboard .gtfa-choice-control input{
  height:38px;min-height:38px;flex:1;width:0;min-width:0;
  font-size:12.5px;font-weight:500;padding:0 12px;text-overflow:ellipsis;
}
.gtfa-dashboard .gtfa-choice-field.compact .gtfa-choice-toggle{height:38px;width:30px;flex:0 0 30px}
.gtfa-dashboard .gtfa-choice-option{min-height:34px;font-size:12.5px;padding:7px 10px;border-radius:7px}
.gtfa-dashboard .gtfa-choice-popover{
  border-radius:12px;padding:5px;min-width:178px;
  box-shadow:0 16px 40px rgba(15,23,42,.14),0 2px 6px rgba(15,23,42,.06);
}

/* Unified Command Query Bar */
.gd-query-shell{margin-bottom:18px}
.gd-command-bar{
  display:grid;grid-template-columns:minmax(220px,1fr) 1px 148px 1px 142px auto;
  align-items:center;gap:0;padding:4px;
  background:var(--gtfa-surface);border:1px solid var(--gtfa-line);border-radius:13px;
  box-shadow:0 2px 8px rgba(15,23,42,.04);
  transition:border-color .15s,box-shadow .15s;
}
.gd-command-bar:focus-within{
  border-color:var(--gtfa-accent);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--gtfa-accent) 14%,transparent),0 2px 8px rgba(15,23,42,.04);
}
.gd-cmd-input-wrap{display:flex;align-items:center;gap:9px;padding:0 12px;min-width:0}
.gd-cmd-input-wrap>svg{color:var(--gtfa-quiet);flex:none}
.gd-cmd-input{
  width:100%;min-width:0;height:40px;border:0;background:transparent;
  color:var(--gtfa-ink);font-size:13.5px;font-weight:500;outline:none!important;
}
.gd-cmd-input::placeholder{color:var(--gtfa-quiet);font-weight:400}
.gd-term-badge{
  font-size:11px;font-weight:550;color:var(--gtfa-muted);background:var(--gtfa-soft);
  padding:2px 7px;border-radius:6px;white-space:nowrap;font-variant-numeric:tabular-nums;
}
.gd-term-badge.over{color:var(--dsw-alias-state-error-primary,#dc2626);background:color-mix(in srgb,#dc2626 10%,var(--gtfa-surface))}
.gd-cmd-sep{width:1px;height:22px;background:var(--gtfa-line);justify-self:center}
.gd-command-bar .gtfa-choice-field.compact .gtfa-choice-control{border-color:transparent;background:transparent;box-shadow:none}
.gd-command-bar .gtfa-choice:not(.disabled):hover .gtfa-choice-control{background:var(--gtfa-hover);border-color:transparent}
.gd-command-bar .gtfa-choice.open .gtfa-choice-control{background:var(--gtfa-soft);border-color:transparent;box-shadow:none}
.gd-command-bar .gd-button.primary{height:38px;min-height:38px;max-height:38px;padding:0 16px;margin-left:5px;border-radius:9px}
.gd-field-error{grid-column:1/-1;color:var(--dsw-alias-state-error-primary,#dc2626);font-size:12px;padding:7px 12px 4px}
.gd-query-sub{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:9px;padding:0 4px;font-size:11.5px;color:var(--gtfa-muted)}
.gd-query-sub-note{margin-left:auto;color:var(--gtfa-quiet)}

/* Compact Summary Strip on History Tab */
.gd-summary-strip{
  display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;
  padding:10px 14px;margin-bottom:14px;
  background:var(--gtfa-surface);border:1px solid var(--gtfa-line);border-radius:12px;
}
.gd-summary-window{display:inline-flex;padding:2px;gap:2px;border-radius:8px;background:var(--gtfa-soft);flex:none}
.gd-summary-window button{border:0;background:transparent;padding:4px 10px;border-radius:6px;font-size:11.5px;font-weight:500;color:var(--gtfa-muted)}
.gd-summary-window button[aria-pressed=true]{background:var(--gtfa-surface);color:var(--gtfa-ink);font-weight:600;box-shadow:0 1px 2px rgba(15,23,42,.07)}
.gd-summary-stats{display:flex;align-items:center;gap:14px;flex-wrap:wrap;flex:1}
.gd-summary-stat{display:inline-flex;align-items:baseline;gap:6px;font-size:12px}
.gd-summary-stat>span{color:var(--gtfa-muted);font-size:11.5px}
.gd-summary-stat>strong{font-weight:650;color:var(--gtfa-ink);font-variant-numeric:tabular-nums}
.gd-summary-stat>strong.accent{color:var(--gtfa-accent)}
.gd-summary-sep{width:1px;height:13px;background:var(--gtfa-line)}

/* Cards & Section Toolbars */
.gd-toolbar{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:14px}
.gd-toolbar h2{font-size:16px;font-weight:650;letter-spacing:-.02em;display:flex;align-items:center;gap:8px}
.gd-toolbar p{color:var(--gtfa-muted);font-size:12px;margin-top:3px}
.gd-card{background:var(--gtfa-surface);border:1px solid var(--gtfa-line);border-radius:15px;min-width:0;box-shadow:0 1px 2px rgba(15,23,42,.03)}
.gd-card h3{font-size:13.5px;font-weight:650;padding:16px 20px}

/* Progress Banner */
.gd-progress{
  padding:11px 16px;margin-bottom:16px;
  border:1px solid color-mix(in srgb,var(--gtfa-accent) 22%,var(--gtfa-line));
  border-radius:12px;background:var(--gtfa-accent-soft);
}
.gd-progress-top{display:flex;align-items:center;justify-content:space-between;gap:12px}
.gd-progress-copy{display:flex;align-items:center;gap:10px;min-width:0}
.gd-progress-copy>div{min-width:0}
.gd-progress-copy strong{font-size:12.5px;font-weight:600}
.gd-progress-copy p{font-size:11.5px;color:var(--gtfa-muted);margin-top:2px;font-variant-numeric:tabular-nums}
.gd-progress-track{height:3px;background:color-mix(in srgb,var(--gtfa-accent) 12%,var(--gtfa-surface));margin-top:10px;border-radius:3px;overflow:hidden}
.gd-progress-track>i{display:block;height:100%;width:30%;border-radius:inherit;background:var(--gtfa-accent);animation:gd-progress 1.6s ease-in-out infinite}
.gd-spinner{display:flex;color:var(--gtfa-accent);animation:gtfa-spin 1.2s linear infinite}
@keyframes gd-progress{from{transform:translateX(-110%)}to{transform:translateX(440%)}}
@media(prefers-reduced-motion:reduce){.gd-progress-track>i,.gd-spinner{animation:none}}

/* Result 2-Column Workspace */
.gd-results{margin-top:0}
.gd-result-grid{display:grid;grid-template-columns:minmax(0,1.88fr) minmax(300px,1fr);gap:16px;align-items:start}
.gd-chart-card{overflow:hidden}
.gd-result-head{
  display:flex;align-items:flex-start;justify-content:space-between;gap:12px;
  padding:18px 20px 10px;min-height:60px;flex-wrap:wrap;
}
.gd-result-title-block{min-width:0}
.gd-result-title-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.gd-result-title-row h2{font-size:17px;font-weight:680;letter-spacing:-.025em;overflow-wrap:anywhere}
.gd-result-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:4px;font-size:12px;color:var(--gtfa-muted)}
.gd-result-tools{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}

.gd-metric-switch{display:inline-flex;align-items:center;padding:3px;gap:2px;border-radius:9px;background:var(--gtfa-soft);flex:none}
.gd-metric-switch button{border:0;background:transparent;border-radius:6px;padding:5px 11px;font:inherit;font-size:12px;font-weight:500;color:var(--gtfa-muted);transition:all .14s}
.gd-metric-switch button[aria-pressed=true]{color:var(--gtfa-ink);font-weight:600;background:var(--gtfa-surface);box-shadow:0 1px 2px rgba(15,23,42,.08)}

/* Chart & Tooltip */
.gd-chart-wrap{position:relative;padding:4px 12px 8px}
.gd-trend-chart{width:100%;height:282px;display:block;user-select:none}
.gtfa-dashboard svg text{font-family:inherit;font-size:10.5px;fill:var(--gtfa-quiet)}
.gd-trend-chart text.gd-log-tag{fill:var(--gtfa-accent);font-weight:600}
.gd-chart-tooltip{
  position:absolute;top:14px;z-index:4;pointer-events:none;max-width:calc(52% - 10px);min-width:150px;
  border:1px solid var(--gtfa-line);border-radius:10px;padding:9px 12px;
  background:color-mix(in srgb,var(--gtfa-surface) 95%,transparent);backdrop-filter:blur(8px);
  box-shadow:0 6px 20px rgba(15,23,42,.12);font-size:11.5px;font-variant-numeric:tabular-nums;
}
.gd-chart-tooltip time{display:block;color:var(--gtfa-muted);font-size:11px;font-weight:550;margin-bottom:5px}
.gd-chart-tooltip>div{display:flex;gap:8px;align-items:center;margin-top:3px}
.gd-chart-tooltip i{width:7px;height:7px;border-radius:2px;flex:none}
.gd-chart-tooltip span{min-width:0;overflow-wrap:anywhere}
.gd-chart-tooltip strong{margin-left:auto;text-align:right;font-weight:650}

/* Legend & Stats Table */
.gd-legend{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:11.5px;color:var(--gtfa-muted);padding:4px 20px 10px}
.gd-legend>span,.gd-chart-legend button{
  display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:999px;
  border:1px solid var(--gtfa-line);background:var(--gtfa-surface);color:var(--gtfa-ink);font-size:12px;font-weight:500;
}
.gd-legend i{display:inline-block;width:8px;height:8px;border-radius:2px;flex-shrink:0}
.gd-chart-legend i{background:currentColor}
.gd-chart-legend i.gd-band-marker{border:1px solid currentColor;background:color-mix(in srgb,currentColor 24%,transparent)}
.gd-chart-legend .gd-legend-missing{opacity:.6;border-style:dashed}
.gd-chart-legend .gd-legend-missing i{background:none;border:1.5px solid currentColor}
.gd-chart-legend small{color:var(--gtfa-muted);font-size:10.5px}
.gd-chart-legend button[aria-pressed=false]{opacity:.42}
.gd-chart-legend button:hover{background:var(--gtfa-hover)}
.gd-chart-note{margin:0;padding:2px 20px 10px;color:var(--gtfa-muted);font-size:11.5px}

.gd-result-stats{width:100%;border-collapse:collapse;text-align:left}
.gd-result-stats th,.gd-result-stats td{padding:11px 20px;border-top:1px solid var(--gtfa-line);font-size:12px}
.gd-result-stats th{color:var(--gtfa-muted);font-size:11px;font-weight:500;background:color-mix(in srgb,var(--gtfa-soft) 65%,transparent)}
.gd-result-stats th:not(:first-child),.gd-result-stats td:not(:first-child){text-align:right;font-variant-numeric:tabular-nums}
.gd-stat-term{display:inline-flex;align-items:center;gap:8px;font-weight:600;color:var(--gtfa-ink)}
.gd-stat-term i{width:8px;height:8px;border-radius:2px;flex:none}
.gd-stat-vol{color:var(--gtfa-accent);font-weight:650}

/* Right Side Column */
.gd-side-stack{display:flex;flex-direction:column;gap:14px}
.gd-result-info{padding:18px}
.gd-result-info h3{padding:0 0 12px;font-size:13.5px;font-weight:650}

/* On-Demand Volume Estimation */
.gd-estimate{margin:0;border:0;padding:0}
.gd-estimate h4{font-size:13.5px;font-weight:650;margin:0 0 12px}
.gd-estimate-action{width:100%;height:38px;min-height:38px;max-height:38px;font-weight:600;font-size:13px!important;margin-top:4px}
.gd-estimate-step{
  display:flex;gap:8px;align-items:center;color:var(--gtfa-accent);
  background:var(--gtfa-accent-soft);padding:9px 12px;border-radius:9px;
  font-size:12px;font-weight:550;margin-bottom:10px;
}
.gd-estimate-line{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:10px 0}
.gd-estimate-line+.gd-estimate-line{border-top:1px solid var(--gtfa-line)}
.gd-estimate-term{display:flex;align-items:center;gap:8px;min-width:0;font-weight:550;font-size:12.5px;overflow-wrap:anywhere}
.gd-estimate-term i{width:8px;height:8px;border-radius:2px;flex:none}
.gd-estimate-line>div{text-align:right;flex:none}
.gd-estimate-line strong{display:block;font-size:14px;font-weight:700;letter-spacing:-.02em;color:var(--gtfa-accent);font-variant-numeric:tabular-nums}
.gd-estimate-line strong.hero{font-size:20px;line-height:1.25}
.gd-estimate-line strong.gd-muted{font-size:12.5px;font-weight:500;color:var(--gtfa-muted)}
.gd-estimate small{display:block;color:var(--gtfa-muted);font-size:11px;margin-top:2px;overflow-wrap:anywhere}

.gd-anchor-list{background:var(--gtfa-soft);border-radius:10px;padding:11px 13px;margin:12px 0 6px}
.gd-anchor-head{display:flex;gap:10px;align-items:baseline;justify-content:space-between;font-size:11px;color:var(--gtfa-muted);margin-bottom:6px}
.gd-anchor-head b{color:var(--gtfa-ink);font-weight:600}
.gd-anchor-line{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:8px;align-items:baseline;padding:4px 0;font-size:11.5px}
.gd-anchor-round{font-size:10.5px;font-weight:600;color:var(--gtfa-muted);background:var(--gtfa-surface);padding:1px 6px;border-radius:4px}
.gd-anchor-line b{overflow-wrap:anywhere;font-weight:600}
.gd-anchor-line>span:last-child{font-variant-numeric:tabular-nums;color:var(--gtfa-muted)}

/* Legacy / Individual Volume Cards */
.gd-volume-note{font-size:12px;color:var(--gtfa-muted);line-height:1.65;padding:12px;border-radius:10px;background:var(--gtfa-soft)}
.gd-volume-list{display:grid;gap:10px}
.gd-volume-list>span{font-size:13.5px;font-weight:650;color:var(--gtfa-ink)}
.gd-volume-row{padding:11px 12px;background:var(--gtfa-soft);border:1px solid var(--gtfa-line);border-radius:10px}
.gd-volume-row>span{font-size:11.5px;color:var(--gtfa-muted)}
.gd-volume-row strong{display:block;font-size:17px;font-weight:650;color:var(--gtfa-accent);margin-top:2px;font-variant-numeric:tabular-nums}
.gd-volume-row small,.gd-volume-list>small{font-size:11px;line-height:1.6;color:var(--gtfa-muted)}
.gd-volume-row>small{display:block;margin-top:3px}
.gd-volume-action{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;margin-top:9px}
.gd-volume-action .gd-button{height:30px;min-height:30px;max-height:30px;padding:0 10px;font-size:11.5px!important}

/* Details Disclosure */
.gd-query-details{margin-top:12px;border-top:1px solid var(--gtfa-line);padding-top:10px;font-size:11.5px;color:var(--gtfa-muted)}
.gd-query-details summary{cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;color:var(--gtfa-muted)}
.gd-query-details summary::-webkit-details-marker{display:none}
.gd-query-details[open] .gd-chevron{transform:rotate(180deg)}
.gd-chevron{transition:transform .16s ease}
.gd-query-details dl{margin:10px 0 0;display:grid;gap:7px}
.gd-query-details dl>div{display:flex;justify-content:space-between;gap:12px}
.gd-query-details dt{color:var(--gtfa-quiet)}
.gd-query-details dd{margin:0;color:var(--gtfa-ink);text-align:right;font-variant-numeric:tabular-nums}
.gd-warnings{padding:12px 16px;border:1px solid var(--gtfa-line);border-radius:12px;margin-top:14px;font-size:11.5px;color:var(--gtfa-muted);background:var(--gtfa-surface)}
.gd-warnings summary{cursor:pointer}
.gd-warnings p{margin-top:8px;overflow-wrap:anywhere}

/* Compact Related Queries Card */
.gd-related-card{padding:16px 16px 14px}
.gd-related-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 4px 10px}
.gd-related-head h3{padding:0;font-size:13.5px;font-weight:650}
.gd-related-tabs{display:inline-flex;padding:2px;gap:2px;border-radius:8px;background:var(--gtfa-soft)}
.gd-related-tabs button{border:0;background:transparent;padding:4px 10px;border-radius:6px;font-size:11.5px;font-weight:500;color:var(--gtfa-muted);transition:color .14s,background .14s}
.gd-related-tabs button[aria-selected=true]{background:var(--gtfa-surface);color:var(--gtfa-ink);font-weight:600;box-shadow:0 1px 2px rgba(15,23,42,.06)}
.gd-related-list{display:flex;flex-direction:column;gap:2px}
.gd-related-row{position:relative;display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:8px;font-size:12.5px;overflow:hidden;transition:background .12s}
.gd-related-row:hover{background:var(--gtfa-hover)}
.gd-related-bar{position:absolute;inset:0 auto 0 0;background:color-mix(in srgb,var(--gtfa-accent) 5.5%,transparent);pointer-events:none;border-radius:8px}
.gd-related-rank{position:relative;z-index:1;width:16px;font-size:11px;font-weight:500;color:var(--gtfa-quiet);text-align:center;font-variant-numeric:tabular-nums;flex:none}
.gd-related-term{position:relative;z-index:1;flex:1;min-width:0;border:0;background:none;padding:0;text-align:left;color:var(--gtfa-ink);font-weight:500;display:flex}
.gd-related-term>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gd-related-row:hover .gd-related-term:not(:disabled){color:var(--gtfa-accent)}
.gd-related-row>strong{position:relative;z-index:1;font-weight:600;color:var(--gtfa-muted);white-space:nowrap;font-variant-numeric:tabular-nums;font-size:12px}
.gd-related-row>strong.rising{color:var(--gtfa-green)}
.gd-related-add{
  position:relative;z-index:1;width:22px;height:22px;padding:0;border:0;border-radius:6px;
  background:transparent;color:var(--gtfa-quiet);display:inline-flex;align-items:center;justify-content:center;flex:none;
  opacity:.35;transition:opacity .12s,background .12s,color .12s;
}
.gd-related-row:hover .gd-related-add,.gd-related-add:focus-visible{opacity:1;color:var(--gtfa-muted)}
.gd-related-add:not(:disabled):hover{color:var(--gtfa-accent);background:var(--gtfa-accent-soft)}
.gd-related{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}
.gd-related .gd-card{padding-bottom:10px}
.gd-related p{display:flex;justify-content:space-between;gap:16px;padding:8px 20px;font-size:12px;border-top:1px solid var(--gtfa-soft)}

/* Error & Empty */
.gd-error{padding:11px 15px;border-radius:10px;background:color-mix(in srgb,#dc2626 8%,var(--gtfa-surface));color:var(--dsw-alias-state-error-primary,#c53d47);font-size:12px;margin:0 0 16px!important;display:flex;align-items:center;justify-content:space-between;gap:14px}
.gd-error-code{font-size:11.5px;color:var(--dsw-alias-state-error-primary,#c53d47);background:color-mix(in srgb,#dc2626 8%,var(--gtfa-surface));padding:9px 11px;border-radius:8px;margin:10px 0!important}
.gd-empty{min-height:240px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;color:var(--gtfa-quiet);padding:40px 20px;text-align:center}
.gd-empty h3{font-size:14.5px;padding:0;color:var(--gtfa-ink)}
.gd-empty p{font-size:12px;color:var(--gtfa-muted)}
.gd-empty-chips{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:7px;margin-top:8px;font-size:11.5px;color:var(--gtfa-muted)}
.gd-chip{
  border:1px solid var(--gtfa-line);background:var(--gtfa-soft);color:var(--gtfa-ink);
  font-size:12px;font-weight:500;padding:4px 11px;border-radius:999px;
  transition:border-color .14s,background .14s,color .14s;
}
.gd-chip:not(:disabled):hover{border-color:color-mix(in srgb,var(--gtfa-accent) 45%,var(--gtfa-line));background:var(--gtfa-accent-soft);color:var(--gtfa-accent)}

/* Records Table */
.gd-record-tools{display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap}
.gd-record-tools>.gd-input{flex:1;min-width:180px;max-width:300px;height:40px;min-height:40px;max-height:40px}
.gd-record-tools>.gtfa-choice-field{width:142px}
.gd-record-tools>.gd-record-clear{margin-left:auto;display:flex;gap:8px}
.gd-records{overflow:hidden}
.gd-scroll{overflow-x:auto}
.gd-records table{width:100%;border-collapse:collapse;text-align:left}
.gd-records th{background:color-mix(in srgb,var(--gtfa-soft) 75%,transparent);font-weight:500;font-size:11px;color:var(--gtfa-muted);padding:11px 16px;white-space:nowrap}
.gd-records td{padding:12px 16px;border-top:1px solid var(--gtfa-line);font-size:12px;color:var(--gtfa-muted);white-space:nowrap}
.gd-record-row{cursor:pointer;transition:background .12s}
.gd-records tbody tr:hover{background:var(--gtfa-hover)}
.gd-records td>strong{display:block;max-width:280px;overflow:hidden;text-overflow:ellipsis;font-size:13px;font-weight:600;color:var(--gtfa-ink)}
.gd-records td>small{display:block;font-size:11px;color:var(--gtfa-quiet);margin-top:3px}
.gd-records .gd-button{height:30px;min-height:30px;max-height:30px;font-size:11.5px!important;padding:0 10px}
.gd-records td:first-child,.gd-records th:first-child{padding-right:0;width:36px}
.gd-badges{display:inline-flex;align-items:center;gap:5px;flex-wrap:wrap}
.gd-records .gd-badges{margin-top:6px}
.gd-badge{font-size:10.5px;font-weight:550;border-radius:6px;padding:2px 7px;white-space:nowrap;background:var(--gtfa-soft);color:var(--gtfa-muted)}
.gd-badge.ok{background:var(--gtfa-green-soft);color:var(--gtfa-green)}
.gd-badge.blocked,.gd-badge.error{background:color-mix(in srgb,#dc2626 10%,var(--gtfa-surface));color:var(--dsw-alias-state-error-primary,#c53d47)}
.gd-badge.cache{background:var(--gtfa-accent-soft);color:var(--gtfa-accent)}
.gd-badge.vol{background:var(--gtfa-accent-soft);color:var(--gtfa-accent);font-variant-numeric:tabular-nums}
.gd-table-footer{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-top:1px solid var(--gtfa-line);color:var(--gtfa-quiet);font-size:11.5px;background:color-mix(in srgb,var(--gtfa-soft) 50%,transparent)}
.gd-table-footer .gd-button{height:32px;min-height:32px;max-height:32px}
.gd-footer{display:flex;justify-content:space-between;align-items:center;gap:14px;font-size:11px;color:var(--gtfa-quiet);padding-top:18px}
.gd-footer-ver{display:inline-flex;align-items:center;gap:6px;border:0;background:none;padding:2px 6px;border-radius:6px;font:inherit;color:var(--gtfa-muted);cursor:pointer}
.gd-footer-ver:hover{background:var(--gtfa-hover);color:var(--gtfa-ink)}
.gd-footer-dot{width:6px;height:6px;border-radius:50%;background:var(--gtfa-accent);flex:none}
.gd-footer-dot.warn{background:#d97706}
.gd-footer-tag{color:var(--gtfa-accent);font-weight:550}
.gd-footer-tag.warn{color:var(--dsw-alias-state-warning-primary,#b45309)}
.gd-muted{color:var(--gtfa-muted)}

/* Confirm Dialog */
.gd-dialog{border:1px solid var(--gtfa-line);border-radius:16px;background:var(--gtfa-surface);color:var(--gtfa-ink);padding:24px;max-width:400px;width:calc(100% - 32px);box-shadow:0 20px 55px rgba(15,23,42,.22)}
.gd-dialog::backdrop{background:rgba(15,23,42,.38);backdrop-filter:blur(2px)}
.gd-dialog>div>svg{color:#dc2626;margin-bottom:12px}
.gd-dialog h2{font-size:17px;font-weight:650}
.gd-dialog p{font-size:12.5px;color:var(--gtfa-muted);margin-top:10px;line-height:1.65}
.gd-dialog .gd-clear-count{font-size:26px;font-weight:700;color:var(--gtfa-ink);font-variant-numeric:tabular-nums}
.gd-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}
.gd-dialog-actions>.gd-button:last-child{color:#fff;background:#dc2626;border-color:#dc2626}

@container gd (max-width:1060px){
  .gd-workspace{padding:18px 20px 24px}
  .gd-result-grid{grid-template-columns:1fr}
}
@container gd (max-width:780px){
  .gd-topbar{padding:0 14px;grid-template-columns:auto 1fr auto;gap:10px}
  .gd-route-pill{display:none}
  .gd-workspace{padding:14px 14px 22px}
  .gd-command-bar{grid-template-columns:1fr 1fr;gap:6px;padding:8px}
  .gd-cmd-input-wrap{grid-column:1/-1;padding:0 6px}
  .gd-cmd-sep{display:none}
  .gd-command-bar .gtfa-choice-field.compact .gtfa-choice-control{background:var(--gtfa-soft)}
  .gd-command-bar .gd-button.primary{grid-column:1/-1;margin-left:0}
  .gd-summary-sep{display:none}
  .gd-record-tools>.gd-input{max-width:none;flex-basis:100%}
  .gd-record-tools>.gd-record-clear{margin-left:0;width:100%}
  .gd-record-tools>.gd-record-clear>.gd-button{flex:1}
}
@container gd (max-width:520px){
  .gd-brand h1{display:none}
  .gd-related{grid-template-columns:1fr}
  .gd-result-head{flex-wrap:wrap;padding:14px 16px 8px}
  .gd-result-stats th,.gd-result-stats td{padding:10px 14px;font-size:11px}
}
`;
