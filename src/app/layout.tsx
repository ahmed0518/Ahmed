import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { LogoutButton } from '@/components/LogoutButton';
import { readCredentialSafe } from '@/lib/auth/credential';
import './globals.css';

export const metadata: Metadata = {
  title: 'Trax Production Status',
  description: 'Production status per product on TraxNYC orders — who changed it and when.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#ffffff',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // A Shopify hiccup never fails a page over the header: readCredentialSafe logs and renders "Log in".
  const cred = await readCredentialSafe(await headers());
  const staffName = cred?.kind === 'staff' ? cred.name : null;
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="site-header__inner">
            <Link href="/" className="site-header__brand">
              Trax Production Status
            </Link>
            <nav className="site-header__nav" aria-label="Main">
              <Link href="/">Orders</Link>
              <Link href="/agents" className="site-header__agents">
                Agents
              </Link>
              {staffName ? (
                <>
                  <span className="site-header__who">{staffName}</span>
                  <LogoutButton className="btn--link" />
                </>
              ) : (
                <Link href="/login">Log in</Link>
              )}
            </nav>
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
