import {
  AUDIT_EXPORT_COLUMNS,
  AUDIT_EXPORT_MAX_ROWS,
  type AuditEvent,
  type ExportAuditEventsQuery,
} from '@financy/contracts';
import { Injectable } from '@nestjs/common';

import { AuditService } from '../../platform/audit/index.js';
import { DatabaseService } from '../../platform/database/index.js';
import { AuditReadService } from './audit-read.service.js';

export interface AuditExport {
  readonly body: string;
  readonly contentType: string;
  readonly filename: string;
  readonly rowCount: number;
  readonly truncated: boolean;
}

/**
 * Exporting the audit trail — which is itself an audited act (task 1.6.2).
 *
 * **The export writes an audit event before it returns.** That is the whole
 * reason this is a separate service rather than a method on the reader: the
 * reader has no transaction and, deliberately, no writer injected into it.
 * Downloading an organisation's complete audit trail is one of the most
 * sensitive things a permission can allow — it is a copy of every privileged
 * action anyone has taken, leaving the system — and an export that left no
 * trace of itself would be the one gap in the record that mattered most.
 *
 * The event records the filters and the row count, not the rows. A copy of
 * the export inside the trail would double the trail on every download and
 * tell a reader nothing they could not get by running the same filters.
 */
@Injectable()
export class AuditExportService {
  constructor(
    private readonly database: DatabaseService,
    private readonly reader: AuditReadService,
    private readonly audit: AuditService,
  ) {}

  async export(query: ExportAuditEventsQuery): Promise<AuditExport> {
    const events = await this.reader.forExport(query);

    // Equal to the cap means the caller almost certainly wanted more, and
    // silently handing them a truncated file that looks complete is how an
    // auditor ends up with three weeks of a month.
    const truncated = events.length === AUDIT_EXPORT_MAX_ROWS;

    const body = query.format === 'json' ? toJson(events) : toCsv(events);

    await this.database.unscoped.$transaction(async (tx) => {
      await this.audit.record(tx, {
        action: 'audit_event.exported',
        resourceType: 'audit_event',
        metadata: {
          format: query.format,
          rowCount: events.length,
          truncated,
          // The filters, so a reader can tell a targeted export from a
          // wholesale one without re-running it.
          filters: {
            ...(query.action === undefined ? {} : { action: query.action }),
            ...(query.resourceType === undefined ? {} : { resourceType: query.resourceType }),
            ...(query.resourceId === undefined ? {} : { resourceId: query.resourceId }),
            ...(query.actorType === undefined ? {} : { actorType: query.actorType }),
            ...(query.actorMembershipId === undefined
              ? {}
              : { actorMembershipId: query.actorMembershipId }),
            ...(query.from === undefined ? {} : { from: query.from }),
            ...(query.before === undefined ? {} : { before: query.before }),
          },
        },
      });
    });

    return {
      body,
      rowCount: events.length,
      truncated,
      contentType: query.format === 'json' ? 'application/json' : 'text/csv; charset=utf-8',
      filename: `audit-${new Date().toISOString().slice(0, 10)}.${query.format}`,
    };
  }
}

function toJson(events: readonly AuditEvent[]): string {
  return JSON.stringify(events, null, 2);
}

/**
 * CSV, with the columns from the contract so the writer and any reader agree.
 *
 * `before`, `after`, and `metadata` are **not** columns. They are arbitrarily
 * nested JSON, and flattening them into a spreadsheet cell produces something
 * neither readable nor parseable; a caller who needs them asks for `json`,
 * which is why that format exists.
 */
function toCsv(events: readonly AuditEvent[]): string {
  const rows = events.map((event) =>
    AUDIT_EXPORT_COLUMNS.map((column) => escapeCsv(event[column])).join(','),
  );

  // CRLF, because that is what the CSV spec says and what Excel expects; a
  // bare LF file opens as one long row for a meaningful share of the people
  // who will actually open this.
  return [AUDIT_EXPORT_COLUMNS.join(','), ...rows].join('\r\n') + '\r\n';
}

/**
 * Quote a CSV field, and defuse the formula-injection class while doing it.
 *
 * A cell beginning `=`, `+`, `-`, or `@` is executed as a formula by Excel and
 * Sheets on open. Audit fields carry user-controlled text — an action name, an
 * actor label somebody chose — so an export is a document written by one
 * person and opened, trusted, by another. Prefixing a tab neutralises it while
 * leaving the value readable, which quoting alone does not.
 */
function escapeCsv(value: string | null): string {
  if (value === null) return '';

  const guarded = /^[=+\-@\t\r]/.test(value) ? `\t${value}` : value;

  return `"${guarded.replace(/"/g, '""')}"`;
}
