export const NOTIFICATION_PROVIDER = Symbol('NotificationProvider');

/**
 * One message to one person, as a template key and its variables.
 *
 * **Never pre-rendered HTML from the domain** (docs/13 §8). A service that
 * built the markup would decide what an email looks like from inside the code
 * that decides what an approval means, and changing the wording would then be
 * a change to business logic. It also makes localisation impossible later
 * without rewriting every call site.
 */
export interface NotificationMessage {
  readonly organizationId: string;
  readonly to: string;
  readonly toName: string;
  readonly subject: string;
  readonly body: string;
  /** Where the recipient should be sent. Absolute, because it lands in mail. */
  readonly actionUrl?: string;
  readonly actionLabel?: string;
}

/**
 * How a message leaves the system (docs/13 §8).
 *
 * The port exists so the domain never learns whether mail is SMTP, an ESP, or
 * a console line in development — and so a test can assert "this person was
 * emailed" without a mail server.
 *
 * **`send` may throw, and the queue is what makes that survivable.** Delivery
 * always goes through a job (FR-NOT-003): a provider outage inside a request
 * would make approving a spend request fail because the *notification* failed,
 * which is the wrong thing to break.
 */
export interface NotificationProvider {
  readonly providerKey: string;
  readonly isSandbox: boolean;
  send(message: NotificationMessage): Promise<void>;
}
