/**
 * `@financy/ui` — the Financy design system.
 *
 * Consumed as source and transpiled by the app, so a token change is visible
 * on the next hot reload rather than after a package rebuild.
 *
 * See docs/UI-DESIGN-SYSTEM.md. The one rule worth repeating here: the
 * `Money` component formats and never calculates, and it has no prop that
 * would allow otherwise.
 */

export { cn } from './lib/cn';

export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './primitives/button';
export {
  Badge,
  StatusBadge,
  toneForStatus,
  humanizeStatus,
  type BadgeProps,
  type BadgeTone,
  type StatusBadgeProps,
} from './primitives/badge';

export { Money, NoValue, type MoneyProps } from './finance/money';

export { Card, CardHeader, CardBody, KpiCard, BudgetMeter, type KpiCardProps } from './data/card';
export { DataTable, type Column, type DataTableProps } from './data/table';
export {
  FirstRunEmptyState,
  FilteredEmptyState,
  ScopeEmptyState,
  Skeleton,
  TableSkeleton,
  ErrorState,
  PermissionState,
} from './data/states';
