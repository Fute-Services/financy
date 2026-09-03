'use client';

import { useState, useTransition } from 'react';
import {
  SPEND_TYPE_LABELS,
  VERDICT_LABELS,
  type CategoryNode,
  type EntitySummary,
  type SimulationResult,
} from '@financy/contracts';
import { Badge, Button, Card, CardBody, CardHeader, FormMessage, Money } from '@financy/ui';

import { simulatePolicy } from '../actions';

/**
 * "What would this do?" — the panel beside the editor.
 *
 * It exists because the alternative is publishing to find out, and publishing
 * to find out is how an organisation discovers a mistake by blocking its own
 * payroll. It runs against the **draft** of this policy, alongside every other
 * live policy, because a rule tested in isolation passes and then loses to a
 * higher-priority policy nobody remembered.
 *
 * **The verdict is not the interesting part; the explanation is.** Anybody can
 * guess whether a €12,000 purchase needs approval. What they cannot guess is
 * *which rule* said so, which policies were even considered, and why the one
 * they just wrote did not fire — so the result lists every policy in scope with
 * a matched/not-matched marker, not just the ones that contributed.
 *
 * Nothing is created. No spend request, no approval chain, no audit of spend.
 */
export function Simulator({
  policyId,
  spendTypes,
  entities,
  categories,
  baseCurrency,
}: {
  policyId: string;
  spendTypes: readonly string[];
  entities: readonly EntitySummary[];
  categories: readonly CategoryNode[];
  baseCurrency: string;
}): React.JSX.Element {
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, startRunning] = useTransition();

  const active = entities.filter((entity) => entity.status === 'ACTIVE');

  const CONTROL =
    'h-8 w-full rounded-[var(--radius-sm)] border border-[var(--border-strong)] ' +
    'bg-[var(--surface-raised)] px-2 text-[13px] text-ink-800 focus:outline-none ' +
    'focus:ring-2 focus:ring-cobalt-500/30 focus:border-cobalt-500';

  function run(form: FormData): void {
    startRunning(async () => {
      const response = await simulatePolicy({
        policyId,
        spendType: read(form, 'spendType') ?? 'SPEND_REQUEST',
        amount: read(form, 'amount') ?? '0',
        currency: (read(form, 'currency') ?? baseCurrency).toUpperCase(),
        entityId: read(form, 'entityId') ?? '',
        categoryId: read(form, 'categoryId'),
        memo: read(form, 'memo'),
        hasReceipt: form.get('hasReceipt') === 'on',
      });

      setResult(response.result);
      setError(response.error);
    });
  }

  return (
    <Card>
      <CardHeader
        title="Simulate"
        description="Runs the draft against a hypothetical request. Nothing is created."
      />

      <CardBody className="flex flex-col gap-3">
        <form action={run} className="flex flex-col gap-2.5">
          <div className="grid grid-cols-[1fr_72px] gap-2">
            <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-600">
              Amount
              <input
                name="amount"
                defaultValue="5000.00"
                inputMode="decimal"
                required
                className={`${CONTROL} tabular text-right`}
              />
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-600">
              Currency
              <input
                name="currency"
                defaultValue={baseCurrency}
                maxLength={3}
                className={`${CONTROL} uppercase`}
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-600">
            Kind of spend
            <select
              name="spendType"
              className={CONTROL}
              defaultValue={spendTypes[0] ?? 'SPEND_REQUEST'}
            >
              {spendTypes.map((type) => (
                <option key={type} value={type}>
                  {SPEND_TYPE_LABELS[type] ?? type}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-600">
            Entity
            <select name="entityId" required className={CONTROL} defaultValue={active[0]?.id ?? ''}>
              {active.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-600">
            Category
            <select name="categoryId" className={CONTROL} defaultValue="">
              <option value="">Any</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {'— '.repeat(category.depth)}
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-600">
            Memo
            <input name="memo" placeholder="Optional" className={CONTROL} />
          </label>

          <label className="flex items-center gap-2 text-[12px] text-ink-600">
            <input type="checkbox" name="hasReceipt" className="size-3.5" />A receipt is attached
          </label>

          <Button type="submit" variant="primary" size="sm" loading={running}>
            Run simulation
          </Button>
        </form>

        {error !== null && <FormMessage>{error}</FormMessage>}

        {result !== null && <SimulationReport result={result} />}
      </CardBody>
    </Card>
  );
}

function SimulationReport({ result }: { result: SimulationResult }): React.JSX.Element {
  const { decision } = result;

  const tone =
    decision.verdict === 'BLOCKED'
      ? 'danger'
      : decision.verdict === 'ALLOWED_WITH_APPROVAL'
        ? 'warning'
        : 'success';

  return (
    <div className="flex flex-col gap-3 border-t border-[var(--border-subtle)] pt-3">
      <div className="flex items-center justify-between gap-2">
        <Badge tone={tone} dot>
          {VERDICT_LABELS[decision.verdict] ?? decision.verdict}
        </Badge>
        <span className="tabular text-[11px] text-ink-400">
          {decision.evaluation.durationMs} ms · engine {decision.evaluation.engineVersion}
        </span>
      </div>

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
        <Section title="Approval chain">
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

      <Section title="Also required">
        <ul className="flex flex-wrap gap-1.5">
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
              <span className="text-[13px] text-ink-400">Nothing beyond the chain above.</span>
            )}
        </ul>
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

      <Section title="Policies considered">
        <ul className="flex flex-col gap-1">
          {result.policiesConsidered.length === 0 ? (
            <li className="text-[13px] text-ink-400">
              None. Nothing is live for this kind of spend, so the organisation default applied.
            </li>
          ) : (
            result.policiesConsidered.map((policy) => (
              <li
                key={policy.policyVersionId}
                className="flex items-center justify-between gap-2 text-[13px]"
              >
                <span className="truncate text-ink-700">
                  {policy.name}
                  {policy.isDraft && <span className="ml-1.5 text-[11px] text-ink-400">draft</span>}
                </span>
                <span className="shrink-0">
                  {policy.matched ? (
                    <Badge tone="info">matched</Badge>
                  ) : (
                    <span className="text-[12px] text-ink-400">no match</span>
                  )}
                </span>
              </li>
            ))
          )}
        </ul>
      </Section>

      <Section title="Evaluated as">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
          <dt className="text-ink-500">Requester</dt>
          <dd className="text-ink-700">
            {result.context.requester.fullName} · {result.context.requester.roleKey}
          </dd>
          <dt className="text-ink-500">Base amount</dt>
          <dd className="text-ink-700">
            <Money
              amount={result.context.amountInBaseCurrency.amount}
              currency={result.context.amountInBaseCurrency.currency}
            />
          </dd>
          <dt className="text-ink-500">Fiscal period</dt>
          <dd className="tabular text-ink-700">{result.context.fiscalPeriod}</dd>
          <dt className="text-ink-500">Tenure</dt>
          <dd className="tabular text-ink-700">{result.context.requester.tenureDays} days</dd>
        </dl>
      </Section>
    </div>
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

/**
 * One text field, or `undefined` for a blank one.
 *
 * Narrowed rather than stringified: `FormData.get` can return a `File`, and
 * `String(file)` is `[object Object]` — a value that would travel all the way
 * to the API as a currency code before anything noticed.
 */
function read(form: FormData, name: string): string | undefined {
  const value = form.get(name);

  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();

  return trimmed === '' ? undefined : trimmed;
}
