import { createTransport, type Transporter } from 'nodemailer';

import type { NotificationMessage, NotificationProvider } from './notification-provider.js';

/**
 * SMTP delivery (docs/13 §8).
 *
 * ## Plain text, and that is a decision rather than a shortcut
 *
 * Every message this system sends is a sentence and a link. HTML mail would
 * add a rendering pipeline, a set of clients to test against, and a second
 * copy of every string that can drift from the first — for a paragraph. When
 * something here needs a table, that is the moment to add HTML, and not
 * before.
 *
 * ## The connection is made once and reused
 *
 * A transport per message opens a TCP connection and a TLS handshake per
 * notification, which is slow under a burst and looks like a small denial of
 * service to the mail host.
 *
 * ## Failure is loud
 *
 * `send` rejects, and the job that called it retries with backoff and
 * eventually dead-letters. Swallowing the error here would produce a
 * notification the record says was delivered and nobody received — which is
 * exactly what `channelsDelivered` exists to prevent.
 */
export class SmtpNotificationProvider implements NotificationProvider {
  readonly providerKey = 'smtp';
  readonly isSandbox: boolean;

  private readonly transport: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
    /**
     * Whether this is a local catcher (Mailpit, MailHog) rather than a real
     * mail host. Derived from the URL rather than configured separately: an
     * operator who has to remember to set a second flag will not, and a
     * staging environment that reported itself as production mail would let a
     * test message look like it reached a customer.
     */
    isSandbox?: boolean,
  ) {
    this.transport = createTransport(smtpUrl);
    this.isSandbox = isSandbox ?? isLocalMailCatcher(smtpUrl);
  }

  async send(message: NotificationMessage): Promise<void> {
    const lines = [message.body];

    if (message.actionUrl !== undefined) {
      lines.push('', `${message.actionLabel ?? 'Open'}: ${message.actionUrl}`);
    }

    await this.transport.sendMail({
      from: this.from,
      to: `${message.toName} <${message.to}>`,
      subject: message.subject,
      text: lines.join('\n'),
    });
  }
}

function isLocalMailCatcher(smtpUrl: string): boolean {
  try {
    const host = new URL(smtpUrl).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === 'mailpit' || host === 'mailhog';
  } catch {
    // An unparseable URL is not evidence of production. `createTransport` will
    // fail on it in a moment and say so more usefully than this would.
    return true;
  }
}
