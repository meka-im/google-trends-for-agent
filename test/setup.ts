import { vi } from 'vitest';
// A missed mock must fail locally instead of reaching any remote server.
vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network is disabled in tests'); }));
