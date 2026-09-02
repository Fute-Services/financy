'use client';

import { useActionState, useState } from 'react';
import { Button, Card, CardBody, CardHeader, FormMessage, Input } from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { closePeriod, runExport } from './actions';

/**
 * Running an export, and closing a month.
 *
 * ## The dry run is the primary button
 *
 * "Check first" is the press somebody should make, and making it the prominent
 * one is cheaper than a confirmation dialog on the real run. The real export is
 * beside it, secondary, and the two send the same filters — because a dry run
 * that could differ from the run it models is worse than not having one.
 *
 * ## Closing is behind a second press
 *
 * Not because it is dangerous — it is reversible, with a reason — but because
 * it is a different decision from exporting, and a screen that offered both as
 * equals would invite somebody to close a month they meant to export.
 */
export function ExportRunner(): React.JSX.Element {
  const [state, submit, pending] = useActionState(runExport, IDLE);
  const [closeState, close, closing] = useActionState(closePeriod, IDLE);
  const [closeOpen, setCloseOpen] = useState(false);

  const now = new Date();
  const firstOfLastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const lastOfLastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));

  return (
    <Card>
      <CardHeader
        title="Export a period"
        description="Reviewed and coded records only. Anything already exported is skipped, and anything unmapped is listed rather than given a default account."
      />
      <CardBody className="flex flex-col gap-4">
        <form action={submit} className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              name="periodStart"
              label="From"
              type="date"
              defaultValue={firstOfLastMonth.toISOString().slice(0, 10)}
              required
            />
            <Input
              name="periodEnd"
              label="To"
              type="date"
              defaultValue={lastOfLastMonth.toISOString().slice(0, 10)}
              required
            />
          </div>

          {state.status === 'error' && state.message !== undefined && (
            <FormMessage>{state.message}</FormMessage>
          )}
          {state.status === 'success' && state.message !== undefined && (
            <p className="text-[13px] text-[var(--color-success-text)]">{state.message}</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" name="dryRun" value="true" variant="primary" loading={pending}>
              Check what would go
            </Button>
            <Button type="submit" name="dryRun" value="false" variant="secondary" loading={pending}>
              Export it
            </Button>
          </div>
        </form>

        <div className="border-t border-[var(--border-subtle)] pt-3">
          {closeOpen ? (
            <form action={close} className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  name="periodStart"
                  label="Close from"
                  type="date"
                  defaultValue={firstOfLastMonth.toISOString().slice(0, 10)}
                  required
                />
                <Input
                  name="periodEnd"
                  label="Close to"
                  type="date"
                  defaultValue={lastOfLastMonth.toISOString().slice(0, 10)}
                  required
                />
              </div>

              <Input name="note" label="Note" maxLength={1000} />

              {closeState.status === 'error' && closeState.message !== undefined && (
                <FormMessage>{closeState.message}</FormMessage>
              )}

              <div className="flex gap-2">
                <Button type="submit" variant="primary" size="sm" loading={closing}>
                  Close the period
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setCloseOpen(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setCloseOpen(true)}>
              Close a period
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
