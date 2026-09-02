/**
 * The wording, in one place, for both channels.
 *
 * **One renderer, not one per channel.** The in-app title and the email
 * subject say the same thing about the same event; two copies drift, and the
 * drift is invisible because nobody reads both. What differs between channels
 * is length and the link, so the template returns a short form and a long one
 * and each channel takes what it needs.
 *
 * **Every string is a sentence somebody can act on.** "Approval required" is a
 * category; "Dana Ortiz needs your approval for €4,200 — office chairs" is a
 * notification. The difference decides whether the recipient has to open the
 * application to find out whether it matters.
 *
 * Amounts arrive **pre-formatted** from the caller. Formatting money means
 * knowing the currency's minor units, and a template that reached for
 * `toFixed(2)` would be wrong for JPY and KWD in opposite directions.
 */
export interface RenderedNotification {
  /** The in-app title and the email subject. One line, no full stop. */
  readonly title: string;
  /** The in-app body and the email's first paragraph. */
  readonly body: string;
  readonly actionLabel: string;
  /** Relative; the caller makes it absolute for mail. */
  readonly path: string;
}

export interface ApprovalRequestedVariables {
  requesterName: string;
  amount: string;
  purpose: string;
  reference: string;
  /** Where the notification points; the subject decides, not the template. */
  path: string;
  dueAt: string | null;
}

export interface ApprovalDecidedVariables {
  reference: string;
  purpose: string;
  amount: string;
  outcome: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED' | 'OVERRIDDEN';
  deciderName: string | null;
  comment: string | null;
  /** Where the notification points; the subject decides, not the template. */
  path: string;
}

export interface ApprovalReminderVariables {
  requesterName: string;
  amount: string;
  purpose: string;
  reference: string;
  /** Where the notification points; the subject decides, not the template. */
  path: string;
  waitingSince: string;
}

export interface ApprovalEscalatedVariables {
  requesterName: string;
  amount: string;
  purpose: string;
  reference: string;
  /** Where the notification points; the subject decides, not the template. */
  path: string;
  dueAt: string;
}

export interface BudgetThresholdVariables {
  budgetName: string;
  /** Whole percent, as the alert defines it — 75, 90, 100. */
  threshold: number;
  /** What the utilisation actually reached, which can exceed the threshold. */
  utilization: number;
  remaining: string;
  period: string;
  path: string;
}

export const templates = {
  approvalRequested(variables: ApprovalRequestedVariables): RenderedNotification {
    const due = variables.dueAt === null ? '' : ` It is due by ${formatDay(variables.dueAt)}.`;

    return {
      title: `${variables.requesterName} needs your approval for ${variables.amount}`,
      body: `${variables.reference} — ${variables.purpose}.${due}`,
      actionLabel: 'Review this request',
      path: variables.path,
    };
  },

  approvalDecided(variables: ApprovalDecidedVariables): RenderedNotification {
    const by = variables.deciderName === null ? '' : ` by ${variables.deciderName}`;
    const comment = variables.comment === null ? '' : ` They said: “${variables.comment}”`;

    // Each outcome gets its own sentence rather than one sentence with the
    // status interpolated. "Your request was CHANGES_REQUESTED" is a database
    // value in a person's inbox, and a returned request needs a different next
    // action from a rejected one.
    const wording: Record<ApprovalDecidedVariables['outcome'], { title: string; lead: string }> = {
      APPROVED: {
        title: `Your ${variables.amount} request was approved`,
        lead: `${variables.reference} — ${variables.purpose} — was approved${by}.`,
      },
      REJECTED: {
        title: `Your ${variables.amount} request was rejected`,
        lead: `${variables.reference} — ${variables.purpose} — was rejected${by}.`,
      },
      CHANGES_REQUESTED: {
        title: `Your ${variables.amount} request was sent back for changes`,
        lead: `${variables.reference} — ${variables.purpose} — was returned${by}. Edit it and submit it again; it will be evaluated against policy from scratch.`,
      },
      OVERRIDDEN: {
        title: `Your ${variables.amount} request was approved by override`,
        lead: `${variables.reference} — ${variables.purpose} — was settled${by} using a finance override rather than the usual approval chain.`,
      },
    };

    const chosen = wording[variables.outcome];

    return {
      title: chosen.title,
      body: `${chosen.lead}${comment}`,
      actionLabel: 'Open the request',
      path: variables.path,
    };
  },

  approvalEscalated(variables: ApprovalEscalatedVariables): RenderedNotification {
    return {
      // Says who it is now with and why it reached them. An escalation that
      // arrived reading like an ordinary approval request would leave the
      // recipient wondering why they, of all people, are being asked.
      title: `Escalated to you: ${variables.amount} for ${variables.requesterName}`,
      body: `${variables.reference} — ${variables.purpose} — passed its deadline of ${formatDay(variables.dueAt)} without a decision, so it has come to you as well.`,
      actionLabel: 'Review this request',
      path: variables.path,
    };
  },

  budgetThreshold(variables: BudgetThresholdVariables): RenderedNotification {
    // Over and approaching are different pieces of news and get different
    // sentences. "Design is at 100% of its budget" reads as a milestone; a
    // budget that is 14% overspent is a problem, and the title should say so
    // before anybody opens anything.
    const over = variables.utilization > 100;

    return {
      title: over
        ? `${variables.budgetName} is ${String(variables.utilization - 100)}% over budget`
        : `${variables.budgetName} has reached ${String(variables.threshold)}% of its budget`,
      body: over
        ? `${variables.period}: ${variables.remaining} remaining, against an allocation already committed and spent past its limit.`
        : `${variables.period}: ${variables.remaining} is left of the allocation.`,
      actionLabel: 'Open the budget',
      path: variables.path,
    };
  },

  approvalReminder(variables: ApprovalReminderVariables): RenderedNotification {
    return {
      title: `Still waiting on you: ${variables.amount} for ${variables.requesterName}`,
      body: `${variables.reference} — ${variables.purpose} — has been waiting since ${formatDay(variables.waitingSince)}.`,
      actionLabel: 'Review this request',
      path: variables.path,
    };
  },
} as const;

/**
 * A date somebody can read, in UTC.
 *
 * Not the organisation's timezone, and the difference is worth stating: a
 * per-organisation local rendering needs the timezone at the point of
 * rendering, which a job has and a test does not want to fake. "3 March" being
 * a day out for somebody in Auckland is a smaller problem than a deadline that
 * cannot be reproduced in a test, and the screen shows the exact timestamp.
 */
function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}
