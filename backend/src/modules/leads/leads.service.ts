import type { CreateLead } from '@financy/contracts';
import { newId } from '@financy/core';
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { DatabaseService } from '../../platform/database/index.js';

/**
 * How long two submissions from the same address count as one.
 *
 * Ten minutes covers the double-click, the impatient second submit, and the
 * person who noticed a typo in their brief and sent it again — all of which
 * are one lead, not three, and all of which would otherwise reach a
 * salesperson as duplicates.
 *
 * It is deliberately short. A prospect who comes back in July after asking in
 * March is a genuinely new lead with new context, and collapsing those would
 * lose the second brief entirely.
 */
const DEDUPE_WINDOW_MS = 10 * 60 * 1000;

export interface LeadSubmission extends CreateLead {
  readonly source: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

/**
 * Demo requests from the public site.
 *
 * The shortest service in the application, and the one with the least
 * authority: it writes a row nobody in any organisation can read through the
 * API, and it returns nothing derived from what it wrote. There is no audit
 * record because there is no actor and no tenant — `AuditService` writes
 * inside an organisation's log, and a prospect is in none. The submission is
 * logged instead, where operations can see the volume.
 */
@Injectable()
export class LeadsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Record a submission.
   *
   * Returns nothing. The caller is anonymous, and every field handed back to
   * an anonymous writer is a field that distinguishes a stored submission from
   * a discarded one — which is the difference an enumeration script is looking
   * for.
   */
  async submit(input: LeadSubmission): Promise<void> {
    const now = new Date();

    // `Lead` is a global model, so the tenant extension passes these through
    // untouched (`GLOBAL_MODELS` in the db package). Using `database.client`
    // rather than `unscoped` is what keeps that a registry decision instead of
    // a bypass — if the model were ever reclassified as tenant-scoped, this
    // would start failing closed rather than silently writing unscoped rows.
    const recent = await this.database.client.lead.findFirst({
      where: {
        email: input.email,
        createdAt: { gt: new Date(now.getTime() - DEDUPE_WINDOW_MS) },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, handledAt: true },
    });

    if (recent !== null) {
      // Overwrite rather than ignore: the second submission is the one the
      // person meant to send. Except once somebody in sales has picked it up —
      // rewriting a lead under a colleague who is already reading it turns a
      // resubmission into a way to change what they see.
      if (recent.handledAt === null) {
        await this.database.client.lead.update({
          where: { id: recent.id },
          data: {
            name: input.name,
            company: input.company,
            teamSize: input.teamSize ?? null,
            brief: input.brief ?? null,
            source: input.source,
            ipAddress: input.ipAddress,
            userAgent: input.userAgent,
          },
        });
      }

      this.logger.info(
        { leadId: recent.id, source: input.source, deduped: true },
        'Demo request re-submitted within the dedupe window.',
      );

      return;
    }

    const created = await this.database.client.lead.create({
      data: {
        id: newId(),
        name: input.name,
        email: input.email,
        company: input.company,
        teamSize: input.teamSize ?? null,
        brief: input.brief ?? null,
        source: input.source,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      select: { id: true },
    });

    // The address is not logged. It is in the row for whoever follows the lead
    // up; putting it in a log line as well spreads a contact detail across a
    // retention policy written for diagnostics.
    this.logger.info({ leadId: created.id, source: input.source }, 'Demo request received.');
  }
}
