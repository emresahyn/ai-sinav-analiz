
'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { LayoutDashboard, Users, BookCopy, LogOut, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';

const menuItems = [
  { name: 'Panel', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Sınıflar', href: '/dashboard/classes', icon: Users },
  { name: 'Sınavlar', href: '/dashboard/exams', icon: BookCopy },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const handleSignOut = async () => {
    await signOut(auth);
    router.push('/login');
  };

  return (
    <div className={`d-flex flex-column vh-100 bg-dark text-white p-3 transition-width ${isCollapsed ? 'w-25' : 'w-100'}`}>
        <div className="d-flex align-items-center justify-content-between mb-4">
            {!isCollapsed && <span className="fs-4">Sınav Analiz</span>}
            <button className="btn btn-outline-light" onClick={() => setIsCollapsed(!isCollapsed)}>
                {isCollapsed ? <ChevronRight /> : <ChevronLeft />}
            </button>
        </div>
      <hr/>
      <ul className="nav nav-pills flex-column mb-auto">
        {menuItems.map((item) => {
          const isActive = pathname ? pathname.startsWith(item.href) && (item.href !== '/dashboard' || pathname === '/dashboard') : false;
          return (
            <li className="nav-item" key={item.name}>
              <Link href={item.href} className={`nav-link text-white d-flex align-items-center ${isActive ? 'active' : ''}`}>
                <item.icon className="me-2" />
                {!isCollapsed && item.name}
              </Link>
            </li>
          );
        })}
      </ul>
      <hr/>
      <div className="dropdown">
        <button onClick={handleSignOut} className="btn btn-danger w-100 d-flex align-items-center justify-content-center">
            <LogOut className="me-2" />
            {!isCollapsed && 'Çıkış Yap'}
        </button>
      </div>
    </div>
  );
}