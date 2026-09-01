'use server';

import type { Resource, SimulationResult } from '@financy/contracts';

import { apiFetch } from './api';

/**
 * Ask the policy engine what it would do, without doing it.
 *
 * One implementation, two callers with genuinely different questions. The
 * **policy editor** asks it about a draft it is writing; the **new-request
 * form** asks it about a request somebody is about to submit. Both want the
 * same answer computed the same way, and a second copy of this in one of them
 * would be the copy that stops matching the real path first.
 *
 * The endpoint is `POST /v1/policies/simulate`: it writes nothing, opens no
 * chain, and is gated on `policy:read`, which every role holds — the point of
 * showing a requester what will happen is that they find out before they ask
 * for something the policy will refuse.
 */
export interface PreviewInput {
  spendType: string;
  amount: string;
  currency: string;
  entityId: string;
  requesterMembershipId?: string | undefined;
  departmentId?: string | undefined;
  projectId?: string | undefined;
  categoryId?: string | undefined;
  memo?: string | undefined;
  hasReceipt?: boolean | undefined;
  neededBy?: string | undefined;
  /**
   * Evaluate one policy's unpublished draft in place of its live rules.
   *
   * Only the editor passes it. A requester previewing their own request must
   * see the rules that will actually decide it.
   */
  includeDraftOfPolicyId?: string | undefined;
}

/**
 * Returns the result, or a message — never throws.
 *
 * A preview that fails is an inconvenience, not a failure of the thing the
 * person is doing: they can still submit, and submission evaluates
 * authoritatively anyway. Throwing here would take down a form over a panel.
 */
export async function previewDecision(
  input: PreviewInput,
): Promise<{ result: SimulationResult | null; error: string | null }> {
  try {
    const response = await apiFetch<Resource<SimulationResult>>('/policies/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spendType: input.spendType,
        amount: { amount: input.amount, currency: input.currency },
        entityId: input.entityId,
        ...defined('requesterMembershipId', input.requesterMembershipId),
        ...defined('departmentId', input.departmentId),
        ...defined('projectId', input.projectId),
        ...defined('categoryId', input.categoryId),
        ...defined('memo', input.memo),
        ...defined('neededBy', input.neededBy),
        ...defined('includeDraftOfPolicyId', input.includeDraftOfPolicyId),
        hasReceipt: input.hasReceipt ?? false,
      }),
    });

    return { result: response.data, error: null };
  } catch (error) {
    return {
      result: null,
      error: error instanceof Error ? error.message : 'The preview could not be run.',
    };
  }
}

/**
 * Include a key only when it has a value.
 *
 * The simulate schema is strict, so sending `categoryId: undefined` is fine but
 * sending `categoryId: ""` for an untouched picker is a 422 about a field
 * nobody filled in.
 */
function defined(key: string, value: string | undefined): Record<string, string> {
  return value === undefined || value === '' ? {} : { [key]: value };
}
