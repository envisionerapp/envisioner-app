import './globals.css'

export const metadata = {
  title: 'Envisioner',
  description: 'Your AI-powered influencer marketing command center',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
