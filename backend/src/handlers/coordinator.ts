import type { ScheduledHandler } from 'aws-lambda';
import { logger } from '../logger.js';

/**
 * Phase 1 scaffold only. Fetching match data from GitHub, computing due
 * actions, and claiming/processing scheduled actions land in Phase 2-4.
 * This stub exists so the EventBridge Scheduler -> Lambda wiring can be
 * deployed and verified independently of that business logic.
 */
export const handler: ScheduledHandler = async () => {
  logger.info('daily coordinator invoked (not yet implemented)');
};
