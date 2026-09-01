/**
 * Run a scheduled job once, now.
 *
 * The inline queue adapter records recurring schedules and never fires them
 * (docs/14 §2): a timer running in every developer's terminal and every test
 * process would make behaviour depend on how long the process had been up,
 * which is the one thing a test cannot control for. So the sweep is triggered
 * by hand locally, and by the scheduler behind a distributed lock in
 * production once the Redis adapter exists.
 *
 *     pnpm --filter @financy/api job                 # list what is registered
 *     pnpm --filter @financy/api job approvals.sweep # run it
 *
 * It boots the whole application rather than reaching into the database
 * directly, because the job's handler is registered by a module and its
 * behaviour — the tenant context, the audit actor, the notifications it
 * enqueues — is the behaviour that runs in production. A script that
 * reimplemented the sweep would be testing a second implementation of it.
 */

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import { QUEUE_PORT, type InlineQueueAdapter, type JobName } from '../platform/queue/index.js';

async function main(): Promise<void> {
  const requested = process.argv[2];

  const app = await NestFactory.createApplicationContext(AppModule, {
    // The sweep logs what it found; the framework's boot chatter is noise
    // around it.
    logger: ['warn', 'error'],
  });

  try {
    const queue = app.get<InlineQueueAdapter>(QUEUE_PORT);
    const registered = queue.recurring;

    if (requested === undefined) {
      console.warn('Registered recurring jobs:');
      for (const entry of registered) {
        console.warn(`  ${entry.name.padEnd(28)} ${entry.cron}`);
      }
      console.warn('\nRun one with: pnpm --filter @financy/api job <name>');
      return;
    }

    if (!registered.some((entry) => entry.name === requested)) {
      throw new Error(
        `"${requested}" is not a registered recurring job. Registered: ${registered
          .map((entry) => entry.name)
          .join(', ')}`,
      );
    }

    const handle = await queue.trigger(requested as JobName);

    // Waiting matters: the process would otherwise exit while the job was
    // still running, and the inline adapter has nowhere to resume from.
    await queue.drain(120_000);

    console.warn(
      handle.deduplicated
        ? `${requested} has already run this minute (execution ${handle.id}).`
        : `${requested} finished (execution ${handle.id}).`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
