
'use client';

import { useAuth } from '@/app/context/AuthContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect } from 'react';
import { Loader2, Users, BookCopy, ArrowRight, ClipboardList } from 'lucide-react';

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
        <div className="d-flex justify-content-center align-items-center vh-100">
            <Loader2 className="animate-spin h-8 w-8 text-primary"/>
        </div>
    );
  }

  if (!user) {
    return null; // Yönlendirme gerçekleşirken hiçbir şey gösterme
  }

  return (
    <div className="container-fluid p-4">
        <header className="border-bottom pb-3 mb-4">
            <h1 className="h2">Kontrol Paneli</h1>
            <p className="text-muted">Sınav analiz uygulamanıza hoş geldiniz, {user.email}.</p>
        </header>

        <div className="row g-4">
            {/* Sınıflar Kartı */}
            <div className="col-lg-4 col-md-6">
                <div className="card h-100 shadow-sm">
                    <div className="card-body d-flex flex-column">
                        <div className="d-flex align-items-start mb-3">
                            <div className="p-3 bg-primary bg-opacity-10 rounded-3 me-3">
                                <Users className="h-6 w-6 text-primary" />
                            </div>
                            <div>
                                <h2 className="card-title h4">Sınıf Yönetimi</h2>
                                <p className="card-text text-muted">Yeni sınıflar oluşturun, mevcut sınıflarınızı düzenleyin ve öğrencilerinizi yönetin.</p>
                            </div>
                        </div>
                        <div className="mt-auto">
                            <Link href="/dashboard/classes" className="btn btn-primary stretched-link">
                                Sınıflara Git <ArrowRight className="ms-2" size={16} />
                            </Link>
                        </div>
                    </div>
                </div>
            </div>

            {/* Sınavlar Kartı */}
            <div className="col-lg-4 col-md-6">
                <div className="card h-100 shadow-sm">
                    <div className="card-body d-flex flex-column">
                        <div className="d-flex align-items-start mb-3">
                            <div className="p-3 bg-success bg-opacity-10 rounded-3 me-3">
                                <BookCopy className="h-6 w-6 text-success" />
                            </div>
                            <div>
                                <h2 className="card-title h4">Sınav Yönetimi</h2>
                                <p className="card-text text-muted">Yeni sınavlar tanımlayın, kazanımları belirleyin ve öğrenci performansını izleyin.</p>
                            </div>
                        </div>
                        <div className="mt-auto">
                            <Link href="/dashboard/exams" className="btn btn-success stretched-link">
                                Sınavlara Git <ArrowRight className="ms-2" size={16} />
                            </Link>
                        </div>
                    </div>
                </div>
            </div>

            {/* Analizler Kartı */}
            <div className="col-lg-4 col-md-6">
                <div className="card h-100 shadow-sm">
                    <div className="card-body d-flex flex-column">
                        <div className="d-flex align-items-start mb-3">
                            <div className="p-3 bg-warning bg-opacity-10 rounded-3 me-3">
                                <ClipboardList className="h-6 w-6 text-warning" />
                            </div>
                            <div>
                                <h2 className="card-title h4">Detaylı Analizler</h2>
                                <p className="card-text text-muted">Sınav ve öğrenci verilerini kullanarak derinlemesine analizler ve raporlar oluşturun.</p>
                            </div>
                        </div>
                        <div className="mt-auto">
                            <Link href="/dashboard/analysis" className="btn btn-warning stretched-link">
                                Analizlere Git <ArrowRight className="ms-2" size={16} />
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        </div>

    </div>
  );
}