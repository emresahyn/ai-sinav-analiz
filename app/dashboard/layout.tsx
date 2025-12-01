
import Sidebar from './components/Sidebar';
import { AuthProvider } from '@/app/context/AuthContext';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <div className="d-flex">
        <Sidebar />
        <main className="flex-grow-1 p-4 bg-light-subtle">
          {children}
        </main>
      </div>
    </AuthProvider>
  );
}