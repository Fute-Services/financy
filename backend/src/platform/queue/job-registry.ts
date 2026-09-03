import { Injectable } from '@nestjs/common';

import type { JobName } from './job-catalogue.js';
import type { JobHandler } from './queue.port.js';

/**
 * Which handler runs which job.
 *
 * **A separate object from the queue adapter**, because the modules that
 * handle jobs (notifications, approvals) depend on the queue to enqueue and
 * the queue would then depend on them to execute — a cycle Nest resolves with
 * `forwardRef` and nobody can read afterwards. Handlers register themselves on
 * module init instead, so the dependency runs one way in both directions.
 *
 * **Registering twice is an error, not a replacement.** Two handlers for one
 * job means one of them silently never runs, and which one depends on module
 * initialisation order — a bug that appears when an unrelated import is added.
 */
@Injectable()
export class JobRegistry {
  private readonly handlers = new Map<JobName, JobHandler<JobName>>();

  register<T extends JobName>(name: T, handler: JobHandler<T>): void {
    if (this.handlers.has(name)) {
      throw new Error(
        `A handler for "${name}" is already registered. Two handlers for one job means one of them never runs.`,
      );
    }

    this.handlers.set(name, handler);
  }

  resolve(name: JobName): JobHandler<JobName> | undefined {
    return this.handlers.get(name);
  }

  get registered(): JobName[] {
    return [...this.handlers.keys()];
  }
}
