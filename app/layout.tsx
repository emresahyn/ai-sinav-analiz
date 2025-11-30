
import '../styles/globals.css';
import { Inter } from 'next/font/google';
import { AuthProvider } from '@/app/context/AuthContext'; // AuthProvider'ı import et

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  title: 'AI Sınav Analiz',
  description: 'Yapay Zeka Destekli Sınav Analiz Uygulaması',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="tr">
      <body className={inter.className}>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
