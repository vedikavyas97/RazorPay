import './globals.css';

export const metadata = {
  title: 'Onboarding Recovery Agent',
  description: 'Finds why merchant applications stalled and drafts safe nudges for a person to approve. Synthetic data only.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
