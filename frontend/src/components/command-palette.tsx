'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@financy/ui';

import { Icon } from './icons';
import { groupedItems, matchesQuery, SECTION_LABELS, type NavItem } from '@/lib/navigation';

/**
 * `⌘K` — the primary navigation.
 *
 * The sidebar holds five things; this holds everything. That split is the
 * whole design: a list of fourteen links is scanned, not read, and scanning is
 * slower than typing three letters of the word you already had in mind.
 *
 * Three properties make it usable rather than decorative:
 *
 * - **It opens on the first keystroke.** No route change, no fetch. Anything
 *   that makes `⌘K` feel slower than clicking kills the habit immediately.
 * - **It matches subsequences.** `arv` finds "Approvals"; `dept` finds
 *   Settings through its keywords. Prefix matching means remembering what we
 *   named things, which is our problem, not the user's.
 * - **It is fully keyboard-driven and fully mouse-driven.** Neither is a
 *   second-class path.
 *
 * Permission filtering happens here too, from the same manifest the sidebar
 * uses — so the palette cannot offer a route the sidebar hides.
 */
export function CommandPalette({
  permissions,
  builtPhases,
}: {
  permissions: ReadonlySet<string>;
  builtPhases: number;
}): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    const groups = groupedItems(permissions)
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => matchesQuery(item, query)),
      }))
      .filter((group) => group.items.length > 0);

    // Flattened alongside the grouping, so arrow keys move through one list
    // while the eye reads sections.
    return { groups, flat: groups.flatMap((group) => group.items) };
  }, [permissions, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setHighlighted(0);
  }, []);

  const go = useCallback(
    (item: NavItem) => {
      close();
      router.push(item.href);
    },
    [close, router],
  );

  // ⌘K / Ctrl-K anywhere, Escape to leave. Registered on `document` because
  // the palette has no trigger element to attach to when it is closed.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((previous) => !previous);
        return;
      }

      if (event.key === 'Escape' && open) {
        event.preventDefault();
        close();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Reset the cursor whenever the result set changes, so it never points past
  // the end of a list that just got shorter.
  useEffect(() => {
    setHighlighted(0);
  }, [query]);

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-highlighted="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  if (!open) {
    return (
      <PaletteTrigger
        onOpen={() => {
          setOpen(true);
        }}
      />
    );
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((index) => (index + 1) % Math.max(results.flat.length, 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted(
        (index) => (index - 1 + results.flat.length) % Math.max(results.flat.length, 1),
      );
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = results.flat[highlighted];
      if (item) go(item);
    }
  }

  let cursor = -1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink-950/40 pt-[12vh] backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-[560px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-white shadow-2xl"
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--border-subtle)] px-4">
          <span className="text-ink-400">
            <Icon name="list" />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            onKeyDown={onInputKeyDown}
            placeholder="Jump to…"
            aria-label="Search navigation"
            className="h-12 flex-1 bg-transparent text-[15px] text-ink-900 outline-none placeholder:text-ink-400"
          />
          <kbd className="rounded border border-[var(--border-default)] px-1.5 py-0.5 text-[11px] text-ink-500">
            esc
          </kbd>
        </div>

        <ul ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
          {results.flat.length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-ink-500">
              Nothing matches “{query}”.
            </li>
          )}

          {results.groups.map((group) => (
            <li key={group.section}>
              <p className="px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-ink-400 uppercase">
                {SECTION_LABELS[group.section]}
              </p>
              <ul>
                {group.items.map((item) => {
                  cursor += 1;
                  const isHighlighted = cursor === highlighted;
                  const index = cursor;

                  return (
                    <li key={item.href}>
                      <button
                        type="button"
                        data-highlighted={isHighlighted}
                        onMouseEnter={() => {
                          setHighlighted(index);
                        }}
                        onClick={() => {
                          go(item);
                        }}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-2 text-left text-sm',
                          isHighlighted ? 'bg-cobalt-50 text-cobalt-800' : 'text-ink-700',
                        )}
                      >
                        <span className={isHighlighted ? 'text-cobalt-600' : 'text-ink-400'}>
                          <Icon name={item.icon} />
                        </span>
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.phase > builtPhases && (
                          <span className="text-[11px] text-ink-400">Phase {item.phase}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * The affordance that teaches the shortcut.
 *
 * A palette nobody knows about is a palette nobody uses, so the trigger sits
 * in the sidebar showing its own keystroke. It stops being clicked within a
 * day or two, which is the point.
 */
function PaletteTrigger({ onOpen }: { onOpen: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-8 w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left text-[13px] text-ink-400 transition-colors hover:bg-white/6 hover:text-ink-200"
    >
      <Icon name="list" />
      <span className="flex-1">Jump to…</span>
      <kbd className="rounded border border-white/15 px-1 py-px font-sans text-[10px] text-ink-400">
        ⌘K
      </kbd>
    </button>
  );
}
