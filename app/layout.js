import './globals.css';

export const metadata = {
  title: 'Onboarding Recovery Agent',
  description: 'Razorpay Campus AI Build-a-thon, Problem 3. Synthetic data only.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
