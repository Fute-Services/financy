import { describe, it, expect } from 'vitest';
import { defineStateMachine } from './state-machine.js';
import { InvalidStateTransitionError } from './errors.js';

/**
 * The spend request lifecycle from docs/05-USER-FLOWS.md §D, used here as the
 * fixture because it is the machine the rest of the system depends on.
 */
type SpendStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'PENDING_APPROVAL'
  | 'CHANGES_REQUESTED'
  | 'ESCALATED'
  | 'APPROVED'
  | 'REJECTED'
  | 'BLOCKED'
  | 'CANCELLED'
  | 'FULFILLED'
  | 'EXPIRED';

const spendMachine = defineStateMachine<SpendStatus>(
  'Spend request',
  {
    DRAFT: ['SUBMITTED', 'CANCELLED'],
    SUBMITTED: ['PENDING_APPROVAL', 'APPROVED', 'BLOCKED'],
    PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'ESCALATED', 'CANCELLED'],
    CHANGES_REQUESTED: ['DRAFT', 'CANCELLED'],
    ESCALATED: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'],
    APPROVED: ['FULFILLED', 'EXPIRED'],
    BLOCKED: ['DRAFT'],
    REJECTED: [],
    CANCELLED: [],
    FULFILLED: [],
    EXPIRED: [],
  },
  ['REJECTED', 'CANCELLED', 'FULFILLED', 'EXPIRED'],
);

describe('StateMachine — legal transitions', () => {
  it.each(spendMachine.legalTransitions())('allows %s → %s', (from, to) => {
    expect(spendMachine.canTransition(from, to)).toBe(true);
    expect(spendMachine.transition(from, to)).toBe(to);
  });
});

describe('StateMachine — illegal transitions (FR-SPD-005)', () => {
  /**
   * Exhaustive, not representative. The illegal transition nobody thought to
   * test is precisely the one that ships — so every ordered pair outside the
   * table is asserted to throw.
   */
  const illegal = spendMachine.illegalTransitions();

  it('has a non-trivial negative space to check', () => {
    expect(illegal.length).toBeGreaterThan(50);
  });

  it.each(illegal)('rejects %s → %s', (from, to) => {
    expect(spendMachine.canTransition(from, to)).toBe(false);
    expect(() => spendMachine.transition(from, to)).toThrow(InvalidStateTransitionError);
  });

  it('names the entity, current state, and attempted state in the error', () => {
    try {
      spendMachine.transition('DRAFT', 'APPROVED');
      expect.unreachable('should have thrown');
    } catch (error) {
      const e = error as InvalidStateTransitionError;
      expect(e.code).toBe('INVALID_STATE_TRANSITION');
      expect(e.httpStatus).toBe(409);
      expect(e.details).toMatchObject({
        entity: 'Spend request',
        currentState: 'DRAFT',
        attemptedState: 'APPROVED',
      });
    }
  });

  it('specifically rejects the transitions that would bypass approval', () => {
    // Each of these would let spend be authorised without a decision.
    expect(() => spendMachine.transition('DRAFT', 'APPROVED')).toThrow();
    expect(() => spendMachine.transition('DRAFT', 'FULFILLED')).toThrow();
    expect(() => spendMachine.transition('REJECTED', 'APPROVED')).toThrow();
    expect(() => spendMachine.transition('CANCELLED', 'APPROVED')).toThrow();
    expect(() => spendMachine.transition('BLOCKED', 'APPROVED')).toThrow();
  });

  it('does not permit a self-transition unless it is declared', () => {
    expect(spendMachine.canTransition('DRAFT', 'DRAFT')).toBe(false);
  });
});

describe('StateMachine — structure', () => {
  it('reports terminal states', () => {
    expect(spendMachine.isTerminal('REJECTED')).toBe(true);
    expect(spendMachine.isTerminal('FULFILLED')).toBe(true);
    expect(spendMachine.isTerminal('DRAFT')).toBe(false);
  });

  it('terminal states have no outgoing transitions', () => {
    for (const state of spendMachine.states) {
      if (spendMachine.isTerminal(state)) {
        expect(spendMachine.allowedFrom(state), `${state} should be a dead end`).toHaveLength(0);
      }
    }
  });

  it('has no unreachable states — the table and the documented diagram agree', () => {
    // A state nobody can reach means either a missing transition or a state
    // that should not exist. Either way the docs are wrong.
    expect(spendMachine.unreachableFrom('DRAFT')).toEqual([]);
  });

  it('enumerates its states', () => {
    expect(spendMachine.states).toHaveLength(11);
    expect(spendMachine.states).toContain('PENDING_APPROVAL');
  });

  it('returns an empty list for an unknown source state rather than throwing', () => {
    expect(spendMachine.allowedFrom('NOT_A_STATE' as SpendStatus)).toEqual([]);
  });
});
