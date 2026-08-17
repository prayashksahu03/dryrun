import { ReactNode } from 'react';
import SiteNav from './SiteNav';
import SiteFooter from './SiteFooter';

// Wraps the marketing pages (Home, Learn). font-sans here makes all chrome copy
// use Inter (the tool stays mono). Themed light/dark via the `dark` html class.
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="font-sans min-h-screen flex flex-col bg-white dark:bg-[#09090b] text-zinc-900 dark:text-zinc-100 antialiased">
      <SiteNav />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
