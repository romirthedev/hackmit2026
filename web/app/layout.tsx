import type { Metadata } from 'next';
import './globals.css';
import './memory-interactions.css';
export const metadata: Metadata = {
  title: 'REWIND · Your physical memory',
  description:
    'Your recordings, conversations, and evidence-backed answers in one personal workspace.',
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
