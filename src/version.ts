import { readFileSync } from 'node:fs';
/** Package version from package.json; the single source for MCP serverInfo and /health. */
export const VERSION: string = (() => {
  try {
    return String((JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown }).version ?? '0.0.0');
  } catch {
    return '0.0.0';
  }
})();
