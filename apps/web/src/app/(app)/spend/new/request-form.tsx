'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  VERDICT_LABELS,
  type CategoryNode,
  type DepartmentNode,
  type EntitySummary,
  type ProjectRecord,
  type SimulationResult,
} from '@financy/contracts';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  FormMessage,
  Input,
  Money,
  Select,
  Textarea,
} from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { previewDecision } from '@/lib/policy-preview';
import { createAndSubmit, createDraft } from '../actions';

/**
 * The request form, with policy shown as it is filled in.
 *
 * ## The preview is debounced, not live on every keystroke
 *
 * Each preview is a round trip that reads the requester's department, tenure,
 * and spend history. Firing one per character would make typing an amount into
 * a five-digit box five evaluations, four of them about amounts nobody meant.
 * Half a second after the person stops is when the number is real.
 *
 * ## Two buttons, because they mean different things
 *
 * **Save as draft** parks it — nobody is asked for anything and nothing is
 * evaluated. **Submit** evaluates policy authoritatively and opens the chain.
 * A single button doing whichever seemed right is how somebody submits a
 * half-written request to their CFO.
 *
 * ## The preview is not a promise, and the copy says so
 *
 * The server re-reads everything at submission. An amount that previewed as
 * "no approval needed" can still need one if somebody else's spend moved a
 * budget in between — so the panel is headed with what *would* happen, not what
 * will.
 */
export function RequestForm({
  entities,
  departments,
  categories,
  projects,
  baseCurrency,
  defaultDepartmentId,
}: {
  entities: readonly EntitySummary[];
  departments: readonly DepartmentNode[];
  categories: readonly CategoryNode[];
  projects: readonly ProjectRecord[];
  baseCurrency: string;
  defaultDepartmentId: string | null;
}): React.JSX.Element {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const [draftState, draftAction, savingDraft] = useActionState(createDraft, IDLE);
  const [submitState, submitAction, submitting] = useActionState(createAndSubmit, IDLE);

  const [preview, setPreview] = useState<SimulationResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, startPreview] = useTransition();

  const activeEntities = entities.filter((entity) => entity.status === 'ACTIVE');
  const state = submitState.status === 'idle' ? draftState : submitState;

  // A successful save of either kind goes to the request. What was created is
  // the thing the person now wants to look at; returning them to the list to
  // hunt for it is a step that exists only because it was easier to write.
  useEffect(() => {
    if (state.status === 'success' && state.createdId !== undefined) {
      router.push(`/spend/${state.createdId}`);
    }
  }, [state, router]);

  /**
   * Re-evaluate half a second after the last change.
   *
   * Reading the form rather than mirroring every field into React state: the
   * form is already the source of truth for what will be submitted, and a
   * second copy of it in state is a second copy that disagrees.
   */
  function schedulePreview(): void {
    const form = formRef.current;
    if (form === null) return;

    const data = new FormData(form);
    const amount = read(data, 'amount');
    const entityId = read(data, 'entityId');

    if (amount === undefined || entityId === undefined) {
      setPreview(null);
      return;
    }

    startPreview(async () => {
      const response = await previewDecision({
        spendType: 'SPEND_REQUEST',
        amount,
        currency: (read(data, 'currency') ?? baseCurrency).toUpperCase(),
        entityId,
        departmentId: read(data, 'departmentId'),
        projectId: read(data, 'projectId'),
        categoryId: read(data, 'categoryId'),
        memo: read(data, 'memo'),
        neededBy: read(data, 'neededBy'),
      });

      setPreview(response.result);
      setPreviewError(response.error);
    });
  }

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onChange(): void {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(schedulePreview, 500);
  }

  useEffect(
    () => () => {
      // Cleared on unmount, so a preview scheduled a moment before the person
      // navigated away does not fire against a form that no longer exists.
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardBody>
          <form ref={formRef} onChange={onChange} className="flex flex-col gap-4">
            {state.status === 'error' && state.message !== undefined && (
              <FormMessage>{state.message}</FormMessage>
            )}

            <div className="grid grid-cols-[1fr_110px] gap-3">
              <Input
                name="amount"
                label="Amount"
                required
                inputMode="decimal"
                placeholder="1250.00"
                className="tabular text-right"
                error={state.fields?.['amount']?.[0]}
              />
              <Input
                name="currency"
                label="Currency"
                required
                defaultValue={baseCurrency}
                maxLength={3}
                className="uppercase"
                error={state.fields?.['currency']?.[0]}
              />
            </div>

            <Input
              name="purpose"
              label="What is this for"
              required
              maxLength={500}
              placeholder="Annual renewal of the design tooling licence"
              hint="One line. Approvers read this first and often only this."
              error={state.fields?.['purpose']?.[0]}
            />

            <Select
              name="entityId"
              label="Entity"
              required
              options={activeEntities.map((entity) => ({ value: entity.id, label: entity.name }))}
              defaultValue={activeEntities[0]?.id ?? ''}
              error={state.fields?.['entityId']?.[0]}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                name="departmentId"
                label="Department"
                options={[
                  { value: '', label: 'None' },
                  ...departments.map((department) => ({
                    value: department.id,
                    label: `${'— '.repeat(department.depth)}${department.name}`,
                  })),
                ]}
                defaultValue={defaultDepartmentId ?? ''}
                hint="Yours by default. Policy often routes by department."
                error={state.fields?.['departmentId']?.[0]}
              />

              <Select
                name="categoryId"
                label="Category"
                options={[
                  { value: '', label: 'None' },
                  ...categories.map((category) => ({
                    value: category.id,
                    label: `${'— '.repeat(category.depth)}${category.name}`,
                  })),
                ]}
                defaultValue=""
                error={state.fields?.['categoryId']?.[0]}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {projects.length > 0 && (
                <Select
                  name="projectId"
                  label="Project"
                  options={[
                    { value: '', label: 'None' },
                    ...projects
                      .filter(
                        (project) => project.status === 'ACTIVE' && project.archivedAt === null,
                      )
                      .map((project) => ({ value: project.id, label: project.name })),
                  ]}
                  defaultValue=""
                  error={state.fields?.['projectId']?.[0]}
                />
              )}

              <Input
                name="neededBy"
                label="Needed by"
                type="date"
                hint="A calendar day, not a deadline the system enforces."
                error={state.fields?.['neededBy']?.[0]}
              />
            </div>

            <Textarea
              name="memo"
              label="Anything else an approver should know"
              rows={3}
              maxLength={2000}
              hint="Some policies require this, and say so in the panel beside."
              error={state.fields?.['memo']?.[0]}
            />

            <div className="mt-1 flex items-center justify-end gap-2">
              <Button type="submit" formAction={draftAction} loading={savingDraft}>
                Save as draft
              </Button>
              <Button
                type="submit"
                variant="primary"
                formAction={submitAction}
                loading={submitting}
              >
                Submit
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <PreviewPanel preview={preview} error={previewError} pending={previewing} />
    </div>
  );
}

function PreviewPanel({
  preview,
  error,
  pending,
}: {
  preview: SimulationResult | null;
  error: string | null;
  pending: boolean;
}): React.JSX.Element {
  return (
    <Card className="self-start">
      <CardHeader
        title="What would happen"
        description="Policy is evaluated again at submission. This is a preview, not a promise."
      />

      <CardBody className="flex flex-col gap-3">
        {error !== null && <FormMessage>{error}</FormMessage>}

        {preview === null ? (
          <p className="py-4 text-[13px] text-ink-500">
            {pending
              ? 'Evaluating…'
              : 'Fill in an amount and an entity, and the decision appears here.'}
          </p>
        ) : (
          <Decision preview={preview} pending={pending} />
        )}
      </CardBody>
    </Card>
  );
}

function Decision({
  preview,
  pending,
}: {
  preview: SimulationResult;
  pending: boolean;
}): React.JSX.Element {
  const { decision } = preview;

  const tone =
    decision.verdict === 'BLOCKED'
      ? 'danger'
      : decision.verdict === 'ALLOWED_WITH_APPROVAL'
        ? 'warning'
        : 'success';

  return (
    <div className={pending ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
      <Badge tone={tone} dot>
        {VERDICT_LABELS[decision.verdict] ?? decision.verdict}
      </Badge>

      {decision.blocks.length > 0 && (
        <div className="mt-2.5 rounded-[var(--radius-sm)] border border-[var(--color-danger-border)] bg-[var(--color-danger-fill)] px-2.5 py-2">
          {decision.blocks.map((block) => (
            <p key={block.ruleId} className="text-[13px] text-[var(--color-danger-text)]">
              {block.message}
            </p>
          ))}
          <p className="mt-1.5 text-[12px] text-[var(--color-danger-text)] opacity-80">
            Submitting this will be refused. Change the request, or ask whoever owns the policy.
          </p>
        </div>
      )}

      {decision.requirements.approvalSteps.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
            Who has to agree
          </div>
          <ol className="flex flex-col gap-1">
            {decision.requirements.approvalSteps.map((step) => (
              <li
                key={step.sequence}
                className="flex items-baseline gap-2 text-[13px] text-ink-700"
              >
                <span className="tabular text-ink-400">{step.sequence}.</span>
                <span>
                  {step.approvers.length === 1
                    ? '1 approver'
                    : `${String(step.approvers.length)} approvers`}
                  {step.stepType !== 'SINGLE' && (
                    <span className="text-ink-400">
                      {' '}
                      · {step.stepType.replace('_', ' ').toLowerCase()}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {(decision.requirements.requireReceipt ||
        decision.requirements.requireMemo.required ||
        decision.requirements.requireFinanceReview) && (
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
            You will also need
          </div>
          <div className="flex flex-wrap gap-1.5">
            {decision.requirements.requireReceipt && <Badge tone="neutral">A receipt</Badge>}
            {decision.requirements.requireMemo.required && (
              <Badge tone="neutral">
                A memo of {decision.requirements.requireMemo.minLength}+ characters
              </Badge>
            )}
            {decision.requirements.requireFinanceReview && (
              <Badge tone="neutral">Finance review</Badge>
            )}
          </div>
        </div>
      )}

      {decision.verdict === 'ALLOWED' && decision.requirements.approvalSteps.length === 0 && (
        <p className="mt-2.5 text-[13px] text-ink-600">
          Nothing in policy applies to this. It will be approved on submission.
        </p>
      )}

      <p className="mt-3 border-t border-[var(--border-subtle)] pt-2 text-[12px] text-ink-400">
        Evaluated against{' '}
        <Money
          amount={preview.context.amountInBaseCurrency.amount}
          currency={preview.context.amountInBaseCurrency.currency}
        />{' '}
        · {preview.context.fiscalPeriod}
      </p>
    </div>
  );
}

/**
 * One field, or `undefined` for a blank one.
 *
 * Narrowed rather than stringified: `FormData.get` can return a `File`, and
 * `String(file)` is `[object Object]` — which would reach the API as a currency
 * code before anything noticed.
 */
function read(form: FormData, name: string): string | undefined {
  const value = form.get(name);

  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();

  return trimmed === '' ? undefined : trimmed;
}
