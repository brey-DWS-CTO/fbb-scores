import { autoBenchQueue, deliverAutoBench, type AutoBenchMessage } from '../server/lib/autoBenchQueue.js';

// A private queue-triggered function, not a public cron or an Express route.
export default autoBenchQueue.handleNodeCallback<AutoBenchMessage>(async message => {
  await deliverAutoBench(message);
}, { retry: () => ({ acknowledge: true }) });
