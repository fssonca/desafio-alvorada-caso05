export { createSyncService } from './application/sync-service.js';
export type {
  Note,
  Operation,
  Receipt,
  OperationResult,
  SyncService,
  ValidationError,
} from './application/contracts.js';
export { createSimulatedClient, createIdGenerator } from './client/simulated-client.js';
export type { SimulatedClient, SimulatedClientOptions } from './client/simulated-client.js';
