import { Global, Module } from '@nestjs/common';

import { ConfigService } from '../config/index.js';
import { DatabaseService } from '../database/index.js';
import { InlineQueueAdapter } from './inline-queue.adapter.js';
import { JobRegistry } from './job-registry.js';
import { QUEUE_PORT } from './queue.port.js';

import { PinoLogger } from 'nestjs-pino';

/**
 * The queue.
 *
 * Global, because every module that writes something worth telling somebody
 * about needs to enqueue, and threading an import of this through each of them
 * adds a line per module and prevents nothing.
 *
 * **Only the inline adapter exists today, and selecting anything else fails
 * loudly.** `REDIS_URL` is already required in production by the config schema
 * (ADR-0006), so a deployment that would need BullMQ cannot start without
 * saying so — but the adapter itself is not written yet, and a factory that
 * silently handed back the in-process one when Redis *was* configured would
 * turn "we have a broker" into "we have a broker nothing uses". The refusal
 * below is what keeps the gap visible.
 */
@Global()
@Module({
  providers: [
    JobRegistry,
    {
      provide: QUEUE_PORT,
      inject: [ConfigService, DatabaseService, JobRegistry, PinoLogger],
      useFactory: (
        config: ConfigService,
        database: DatabaseService,
        registry: JobRegistry,
        logger: PinoLogger,
      ): InlineQueueAdapter => {
        const redisUrl = config.get('REDIS_URL');

        if (redisUrl !== undefined && redisUrl !== '') {
          throw new Error(
            'REDIS_URL is set, but the BullMQ adapter is not implemented yet. ' +
              'Unset it to use the in-process queue, or implement BullMqQueueAdapter — ' +
              'running the inline adapter while a broker is configured would look like a working queue and lose every job on restart.',
          );
        }

        return new InlineQueueAdapter(database, registry, logger);
      },
    },
  ],
  exports: [QUEUE_PORT, JobRegistry],
})
export class QueueModule {}
