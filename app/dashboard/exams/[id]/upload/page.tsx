'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useFormState, useFormStatus } from 'react-dom';
import { doc, getDoc, collection, getDocs, DocumentData } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/app/context/AuthContext';
import { toast, Toaster } from 'react-hot-toast';
import { Loader2, ArrowLeft, Upload, Trash2, FileCheck2, ShieldX } from 'lucide-react';
import Link from 'next/link';
import { Alert, Button, Form, Card, ListGroup } from 'react-bootstrap';
// 'analyzeExamPapers' ve 'ActionState' artık buradan kaldırıldı, çünkü doğrudan analiz yapıyoruz.
import { uploadExamPaper, getUploadedPapers, deleteExamPaper, ActionState } from '@/app/actions';

// --- Tür Tanımları ---
interface Exam extends DocumentData {
  title: string;
  classId: string;
  teacherId: string;
}
interface Student {
  id: string;
  name: string;
  studentNumber: string;
}
interface UploadedFile {
  name: string;
  path: string;
}

// --- Alt Bileşenler ---
const StudentCard = ({ student, examId }: { student: Student; examId: string }) => {
    const { user } = useAuth();
    // Her form kendi state'ini yönetir.
    const initialState: ActionState = { message: '', success: false, studentId: student.id };
    const [state, formAction] = useFormState(uploadExamPaper, initialState);
    
    const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
    const [isFetchingFiles, setIsFetchingFiles] = useState(true);

    // Başlangıçta öğrencinin yüklenmiş kağıtlarını getir
    useEffect(() => {
        const fetchFiles = async () => {
            const result = await getUploadedPapers(examId, student.id);
            if (result.success && result.files) {
                setUploadedFiles(result.files);
            }
            setIsFetchingFiles(false);
        };
        fetchFiles();
    }, [examId, student.id]);

    // Form action'dan (uploadExamPaper) bir sonuç döndüğünde çalışır
    useEffect(() => {
        // Sadece bu öğrenci kartına ait bir durum güncellemesi varsa toast göster
        if (state?.message && state.studentId === student.id) {
            if (state.success) {
                toast.success(state.message, { id: `toast-${student.id}` });
                // Yeni yüklenen dosyaları state'e ekle
                if (state.uploadedFiles) {
                     setUploadedFiles(prev => [...prev, ...state.uploadedFiles!]);
                }
            } else {
                toast.error(state.message, { id: `toast-${student.id}` });
            }
        }
    }, [state, student.id]);

    const handleDelete = async (paperId: string, fileName: string) => {
        if (!user) return;
        const isConfirmed = window.confirm(`"${fileName}" dosyasını kalıcı olarak silmek istediğinizden emin misiniz?`);
        if (isConfirmed) {
            const res = await deleteExamPaper(examId, user.uid, paperId);
            if (res.success) {
                toast.success(res.message);
                setUploadedFiles(prev => prev.filter(f => f.path !== paperId));
            } else {
                toast.error(res.message);
            }
        }
    };

    // Bu buton artık hem yükleme hem de analiz durumunu gösterir
    const SubmitBtn = () => {
        const { pending } = useFormStatus();
        return (
            <Button type="submit" variant="secondary" size="sm" disabled={pending}>
                {pending ? (
                    <>
                        <Loader2 size={16} className="animate-spin me-2" />
                        İşleniyor...
                    </>
                ) : (
                    <>
                        <Upload size={16} className="me-2" />
                        Gönder ve Analiz Et
                    </>
                )}
            </Button>
        );
    }

    return (
        <Card className="mb-3">
            <Card.Body>
                <Card.Title className="d-flex justify-content-between align-items-center">{student.name} <span className="text-muted fw-normal fs-6">#{student.studentNumber}</span></Card.Title>
                <Form action={formAction}>
                    <input type="hidden" name="examId" value={examId} />
                    <input type="hidden" name="studentId" value={student.id} />
                    <input type="hidden" name="teacherId" value={user?.uid || ''} />
                    <div className="d-flex flex-column gap-2">
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

    // Toplu analiz ile ilgili tüm state'ler kaldırıldı.
    // [isAnalyzing, totalPaperCount, analysisState, analysisFormAction]

    useEffect(() => {
        if (authLoading) return;
        if (!user) { router.push('/login'); return; }

        const fetchExamData = async () => {
            try {
                const examRef = doc(db, 'exams', examId);
                const examSnap = await getDoc(examRef);
                if (!examSnap.exists() || examSnap.data().teacherId !== user.uid) {
                    setError('Sınav bulunamadı veya bu sayfayı görüntüleme yetkiniz yok.');
                    return;
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

    if (isLoading) return <div className="d-flex vh-100 align-items-center justify-content-center"><Loader2 className="animate-spin h-8 w-8 text-primary" /> <span className="ms-3 fs-5 text-muted">Yükleme Sayfası Hazırlanıyor...</span></div>;
    if (error) return <Alert variant="danger" className="m-4"><ShieldX className="me-2"/>{error}</Alert>;

    return (
        <div className="container-fluid p-4">
            <Toaster position="bottom-right" />
            {/* Header'dan toplu analiz butonu kaldırıldı */}
            <header className="border-bottom pb-3 mb-4">
                <div className="d-flex justify-content-between align-items-center flex-wrap gap-3">
                    <div>
                        <Link href={`/dashboard/exams/${examId}`} className="btn btn-outline-secondary mb-3">
                            <ArrowLeft size={16} className="me-2"/> Sınav Detayına Dön
                        </Link>
                        <h1 className="h2">{exam?.title}</h1>
                        <p className="text-muted mb-0">Öğrencilerin sınav kağıtlarını yükleyip anında analiz sonuçlarını alın.</p>
                    </div>
                </div>
            </header>

            {/* Yükleniyor katmanı (LoadingOverlay) kaldırıldı */}
            <div className="row">
                {students.map(student => (
                    <div key={student.id} className="col-md-6 col-lg-4">
                        {/* 'onFileChange' prop'u kaldırıldı */}
                        <StudentCard student={student} examId={examId} />
                    </div>
                ))}
            </div>
            {students.length === 0 && (
                <Alert variant='secondary' className="text-center p-5">
                    Bu sınıfa henüz öğrenci eklenmemiş veya öğrenciler yüklenemedi.
                </Alert>
            )}
        </div>
    );
};

export default UploadPage;
