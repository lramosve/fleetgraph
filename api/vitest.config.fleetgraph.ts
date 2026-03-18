import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/fleetgraph/**/*.test.ts'],
    // No setupFiles — FleetGraph unit tests use mocks, no DB required
  },
})
