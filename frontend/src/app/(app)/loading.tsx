import { Card, Skeleton, TableSkeleton } from '@financy/ui';

/**
 * What a navigation looks like while it is happening.
 *
 * Every screen under this layout is server-rendered on demand against the API,
 * which takes roughly a second — longer the first time a dev server compiles
 * the route. Without this file the App Router holds the *previous* page on
 * screen for that whole second: the sidebar link highlights nothing, the
 * content does not change, and the click reads as having been dropped. That is
 * the entire "the buttons feel laggy" complaint, and it is a missing loading
 * state rather than slow code.
 *
 * It lives at the group root rather than per route because the shape below is
 * what almost every screen here actually is — a page header, then a table in a
 * card. A skeleton that guesses wrong is still better than a frozen page, and
 * a route whose shape is genuinely different can add its own `loading.tsx`
 * beside its `page.tsx`.
 *
 * Note what is *not* skeletoned: the shell. The layout resolves the session
 * before it renders, so the sidebar, the organisation name and the counts are
 * already correct and stay put. Only the region that is actually changing
 * flickers, which is what makes the transition read as navigation rather than
 * as a reload.
 */
export default function Loading(): React.JSX.Element {
  return (
    <div role="status" aria-label="Loading the page">
      <div className="mb-6">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="mt-2.5 h-4 w-96" />
      </div>

      <Card>
        <TableSkeleton rows={8} columns={5} />
      </Card>
    </div>
  );
}
