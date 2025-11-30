
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Users, BookCopy, LogOut, ClipboardList } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';

const navLinks = [
  { href: '/dashboard', label: 'Panel', icon: Home },
  { href: '/dashboard/classes', label: 'Sınıflar', icon: Users },
  { href: '/dashboard/exams', label: 'Sınavlar', icon: BookCopy },
  { href: '/dashboard/analysis', label: 'Analizler', icon: ClipboardList },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { logout } = useAuth();

  // AuthContext, çıkış yapıldığında kullanıcıyı otomatik olarak yönlendirecektir.
  // Bu yüzden burada ek bir yönlendirme yapmaya gerek yoktur.
  const handleLogout = async () => {
    await logout();
  };

  return (
    <aside className="d-flex flex-column vh-100 p-3 bg-light border-end shadow-sm" style={{ width: '250px' }}>
      <h4 className="mb-4 text-primary">Sınav Analiz</h4>
      <ul className="nav nav-pills flex-column mb-auto">
        {navLinks.map((link) => {
          const isActive = pathname === link.href;
          return (
            <li className="nav-item" key={link.href}>
              <Link href={link.href} className={`nav-link d-flex align-items-center ${isActive ? 'active' : 'text-dark'}`}>
                <link.icon size={20} className="me-3" />
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <hr />
      <button className="btn btn-outline-danger d-flex align-items-center" onClick={handleLogout}>
        <LogOut size={20} className="me-3" />
        Çıkış Yap
      </button>
    </aside>
  );
}
