'use client';

import {
  BUDGET_SCOPE_TYPES,
  BUDGET_SCOPE_TYPE_LABELS,
  BUDGET_STATUSES,
  BUDGET_STATUS_LABELS,
  type EntitySummary,
} from '@financy/contracts';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

/**
 * Three filters and a search box.
 *
 * **"Active" is a shortcut, not a default.** A budget list that silently hid
 * drafts would make somebody who had just created one conclude it had not
 * saved. The shortcut is one press away and its pressed state is visible, which
 * is the difference between a filter and a lie.
 */
export function BudgetFilters({
  entities,
}: {
  entities: readonly EntitySummary[];
}): React.JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function apply(key: string, value: string): void {
    const next = new URLSearchParams(params.toString());

    if (value === '') next.delete(key);
    else next.set(key, value);

    next.delete('page');

    startTransition(() => {
      router.push(next.toString() === '' ? '/budgets' : `/budgets?${next.toString()}`);
    });
  }

  const control =
    'h-8 rounded-[var(--radius-sm)] border border-line bg-white px-2 text-[13px] text-ink-700 ' +
    'focus:border-cobalt-500 focus:outline-none';

  const onlyActive = params.get('status') === 'ACTIVE';

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" data-pending={pending || undefined}>
      <button
        type="button"
        aria-pressed={onlyActive}
        onClick={() => apply('status', onlyActive ? '' : 'ACTIVE')}
        className={`h-8 rounded-[var(--radius-sm)] border px-3 text-[13px] ${
          onlyActive
            ? 'border-cobalt-500 bg-cobalt-50 text-cobalt-700'
            : 'border-line bg-white text-ink-600'
        }`}
      >
        Active only
      </button>

      <select
        aria-label="Status"
        className={control}
        value={params.get('status') ?? ''}
        onChange={(event) => apply('status', event.target.value)}
      >
        <option value="">Any status</option>
        {BUDGET_STATUSES.map((status) => (
          <option key={status} value={status}>
            {BUDGET_STATUS_LABELS[status]}
          </option>
        ))}
      </select>

      <select
        aria-label="Drawn around"
        className={control}
        value={params.get('scopeType') ?? ''}
        onChange={(event) => apply('scopeType', event.target.value)}
      >
        <option value="">Anything</option>
        {BUDGET_SCOPE_TYPES.map((scope) => (
          <option key={scope} value={scope}>
            {BUDGET_SCOPE_TYPE_LABELS[scope]}
          </option>
        ))}
      </select>

      {entities.length > 1 && (
        <select
          aria-label="Entity"
          className={control}
          value={params.get('entityId') ?? ''}
          onChange={(event) => apply('entityId', event.target.value)}
        >
          <option value="">Every entity</option>
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.name}
            </option>
          ))}
        </select>
      )}

      <input
        type="search"
        aria-label="Search budgets"
        placeholder="Search by name"
        className={`${control} w-48`}
        defaultValue={params.get('q') ?? ''}
        onKeyDown={(event) => {
          if (event.key === 'Enter') apply('q', event.currentTarget.value.trim());
        }}
      />
    </div>
  );
}
