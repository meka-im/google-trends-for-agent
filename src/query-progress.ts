/** Safe progress states. Never includes credentials or upstream request bodies. */
export type QueryPhase = 'requesting' | 'starting' | 'queued' | 'running' | 'reading' | 'cache' | 'calibrating' | 'saving';
export interface QueryProgress { requestId: string; phase: QueryPhase; startedAt: number }
