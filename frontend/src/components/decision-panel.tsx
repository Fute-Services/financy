import { VERDICT_LABELS, type StoredPolicyDecision } from '@financy/contracts';
import { Badge, Card, CardBody, CardHeader } from '@financy/ui';

/**
 * Why this was decided the way it was.
 *
 * **The stored snapshot, never a recomputation.** The decision names the policy
 * versions and the rules it was made under, and it was made under the engine
 * version recorded in it. Re-evaluating against today's policies would answer a
 * different question — what would happen if this were raised now — and present
 * the answer as history. That is the failure this whole snapshot exists to
 * prevent, and it would be undone by one convenient `evaluate()` call here.
 *
 * The engine version is shown for the same reason it is recorded. If the merge
 * semantics ever change, a decision made under 1.0.0 is still interpretable —
 * and a reader can see which set of rules the words on this panel mean.
 */
export function DecisionPanel({
  decision,
}: {
  decision: StoredPolicyDecision | null;
}): React.JSX.Element {
  if (decision === null) {
    return (
      <Card className="self-start">
        <CardHeader title="Policy" />
        <CardBody>
          <p className="text-[13px] text-ink-500">
            Not evaluated yet. Policy runs at submission, and the decision it makes is recorded here
            verbatim.
          </p>
        </CardBody>
      </Card>
    );
  }

  const tone =
    decision.verdict === 'BLOCKED'
      ? 'danger'
      : decision.verdict === 'ALLOWED_WITH_APPROVAL'
        ? 'warning'
        : 'success';

  return (
    <Card className="self-start">
      <CardHeader
        title="Policy"
        description="The decision as it was made, not as it would be made today."
      />

      <CardBody className="flex flex-col gap-3">
        <Badge tone={tone} dot>
          {VERDICT_LABELS[decision.verdict] ?? decision.verdict}
        </Badge>

        {decision.blocks.length > 0 && (
          <div className="rounded-[var(--radius-sm)] border border-[var(--color-danger-border)] bg-[var(--color-danger-fill)] px-2.5 py-2">
            {decision.blocks.map((block) => (
              <p key={block.ruleId} className="text-[13px] text-[var(--color-danger-text)]">
                <span className="font-mono text-[11px] uppercase">{block.reasonCode}</span> —{' '}
                {block.message}
              </p>
            ))}
          </div>
        )}

        {decision.requirements.approvalSteps.length > 0 && (
          <Section title="Chain policy asked for">
            <ol className="flex flex-col gap-1">
              {decision.requirements.approvalSteps.map((step) => (
                <li
                  key={step.sequence}
                  className="flex items-baseline gap-2 text-[13px] text-ink-700"
                >
                  <span className="tabular text-ink-400">{step.sequence}.</span>
                  <span>
                    {step.stepType.replace('_', ' ').toLowerCase()} —{' '}
                    {step.approvers.length === 1
                      ? '1 approver'
                      : `${String(step.approvers.length)} approvers`}
                    {step.timeoutHours !== null && (
                      <span className="text-ink-400"> · {step.timeoutHours}h to act</span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </Section>
        )}

        <Section title="Requirements">
          <div className="flex flex-wrap gap-1.5">
            {decision.requirements.requireReceipt && <Badge tone="neutral">Receipt</Badge>}
            {decision.requirements.requireMemo.required && (
              <Badge tone="neutral">
                Memo, {decision.requirements.requireMemo.minLength}+ characters
              </Badge>
            )}
            {decision.requirements.requireFinanceReview && (
              <Badge tone="neutral">Finance review</Badge>
            )}
            {decision.requirements.validityDays !== null && (
              <Badge tone="neutral">Valid {decision.requirements.validityDays} days</Badge>
            )}
            {!decision.requirements.requireReceipt &&
              !decision.requirements.requireMemo.required &&
              !decision.requirements.requireFinanceReview &&
              decision.requirements.validityDays === null && (
                <span className="text-[13px] text-ink-400">None beyond the chain.</span>
              )}
          </div>
        </Section>

        {decision.exceptions.length > 0 && (
          <Section title="Flagged">
            <div className="flex flex-wrap gap-1.5">
              {decision.exceptions.map((exception) => (
                <Badge key={exception.ruleId} tone="warning">
                  {exception.exceptionCode}
                </Badge>
              ))}
            </div>
          </Section>
        )}

        <div className="border-t border-[var(--border-subtle)] pt-2 text-[12px] text-ink-400">
          <p>
            {decision.evaluation.matchedRuleIds.length === 0
              ? 'No rule matched — the organisation default applied.'
              : `${String(decision.evaluation.matchedRuleIds.length)} ${
                  decision.evaluation.matchedRuleIds.length === 1 ? 'rule' : 'rules'
                } matched across ${String(decision.evaluation.policyVersionIds.length)} ${
                  decision.evaluation.policyVersionIds.length === 1 ? 'policy' : 'policies'
                }.`}
          </p>
          <p className="mt-0.5">
            Engine {decision.evaluation.engineVersion} ·{' '}
            <time dateTime={decision.evaluation.evaluatedAt}>
              {formatDateTime(decision.evaluation.evaluatedAt)}
            </time>
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
        {title}
      </div>
      {children}
    </div>
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}
