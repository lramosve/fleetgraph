import { startPolling, stopPolling } from './polling/scheduler.js';

export function startFleetGraph(): void {
  if (process.env.FLEETGRAPH_ENABLED !== 'true') {
    console.log('[FleetGraph] Disabled (FLEETGRAPH_ENABLED != true)');
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[FleetGraph] ANTHROPIC_API_KEY not set, skipping startup');
    return;
  }

  console.log('[FleetGraph] Starting FleetGraph agent...');
  startPolling();

  // Graceful shutdown
  process.on('SIGTERM', () => {
    stopPolling();
  });
}

export { stopPolling as stopFleetGraph };
