'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useFormState, useFormStatus } from 'react-dom';
import { doc, getDoc, collection, getDocs, DocumentData } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/app/context/AuthContext';
import { toast, Toaster } from 'react-hot-toast';
import { Loader2, ArrowLeft, Sparkles, Upload, Trash2, FileCheck2, ShieldX } from 'lucide-react';
import Link from 'next/link';
import { Alert, Button, Form, Card, ListGroup } from 'react-bootstrap';
import { uploadExamPaper, getUploadedPapers, deleteExamPaper, analyzeExamPapers, ActionState } from '@/app/actions';

// --- Tür Tanımları ---
interface Exam extends DocumentData { title: string; classId: string; teacherId: string; }
interface Student { id: string; name: string; studentNumber: string; }
interface UploadedFile { name: string; path: string; }

// --- Yükleniyor Katmanı ---
const LoadingOverlay = () => (
    <div className="position-absolute top-0 start-0 w-100 h-100 d-flex flex-column align-items-center justify-content-center bg-dark bg-opacity-50 rounded-3" style={{ zIndex: 10 }}>
      <Loader2 size={48} className="animate-spin text-white mb-3" />
      <h4 className="fw-bold text-white">Yapay Zeka Analizi Sürüyor...</h4>
      <p className="text-white-50">Bu işlem birkaç dakika sürebilir. Lütfen sayfayı kapatmayın.</p>
    </div>
  );

// --- Alt Bileşenler ---
const StudentCard = ({ student, examId, onFileChange }: { student: Student; examId: string; onFileChange: (studentId: string, change: number) => void; }) => {
    const { user } = useAuth();
    const initialState: ActionState = { message: '', success: false, studentId: student.id };
    const [state, formAction] = useFormState(uploadExamPaper, initialState);
    const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
    const [isFetchingFiles, setIsFetchingFiles] = useState(true);

    useEffect(() => {
        const fetchFiles = async () => {
            const result = await getUploadedPapers(examId, student.id);
            if (result.success && result.files) {
                setUploadedFiles(result.files);
                onFileChange(student.id, result.files.length);
            }
            setIsFetchingFiles(false);
        };
        fetchFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [examId, student.id]);

    useEffect(() => {
        if (state?.message && state.studentId === student.id) {
            if (state.success) {
                toast.success(state.message, { id: student.id });
                if (state.uploadedFiles) {
                    const newFiles = state.uploadedFiles.filter(f => !uploadedFiles.some(uf => uf.path === f.path));
                    setUploadedFiles(prev => [...prev, ...newFiles]);
                    onFileChange(student.id, newFiles.length);
                }
            } else {
                toast.error(state.message, { id: student.id });
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state]);

    const handleDelete = async (paperId: string, fileName: string) => {
        if (!user) return;
        
        // YENİ: Silme onayı ekle
        const isConfirmed = window.confirm(`"${fileName}" dosyasını kalıcı olarak silmek istediğinizden emin misiniz?\nBu işlem geri alınamaz.`);

        if (isConfirmed) {
            const res = await deleteExamPaper(examId, user.uid, paperId);
            if (res.success) {
                toast.success(res.message);
                setUploadedFiles(prev => prev.filter(f => f.path !== paperId));
                onFileChange(student.id, -1);
            } else {
                toast.error(res.message);
            }
        }
    };

    const SubmitBtn = () => {
        const { pending } = useFormStatus();
        return <Button type="submit" variant="secondary" size="sm" disabled={pending}>{pending ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}</Button>;
    }

    return (
        <Card className="mb-3">
            <Card.Body>
                <Card.Title className="d-flex justify-content-between align-items-center">{student.name} <span className="text-muted fw-normal fs-6">#{student.studentNumber}</span></Card.Title>
                <Form action={formAction}>
                    <input type="hidden" name="examId" value={examId} />
                    <input type="hidden" name="studentId" value={student.id} />
                    <input type="hidden" name="teacherId" value={user?.uid || ''} />
                    <div className="d-flex gap-2">
                        <Form.Control type="file" name="papers" multiple accept="image/jpeg,image/png,image/webp" required className="form-control-sm" />
                        <SubmitBtn />
                    </div>
                </Form>
                {isFetchingFiles ? (
                    <div className="text-center mt-3"><Loader2 className="animate-spin text-muted" /></div>
                ) : uploadedFiles.length > 0 && (
                    <ListGroup variant="flush" className="mt-3">
                        {uploadedFiles.map(file => (
                            <ListGroup.Item key={file.path} className="d-flex justify-content-between align-items-center px-0">
                                <span className="text-success"><FileCheck2 size={16} className="me-2"/>{file.name}</span>
                                {/* GÜNCELLENDİ: Onay için dosya adı da gönderiliyor */}
                                <Button variant="outline-danger" size="sm" onClick={() => handleDelete(file.path, file.name)}><Trash2 size={14} /></Button>
                            </ListGroup.Item>
                        ))}
                    </ListGroup>
                )}
            </Card.Body>
        </Card>
    );
}

// --- Ana Bileşen ---
const UploadPage = () => {
    const { user, loading: authLoading } = useAuth();
    const params = useParams();
    const router = useRouter();
    const examId = (params?.id || '') as string;


    const [exam, setExam] = useState<Exam | null>(null);
    const [students, setStudents] = useState<Student[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [totalPaperCount, setTotalPaperCount] = useState(0);

    const [analysisState, analysisFormAction] = useFormState(analyzeExamPapers, { success: false, message: '' });

    useEffect(() => {
        if (authLoading) return;
        if (!user) { router.push('/login'); return; }

        const fetchExamData = async () => {
            try {
                const examRef = doc(db, 'exams', examId);
                const examSnap = await getDoc(examRef);
                if (!examSnap.exists() || examSnap.data().teacherId !== user.uid) {
                    setError('Sınav bulunamadı veya bu sayfayı görüntüleme yetkiniz yok.'); return;
                }
                const examData = examSnap.data() as Exam;
                setExam(examData);

                if (examData.classId) {
                    const studentsRef = collection(db, 'classes', examData.classId, 'students');
                    const studentsSnap = await getDocs(studentsRef);
                    const studentsList = studentsSnap.docs.map(s => ({ id: s.id, ...s.data() } as Student)).sort((a,b) => a.studentNumber.localeCompare(b.studentNumber, undefined, { numeric: true }));
                    setStudents(studentsList);
                } else {
                    setError('Sınava atanmış bir sınıf bulunamadı.');
                }
            } catch (err: any) {
                setError(`Veri yüklenirken bir hata oluştu: ${err.message}`);
            } finally {
                setIsLoading(false);
            }
        };
        fetchExamData();
    }, [examId, user, authLoading, router]);
    
    const handleFileChange = useMemo(() => {
        const studentPaperCounts: { [key: string]: number } = {};
        return (studentId: string, change: number) => {
            if (change > 0) {
                 studentPaperCounts[studentId] = (studentPaperCounts[studentId] || 0) + change;
            } else {
                 studentPaperCounts[studentId] = Math.max(0, (studentPaperCounts[studentId] || 0) + change);
            }
            
            const total = Object.values(studentPaperCounts).reduce((sum, count) => sum + count, 0);
            setTotalPaperCount(total);
        }
    }, []);

    useEffect(() => {
        if (analysisState.message) {
            setIsAnalyzing(false);
            if (analysisState.success) {
                toast.success("Analiz başarıyla tamamlandı! Puan tablosuna yönlendiriliyorsunuz...");
                router.push(`/dashboard/analysis/${examId}`);
            } else {
                toast.error(`Analiz Hatası: ${analysisState.message}`);
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [analysisState]);

    if (isLoading) return <div className="d-flex vh-100 align-items-center justify-content-center"><Loader2 className="animate-spin h-8 w-8 text-primary" /> <span className="ms-3 fs-5 text-muted">Yükleme Sayfası Hazırlanıyor...</span></div>;
    if (error) return <Alert variant="danger" className="m-4"><ShieldX className="me-2"/>{error}</Alert>;

    return (
        <div className="container-fluid p-4">
            <Toaster position="bottom-right" />
            <header className="border-bottom pb-3 mb-4">
                <div className="d-flex justify-content-between align-items-center flex-wrap gap-3">
                    <div>
                        <Link href={`/dashboard/exams/${examId}`} className="btn btn-outline-secondary mb-3">
                            <ArrowLeft size={16} className="me-2"/> Sınav Detayına Dön
                        </Link>
                        <h1 className="h2">{exam?.title}</h1>
                        <p className="text-muted mb-0">Öğrencilerin sınav kağıtlarını yükleyin.</p>
                    </div>
                    <div>
                        <Form action={analysisFormAction} onSubmit={() => setIsAnalyzing(true)}>
                            <input type="hidden" name="examId" value={examId} />
                            <Button type="submit" variant="primary" size="lg" disabled={totalPaperCount === 0 || isAnalyzing}>
                                <Sparkles size={18} className="me-2" />
                                {isAnalyzing ? 'Analiz Ediliyor...' : `Analizi Başlat (${totalPaperCount} Kağıt)`}
                            </Button>
                        </Form>
                    </div>
                </div>
            </header>

            <div className="position-relative">
                {isAnalyzing && <LoadingOverlay />}
                <div className="row">
                    {students.map(student => (
                        <div key={student.id} className="col-md-6 col-lg-4">
                            <StudentCard student={student} examId={examId} onFileChange={handleFileChange} />
                        </div>
                    ))}
                </div>
                {students.length === 0 && (
                    <Alert variant='secondary' className="text-center p-5">
                        Bu sınıfa henüz öğrenci eklenmemiş veya öğrenciler yüklenemedi.
                    </Alert>
                )}
            </div>
        </div>
    );
};

export default UploadPage;
