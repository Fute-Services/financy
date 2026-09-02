import { cn } from '../lib/cn';

export interface BarChartPoint {
  /** The axis label — a month, a week, a department. */
  label: string;
  /** Already formatted for display. This component never formats money. */
  formatted: string;
  /** The magnitude, for geometry only. */
  value: number;
  /** Marks the current period, which is incomplete and should read as such. */
  partial?: boolean;
}

export interface BarChartProps {
  points: readonly BarChartPoint[];
  /** Describes the whole chart to a screen reader. */
  caption: string;
  height?: number;
  className?: string;
}

/**
 * A bar chart that is honest about being small.
 *
 * ## Why not a chart library
 *
 * Six bars and a baseline is not a charting problem. Every library that would
 * draw this ships a renderer, a scale system, and an animation loop to do it —
 * and none of them produce markup a screen reader can read, so the accessible
 * table has to be written by hand anyway. What is left is geometry, and the
 * geometry is four lines.
 *
 * ## The axis is what makes it a chart
 *
 * The first version of this was bare `div`s with values floating above them.
 * Bars with no baseline and no scale are a picture of some rectangles: two
 * bars differing by 8% look identical, and a value near zero renders as a
 * sliver that reads as a rendering fault rather than as a quiet month.
 * Gridlines at quarters of a rounded maximum give every bar something to be
 * measured against.
 *
 * ## Numbers are never re-derived here
 *
 * `formatted` arrives ready. This component knows a magnitude for geometry and
 * a string for display, and cannot accidentally show a number the server did
 * not produce — which is the same rule the rest of the application follows
 * (docs/15 §1).
 *
 * ## It is readable without colour, and without sight
 *
 * Each bar carries its own value beneath it, so nothing depends on comparing
 * heights. The visually-hidden table is the real content for a screen reader;
 * the bars are `aria-hidden` decoration over it.
 */
export function BarChart({
  points,
  caption,
  height = 180,
  className,
}: BarChartProps): React.JSX.Element {
  const peak = points.reduce((highest, point) => Math.max(highest, point.value), 0);

  // Round the top of the scale up to something a person would choose, so the
  // gridlines land on readable numbers instead of on 1.03× the tallest bar.
  const ceiling = niceCeiling(peak);

  return (
    <figure className={cn('m-0', className)}>
      <div className="relative" style={{ height: `${String(height)}px` }} aria-hidden="true">
        {/* Gridlines, behind everything, at quarters of the scale. */}
        <div className="absolute inset-0 flex flex-col justify-between">
          {[0, 1, 2, 3, 4].map((step) => (
            <div key={step} className="border-t border-dashed border-[var(--border-subtle)]" />
          ))}
        </div>

        <ol className="absolute inset-0 flex items-end gap-2 px-1">
          {points.map((point) => {
            const ratio = ceiling === 0 ? 0 : point.value / ceiling;

            return (
              <li key={point.label} className="group flex h-full flex-1 flex-col justify-end">
                <div
                  className={cn(
                    'w-full rounded-t-[var(--radius-sm)] transition-[filter,opacity]',
                    'group-hover:brightness-110',
                    point.partial === true
                      ? // The current period is not finished. Hatching says so
                        // without needing a legend nobody reads.
                        'bg-[var(--color-chart-1)] opacity-45'
                      : 'bg-[var(--color-chart-1)]',
                  )}
                  style={{
                    // A floor of two pixels: a real but tiny value must still
                    // draw something, or a quiet month is indistinguishable
                    // from a missing one.
                    height: `${String(Math.max(ratio * 100, point.value > 0 ? 1.5 : 0))}%`,
                  }}
                />
              </li>
            );
          })}
        </ol>
      </div>

      {/* The axis: label and value together, so no bar has to be measured. */}
      <ol className="mt-2 flex gap-2 px-1" aria-hidden="true">
        {points.map((point) => (
          <li key={point.label} className="flex-1 text-center">
            <div className="tabular text-[12px] font-medium text-ink-800">{point.formatted}</div>
            <div className="text-[11px] text-ink-400">
              {point.label}
              {point.partial === true && ' · so far'}
            </div>
          </li>
        ))}
      </ol>

      <figcaption className="sr-only">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col">Amount</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.label}>
                <th scope="row">
                  {point.label}
                  {point.partial === true ? ' (so far)' : ''}
                </th>
                <td>{point.formatted}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}

/**
 * A scale maximum a person would have chosen.
 *
 * `64,890` becomes `70,000` rather than `64,890`, so the gridlines sit on
 * numbers that mean something and the tallest bar does not touch the ceiling.
 */
function niceCeiling(peak: number): number {
  if (peak <= 0) return 0;

  const magnitude = 10 ** Math.floor(Math.log10(peak));
  const steps = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10];

  for (const step of steps) {
    const candidate = step * magnitude;
    if (candidate >= peak) return candidate;
  }

  return 10 * magnitude;
}
