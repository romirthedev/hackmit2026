import type { Metadata } from 'next';
import './globals.css';
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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
