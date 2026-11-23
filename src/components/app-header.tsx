'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type HealthState, StatusPill } from '@/components/status-pill';

const NAV = [
  {
    href: '/',
    label: 'Dashboard',
    match: (path: string) => path === '/' || path.startsWith('/domains'),
  },
  {
    href: '/reports',
    label: 'Reports',
    match: (path: string) => path.startsWith('/reports'),
  },
];

interface AppHeaderProps {
  health: HealthState;
  onRecheck: () => void;
}

export function AppHeader({ health, onRecheck }: AppHeaderProps) {
  const pathname = usePathname();
  return (
    <header className="border-b border-gray-3">
      <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="text-gray-10"
              aria-hidden="true"
            >
              <path
                d="M3 8L10.89 13.26C11.2187 13.4793 11.6049 13.5963 12 13.5963C12.3951 13.5963 12.7813 13.4793 13.11 13.26L21 8M5 19H19C19.5304 19 20.0391 18.7893 20.4142 18.4142C20.7893 18.0391 21 17.5304 21 17V7C21 6.46957 20.7893 5.96086 20.4142 5.58579C20.0391 5.21071 19.5304 5 19 5H5C4.46957 5 3.96086 5.21071 3.58579 5.58579C3.21071 5.96086 3 6.46957 3 7V17C3 17.5304 3.21071 18.0391 3.58579 18.4142C3.96086 18.7893 4.46957 19 5 19Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <h1 className="text-lg font-semibold text-gray-10">
              DMARC Analyzer
            </h1>
          </div>
          <nav aria-label="Main" className="flex items-center gap-1">
            {NAV.map(({ href, label, match }) => {
              const active = match(pathname ?? '');
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? 'bg-gray-3 text-gray-10'
                      : 'text-gray-6 hover:text-gray-9'
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
        <StatusPill health={health} onRecheck={onRecheck} />
      </div>
    </header>
  );
}
