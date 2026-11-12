import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConfigPage, EN } from '../src/client/index.js';

const t = (key: string) => EN[key] ?? key;

function render(value: Record<string, unknown> = {}) {
  const snapshot = {
    status: 'ready' as const,
    revision: 1,
    writable: true,
    value: {
      egress: 'local',
      apifyProxyGroup: 'RESIDENTIAL',
      apifyProxyCountry: 'US',
      geo: 'US',
      cache: true,
      charts: true,
      snapshotDir: '.gtfa/snapshots',
      chartDir: '.gtfa/charts',
      baselines: {
        anchors: [{ term: 'chacha', geo: 'US', dailySearches: 1200, tolerance: 0.5 }],
        windowAnchors: { short: 'sudoku', long: 'chacha' },
      },
      ...value,
    },
  };
  const describeSnapshot = {
    view: {
      writable: true,
      namespaces: [{ ns: 'gtfa', secrets: [{ path: ['apifyToken'], set: true }] }],
    },
  };
  const form = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    mutate: async () => true,
  };
  const describeFace = {
    getSnapshot: () => describeSnapshot,
    subscribe: () => () => {},
  };
  const ctx = {
    configForms: {
      get: () => form,
      describe: () => describeFace,
    },
  };
  return renderToStaticMarkup(createElement(ConfigPage, { ctx: ctx as never, t }));
}

describe('dsh settings form', () => {
  it('renders choices as selects, a segmented control, and switches', () => {
    const html = render();
    expect(html).toContain('role="tablist"');
    expect(html.match(/role="tab"/g)).toHaveLength(2);
    expect(html).toContain('aria-selected="true"');
    expect(html.match(/role="switch"/g)).toHaveLength(4);
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain('<select');
    expect(html).toContain('value="auto"');
    expect(html).toContain('Datacenter (automatic)');
    expect(html).toContain('United States (US)');
    expect(html).toContain('Worldwide');
    expect(html).toContain('Automatic (sudoku for ≤1 day, gpts for 7 days+)');
    expect(html).toContain('±50%');
    expect(html).not.toContain('apifyProxyGroups');
  });

  it('derives fixed and window anchor options from built-ins and configured anchors', () => {
    const html = render();
    expect(html).toContain('<option value="gpts">gpts</option>');
    expect(html).toContain('<option value="sudoku">sudoku</option>');
    expect(html).toContain('<option value="chacha">chacha</option>');
    expect(html).toContain('aria-label="Short-window anchor"');
    expect(html).toContain('aria-label="Long-window anchor"');
    expect(html).toContain('aria-label="Geo chacha"');
  });

  it('keeps only the allowed text inputs', () => {
    const html = render();
    const inputs = [...html.matchAll(/<input\b[^>]*>/g)].map(match => match[0]);
    expect(inputs.filter(input => input.includes('type="text"'))).toHaveLength(3);
    expect(inputs.filter(input => input.includes('type="password"'))).toHaveLength(1);
    expect(inputs.filter(input => input.includes('type="number"'))).toHaveLength(2);
    expect(inputs).toHaveLength(6);
    expect(html).not.toContain('<textarea');
  });

  it('shows Worldwide as the empty geo option and tolerances as selects', () => {
    const html = render({ geo: '' });
    expect(html).toContain('<option value="" selected="">Worldwide</option>');
    expect(html).toContain('aria-label="Default geo"');
    // Anchors calibrate one country, so Worldwide appears only in the default-geo select.
    expect(html.match(/>Worldwide</g)).toHaveLength(1);
    expect(html.match(/aria-label="Tolerance /g)).toHaveLength(2);
    expect(html).toContain('<option value="0.1">±10%</option>');
    expect(html).toContain('<option value="1">±100%</option>');
  });

  it('keeps stored tolerances exactly instead of rounding them to a preset', () => {
    const html = render({ baselines: { anchors: [
      { term: 'chacha', geo: 'US', dailySearches: 1200, tolerance: 0.2 },
      { term: 'pizza', geo: 'GB', dailySearches: 9000 },
    ] } });
    expect(html).toContain('<option value="0.2" selected="">±20%</option>');
    expect(html).toMatch(/aria-label="Tolerance pizza"><option value="" selected="">Default \(±50%\)<\/option>/);
  });
});
