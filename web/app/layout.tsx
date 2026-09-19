import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'REWIND · Your physical memory',
  description:
    'Wireless capture, evidence-backed recall, and connections worth making.',
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
