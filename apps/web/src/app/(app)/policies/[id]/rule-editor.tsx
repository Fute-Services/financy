'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  GROUP_OPERATOR_LABELS,
  OPERATOR_LABELS,
  OUTCOME_LABELS,
  POLICY_FIELD_LABELS,
  ROLE_KEYS,
  ROLE_LABELS,
  permissionsForRole,
  SPEND_TYPE_LABELS,
  STEP_TYPE_LABELS,
  APPROVER_KIND_LABELS,
  type CategoryNode,
  type DepartmentNode,
  type EntitySummary,
  type PolicyDetail,
} from '@financy/contracts';
import {
  APPROVER_SCOPES,
  BOOLEAN_FIELDS,
  MONEY_FIELDS,
  NUMBER_FIELDS,
  PATH_FIELDS,
  SPEND_TYPES,
  STEP_TYPES,
  STRING_FIELDS,
  operatorsForField,
  valueKindsFor,
  type ComparisonOperator,
  type PolicyField,
} from '@financy/core';
import { Button, Card, CardBody, CardHeader, FormMessage } from '@financy/ui';

import { savePolicyRules } from '../actions';

/**
 * The rule builder (task 2.6).
 *
 * ## Why this is a form and not a text editor
 *
 * A rule expressed as JSON or an expression language is a rule only an engineer
 * can write, and the people who own spending policy are not engineers. More
 * importantly, free text can express a rule that cannot fire — a misspelled
 * field, an operator that does not belong to a type — and **a rule that cannot
 * fire is worse than a rule that is wrong**: nothing errors, nothing is logged,
 * and the spend it was written to control simply goes through. Every control
 * here is populated from the closed field set and the operator tables in
 * `@financy/core`, so the unfireable rule is not expressible rather than merely
 * rejected.
 *
 * That is also why ids are picked from lists wherever the data is on hand. A
 * department typed as an id is a typo away from a rule that matches nobody and
 * looks completely healthy.
 *
 * ## Sequence is position, not a field
 *
 * Rules are ordered by their place in the list, and the sequence numbers are
 * assigned from that on save. Exposing the number as an editable field is how
 * two rules end up sharing one — which the API refuses, correctly, and which
 * would have been an error message rather than a thing that cannot happen.
 *
 * ## Saving is explicit, and saving is not publishing
 *
 * There is no autosave. A half-written rule set saved on every keystroke would
 * mean the draft is briefly incoherent all the time, and the person who then
 * pressed Publish would be publishing whatever the last keystroke left behind.
 * Saving writes the draft; the draft decides nothing until it is published.
 */

type EditableRule = PolicyDetail['rules'][number];
type Outcome = EditableRule['outcomes'][number];

/** Local, mutable mirrors of the wire types. The contract's are deeply readonly. */
interface Comparison {
  type: 'COMPARISON';
  field: PolicyField;
  operator: ComparisonOperator;
  value: PolicyValue;
}

interface Group {
  type: 'GROUP';
  operator: 'ALL' | 'ANY' | 'NONE';
  conditions: EditCondition[];
}

type EditCondition = Comparison | Group;

type PolicyValue =
  | { kind: 'money'; amount: string; currency: string }
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'strings'; value: string[] }
  | {
      kind: 'moneyRange';
      from: { amount: string; currency: string };
      to: { amount: string; currency: string };
    }
  | { kind: 'numberRange'; from: number; to: number }
  | { kind: 'none' };

interface EditRule {
  /** Present on a rule that has been stored. Absent on one created here. */
  id?: string;
  /** Stable across renders so React keys survive a reorder. */
  key: string;
  name: string;
  condition: Group;
  outcomes: Outcome[];
  terminal: boolean;
}

/**
 * The roles a step may name, which is not all of them.
 *
 * `ORG_ADMIN` and `AUDITOR` do not hold `approval:act` — administering people
 * and structure is separate from approving spend (docs/03 §2.1) — so a rule
 * naming either resolves to a step nobody can complete. The API raises
 * `UNRESOLVABLE_APPROVER` at submission, which is legible but late: the policy
 * author has gone, and the person who finds out is the requester whose money
 * is stuck.
 *
 * Filtering here is the same principle as the closed field set: the builder
 * should not be able to express a rule that cannot fire.
 */
const APPROVING_ROLES = ROLE_KEYS.filter((key) => permissionsForRole(key).has('approval:act'));

const CONTROL =
  'h-8 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-raised)] ' +
  'px-2 text-[13px] text-ink-800 focus:outline-none focus:ring-2 focus:ring-cobalt-500/30 ' +
  'focus:border-cobalt-500 disabled:bg-ink-50 disabled:text-ink-400';

const FIELD_GROUPS: ReadonlyArray<{ label: string; fields: readonly string[] }> = [
  { label: 'Amount', fields: MONEY_FIELDS },
  { label: 'Numbers', fields: NUMBER_FIELDS },
  { label: 'Identity and classification', fields: STRING_FIELDS },
  { label: 'Trees', fields: PATH_FIELDS },
  { label: 'Yes or no', fields: BOOLEAN_FIELDS },
];

export function RuleEditor({
  policyId,
  initialRules,
  baseCurrency,
  departments,
  categories,
  entities,
  readOnly,
}: {
  policyId: string;
  initialRules: readonly EditableRule[];
  baseCurrency: string;
  departments: readonly DepartmentNode[];
  categories: readonly CategoryNode[];
  entities: readonly EntitySummary[];
  readOnly: boolean;
}): React.JSX.Element {
  const [rules, setRules] = useState<EditRule[]>(() =>
    initialRules.map((rule, index) => fromWire(rule, index)),
  );
  const [message, setMessage] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, startSaving] = useTransition();

  const lookups = useMemo(
    () => ({ baseCurrency, departments, categories, entities }),
    [baseCurrency, departments, categories, entities],
  );

  function mutate(next: EditRule[]): void {
    setRules(next);
    setDirty(true);
    setMessage(null);
  }

  function updateRule(index: number, patch: Partial<EditRule>): void {
    mutate(rules.map((rule, position) => (position === index ? { ...rule, ...patch } : rule)));
  }

  function addRule(): void {
    mutate([
      ...rules,
      {
        key: newKey(),
        name: `Rule ${String(rules.length + 1)}`,
        // A new rule starts with one comparison rather than none. An empty
        // `ALL` group matches everything, which is a rule that fires on every
        // request — not a neutral starting point.
        condition: {
          type: 'GROUP',
          operator: 'ALL',
          conditions: [defaultComparison(baseCurrency)],
        },
        outcomes: [{ type: 'REQUIRE_RECEIPT' }] as Outcome[],
        terminal: false,
      },
    ]);
  }

  function move(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= rules.length) return;

    const next = [...rules];
    const [moved] = next.splice(index, 1);
    if (moved !== undefined) next.splice(target, 0, moved);
    mutate(next);
  }

  function save(): void {
    const problem = firstProblem(rules);

    if (problem !== null) {
      setMessage({ tone: 'danger', text: problem });
      return;
    }

    startSaving(async () => {
      // Sequence comes from position, so the numbers are dense and unique by
      // construction — see the note at the top of this file.
      const payload = rules.map((rule, index) => ({
        ...(rule.id === undefined ? {} : { id: rule.id }),
        name: rule.name,
        sequence: index + 1,
        condition: rule.condition,
        outcomes: rule.outcomes,
        terminal: rule.terminal,
      }));

      const state = await savePolicyRules(policyId, payload);

      if (state.status === 'success') {
        setDirty(false);
        setMessage({ tone: 'success', text: state.message ?? 'Draft saved.' });
        return;
      }

      setMessage({
        tone: 'danger',
        text: state.message ?? 'The draft could not be saved.',
      });
    });
  }

  return (
    <Card>
      <CardHeader
        title="Rules"
        description="Evaluated top to bottom. The first block, or a terminal rule, stops everything."
        action={
          readOnly ? undefined : (
            <div className="flex items-center gap-2">
              {dirty && <span className="text-[12px] text-ink-500">Unsaved</span>}
              <Button size="sm" onClick={addRule}>
                Add rule
              </Button>
              <Button size="sm" variant="primary" loading={saving} onClick={save} disabled={!dirty}>
                Save draft
              </Button>
            </div>
          )
        }
      />

      <CardBody className="flex flex-col gap-3">
        {message !== null && <FormMessage tone={message.tone}>{message.text}</FormMessage>}

        {rules.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-500">
            No rules yet. A policy with no rules matches nothing and decides nothing.
          </p>
        ) : (
          rules.map((rule, index) => (
            <RuleCard
              key={rule.key}
              rule={rule}
              position={index}
              total={rules.length}
              readOnly={readOnly}
              lookups={lookups}
              onChange={(patch) => updateRule(index, patch)}
              onRemove={() => mutate(rules.filter((_, position) => position !== index))}
              onMove={(direction) => move(index, direction)}
            />
          ))
        )}
      </CardBody>
    </Card>
  );
}

interface Lookups {
  baseCurrency: string;
  departments: readonly DepartmentNode[];
  categories: readonly CategoryNode[];
  entities: readonly EntitySummary[];
}

function RuleCard({
  rule,
  position,
  total,
  readOnly,
  lookups,
  onChange,
  onRemove,
  onMove,
}: {
  rule: EditRule;
  position: number;
  total: number;
  readOnly: boolean;
  lookups: Lookups;
  onChange: (patch: Partial<EditRule>) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}): React.JSX.Element {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-raised)]">
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
        <span className="tabular w-6 shrink-0 text-[12px] text-ink-400">{position + 1}</span>

        <input
          value={rule.name}
          onChange={(event) => onChange({ name: event.target.value })}
          disabled={readOnly}
          aria-label={`Name of rule ${String(position + 1)}`}
          maxLength={200}
          className={`${CONTROL} min-w-0 flex-1 font-medium`}
        />

        <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-ink-600">
          <input
            type="checkbox"
            checked={rule.terminal}
            onChange={(event) => onChange({ terminal: event.target.checked })}
            disabled={readOnly}
            className="size-3.5"
          />
          <span title="Stops evaluation entirely — no later rule in any policy runs.">
            Terminal
          </span>
        </label>

        {!readOnly && (
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onMove(-1)}
              disabled={position === 0}
              aria-label="Move rule earlier"
            >
              ↑
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onMove(1)}
              disabled={position === total - 1}
              aria-label="Move rule later"
            >
              ↓
            </Button>
            <Button size="sm" variant="ghost" onClick={onRemove} aria-label="Remove rule">
              ✕
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 px-3 py-3">
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
            When
          </div>
          <GroupEditor
            group={rule.condition}
            depth={0}
            readOnly={readOnly}
            lookups={lookups}
            onChange={(condition) => onChange({ condition })}
          />
        </div>

        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
            Then
          </div>
          <OutcomesEditor
            outcomes={rule.outcomes}
            readOnly={readOnly}
            onChange={(outcomes) => onChange({ outcomes })}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * A condition group.
 *
 * Nesting is capped at two levels here against the model's three, and the cap
 * is a usability judgement rather than a technical one: a three-deep boolean
 * expression rendered as nested boxes is a thing nobody can read back, and a
 * rule its author cannot read back is a rule nobody checks.
 */
function GroupEditor({
  group,
  depth,
  readOnly,
  lookups,
  onChange,
}: {
  group: Group;
  depth: number;
  readOnly: boolean;
  lookups: Lookups;
  onChange: (group: Group) => void;
}): React.JSX.Element {
  function replaceChild(index: number, child: EditCondition): void {
    onChange({
      ...group,
      conditions: group.conditions.map((existing, position) =>
        position === index ? child : existing,
      ),
    });
  }

  return (
    <div
      className={
        depth === 0
          ? 'flex flex-col gap-1.5'
          : 'flex flex-col gap-1.5 rounded-[var(--radius-sm)] border border-dashed border-[var(--border-strong)] p-2'
      }
    >
      <div className="flex items-center gap-2">
        <select
          value={group.operator}
          onChange={(event) =>
            onChange({ ...group, operator: event.target.value as Group['operator'] })
          }
          disabled={readOnly}
          aria-label="How these conditions combine"
          className={`${CONTROL} w-[150px]`}
        >
          {Object.entries(GROUP_OPERATOR_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <span className="text-[12px] text-ink-400">
          {group.conditions.length === 1
            ? '1 condition'
            : `${String(group.conditions.length)} conditions`}
        </span>
      </div>

      {group.conditions.map((condition, index) => (
        <div key={index} className="flex items-start gap-1.5">
          <div className="min-w-0 flex-1">
            {condition.type === 'COMPARISON' ? (
              <ComparisonEditor
                comparison={condition}
                readOnly={readOnly}
                lookups={lookups}
                onChange={(next) => replaceChild(index, next)}
              />
            ) : (
              <GroupEditor
                group={condition}
                depth={depth + 1}
                readOnly={readOnly}
                lookups={lookups}
                onChange={(next) => replaceChild(index, next)}
              />
            )}
          </div>

          {!readOnly && group.conditions.length > 1 && (
            <Button
              size="sm"
              variant="ghost"
              aria-label="Remove condition"
              onClick={() =>
                onChange({
                  ...group,
                  conditions: group.conditions.filter((_, position) => position !== index),
                })
              }
            >
              ✕
            </Button>
          )}
        </div>
      ))}

      {!readOnly && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              onChange({
                ...group,
                conditions: [...group.conditions, defaultComparison(lookups.baseCurrency)],
              })
            }
          >
            + Condition
          </Button>
          {depth === 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                onChange({
                  ...group,
                  conditions: [
                    ...group.conditions,
                    {
                      type: 'GROUP',
                      operator: 'ANY',
                      conditions: [defaultComparison(lookups.baseCurrency)],
                    },
                  ],
                })
              }
            >
              + Group
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One comparison, laid out as a sentence: field · operator · value.
 *
 * Changing the field re-derives the operator and the value, because the old
 * ones may not be legal on the new type — `GT` on a boolean, a money literal
 * on a day of the month. Carrying them over would produce a comparison the API
 * refuses on save, reported as a validation error about a field the person did
 * not touch.
 */
function ComparisonEditor({
  comparison,
  readOnly,
  lookups,
  onChange,
}: {
  comparison: Comparison;
  readOnly: boolean;
  lookups: Lookups;
  onChange: (comparison: Comparison) => void;
}): React.JSX.Element {
  const operators = operatorsForField(comparison.field);

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius-sm)] bg-ink-50/60 px-2 py-1.5">
      <select
        value={comparison.field}
        onChange={(event) => {
          const field = event.target.value as PolicyField;
          const allowed = operatorsForField(field);
          const operator = allowed.includes(comparison.operator)
            ? comparison.operator
            : (allowed[0] ?? 'EQ');

          onChange({
            type: 'COMPARISON',
            field,
            operator,
            value: defaultValue(field, operator, lookups),
          });
        }}
        disabled={readOnly}
        aria-label="Field"
        className={`${CONTROL} max-w-[240px] flex-1`}
      >
        {FIELD_GROUPS.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.fields.map((field) => (
              <option key={field} value={field}>
                {POLICY_FIELD_LABELS[field] ?? field}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      <select
        value={comparison.operator}
        onChange={(event) => {
          const operator = event.target.value as ComparisonOperator;
          onChange({
            ...comparison,
            operator,
            value: defaultValue(comparison.field, operator, lookups),
          });
        }}
        disabled={readOnly}
        aria-label="Operator"
        className={`${CONTROL} w-[130px]`}
      >
        {operators.map((operator) => (
          <option key={operator} value={operator}>
            {OPERATOR_LABELS[operator] ?? operator}
          </option>
        ))}
      </select>

      <ValueEditor
        field={comparison.field}
        value={comparison.value}
        readOnly={readOnly}
        lookups={lookups}
        onChange={(value) => onChange({ ...comparison, value })}
      />
    </div>
  );
}

function ValueEditor({
  field,
  value,
  readOnly,
  lookups,
  onChange,
}: {
  field: PolicyField;
  value: PolicyValue;
  readOnly: boolean;
  lookups: Lookups;
  onChange: (value: PolicyValue) => void;
}): React.JSX.Element | null {
  const choices = optionsForField(field, lookups);

  switch (value.kind) {
    case 'none':
      return null;

    case 'money':
      return (
        <span className="flex items-center gap-1">
          <input
            value={value.amount}
            onChange={(event) => onChange({ ...value, amount: event.target.value })}
            disabled={readOnly}
            inputMode="decimal"
            aria-label="Amount"
            className={`${CONTROL} tabular w-28 text-right`}
          />
          <input
            value={value.currency}
            onChange={(event) => onChange({ ...value, currency: event.target.value.toUpperCase() })}
            disabled={readOnly}
            maxLength={3}
            aria-label="Currency"
            className={`${CONTROL} w-16 uppercase`}
          />
        </span>
      );

    case 'moneyRange':
      return (
        <span className="flex items-center gap-1">
          <input
            value={value.from.amount}
            onChange={(event) =>
              onChange({ ...value, from: { ...value.from, amount: event.target.value } })
            }
            disabled={readOnly}
            inputMode="decimal"
            aria-label="From amount"
            className={`${CONTROL} tabular w-24 text-right`}
          />
          <span className="text-[12px] text-ink-400">and</span>
          <input
            value={value.to.amount}
            onChange={(event) =>
              onChange({ ...value, to: { ...value.to, amount: event.target.value } })
            }
            disabled={readOnly}
            inputMode="decimal"
            aria-label="To amount"
            className={`${CONTROL} tabular w-24 text-right`}
          />
          <span className="text-[12px] uppercase text-ink-400">{value.from.currency}</span>
        </span>
      );

    case 'number':
      return (
        <input
          value={String(value.value)}
          onChange={(event) => onChange({ kind: 'number', value: Number(event.target.value) })}
          disabled={readOnly}
          type="number"
          aria-label="Value"
          className={`${CONTROL} tabular w-28 text-right`}
        />
      );

    case 'numberRange':
      return (
        <span className="flex items-center gap-1">
          <input
            value={String(value.from)}
            onChange={(event) => onChange({ ...value, from: Number(event.target.value) })}
            disabled={readOnly}
            type="number"
            aria-label="From"
            className={`${CONTROL} tabular w-20 text-right`}
          />
          <span className="text-[12px] text-ink-400">and</span>
          <input
            value={String(value.to)}
            onChange={(event) => onChange({ ...value, to: Number(event.target.value) })}
            disabled={readOnly}
            type="number"
            aria-label="To"
            className={`${CONTROL} tabular w-20 text-right`}
          />
        </span>
      );

    case 'string':
      // A picker wherever the values are known ids. A department typed by hand
      // is one transposition away from a rule that matches nobody and looks
      // entirely healthy in every list.
      return choices === null ? (
        <input
          value={value.value}
          onChange={(event) => onChange({ kind: 'string', value: event.target.value })}
          disabled={readOnly}
          aria-label="Value"
          className={`${CONTROL} min-w-[160px] flex-1`}
        />
      ) : (
        <select
          value={value.value}
          onChange={(event) => onChange({ kind: 'string', value: event.target.value })}
          disabled={readOnly}
          aria-label="Value"
          className={`${CONTROL} min-w-[160px] flex-1`}
        >
          <option value="">Choose…</option>
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      );

    case 'strings':
      return choices === null ? (
        <input
          value={value.value.join(', ')}
          onChange={(event) =>
            onChange({
              kind: 'strings',
              value: event.target.value
                .split(',')
                .map((entry) => entry.trim())
                .filter((entry) => entry !== ''),
            })
          }
          disabled={readOnly}
          aria-label="Values, comma separated"
          placeholder="one, two, three"
          className={`${CONTROL} min-w-[200px] flex-1`}
        />
      ) : (
        <select
          multiple
          value={value.value}
          onChange={(event) =>
            onChange({
              kind: 'strings',
              value: Array.from(event.target.selectedOptions, (option) => option.value),
            })
          }
          disabled={readOnly}
          aria-label="Values"
          className={`${CONTROL} h-auto min-h-[64px] min-w-[200px] flex-1 py-1`}
        >
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      );

    default:
      return null;
  }
}

function OutcomesEditor({
  outcomes,
  readOnly,
  onChange,
}: {
  outcomes: readonly Outcome[];
  readOnly: boolean;
  onChange: (outcomes: Outcome[]) => void;
}): React.JSX.Element {
  function replace(index: number, outcome: Outcome): void {
    onChange(outcomes.map((existing, position) => (position === index ? outcome : existing)));
  }

  return (
    <div className="flex flex-col gap-1.5">
      {outcomes.map((outcome, index) => (
        <div
          key={index}
          className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius-sm)] bg-ink-50/60 px-2 py-1.5"
        >
          <select
            value={outcome.type}
            onChange={(event) => replace(index, defaultOutcome(event.target.value))}
            disabled={readOnly}
            aria-label="What happens"
            className={`${CONTROL} w-[210px]`}
          >
            {Object.entries(OUTCOME_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <OutcomeFields
            outcome={outcome}
            readOnly={readOnly}
            onChange={(next) => replace(index, next)}
          />

          {!readOnly && outcomes.length > 1 && (
            <Button
              size="sm"
              variant="ghost"
              aria-label="Remove outcome"
              onClick={() => onChange(outcomes.filter((_, position) => position !== index))}
            >
              ✕
            </Button>
          )}
        </div>
      ))}

      {!readOnly && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onChange([...outcomes, { type: 'REQUIRE_RECEIPT' }])}
        >
          + Outcome
        </Button>
      )}
    </div>
  );
}

/**
 * The fields a particular outcome needs.
 *
 * `WORKFLOW` is absent from the approver picker on purpose: the resolver does
 * not implement it yet, and a chain naming an approver nobody can resolve is
 * refused at submission — a spend request stuck with nothing saying why. An
 * option that produces that is worse than a missing option.
 */
function OutcomeFields({
  outcome,
  readOnly,
  onChange,
}: {
  outcome: Outcome;
  readOnly: boolean;
  onChange: (outcome: Outcome) => void;
}): React.JSX.Element | null {
  const patch = (fields: Record<string, unknown>): void =>
    onChange({ ...(outcome as object), ...fields } as Outcome);

  switch (outcome.type) {
    case 'BLOCK':
      return (
        <>
          <input
            value={outcome.reasonCode}
            onChange={(event) => patch({ reasonCode: event.target.value })}
            disabled={readOnly}
            aria-label="Reason code"
            placeholder="OVER_LIMIT"
            maxLength={50}
            className={`${CONTROL} w-[150px] font-mono text-[12px] uppercase`}
          />
          <input
            value={outcome.message}
            onChange={(event) => patch({ message: event.target.value })}
            disabled={readOnly}
            aria-label="Message shown to the requester"
            placeholder="Explain what they should do instead."
            maxLength={300}
            className={`${CONTROL} min-w-[200px] flex-1`}
          />
        </>
      );

    case 'REQUIRE_APPROVER':
      return (
        <>
          <select
            value={outcome.approver.kind}
            onChange={(event) => patch({ approver: defaultApprover(event.target.value) })}
            disabled={readOnly}
            aria-label="Who approves"
            className={`${CONTROL} w-[190px]`}
          >
            {Object.entries(APPROVER_KIND_LABELS)
              .filter(([kind]) => kind !== 'WORKFLOW')
              .map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
          </select>

          <ApproverFields
            approver={outcome.approver}
            readOnly={readOnly}
            onChange={(approver) => patch({ approver })}
          />

          <select
            value={outcome.stepType}
            onChange={(event) => patch({ stepType: event.target.value })}
            disabled={readOnly}
            aria-label="How the step completes"
            className={`${CONTROL} w-[150px]`}
          >
            {STEP_TYPES.map((type) => (
              <option key={type} value={type}>
                {STEP_TYPE_LABELS[type] ?? type}
              </option>
            ))}
          </select>

          <label className="flex items-center gap-1 text-[12px] text-ink-500">
            step
            <input
              value={String(outcome.sequence)}
              onChange={(event) => patch({ sequence: Number(event.target.value) })}
              disabled={readOnly}
              type="number"
              min={1}
              max={20}
              aria-label="Step number"
              className={`${CONTROL} tabular w-14 text-right`}
            />
          </label>
        </>
      );

    case 'REQUIRE_MEMO':
      return (
        <label className="flex items-center gap-1 text-[12px] text-ink-500">
          at least
          <input
            value={String(outcome.minLength ?? 20)}
            onChange={(event) => patch({ minLength: Number(event.target.value) })}
            disabled={readOnly}
            type="number"
            min={1}
            max={2000}
            aria-label="Minimum memo length"
            className={`${CONTROL} tabular w-20 text-right`}
          />
          characters
        </label>
      );

    case 'FLAG_EXCEPTION':
      return (
        <input
          value={outcome.exceptionCode}
          onChange={(event) => patch({ exceptionCode: event.target.value })}
          disabled={readOnly}
          aria-label="Exception code"
          placeholder="OUT_OF_POLICY"
          maxLength={50}
          className={`${CONTROL} w-[200px] font-mono text-[12px] uppercase`}
        />
      );

    case 'SET_VALIDITY':
      return (
        <label className="flex items-center gap-1 text-[12px] text-ink-500">
          for
          <input
            value={String(outcome.days)}
            onChange={(event) => patch({ days: Number(event.target.value) })}
            disabled={readOnly}
            type="number"
            min={1}
            max={365}
            aria-label="Days the approval stays valid"
            className={`${CONTROL} tabular w-20 text-right`}
          />
          days
        </label>
      );

    // Named rather than swept into a default, so that adding an outcome to
    // the model is a compile error here rather than a control that silently
    // renders nothing.
    case 'ALLOW':
    case 'AUTO_APPROVE':
    case 'REQUIRE_RECEIPT':
    case 'REQUIRE_FINANCE_REVIEW':
      return null;
  }
}

function ApproverFields({
  approver,
  readOnly,
  onChange,
}: {
  approver: Extract<Outcome, { type: 'REQUIRE_APPROVER' }>['approver'];
  readOnly: boolean;
  onChange: (approver: Extract<Outcome, { type: 'REQUIRE_APPROVER' }>['approver']) => void;
}): React.JSX.Element | null {
  const patch = (fields: Record<string, unknown>): void =>
    onChange({ ...(approver as object), ...fields } as typeof approver);

  switch (approver.kind) {
    case 'ROLE':
      return (
        <>
          <select
            value={approver.roleKey}
            onChange={(event) => patch({ roleKey: event.target.value })}
            disabled={readOnly}
            aria-label="Role"
            className={`${CONTROL} w-[160px]`}
          >
            {APPROVING_ROLES.map((key) => (
              <option key={key} value={key}>
                {ROLE_LABELS[key]}
              </option>
            ))}
          </select>
          <select
            value={approver.scope}
            onChange={(event) => patch({ scope: event.target.value })}
            disabled={readOnly}
            aria-label="Where that role is looked for"
            className={`${CONTROL} w-[150px]`}
          >
            {APPROVER_SCOPES.map((scope) => (
              <option key={scope} value={scope}>
                {scope === 'ORGANIZATION'
                  ? 'Anywhere'
                  : scope === 'ENTITY'
                    ? "In the requester's entity"
                    : "In the requester's department"}
              </option>
            ))}
          </select>
        </>
      );

    case 'DEPARTMENT_HEAD':
      return (
        <label className="flex items-center gap-1 text-[12px] text-ink-500">
          levels up
          <input
            value={String(approver.levelsUp)}
            onChange={(event) => patch({ levelsUp: Number(event.target.value) })}
            disabled={readOnly}
            type="number"
            min={0}
            max={5}
            aria-label="Levels up the department tree"
            className={`${CONTROL} tabular w-14 text-right`}
          />
        </label>
      );

    case 'MANAGER_CHAIN':
      return (
        <label className="flex items-center gap-1 text-[12px] text-ink-500">
          position
          <input
            value={String(approver.position)}
            onChange={(event) => patch({ position: Number(event.target.value) })}
            disabled={readOnly}
            type="number"
            min={1}
            max={5}
            aria-label="Position in the manager chain"
            className={`${CONTROL} tabular w-14 text-right`}
          />
        </label>
      );

    case 'MEMBERSHIP':
      return (
        <input
          value={approver.membershipId}
          onChange={(event) => patch({ membershipId: event.target.value })}
          disabled={readOnly}
          aria-label="Membership id"
          placeholder="Membership id"
          className={`${CONTROL} w-[220px] font-mono text-[12px]`}
        />
      );

    // Neither takes a parameter. `WORKFLOW` is additionally not offered by the
    // picker above, because the resolver does not implement it — a chain
    // naming an approver nobody can resolve is a request stuck at submission.
    case 'ENTITY_FINANCE_OWNER':
    case 'WORKFLOW':
      return null;
  }
}

// ── conversion and defaults ─────────────────────────────────────────────────

let counter = 0;

function newKey(): string {
  counter += 1;
  return `rule-${String(counter)}-${String(Date.now())}`;
}

/**
 * A stored rule, as the editor holds it.
 *
 * A rule whose top-level condition is a bare comparison is wrapped in an `ALL`
 * group. The model allows either; the editor only renders groups, and one
 * shape to render is one shape to get wrong.
 */
function fromWire(rule: EditableRule, index: number): EditRule {
  const condition = rule.condition as unknown as EditCondition;

  return {
    id: rule.id,
    key: `${rule.id}-${String(index)}`,
    name: rule.name,
    condition:
      condition.type === 'GROUP'
        ? condition
        : { type: 'GROUP', operator: 'ALL', conditions: [condition] },
    outcomes: [...rule.outcomes],
    terminal: rule.terminal,
  };
}

function defaultComparison(currency: string): Comparison {
  return {
    type: 'COMPARISON',
    field: 'amountInBaseCurrency',
    operator: 'GT',
    value: { kind: 'money', amount: '1000.00', currency },
  };
}

/**
 * A legal value for a field and operator, chosen from the kinds the model
 * allows. The first kind is the canonical one — `BETWEEN` has only a range,
 * `IN` has only a list, and the boolean operators have none.
 */
function defaultValue(
  field: PolicyField,
  operator: ComparisonOperator,
  lookups: Lookups,
): PolicyValue {
  const kind = valueKindsFor(field, operator)[0] ?? 'none';

  switch (kind) {
    case 'money':
      return { kind: 'money', amount: '0.00', currency: lookups.baseCurrency };
    case 'moneyRange':
      return {
        kind: 'moneyRange',
        from: { amount: '0.00', currency: lookups.baseCurrency },
        to: { amount: '1000.00', currency: lookups.baseCurrency },
      };
    case 'number':
      return { kind: 'number', value: 0 };
    case 'numberRange':
      return { kind: 'numberRange', from: 0, to: 10 };
    case 'string':
      return { kind: 'string', value: '' };
    case 'strings':
      return { kind: 'strings', value: [] };
    case 'none':
      return { kind: 'none' };
  }
}

function defaultOutcome(type: string): Outcome {
  switch (type) {
    case 'BLOCK':
      return { type: 'BLOCK', reasonCode: 'OVER_LIMIT', message: 'This exceeds policy.' };
    case 'REQUIRE_APPROVER':
      return {
        type: 'REQUIRE_APPROVER',
        approver: { kind: 'MANAGER_CHAIN', position: 1 },
        stepType: 'SINGLE',
        sequence: 1,
      };
    case 'REQUIRE_MEMO':
      return { type: 'REQUIRE_MEMO', minLength: 20 };
    case 'FLAG_EXCEPTION':
      return { type: 'FLAG_EXCEPTION', exceptionCode: 'OUT_OF_POLICY' };
    case 'SET_VALIDITY':
      return { type: 'SET_VALIDITY', days: 30 };
    default:
      return { type } as Outcome;
  }
}

function defaultApprover(kind: string): Extract<Outcome, { type: 'REQUIRE_APPROVER' }>['approver'] {
  switch (kind) {
    case 'ROLE':
      return {
        kind: 'ROLE',
        roleKey: APPROVING_ROLES[0] ?? 'FINANCE_ADMIN',
        scope: 'ORGANIZATION',
      };
    case 'DEPARTMENT_HEAD':
      return { kind: 'DEPARTMENT_HEAD', levelsUp: 0 };
    case 'MANAGER_CHAIN':
      return { kind: 'MANAGER_CHAIN', position: 1 };
    case 'MEMBERSHIP':
      return { kind: 'MEMBERSHIP', membershipId: '' };
    default:
      return { kind: 'ENTITY_FINANCE_OWNER' };
  }
}

/**
 * The choices for a field whose values are a closed set, or `null` for the
 * fields where free text is the only honest answer (a merchant name, a fiscal
 * period).
 *
 * A lookup rather than a switch, because most of the closed field set has no
 * picker and enumerating twenty `return null` cases would bury the seven that
 * matter.
 */
const FIELD_OPTIONS: Readonly<
  Record<string, (lookups: Lookups) => ReadonlyArray<{ value: string; label: string }>>
> = {
  spendType: () =>
    SPEND_TYPES.map((type) => ({ value: type, label: SPEND_TYPE_LABELS[type] ?? type })),
  'requester.roleKey': () => ROLE_KEYS.map((key) => ({ value: key, label: ROLE_LABELS[key] })),
  'requester.entityId': (lookups) =>
    lookups.entities.map((entity) => ({ value: entity.id, label: entity.name })),
  'requester.departmentId': (lookups) =>
    lookups.departments.map((department) => ({
      value: department.id,
      label: `${'— '.repeat(department.depth)}${department.name}`,
    })),
  'requester.departmentPath': (lookups) =>
    lookups.departments.map((department) => ({
      value: department.path,
      label: `${'— '.repeat(department.depth)}${department.name}`,
    })),
  'category.id': (lookups) =>
    lookups.categories.map((category) => ({
      value: category.id,
      label: `${'— '.repeat(category.depth)}${category.name}`,
    })),
  'category.path': (lookups) =>
    lookups.categories.map((category) => ({
      value: `/${category.key}/`,
      label: `${'— '.repeat(category.depth)}${category.name}`,
    })),
};

function optionsForField(
  field: PolicyField,
  lookups: Lookups,
): ReadonlyArray<{ value: string; label: string }> | null {
  const build = FIELD_OPTIONS[field];

  return build === undefined ? null : build(lookups);
}

/**
 * The first thing wrong with the rule set, in the reader's words.
 *
 * Checked before the request rather than after it, only because the message can
 * point at the rule by position — the API's field errors name a path into a
 * nested array, which is accurate and unreadable. The API still validates
 * everything independently; this is a courtesy, not a control.
 */
function firstProblem(rules: readonly EditRule[]): string | null {
  for (const [index, rule] of rules.entries()) {
    const position = index + 1;

    if (rule.name.trim() === '') return `Rule ${String(position)} needs a name.`;
    if (rule.outcomes.length === 0) {
      return `Rule ${String(position)} does nothing. Give it at least one outcome.`;
    }

    const problem = conditionProblem(rule.condition, position);
    if (problem !== null) return problem;
  }

  return null;
}

function conditionProblem(condition: EditCondition, position: number): string | null {
  if (condition.type === 'GROUP') {
    if (condition.conditions.length === 0) {
      return `Rule ${String(position)} has an empty group, which would match every request.`;
    }

    for (const child of condition.conditions) {
      const problem = conditionProblem(child, position);
      if (problem !== null) return problem;
    }

    return null;
  }

  const { value } = condition;
  const label = POLICY_FIELD_LABELS[condition.field] ?? condition.field;

  if (value.kind === 'string' && value.value.trim() === '') {
    return `Rule ${String(position)}: “${label}” has no value to compare against.`;
  }

  if (value.kind === 'strings' && value.value.length === 0) {
    return `Rule ${String(position)}: “${label}” needs at least one value in its list.`;
  }

  if (value.kind === 'numberRange' && value.from > value.to) {
    return `Rule ${String(position)}: “${label}” has a range that starts above its end, so it matches nothing.`;
  }

  return null;
}
