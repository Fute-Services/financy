/**
 * The policy engine (docs/11).
 *
 * Everything here is pure: no I/O, no clock, no database. The caller supplies
 * the context and the active policy versions; the evaluator answers. That is
 * what makes ten thousand generated cases feasible, what lets a simulation
 * ask "what would this policy have done in March", and what makes a decision
 * reproducible from its record months later.
 */

export type { PolicyContext } from './context.js';
export { evaluateCondition, evaluateComparison, readField } from './conditions.js';
export {
  mergeOutcomes,
  type AttributedOutcome,
  type MergedOutcomes,
  type MergedRequirements,
  type ResolvedStepSpec,
} from './merge.js';
export {
  evaluate,
  POLICY_ENGINE_VERSION,
  type EvaluateOptions,
  type PolicyDecision,
} from './evaluator.js';
export * from './rules.js';
