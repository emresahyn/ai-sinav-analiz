'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useFormStatus, useFormState } from 'react-dom';
import { collection, doc, onSnapshot, query, orderBy, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/app/context/AuthContext';
import { uploadExamPaper, uploadAnswerKey } from '@/app/upload-action';
import { runAnalysis } from '@/app/analysis-action';
import { Loader2, AlertCircle, ArrowLeft, Wand2, CheckCircle, FileCheck, FileWarning, Upload } from 'lucide-react';

// --- Tür Tanımları ---
interface ExamDetails { id: string; title: string; date: string; answerKeyPath?: string; }
interface Acquisition { id: string; questionNumber: string; description: string; }
interface Class { id: string; name: string; }
interface Student { id: string; name: string; studentNumber: string; }
interface ExamPaper { studentId: string; filePath: string; status?: 'Analiz Edildi' | 'Bekleniyor'; analysis?: any }

// --- Yükleme ve Analiz için Alt Bileşenler ---
const StudentPaperUploader = ({ examId, student, paper }: { examId: string, student: Student, paper?: ExamPaper }) => {
    const [status, setStatus] = useState<{success: boolean, message: string} | null>(null);
    const [isPending, setIsPending] = useState(false);
    
    const action = async (formData: FormData) => {
        setIsPending(true);
        const result = await uploadExamPaper(examId, student.id, formData);
        setStatus(result);
        setIsPending(false);
        setTimeout(() => setStatus(null), 4000);
    }

    const getStatusIndicator = () => {
        if (paper?.status === 'Analiz Edildi') return <div className="flex items-center text-sm text-green-600"><CheckCircle className="w-4 h-4 mr-1"/> Analiz Edildi</div>;
        if (paper) return <div className="flex items-center text-sm text-blue-600"><FileCheck className="w-4 h-4 mr-1"/> Yüklendi</div>;
        return <div className="flex items-center text-sm text-amber-600"><FileWarning className="w-4 h-4 mr-1"/> Bekleniyor</div>;
    }

    return (
         <li className="flex flex-col md:flex-row items-start md:items-center justify-between py-3 gap-2">
            <p className="font-medium text-slate-800">{student.name} <span className="text-xs text-slate-500">({student.studentNumber})</span></p>
            <div className="flex items-center gap-4 w-full md:w-auto">
                {getStatusIndicator()}
                {paper?.status !== 'Analiz Edildi' && (
                    <form action={action} className="flex items-center gap-2">
                        <input type="file" name="examPaper" required className="text-xs text-slate-500 file:mr-2 file:py-1 file:px-2 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100" />
                        <button type="submit" disabled={isPending} className="px-2 py-1 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-blue-400">
                            {isPending ? <Loader2 className="w-4 h-4 animate-spin"/> : <Upload className="w-4 h-4"/>}
                        </button>
                    </form>
                )}
            </div>
             {status && <div className={`mt-2 text-xs ${status.success ? 'text-green-600' : 'text-red-600'}`}>{status.message}</div>}
        </li>
    );
}

const AnalysisRunner = ({ examId, isReady }: { examId: string, isReady: boolean}) => {
    const { user } = useAuth();
    const [status, setStatus] = useState<{success: boolean, message: string} | null>(null);
    const [isPending, setIsPending] = useState(false);

    const handleClick = async () => {
        if (!user || !isReady || !confirm('Analizi başlatmak istediğinizden emin misiniz? Bu işlem mevcut analiz sonuçlarının üzerine yazabilir.')) return;
        
        setIsPending(true);
        const result = await runAnalysis(examId, user.uid);
        setStatus(result);
        setIsPending(false);
        setTimeout(() => setStatus(null), 5000);
    }

    return (
        <div className="mt-4">
            <button onClick={handleClick} disabled={!isReady || isPending} className="w-full inline-flex items-center justify-center px-6 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed">
                {isPending ? <Loader2 className="w-5 h-5 mr-3 animate-spin"/> : <Wand2 className="w-5 h-5 mr-3"/>}
                {isPending ? 'Analiz Ediliyor...' : 'Yapay Zeka Analizini Başlat'}
            </button>
             {!isReady && <p className="text-center text-sm text-amber-600 mt-2">Analizi başlatmak için önce cevap anahtarını yüklemeli ve en az bir öğrenci kağıdı eklemelisiniz.</p>}
             {status && <div className={`mt-4 text-center font-semibold ${status.success ? 'text-green-600' : 'text-red-600'}`}>{status.message}</div>}
        </div>
    );
}

// --- Ana Sayfa Bileşeni ---
export default function ExamDetailClientPage({ id }: { id: string }) {
    const { user, loading: authLoading } = useAuth();
    
    // Durumlar (States)
    const [examDetails, setExamDetails] = useState<ExamDetails | null>(null);
    const [acquisitions, setAcquisitions] = useState<Acquisition[]>([]);
    const [classes, setClasses] = useState<Class[]>([]);
    const [selectedClass, setSelectedClass] = useState<string>('');
    const [students, setStudents] = useState<Student[]>([]);
    const [examPapers, setExamPapers] = useState<Map<string, ExamPaper>>(new Map());
    
    // Yükleme ve Hata Durumları
    const [pageState, setPageState] = useState<'loading' | 'error' | 'success'>('loading');
    const [errorMessage, setErrorMessage] = useState<string>('');

    // Ana Veri Yükleme useEffect'i
    useEffect(() => {
        // Gerekli olan id veya user yoksa, hiçbir şey yapma.
        if (!id || !user) {
            if(!authLoading) {
                setPageState('error');
                setErrorMessage('Kimlik doğrulama başarısız oldu veya sınav kimliği bulunamadı. Lütfen tekrar giriş yapın.');
            }
            return;
        }

        setPageState('loading');

        const unsubscribers: (() => void)[] = [];

        const examDocRef = doc(db, 'exams', id);
        unsubscribers.push(onSnapshot(examDocRef, 
          (doc) => {
            if (doc.exists() && doc.data().teacherId === user.uid) {
                setExamDetails({ id: doc.id, ...doc.data() } as ExamDetails);
                setPageState('success'); // Sadece ana veri yüklendiğinde success yap
            } else {
                setPageState('error');
                setErrorMessage('Bu sınava erişim yetkiniz yok veya sınav bulunamadı.');
            }
          },
          (err) => {
            console.error("Sınav detayları alınırken hata:", err);
            setPageState('error');
            setErrorMessage(`Sınav verileri alınamadı: ${err.message}.`);
          }
        ));

        // Diğer alt sorgular (Bunlar ana sayfayı çökertmez)
        const acqQuery = query(collection(db, 'exams', id, 'acquisitions'), orderBy('questionNumber'));
        unsubscribers.push(onSnapshot(acqQuery, (snapshot) => setAcquisitions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Acquisition)))));

        const classesQuery = query(collection(db, 'classes'), where('teacherId', '==', user.uid));
        unsubscribers.push(onSnapshot(classesQuery, (snapshot) => setClasses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Class)))));

        const papersQuery = query(collection(db, 'exams', id, 'exam-papers'));
        unsubscribers.push(onSnapshot(papersQuery, (snapshot) => {
            const papersData = new Map<string, ExamPaper>();
            snapshot.docs.forEach(doc => papersData.set(doc.data().studentId, doc.data() as ExamPaper));
            setExamPapers(papersData);
        }));

        // Temizleme fonksiyonu
        return () => unsubscribers.forEach(unsub => unsub());

    }, [id, user, authLoading]);

    // Seçilen sınıfa göre öğrencileri getiren useEffect
    useEffect(() => {
        if (selectedClass) {
            const studentsQuery = query(collection(db, 'classes', selectedClass, 'students'));
            const unsub = onSnapshot(studentsQuery, (snapshot) => {
                setStudents(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Student)));
            });
            return () => unsub();
        } else {
            setStudents([]);
        }
    }, [selectedClass]);
    
    // --- RENDER KISMI ---
    if (pageState === 'loading' || authLoading) {
        return <div className="flex h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-blue-600"/> <span className="ml-4 text-slate-600">Yükleniyor...</span></div>;
    }
    
    if (pageState === 'error') {
        return <div className="flex h-screen items-center justify-center p-8 text-center"><AlertCircle className="h-8 w-8 mr-2 text-red-500"/> <span className="text-red-500">{errorMessage}</span></div>;
    }
    
    if (pageState === 'success' && examDetails) {
        const isAnalysisReady = !!examDetails.answerKeyPath && examPapers.size > 0;
        return (
          <div className="flex min-h-screen bg-slate-100 font-sans">
            <main className="flex-1 p-10">
                 <div className="bg-white rounded-xl shadow-xl p-8 mb-10">
                    <h2 className="text-2xl font-semibold text-slate-700 mb-2 flex items-center"><Wand2 className="mr-3 text-purple-500"/> Analiz Et</h2>
                    <p className="text-slate-500 mb-4">Tüm veriler hazır olduğunda, yapay zeka analizini başlatın.</p>
                    <AnalysisRunner examId={id} isReady={isAnalysisReady} />
                </div>

                <div className="bg-white rounded-xl shadow-xl p-8">
                    <h2 className="text-2xl font-semibold text-slate-700 mb-6">Sınav Kağıtlarını Yükle</h2>
                    <div className="mb-6 max-w-sm">
                        <label htmlFor="class-select" className="block text-sm font-medium text-slate-600 mb-1">Sınıf Seç</label>
                        <select id="class-select" value={selectedClass} onChange={e => setSelectedClass(e.target.value)} className="w-full rounded-md border-slate-300 shadow-sm">
                            <option value="">Sınıf seçin...</option>
                            {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>

                    {selectedClass && (
                        <div>
                             <h3 className="text-lg font-semibold text-slate-600 mb-4">Öğrenci Kağıtları ({students.length})</h3>
                            {students.length > 0 ? (
                                <ul className="divide-y divide-slate-200">
                                    {students.map(student => <StudentPaperUploader key={student.id} examId={id} student={student} paper={examPapers.get(student.id)} />)}
                                </ul>
                            ) : <p className="text-sm text-slate-500">Bu sınıfta öğrenci bulunmuyor.</p>}
                        </div>
                    )}
                </div>
            </main>
          </div>
        );
    }

    // Beklenmedik bir durumda fallback
    return <div className="flex h-screen items-center justify-center text-red-500">Bir hata oluştu.</div>;
}