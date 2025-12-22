'use client';

import { useEffect, useState, useRef } from 'react';
// YENİ: Sunucu eylemlerini import et
import { getReportData, generateExcelReport } from '@/app/actions';
import { useAuth } from '@/app/context/AuthContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

// Word dışa aktarma fonksiyonu istemci tarafında kalabilir
import { exportReportToWord } from '@/lib/wordExport';

import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    BarElement,
    Title,
    Tooltip,
    Legend,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

import { 
    Loader2, 
    ShieldX, 
    ArrowLeft, 
    Users, 
    UserCheck, 
    UserX, 
    Percent, 
    FileText, 
    FileSpreadsheet,
    BarChart, 
    Target, 
    Info, 
    Download,
    ClipboardList
} from 'lucide-react';

ChartJS.register(
    CategoryScale,
    LinearScale,
    BarElement,
    Title,
    Tooltip,
    Legend
);

// --- Yardımcı Bileşenler (Değişiklik yok) ---
const LoadingSpinner = ({ text }: { text: string }) => (
    <div className="d-flex flex-column vh-100 align-items-center justify-content-center bg-light">
        <Loader2 className="animate-spin text-primary mb-3" style={{ width: '50px', height: '50px' }} />
        <h4 className="text-muted fw-normal">{text}</h4>
    </div>
);

const ErrorDisplay = ({ message }: { message: string }) => (
    <div className="alert alert-danger d-flex align-items-center m-4" role="alert">
        <ShieldX className="me-3" size={48} />
        <div>
            <h4 className="alert-heading">Rapor Oluşturulamadı</h4>
            <p>{message}</p>
            <Link href="/dashboard/analysis" className="btn btn-outline-danger">
                Analiz Sayfasına Dön
            </Link>
        </div>
    </div>
);

const StatCard = ({ icon, title, value, colorClass }: { icon: React.ReactNode, title: string, value: string | number, colorClass: string }) => (
    <div className={`card ${colorClass} text-white shadow-sm`}>
        <div className="card-body d-flex align-items-center">
            <div className="me-3">{icon}</div>
            <div>
                <h5 className="card-title mb-0">{value}</h5>
                <p className="card-text mb-0">{title}</p>
            </div>
        </div>
    </div>
);

const ChartCard = ({ title, icon, children }: { title: string, icon: React.ReactNode, children: React.ReactNode }) => (
    <div className="card h-100">
        <div className="card-header d-flex align-items-center">
            {icon} <h5 className="card-title mb-0 ms-2">{title}</h5>
        </div>
        <div className="card-body">{children}</div>
    </div>
);

// --- Ana Rapor Bileşeni ---

export default function ReportClientPage({ examId }: { examId: string }) {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const [reportData, setReportData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [isExporting, setIsExporting] = useState(false); // Dışa aktarma durumu için state
    const [error, setError] = useState<string | null>(null);
    const chartRefs = useRef<Map<string, any>>(new Map());

    useEffect(() => {
        if (authLoading) return;
        if (!user) {
            router.push('/login');
            return;
        }

        const fetchReport = async () => {
            setLoading(true);
            try {
                const result = await getReportData(examId, user.uid);
                if (result.success) {
                    setReportData(result.data);
                } else {
                    setError(result.message || 'Bilinmeyen bir hata oluştu.');
                }
            } catch (err: any) {
                setError(`Rapor verileri alınırken bir hata oluştu: ${err.message}`);
            }
            setLoading(false);
        };

        fetchReport();
    }, [examId, user, authLoading, router]);
    
    const handleExportToWord = () => {
        if (!reportData) return;
        const chartImages: { [key: string]: string } = {};
        chartRefs.current.forEach((chartInstance, id) => {
            if (chartInstance) {
                chartImages[id] = chartInstance.toBase64Image();
            }
        });
        exportReportToWord(reportData, chartImages);
    };

    // YENİ: Sunucu Eylemini Çağıran Excel Dışa Aktarma Fonksiyonu
    const handleExportToExcel = async () => {
        if (!reportData || isExporting) return;
        setIsExporting(true);

        try {
            const chartImages: { [key: string]: string } = {};
            chartRefs.current.forEach((chartInstance, id) => {
                if (chartInstance) {
                    chartImages[id] = chartInstance.toBase64Image();
                }
            });

            // Sunucu eylemini çağır
            const result = await generateExcelReport(reportData, chartImages);

            if (result.success && result.fileData) {
                // Sunucudan gelen base64 verisini dosyaya dönüştür ve indir
                const link = document.createElement("a");
                link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${result.fileData}`;
                const fileName = `${reportData.classInfo.name}_${reportData.exam.title}_Raporu.xlsx`.replace(/[^a-zA-Z0-9_.-]/g, '-');
                link.download = fileName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            } else {
                alert(`Excel raporu oluşturulamadı: ${result.message || 'Bilinmeyen sunucu hatası'}`);
            }
        } catch (error: any) {
            alert(`Excel dışa aktarılırken bir hata oluştu: ${error.message}`);
        }

        setIsExporting(false);
    };

    if (loading || authLoading) {
        return <LoadingSpinner text="Rapor verileri analiz ediliyor ve oluşturuluyor..." />;
    }

    if (error) {
        return <ErrorDisplay message={error} />;
    }

    if (!reportData) {
        return <ErrorDisplay message="Analiz edilecek rapor verisi bulunamadı." />;
    }

    const { stats, charts, studentResults, questionAnalysis, kazanimAnalysis, exam, classInfo, summaryNote, questions } = reportData;

    const getStatusRowClass = (status: string) => {
        switch (status) {
            case 'Başarısız': return 'table-danger';
            case 'Girmedi': return 'table-secondary';
            default: return '';
        }
    };
     const getStatusTextClass = (status: string) => {
        switch (status) {
            case 'Başarılı': return 'text-success';
            case 'Başarısız': return 'text-danger';
            case 'Girmedi': return 'text-dark';
            default: return '';
        }
    };

    return (
        <div className="container-fluid bg-light p-4">
            <header className="mb-4">
                 <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
                    <Link href="/dashboard/analysis" className="btn btn-outline-secondary">
                        <ArrowLeft size={16} className="me-2" /> Analiz Listesine Dön
                    </Link>
                    <div className='d-flex gap-2'>
                         <button 
                            onClick={handleExportToExcel}
                            className="btn btn-success"
                            disabled={isExporting} // Butonu işlem sırasında devre dışı bırak
                        >
                            {isExporting ? <Loader2 size={16} className="animate-spin me-2" /> : <FileSpreadsheet size={16} className="me-2" />} 
                            {isExporting ? 'Oluşturuluyor...' : "Excel'e Aktar"}
                        </button>
                        <button 
                            onClick={handleExportToWord} 
                            className="btn btn-primary"
                        >
                            <FileText size={16} className="me-2" /> Word'e Aktar
                        </button>
                    </div>
                </div>
                <div className="p-4 rounded bg-white shadow-sm border">
                    <h1 className="display-6 fw-bold">{exam.title}</h1>
                    <p className="lead text-muted">{classInfo.name} Sınıfı Detaylı Analiz Raporu</p>
                </div>
            </header>

            {/* ... (kodun geri kalanı aynı) ... */}
            <section className="mb-4">
                <div className="row g-3">
                    <div className="col"><StatCard icon={<Users size={32} />} title="Kayıtlı Öğrenci" value={stats.totalStudents} colorClass="bg-secondary" /></div>
                    <div className="col"><StatCard icon={<UserCheck size={32} />} title="Sınava Giren" value={stats.participatingStudents} colorClass="bg-primary" /></div>
                    <div className="col"><StatCard icon={<UserX size={32} />} title="Başarısız Öğrenci" value={stats.unsuccessfulStudents} colorClass="bg-danger" /></div>
                    <div className="col"><StatCard icon={<Percent size={32} />} title="Katılım Başarısı" value={`%${stats.overallSuccessPercentage}`} colorClass="bg-info" /></div>
                </div>
            </section>
            
             <div className="alert alert-light border shadow-sm mb-4 d-flex">
                <Info size={24} className="text-primary me-3 flex-shrink-0"/>
                <p className="mb-0">{summaryNote}</p>
            </div>

            <section className="card mb-4">
                <div className="card-header d-flex align-items-center">
                    <ClipboardList size={20}/> <h5 className="card-title mb-0 ms-2">Öğrenci Sonuçları</h5>
                </div>
                <div className="card-body">
                    <div className="table-responsive">
                        <table className="table table-bordered table-hover table-sm align-middle">
                            <thead className="table-light text-center">
                                <tr>
                                    <th scope="col">Öğrenci No</th>
                                    <th scope="col" style={{textAlign: 'left'}}>Öğrenci Adı</th>
                                    {questions.map((q: any) => <th key={q.id}>S{q.questionNumber}<br/><small className="fw-normal">({q.points}p)</small></th>)}
                                    <th scope="col">Toplam Puan</th>
                                    <th scope="col">Durum</th>
                                </tr>
                            </thead>
                            <tbody>
                                {studentResults.map((s: any) => (
                                    <tr key={s.id} className={getStatusRowClass(s.status)}>
                                        <td className="text-center">{s.studentNumber}</td>
                                        <td>{s.name}</td>
                                        {s.scores.map((sc: any, index: number) => (
                                            <td key={index} className="text-center">
                                                {sc.score !== null ? sc.score : '-'}
                                            </td>
                                        ))}
                                        <td className="text-center fw-bold">
                                            {s.totalScore !== null ? s.totalScore : '-'}
                                        </td>
                                        <td className={`text-center fw-bold ${getStatusTextClass(s.status)}`}>
                                            {s.status}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>
            
            <div className="row g-4 mb-4">
                <div className="col-lg-6">
                    <div className="card h-100">
                        <div className="card-header d-flex align-items-center">
                            <BarChart size={20}/> <h5 className="card-title mb-0 ms-2">Soru Başarı Analizi</h5>
                        </div>
                        <div className="card-body">
                             <div className="table-responsive">
                                <table className="table table-striped table-sm">
                                    <thead className="table-light">
                                        <tr><th>Soru No</th><th>Sınıf Ortalaması</th><th>Başarı Yüzdesi</th></tr>
                                    </thead>
                                    <tbody>
                                        {questionAnalysis.map((q: any) => (
                                            <tr key={q.id}>
                                                <td>{q.questionNumber}</td>
                                                <td>{q.averageScore}</td>
                                                <td>%{q.successPercentage.toFixed(2)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
                {kazanimAnalysis && kazanimAnalysis.length > 0 && (
                 <div className="col-lg-6">
                    <div className="card h-100">
                         <div className="card-header d-flex align-items-center">
                           <Target size={20}/> <h5 className="card-title mb-0 ms-2">Kazanım Başarı Analizi</h5>
                        </div>
                        <div className="card-body">
                            <div className="table-responsive">
                                <table className="table table-striped table-sm">
                                    <thead className="table-light">
                                        <tr><th>Kazanım</th><th>Başarı Yüzdesi</th></tr>
                                    </thead>
                                    <tbody>
                                        {kazanimAnalysis.map((k: any, i:number) => (
                                            <tr key={i}>
                                                <td>{k.kazanim}</td>
                                                <td>%{k.successPercentage.toFixed(2)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
                )}
            </div>

            <section className="row g-4 mb-4">
                <div className="col-lg-6">
                    <ChartCard title="Soruların Sınıf Başarısı" icon={<BarChart size={20}/>}>
                    <Bar 
                        ref={(el) => chartRefs.current.set('questionSuccess', el)} 
                        options={{ 
                            responsive: true, 
                            maintainAspectRatio: false, 
                            indexAxis: 'y' as const,
                            scales: {
                                x: {
                                    min: 0,
                                    max: 100
                                }
                            } 
                        }} 
                        data={charts.questionSuccess} 
                        style={{height: '300px'}}
                    />
                    </ChartCard>
                </div>
                 {charts.kazanimSuccess && charts.kazanimSuccess.datasets[0].data.length > 0 && (
                    <div className="col-lg-6">
                        <ChartCard title="Kazanım Başarıları" icon={<Target size={20}/>}>
                        <Bar 
                            ref={(el) => chartRefs.current.set('kazanimSuccess', el)} 
                            options={{ 
                                responsive: true, 
                                maintainAspectRatio: false, 
                                indexAxis: 'y' as const,
                                scales: {
                                    x: {
                                        min: 0,
                                        max: 100
                                    }
                                } 
                            }} 
                            data={charts.kazanimSuccess} 
                            style={{height: '300px'}}
                        />
                        </ChartCard>
                    </div>
                )}
            </section>
            {charts.studentScores && (
                 <section className="row g-4">
                    <div className="col-12">
                        <ChartCard title="Öğrenci Puan Dağılımı (100 Üzerinden)" icon={<BarChart size={20}/>}>
                            <div style={{ height: '400px' }}>
                                <Bar 
                                    ref={(el) => chartRefs.current.set('studentScores', el)}
                                    data={charts.studentScores}
                                    options={{ 
                                        responsive: true, 
                                        maintainAspectRatio: false,
                                        scales: {
                                            y: {
                                                beginAtZero: true,
                                                max: 100,
                                                title: {
                                                    display: true,
                                                    text: 'Puan (100)'
                                                }
                                            },
                                            x: {
                                                ticks: {
                                                    autoSkip: false,
                                                    maxRotation: 90,
                                                    minRotation: 45
                                                }
                                            }
                                        }
                                    }} 
                                />
                            </div>
                        </ChartCard>
                    </div>
                </section>
            )}

        </div>
    );
}
