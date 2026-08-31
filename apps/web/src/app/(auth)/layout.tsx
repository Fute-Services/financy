import Link from 'next/link';

import { Logo } from '@/components/icons';

/**
 * The unauthenticated layout.
 *
 * No shell, no navigation, no organisation switcher — there is no session yet,
 * so there is nothing true to put in them. A login screen wrapped in the
 * application chrome shows a sidebar the user cannot use and an organisation
 * name that is a guess.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--surface-page)]">
      <header className="px-6 py-5">
        <Link href="/" className="inline-flex items-center gap-2 text-ink-900">
          <span className="text-cobalt-600">
            <Logo />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Financy</span>
        </Link>
      </header>

      <main className="flex flex-1 items-start justify-center px-6 pt-6 pb-16 sm:items-center sm:pt-0 sm:pb-24">
        <div className="w-full max-w-[400px]">{children}</div>
      </main>

      <footer className="px-6 py-5 text-center text-[12px] text-ink-500">
        Financy holds no compliance certification and is not a regulated financial institution.
      </footer>
    </div>
  );
}
