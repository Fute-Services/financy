/**
 * What never reaches a log line.
 *
 * A log aggregator is a searchable, widely-readable, long-retained copy of
 * whatever the application prints. Anything on this list would turn it into a
 * credential store or a copy of the personal data the product is trusted with
 * — and unlike a database, nobody deletes a log because a user asked.
 *
 * Redaction is deny-by-path here and belt-and-braces elsewhere: the logger
 * also serialises only the request and response fields it is explicitly told
 * about, so a header added tomorrow is not logged merely because nobody
 * thought to add it to this list.
 */
export const REDACTED_PATHS: readonly string[] = [
  // Credentials in transit
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  'req.headers["x-api-key"]',
  'req.headers["idempotency-key"]',

  // Credentials in bodies. Bodies are not logged by default; these hold if
  // someone enables body logging while debugging and forgets to turn it off.
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.passwordHash',
  '*.token',
  '*.tokenHash',
  '*.refreshToken',
  '*.secret',
  '*.mfaSecret',
  '*.totpCode',
  '*.apiKey',
  '*.accessKeyId',
  '*.secretAccessKey',

  // Card and bank data. The product stores no PAN or CVV at all (docs/09
  // §6.4); these exist so a provider payload echoed into a log cannot leak.
  '*.pan',
  '*.cvv',
  '*.cardNumber',
  '*.bankDetails',
  '*.bankDetailsEncrypted',
  '*.iban',
  '*.accountNumber',
  '*.routingNumber',
];

export const REDACTION_PLACEHOLDER = '[redacted]';
