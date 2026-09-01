import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import type { NotificationMessage, NotificationProvider } from './notification-provider.js';

/**
 * The development adapter: it writes the mail to the log.
 *
 * **`isSandbox` is `true` and that value travels** (docs/13 §3). A screen that
 * says "we emailed them" when the only thing that happened was a log line is
 * the specific dishonesty the sandbox flag exists to prevent — the session
 * response already carries `isSandbox` for the card provider, and this joins
 * it.
 *
 * The recipient's address is logged because this is a local development tool
 * and the address is the useful part; production runs SMTP, where the logger's
 * redaction rules apply to the request path instead.
 */
@Injectable()
export class ConsoleNotificationProvider implements NotificationProvider {
  readonly providerKey = 'console';
  readonly isSandbox = true;

  constructor(private readonly logger: PinoLogger) {}

  send(message: NotificationMessage): Promise<void> {
    this.logger.info(
      {
        provider: this.providerKey,
        to: message.to,
        subject: message.subject,
        organizationId: message.organizationId,
        ...(message.actionUrl === undefined ? {} : { actionUrl: message.actionUrl }),
      },
      `[mail] ${message.subject} → ${message.to}`,
    );

    return Promise.resolve();
  }
}
