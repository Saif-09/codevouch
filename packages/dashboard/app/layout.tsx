import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Vouch',
  description: 'The share of your codebase you can actually defend.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
