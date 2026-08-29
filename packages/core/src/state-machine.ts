import { InvalidStateTransitionError } from './errors.js';

/**
 * A deterministic state machine.
 *
 * Every financial lifecycle in this system — spend requests, transactions,
 * expenses, reimbursements, approvals, cards, bills, purchase orders — is
 * defined as an explicit transition table rather than as scattered status
 * assignments. That gives three things scattered assignments cannot:
 *
 *   1. **No undefined states.** A transition not in the table cannot happen.
 *   2. **Exhaustive testability.** Illegal transitions can be enumerated and
 *      asserted, which is how docs/16-TESTING-STRATEGY.md §3.3 tests them —
 *      exhaustively, not representatively.
 *   3. **A readable specification.** The table *is* the diagram in
 *      docs/05-USER-FLOWS.md, and drift between them is visible.
 */

export type TransitionTable<TState extends string> = {
  readonly [S in TState]: readonly TState[];
};

export interface TransitionContext {
  readonly entity: string;
}

export class StateMachine<TState extends string> {
  constructor(
    private readonly entity: string,
    private readonly table: TransitionTable<TState>,
    private readonly terminalStates: readonly TState[] = [],
  ) {}

  /** All states in the machine. */
  get states(): TState[] {
    return Object.keys(this.table) as TState[];
  }

  canTransition(from: TState, to: TState): boolean {
    const allowed = this.table[from];
    return Array.isArray(allowed) && allowed.includes(to);
  }

  /**
   * Validate a transition, throwing if it is not permitted.
   *
   * Returns the target state so it reads naturally at a call site:
   * `request.status = machine.transition(request.status, 'APPROVED')`.
   */
  transition(from: TState, to: TState): TState {
    if (!this.canTransition(from, to)) {
      throw new InvalidStateTransitionError(this.entity, from, to);
    }
    return to;
  }

  isTerminal(state: TState): boolean {
    return this.terminalStates.includes(state);
  }

  allowedFrom(from: TState): readonly TState[] {
    return this.table[from] ?? [];
  }

  /**
   * Every ordered pair that is **not** a legal transition.
   *
   * This exists so tests can assert the negative space exhaustively rather
   * than picking a few representative cases — the illegal transition nobody
   * thought to test is precisely the one that ships.
   */
  illegalTransitions(): Array<[TState, TState]> {
    const result: Array<[TState, TState]> = [];
    for (const from of this.states) {
      for (const to of this.states) {
        if (from !== to && !this.canTransition(from, to)) result.push([from, to]);
      }
    }
    return result;
  }

  /** Every legal ordered pair. */
  legalTransitions(): Array<[TState, TState]> {
    const result: Array<[TState, TState]> = [];
    for (const from of this.states) {
      for (const to of this.allowedFrom(from)) result.push([from, to]);
    }
    return result;
  }

  /**
   * States unreachable from the given start state.
   *
   * A non-empty result means the table and the documented diagram disagree —
   * either a transition is missing or a state is dead. Asserted in tests.
   */
  unreachableFrom(start: TState): TState[] {
    const seen = new Set<TState>([start]);
    const queue: TState[] = [start];
    while (queue.length > 0) {
      const current = queue.shift() as TState;
      for (const next of this.allowedFrom(current)) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return this.states.filter((s) => !seen.has(s));
  }
}

export function defineStateMachine<TState extends string>(
  entity: string,
  table: TransitionTable<TState>,
  terminalStates: readonly TState[] = [],
): StateMachine<TState> {
  return new StateMachine(entity, table, terminalStates);
}
