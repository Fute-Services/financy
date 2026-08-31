import type { IncomingMessage, ServerResponse } from 'node:http';

import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { ConfigService } from '../config/index.js';
import { getContext } from '../request-context/index.js';
import { REDACTED_PATHS, REDACTION_PLACEHOLDER } from './redaction.js';

/**
 * Structured logging (docs/07 §5).
 *
 * JSON by default, because logs are read by an aggregator far more often than
 * by a person, and a human-readable format that a machine cannot parse means
 * the machine gets nothing. `LOG_PRETTY` exists for the terminal and is
 * rejected outright in production by the config schema.
 *
 * Every line carries the correlation id from the request context, which is
 * what makes a log searchable by the identifier the user was given in their
 * error envelope.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL'),

          ...(config.get('LOG_PRETTY')
            ? {
                transport: {
                  target: 'pino-pretty',
                  options: { singleLine: true, translateTime: 'HH:MM:ss.l' },
                },
              }
            : {}),

          redact: { paths: [...REDACTED_PATHS], censor: REDACTION_PLACEHOLDER },

          /**
           * Correlate every line with the request that produced it. Read from
           * the async context rather than from the request object so that a
           * line emitted deep inside a service — where there is no `req` —
           * carries it too.
           */
          customProps: () => {
            const context = getContext();
            return context === undefined
              ? {}
              : {
                  correlationId: context.correlationId,
                  ...(context.organizationId ? { organizationId: context.organizationId } : {}),
                  ...(context.membershipId ? { membershipId: context.membershipId } : {}),
                };
          },

          /**
           * Explicit serialisers. Pino's defaults log every header, which is
           * how an `Authorization` value ends up searchable in an aggregator
           * despite the redaction list above not naming a header someone
           * introduced last week.
           */
          serializers: {
            req: (request: IncomingMessage) => ({
              method: request.method,
              // Query strings carry filters, and filters carry search terms.
              // The path is enough to know which endpoint was called.
              path: (request.url ?? '').split('?')[0],
              userAgent: request.headers['user-agent'],
            }),
            res: (response: ServerResponse) => ({ statusCode: response.statusCode }),
          },

          /**
           * Health probes run every few seconds forever. Logging them buries
           * everything else and costs real money in an ingest-priced log
           * service, and a failing probe is visible from the readiness
           * endpoint's own status rather than from its access log.
           */
          autoLogging: {
            ignore: (request: IncomingMessage) => request.url?.startsWith('/v1/health') === true,
          },

          /**
           * A 4xx is the caller's problem and a 5xx is ours. Logging both at
           * `error` trains everyone to ignore the level.
           */
          customLogLevel: (_request: IncomingMessage, response: ServerResponse, error?: Error) => {
            if (error !== undefined || response.statusCode >= 500) return 'error';
            if (response.statusCode >= 400) return 'warn';
            return 'info';
          },
        },
      }),
    }),
  ],
  exports: [LoggerModule],
})
export class LoggingModule {}
