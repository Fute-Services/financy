import { Module } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { ConfigService } from '../../platform/config/index.js';
import { ConsoleNotificationProvider } from './console-notification-provider.js';
import { NOTIFICATION_PROVIDER, type NotificationProvider } from './notification-provider.js';
import { NotificationJobs } from './notification-jobs.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { SmtpNotificationProvider } from './smtp-notification-provider.js';

/**
 * Notifications (epic 2.5).
 *
 * The provider is chosen by configuration, and the choice is validated at
 * startup rather than at the first send: `NOTIFICATION_PROVIDER=smtp` without
 * an `SMTP_URL` already fails the config schema, so the factory below cannot
 * be reached in a state where it would have to guess. A mail configuration
 * that turns out to be wrong when the first approval is raised is a
 * configuration nobody will connect to the cause.
 */
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationJobs,
    {
      provide: NOTIFICATION_PROVIDER,
      inject: [ConfigService, PinoLogger],
      useFactory: (config: ConfigService, logger: PinoLogger): NotificationProvider => {
        if (config.get('NOTIFICATION_PROVIDER') === 'smtp') {
          const smtpUrl = config.get('SMTP_URL');

          /* c8 ignore next 3 -- the config schema refuses this combination. */
          if (smtpUrl === undefined) {
            throw new Error('NOTIFICATION_PROVIDER=smtp requires SMTP_URL.');
          }

          return new SmtpNotificationProvider(smtpUrl, config.get('MAIL_FROM'));
        }

        return new ConsoleNotificationProvider(logger);
      },
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
