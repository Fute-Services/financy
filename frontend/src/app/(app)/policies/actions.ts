'use server';

import type { PolicyDetail, Resource, SavePolicyRules, SimulationResult } from '@financy/contracts';

import { apiFetch } from '@/lib/api';
import {
  create,
  nullable,
  optional,
  runWrite,
  text,
  version,
  writeWithVersion,
  type FormState,
} from '@/lib/actions';

/**
 * The policy screen's writes.
 *
 * **Saving rules and publishing them are two different actions**, and the UI
 * keeps them two different buttons. Saving edits a draft that decides nothing;
 * publishing points evaluation at it. A single "Save" that did both would mean
 * every keystroke in the rule builder changed what the organisation is allowed
 * to spend — which is exactly what the draft/published split in the API exists
 * to prevent, and it would be undone here.
 *
 * `saveRules` takes a typed object rather than `FormData`, because a rule set
 * is a tree: conditions nest, outcomes are a discriminated union, and flattening
 * that into form fields and reassembling it would put a second, undocumented
 * copy of the rule model in this file. The editor holds the tree in state and
 * hands it over whole.
 */

const POLICIES = '/policies';

export async function createPolicy(_previous: FormState, form: FormData): Promise<FormState> {
  const spendTypes = form
    .getAll('spendTypes')
    .filter((value): value is string => typeof value === 'string');

  if (spendTypes.length === 0) {
    // Caught here rather than at the API, only because the message can name
    // the box: a policy that applies to nothing is the same silent-failure
    // shape the whole subsystem is designed against.
    return {
      status: 'error',
      fields: { spendTypes: ['Choose at least one kind of spend this policy applies to.'] },
    };
  }

  return runWrite(
    [POLICIES],
    () =>
      create<Resource<PolicyDetail>>('/policies', {
        name: optional(form, 'name'),
        description: nullable(form, 'description') ?? undefined,
        spendTypes,
        priority: Number.parseInt(optional(form, 'priority') ?? '100', 10),
      }),
    'Policy created as a draft. Add rules, then publish it.',
    (response) => ({ createdId: response.data.id }),
  );
}

export async function updatePolicy(_previous: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');
  const spendTypes = form
    .getAll('spendTypes')
    .filter((value): value is string => typeof value === 'string');

  return runWrite(
    [POLICIES, `${POLICIES}/${id}`],
    () =>
      writeWithVersion<Resource<PolicyDetail>>(`/policies/${id}`, 'PATCH', version(form), {
        name: optional(form, 'name'),
        description: nullable(form, 'description'),
        ...(spendTypes.length === 0 ? {} : { spendTypes }),
        priority: Number.parseInt(optional(form, 'priority') ?? '100', 10),
      }),
    'Policy updated.',
  );
}

/**
 * Replace the draft's rules.
 *
 * Not a form action — the caller is the rule builder, which owns the tree and
 * calls this directly. It still returns a `FormState` so the editor renders
 * failures through the same path every other write in this app uses.
 */
export async function savePolicyRules(
  policyId: string,
  rules: SavePolicyRules['rules'],
): Promise<FormState> {
  return runWrite(
    [POLICIES, `${POLICIES}/${policyId}`],
    () => create<Resource<PolicyDetail>>(`/policies/${policyId}/rules`, { rules }),
    'Draft saved. It is not deciding anything until you publish it.',
  );
}

export async function publishPolicy(_previous: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');

  return runWrite(
    [POLICIES, `${POLICIES}/${id}`],
    () =>
      writeWithVersion<Resource<PolicyDetail>>(`/policies/${id}/publish`, 'POST', version(form), {
        note: optional(form, 'note'),
      }),
    'Published. This policy is now deciding spend.',
  );
}

export async function setPolicyArchived(_previous: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');
  const archived = form.get('archived') === 'true';

  return runWrite(
    [POLICIES, `${POLICIES}/${id}`],
    () =>
      writeWithVersion<Resource<PolicyDetail>>(
        `/policies/${id}/${archived ? 'archive' : 'restore'}`,
        'POST',
        version(form),
      ),
    archived ? 'Policy archived. It no longer decides anything.' : 'Policy restored.',
  );
}

/**
 * Run a simulation.
 *
 * Returns the result rather than a `FormState`, because there is nothing to
 * revalidate and nothing was written — the caller renders the decision. A
 * failure is still returned as a message, so a 422 from a malformed amount
 * shows under the form rather than as an unhandled rejection.
 */
export async function simulatePolicy(input: {
  policyId: string | null;
  spendType: string;
  amount: string;
  currency: string;
  entityId: string;
  requesterMembershipId?: string | undefined;
  categoryId?: string | undefined;
  projectId?: string | undefined;
  memo?: string | undefined;
  hasReceipt: boolean;
}): Promise<{ result: SimulationResult | null; error: string | null }> {
  try {
    const response = await apiFetch<Resource<SimulationResult>>('/policies/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spendType: input.spendType,
        amount: { amount: input.amount, currency: input.currency },
        entityId: input.entityId,
        ...(input.requesterMembershipId === undefined
          ? {}
          : { requesterMembershipId: input.requesterMembershipId }),
        ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
        ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
        ...(input.memo === undefined ? {} : { memo: input.memo }),
        hasReceipt: input.hasReceipt,
        // Always against the draft when one is open. Simulating the published
        // rules from inside the editor would answer a question nobody asked.
        ...(input.policyId === null ? {} : { includeDraftOfPolicyId: input.policyId }),
      }),
    });

    return { result: response.data, error: null };
  } catch (error) {
    return {
      result: null,
      error: error instanceof Error ? error.message : 'The simulation could not be run.',
    };
  }
}
