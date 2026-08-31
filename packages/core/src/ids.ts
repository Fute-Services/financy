/**
 * Identifiers.
 *
 * Three things matter here:
 *
 *  1. **UUID v7**, not v4. v7 embeds a millisecond timestamp in its high bits,
 *     so ids sort chronologically and index like a sequence — which keeps
 *     B-tree inserts at the right edge instead of scattering them across the
 *     index. v4's randomness causes page splits and cache churn on exactly the
 *     tables that grow fastest here (`transactions`, `audit_events`). v7
 *     retains 74 bits of entropy, so it is still not guessable (THR-03).
 *
 *  2. **Branded types.** A `string` for an organisation id and a `string` for a
 *     membership id are interchangeable to the compiler, and swapping them is
 *     a tenant-isolation bug that type-checks. Branding makes the swap a
 *     compile error.
 *
 *  3. **Web Crypto, not `node:crypto`.** This package is compiled into the
 *     browser bundle as well as the API — it is the shared domain layer, and
 *     `@financy/ui` and `@financy/contracts` both depend on it. A `node:`
 *     import here fails the Next.js build the moment anything reaches this
 *     module, which is a strange way to discover that a "framework-free"
 *     package was not portable. `globalThis.crypto` is standard in Node ≥ 19
 *     and in every browser, and it is a CSPRNG in both (THR-03).
 */

/**
 * Cryptographically secure random bytes.
 *
 * `Math.random` is banned by lint precisely because a call site like this one
 * is where it would do the most damage: these bytes become record ids that are
 * exposed in URLs.
 */
function randomBytes(length: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

/**
 * A `DataView` over the bytes, rather than indexing them directly.
 *
 * `noUncheckedIndexedAccess` types `bytes[6]` as `number | undefined`, so every
 * read would need a `?? 0` that can never fire — sixteen unreachable branches
 * in the one file that must stay at 100% coverage. `getUint8` returns a
 * `number`, so the guards are not needed and the coverage figure keeps meaning
 * something.
 */
function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** Format 16 bytes as `8-4-4-4-12`. */
function formatUuid(bytes: Uint8Array): string {
  const hex = toHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

declare const brand: unique symbol;

export type Branded<T, TBrand extends string> = T & { readonly [brand]: TBrand };

export type OrganizationId = Branded<string, 'OrganizationId'>;
export type UserId = Branded<string, 'UserId'>;
export type MembershipId = Branded<string, 'MembershipId'>;
export type RoleId = Branded<string, 'RoleId'>;
export type PermissionId = Branded<string, 'PermissionId'>;
export type EntityId = Branded<string, 'EntityId'>;
export type DepartmentId = Branded<string, 'DepartmentId'>;
export type ProjectId = Branded<string, 'ProjectId'>;
export type CategoryId = Branded<string, 'CategoryId'>;
export type SessionId = Branded<string, 'SessionId'>;
export type InvitationId = Branded<string, 'InvitationId'>;
export type PolicyId = Branded<string, 'PolicyId'>;
export type PolicyVersionId = Branded<string, 'PolicyVersionId'>;
export type PolicyRuleId = Branded<string, 'PolicyRuleId'>;
export type ApprovalInstanceId = Branded<string, 'ApprovalInstanceId'>;
export type ApprovalStepId = Branded<string, 'ApprovalStepId'>;
export type SpendRequestId = Branded<string, 'SpendRequestId'>;
export type CardId = Branded<string, 'CardId'>;
export type TransactionId = Branded<string, 'TransactionId'>;
export type ReceiptId = Branded<string, 'ReceiptId'>;
export type ExpenseId = Branded<string, 'ExpenseId'>;
export type ReimbursementId = Branded<string, 'ReimbursementId'>;
export type BudgetId = Branded<string, 'BudgetId'>;
export type BudgetLineId = Branded<string, 'BudgetLineId'>;
export type VendorId = Branded<string, 'VendorId'>;
export type BillId = Branded<string, 'BillId'>;
export type PurchaseOrderId = Branded<string, 'PurchaseOrderId'>;
export type AuditEventId = Branded<string, 'AuditEventId'>;
export type CorrelationId = Branded<string, 'CorrelationId'>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Monotonic counter so ids generated inside the same millisecond still order. */
let lastTimestamp = 0;
let sequence = 0;

/**
 * Generate a UUID v7.
 *
 * Layout (RFC 9562): 48-bit big-endian Unix millisecond timestamp, 4-bit
 * version (7), 12 bits of `rand_a` (used here as a monotonic counter so
 * same-millisecond ids remain ordered), 2-bit variant, 62 bits of `rand_b`.
 */
export function generateId(): string {
  const now = Date.now();

  if (now === lastTimestamp) {
    sequence = (sequence + 1) & 0xfff;
    // Counter exhausted within one millisecond (4096 ids). Spin to the next
    // millisecond rather than emitting a duplicate or an out-of-order id.
    /* c8 ignore next 4 */
    if (sequence === 0) {
      while (Date.now() === lastTimestamp) {
        /* busy-wait — at most 1 ms */
      }
      return generateId();
    }
  } else {
    lastTimestamp = now;
    sequence = viewOf(randomBytes(2)).getUint16(0) & 0xfff;
  }

  const bytes = randomBytes(16);
  const view = viewOf(bytes);

  // 48-bit big-endian millisecond timestamp, written as 16 + 32 bits because
  // `setUint32` cannot hold all 48 and JavaScript bitwise operators truncate
  // to 32 — `now << 8` would silently lose the top of the clock in 2038.
  view.setUint16(0, Math.floor(now / 2 ** 32));
  view.setUint32(2, now % 2 ** 32);

  // Version 7, then the 12-bit monotonic counter.
  view.setUint8(6, 0x70 | ((sequence >> 8) & 0x0f));
  view.setUint8(7, sequence & 0xff);

  // RFC 4122 variant, preserving the random low bits.
  view.setUint8(8, 0x80 | (view.getUint8(8) & 0x3f));

  return formatUuid(bytes);
}

/** Typed id generator: `newId<OrganizationId>()`. */
export function newId<T extends string = string>(): T {
  return generateId() as T;
}

export function isValidId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * Extract the creation timestamp embedded in a v7 id.
 * Returns `null` for a non-v7 uuid.
 */
export function idTimestamp(id: string): Date | null {
  if (!isValidId(id)) return null;
  const hex = id.replace(/-/g, '');
  if (hex[12] !== '7') return null;
  return new Date(Number.parseInt(hex.slice(0, 12), 16));
}

/**
 * Correlation id for request tracing.
 *
 * v4 is correct here — these are not stored or indexed, only propagated, so
 * there is nothing for v7's time ordering to help.
 *
 * Built from `getRandomValues` rather than `crypto.randomUUID()` because the
 * latter is unavailable in a browser outside a secure context. This module is
 * bundled for the browser, and a function that throws on `http://` in some
 * environments and not others is a worse trade than eight lines of bit
 * twiddling.
 */
export function newCorrelationId(): CorrelationId {
  const bytes = randomBytes(16);
  const view = viewOf(bytes);

  // Version 4, RFC 4122 variant.
  view.setUint8(6, 0x40 | (view.getUint8(6) & 0x0f));
  view.setUint8(8, 0x80 | (view.getUint8(8) & 0x3f));

  return formatUuid(bytes) as CorrelationId;
}

/**
 * Human-facing reference, e.g. `SR-2026-0042`.
 *
 * Separate from the primary key on purpose: a UUID is unreadable over the
 * phone, and a sequence exposed as a primary key leaks volume. References are
 * unique **within an organisation**, never globally.
 */
export function formatReference(prefix: string, year: number, sequenceNumber: number): string {
  return `${prefix}-${year}-${sequenceNumber.toString().padStart(4, '0')}`;
}
