/**
 * The wire form of the policy rule model (docs/11 §4).
 *
 * `@financy/core` owns the shape and the behaviour — the closed field set, the
 * operator tables, the merge semantics; this module owns their validation.
 * The same split `Money` already has, and the same reason: the dependency runs
 * contracts → core, so the domain cannot import the schemas and the schemas
 * are free to be strict about what may be stored.
 *
 * The strictness matters more here than almost anywhere else. **A rule that
 * cannot fire is worse than a rule that is wrong**: nothing errors, nothing is
 * logged, and the spend the policy was written to control simply goes through.
 * So a comparison is validated for internal coherence — the operator must
 * belong to the field's type, the value's kind must match the operator, and a
 * range's bounds must be the right way round — and any of those failing is a
 * `422` at authoring time rather than silence at evaluation time.
 */

import {
  COMPARISON_OPERATORS,
  CONDITION_GROUP_OPERATORS,
  POLICY_FIELDS,
  SPEND_TYPES,
  STEP_TYPES,
  APPROVER_SCOPES,
  operatorsForField,
  valueKindsFor,
  type ApproverSpec,
  type Condition,
  type Outcome,
  type PolicyVersion,
} from '@financy/core';
import { z } from 'zod';

import { idSchema, moneySchema, nonEmptyString } from './primitives.js';
import { ROLE_KEYS } from './permissions.js';

export const spendTypeSchema = z.enum(SPEND_TYPES);
export const policyFieldSchema = z.enum(POLICY_FIELDS);
export const comparisonOperatorSchema = z.enum(COMPARISON_OPERATORS);

/**
 * A comparison's right-hand side.
 *
 * `BETWEEN` carries two values, `IN` carries a list, and the boolean and null
 * operators carry none. Which kind is required is decided by the field and the
 * operator together, and checked below — so a `BETWEEN` with one bound cannot
 * be stored.
 */
export const policyValueSchema = z.union([
  z.object({ kind: z.literal('money'), amount: z.string(), currency: z.string() }),
  z.object({ kind: z.literal('number'), value: z.number().finite() }),
  z.object({ kind: z.literal('string'), value: z.string().max(200) }),
  z.object({ kind: z.literal('strings'), value: z.array(z.string().max(200)).min(1).max(100) }),
  z.object({ kind: z.literal('moneyRange'), from: moneySchema, to: moneySchema }),
  z.object({ kind: z.literal('numberRange'), from: z.number().finite(), to: z.number().finite() }),
  z.object({ kind: z.literal('none') }),
]);

const comparisonShape = z.object({
  type: z.literal('COMPARISON'),
  field: policyFieldSchema,
  operator: comparisonOperatorSchema,
  value: policyValueSchema,
});

export const comparisonConditionSchema = comparisonShape.superRefine((condition, ctx) => {
  const allowed = operatorsForField(condition.field);

  if (!allowed.includes(condition.operator)) {
    ctx.addIssue({
      code: 'custom',
      path: ['operator'],
      message: `${condition.operator} cannot be used on ${condition.field}. Allowed: ${allowed.join(', ')}.`,
    });

    return;
  }

  const expected = valueKindsFor(condition.field, condition.operator);

  if (!expected.includes(condition.value.kind)) {
    ctx.addIssue({
      code: 'custom',
      path: ['value'],
      message: `${condition.operator} on ${condition.field} needs a ${expected.join(' or ')} value, not ${condition.value.kind}.`,
    });

    return;
  }

  // A range whose bounds are inverted matches nothing, ever. Rejecting it is
  // the difference between a policy that is wrong and one that is silent.
  if (condition.value.kind === 'numberRange' && condition.value.from > condition.value.to) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'The range starts above its end.' });
  }
});

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    comparisonConditionSchema,
    z.object({
      type: z.literal('GROUP'),
      operator: z.enum(CONDITION_GROUP_OPERATORS),
      conditions: z.array(conditionSchema).min(1).max(20),
    }),
  ]),
);

export const approverSpecSchema: z.ZodType<ApproverSpec> = z.union([
  z.object({ kind: z.literal('MEMBERSHIP'), membershipId: idSchema }),
  z.object({ kind: z.literal('ROLE'), roleKey: z.enum(ROLE_KEYS), scope: z.enum(APPROVER_SCOPES) }),
  z.object({ kind: z.literal('DEPARTMENT_HEAD'), levelsUp: z.int().min(0).max(5).default(0) }),
  z.object({ kind: z.literal('MANAGER_CHAIN'), position: z.int().min(1).max(5) }),
  z.object({ kind: z.literal('ENTITY_FINANCE_OWNER') }),
  z.object({ kind: z.literal('WORKFLOW'), workflowId: idSchema }),
]);

export const escalationSpecSchema = z.object({
  afterHours: z.int().min(1).max(720),
  to: approverSpecSchema,
});

export const outcomeSchema: z.ZodType<Outcome> = z.union([
  z.object({ type: z.literal('ALLOW') }),
  z.object({
    type: z.literal('BLOCK'),
    reasonCode: nonEmptyString(50),
    message: nonEmptyString(300),
  }),
  z.object({ type: z.literal('AUTO_APPROVE') }),
  z.object({
    type: z.literal('REQUIRE_APPROVER'),
    approver: approverSpecSchema,
    stepType: z.enum(STEP_TYPES),
    sequence: z.int().min(1).max(20),
    timeoutHours: z.int().min(1).max(720).optional(),
    escalation: escalationSpecSchema.optional(),
  }),
  z.object({ type: z.literal('REQUIRE_RECEIPT') }),
  z.object({ type: z.literal('REQUIRE_MEMO'), minLength: z.int().min(1).max(2000).optional() }),
  z.object({ type: z.literal('REQUIRE_FINANCE_REVIEW') }),
  z.object({ type: z.literal('FLAG_EXCEPTION'), exceptionCode: nonEmptyString(50) }),
  z.object({ type: z.literal('SET_VALIDITY'), days: z.int().min(1).max(365) }),
]) as z.ZodType<Outcome>;

export const policyRuleSchema = z.object({
  id: idSchema,
  name: nonEmptyString(200),
  sequence: z.int().min(1).max(1000),
  condition: conditionSchema,
  outcomes: z.array(outcomeSchema).min(1).max(20),
  terminal: z.boolean().default(false),
});

export const policyVersionSchema: z.ZodType<PolicyVersion> = z.object({
  id: idSchema,
  policyId: idSchema,
  version: z.int().min(1),
  spendTypes: z.array(spendTypeSchema).min(1),
  priority: z.int().min(0).max(1000),
  rules: z.array(policyRuleSchema).max(200),
});
