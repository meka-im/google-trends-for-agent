import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GEO_CODES } from '../src/options.js';

function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as Record<string, unknown>;
}

const actor = json('../.actor/actor.json');
const store = json('../.actor/store.json');
const input = json('../.actor/input_schema.json');
const dataset = json('../.actor/dataset_schema.json');
const output = json('../.actor/output_schema.json');
const kv = json('../.actor/key_value_store_schema.json');
const web = json('../.actor/web_server_schema.json');
const readme = readFileSync(new URL('../.actor/README.md', import.meta.url), 'utf8');

const properties = (input.properties ?? {}) as Record<string, Record<string, unknown>>;

describe('Actor Store metadata', () => {
  it('has the required titles, description, memory limits and paths', () => {
    expect(actor.title).toBe('Google Trends MCP & API for AI Agents — Open Source');
    expect(String(actor.description).length).toBeGreaterThan(0);
    expect(String(actor.description).length).toBeLessThanOrEqual(300);
    expect(actor.version).toBe('0.2.2');
    expect(actor.buildTag).toBe('latest');
    expect(actor.minMemoryMbytes).toBe(256);
    expect(actor.maxMemoryMbytes).toBe(1024);
    expect(actor.defaultMemoryMbytes).toBe(512);
    expect(actor.usesStandbyMode).toBe(true);
    expect(actor.webServerMcpPath).toBe('/mcp');
    expect(actor.readme).toBe('./README.md');
    expect(actor.changelog).toBe('../CHANGELOG.md');
    expect(actor.input).toBe('./input_schema.json');
    expect(actor.output).toBe('./output_schema.json');
    expect(actor.storages).toEqual({
      dataset: './dataset_schema.json',
      keyValueStore: './key_value_store_schema.json',
    });
    expect(actor.webServerSchema).toBe('./web_server_schema.json');
    expect(actor.dockerfile).toBe('./Dockerfile');
    expect(actor).not.toHaveProperty('meta');
    expect(actor.icon).toBe('./icon.png');
    expect(existsSync(new URL('../.actor/icon.png', import.meta.url))).toBe(true);
    expect(existsSync(new URL('../.actor/icon.svg', import.meta.url))).toBe(true);
  });

  it('has SEO metadata, run defaults, Standby settings and pricing notes', () => {
    expect(store.seoTitle).toBe('Google Trends MCP Server & API for AI Agents');
    expect(String(store.seoTitle).length).toBeLessThanOrEqual(60);
    expect(String(store.seoDescription).length).toBeLessThanOrEqual(160);
    expect(store.categories).toEqual(['MCP_SERVERS', 'AI', 'OPEN_SOURCE']);
    expect(store.defaultRunOptions).toEqual({ build: 'latest', timeoutSecs: 300, memoryMbytes: 512 });
    expect(store.actorStandby).toEqual({
      isEnabled: true,
      tenancy: 'single-tenant',
      idleTimeoutSecs: 60,
      memoryMbytes: 512,
      desiredRequestsPerActorRun: 3,
      maxRequestsPerActorRun: 4,
      build: 'latest',
    });
    expect(store.isSourceCodeHidden).toBe(false);
    expect(store.pricing).toBe('usage-only (no Actor fee): pay per platform usage, no monetization');
  });

  it('uses a small example input that matches the README Quick start and the input schema', () => {
    const example = store.exampleRunInput as Record<string, unknown>;
    expect(example).toEqual({ tool: 'snapshot', terms: ['Sora'], geo: 'US', window: 'now 1-d', anchor: '' });
    for (const key of Object.keys(example)) expect(properties).toHaveProperty(key);
    const quickStart = readme.slice(readme.indexOf('## Quick start'), readme.indexOf('### MCP client'));
    const block = quickStart.match(/```json\n([\s\S]*?)```/);
    expect(block).not.toBeNull();
    expect(JSON.parse(block![1]!)).toEqual(example);
  });
});

describe('Actor input schema', () => {
  it('declares the sections, controls and tiny prefill', () => {
    expect(input.required).toEqual([]);
    expect(properties.tool).toMatchObject({
      sectionCaption: 'Question',
      editor: 'select',
      default: 'ask',
      prefill: 'snapshot',
      enum: ['ask', 'snapshot', 'compare', 'now'],
    });
    expect((properties.tool.enumTitles as string[])[1]).toBe('Calibrated snapshot (trends_snapshot)');
    expect(properties.terms).toMatchObject({ editor: 'stringList', default: [], prefill: ['Sora'] });
    expect(properties.anchor).toMatchObject({
      sectionCaption: 'Calibration',
      editor: 'select',
      default: '',
      enum: ['', 'gpts', 'sudoku'],
    });
    expect(properties.proxyConfiguration).toMatchObject({ sectionCaption: 'Advanced: proxy', editor: 'proxy' });
    expect(properties.proxyConfiguration.default).toEqual(properties.proxyConfiguration.prefill);
    expect(properties.window.default).toBe('now 1-d');
    expect((properties.window.enum as string[]).length).toBe(9);
  });

  it('keeps the generated geo enum in lockstep with src/geos.ts', () => {
    expect(properties.geo.enum).toEqual(['WORLDWIDE', ...GEO_CODES.filter(Boolean)]);
    expect((properties.geo.enumTitles as string[])[0]).toBe('Worldwide');
    const us = (properties.geo.enum as string[]).indexOf('US');
    expect((properties.geo.enumTitles as string[])[us]).toBe('United States (US)');
    expect((properties.geo.enum as string[]).length).toBe((properties.geo.enumTitles as string[]).length);
  });
});

describe('Actor output schemas', () => {
  it('describes every dataset field with a view per question', () => {
    expect(dataset.actorSpecification).toBe(1);
    const fields = (dataset.fields as { properties: Record<string, Record<string, unknown>> }).properties;
    for (const name of ['term', 'tool', 'geo', 'window', 'status', 'interestLatest', 'interestSettled', 'interestAverage',
      'interestPeak', 'searchesPerDay', 'verdict', 'anchor', 'topRelated', 'topRising', 'chartKey', 'chartUrl', 'error', 'fetchedAt']) {
      expect(fields[name], name).toBeTruthy();
      expect(fields[name]!.description, name).toBeTruthy();
      expect(fields[name]!.example !== undefined, name).toBe(true);
    }
    const views = dataset.views as Record<string, { transformation: { fields: string[] }; display: { properties: Record<string, { format: string }> } }>;
    expect(Object.keys(views)).toEqual(['overview', 'related', 'calibration']);
    expect(views.overview!.transformation.fields).toEqual(['term', 'tool', 'geo', 'window', 'status', 'interestLatest', 'interestAverage', 'interestPeak', 'searchesPerDay', 'chartUrl']);
    expect(views.overview!.display.properties.chartUrl!.format).toBe('image');
    expect(views.overview!.display.properties.interestLatest!.format).toBe('number');
    expect(views.related!.display.properties.topRelated!.format).toBe('array');
  });

  it('links the dataset and OUTPUT from the output schema', () => {
    expect(output.actorOutputSchemaVersion).toBe(1);
    expect(output.properties).toMatchObject({
      results: { template: '{{links.apiDefaultDatasetUrl}}/items' },
      summary: { template: '{{links.apiDefaultKeyValueStoreUrl}}/records/OUTPUT' },
    });
  });

  it('declares the OUTPUT counters and the chart collection', () => {
    expect(kv.actorKeyValueStoreSchemaVersion).toBe(1);
    const collections = kv.collections as Record<string, Record<string, unknown>>;
    expect(collections.runSummary).toMatchObject({ key: 'OUTPUT', contentTypes: ['application/json'] });
    expect((collections.runSummary!.jsonSchema as { properties: { status: { enum: string[] } } }).properties.status.enum)
      .toEqual(['completed', 'partial', 'failed']);
    expect(collections.charts).toMatchObject({ keyPrefix: 'chart-', contentTypes: ['image/png', 'image/svg+xml'] });
  });

  it('documents the HTTP API and /mcp in OpenAPI', () => {
    expect(web.openapi).toMatch(/^3\./);
    expect(String((web.info as { description: string }).description)).toContain('/mcp');
    expect(Object.keys(web.paths as object).sort()).toEqual(['/egress/fetch', '/health', '/tools/{name}']);
  });
});
