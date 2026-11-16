import type { ReactNode } from 'react';

const paths: Record<string, ReactNode> = {
  globe: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>,
  laptop: <><rect x="5" y="4" width="14" height="11" rx="2" /><path d="M3 19h18M5 15l-2 4M19 15l2 4" /></>,
  cloud: <><path d="M7 18a5 5 0 0 1-.7-9.9A6 6 0 0 1 18 7a4.6 4.6 0 0 1-.2 9H15" /><path d="m9 17 3 3 3-3M12 12v8" /></>,
  server: <><rect x="4" y="3" width="16" height="7" rx="2" /><rect x="4" y="14" width="16" height="7" rx="2" /><path d="M7 6.5h.1M7 17.5h.1M12 6.5h5M12 17.5h5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  play: <path d="m9 6 9 6-9 6Z" />,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  refresh: <><path d="M20 6v5h-5M4 18v-5h5" /><path d="M6 7a7 7 0 0 1 11-1l3 5M4 13l3 5a7 7 0 0 0 11-1" /></>,
  shield: <><path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6Z" /><path d="m8 12 3 3 5-6" /></>,
  sliders: <><path d="M4 7h7M15 7h5M4 17h3M11 17h9" /><circle cx="13" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>,
  external: <><path d="M14 4h6v6M20 4 10 14M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" /></>,
  alert: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 17h.01" /></>,
  plug: <path d="M8 3v5M16 3v5M6 8h12v3a6 6 0 0 1-12 0ZM12 17v4" />,
};

/** Decorative icons used by the settings controls; their buttons own accessible names. */
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={1.65} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={{ flexShrink: 0, display: 'block' }}>{paths[name]}</svg>;
}
