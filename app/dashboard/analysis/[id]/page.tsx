'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useFormState, useFormStatus } from 'react-dom';
import { doc, getDoc, collection, getDocs, DocumentData } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/app/context/AuthContext';
import { toast, Toaster } from 'react-hot-toast';
import { getStudentScoresForExam, saveStudentScore, analyzeExamPapers } from '@/app/actions';
import { Loader2, ArrowLeft, Sparkles, ShieldX } from 'lucide-react';
import Link from 'next/link';
import { Alert, Button } from 'react-bootstrap';

// --- Tür Tanımları ---
interface Exam extends DocumentData { title: string; classId: string; teacherId: string; }
interface Question { id: string; questionNumber: number; points: number; }
interface Student { id: string; name: string; studentNumber: string; }
interface ScoresMap { [key: string]: number | string; }

// --- Yükleniyor Katmanı ve Buton Bileşenleri ---
const LoadingOverlay = () => (
  <div className="position-absolute top-0 start-0 w-100 h-100 d-flex flex-column align-items-center justify-content-center bg-white bg-opacity-75" style={{ zIndex: 10 }}>
    <Loader2 size={48} className="animate-spin text-primary mb-3" />
    <h4 className="fw-bold">Yapay Zeka Analizi Sürüyor...</h4>
    <p className="text-muted">Bu işlem birkaç dakika sürebilir. Lütfen sayfayı kapatmayın.</p>
  </div>
);

const SubmitButton = () => {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} variant="primary" className="w-100">
      {pending ? <><Loader2 size={16} className="animate-spin me-2" /> Analiz Başladı...</> : <><Sparkles size={16} className="me-2"/> Yapay Zeka ile Doldur</>}
    </Button>
  );
};

// --- Ana Bileşen ---
const AnalysisPage = () => {
  const { user, loading: authLoading } = useAuth();
  const params = useParams();
  const router = useRouter();
  const examId = params ? (Array.isArray(params.id) ? params.id[0] : params.id) : null;

  const [exam, setExam] = useState<Exam | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [scores, setScores] = useState<ScoresMap>({});
  const [isPageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const [analysisState, formAction] = useFormState(analyzeExamPapers, { success: false, message: '' });

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push('/login'); return; }

    const fetchInitialData = async () => {
      if (!examId || !user.uid) {
        setError("Sınav ID veya kullanıcı bilgisi bulunamadı.");
        setPageLoading(false);
        return;
      }
      try {
        const examRef = doc(db, 'exams', examId);
        const examSnap = await getDoc(examRef);
        if (!examSnap.exists() || examSnap.data().teacherId !== user.uid) {
          setError('Sınav bulunamadı veya bu analizi görüntüleme yetkiniz yok.');
          return;
        }
        setExam(examSnap.data() as Exam);

        const questionsRef = collection(db, 'exams', examId, 'questions');
        const questionsSnap = await getDocs(questionsRef);
        const questionsList = questionsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Question)).sort((a, b) => a.questionNumber - b.questionNumber);
        setQuestions(questionsList);

        if (examSnap.data().classId) {
          const studentsRef = collection(db, 'classes', examSnap.data().classId, 'students');
          const studentsSnap = await getDocs(studentsRef);
          const studentsData = studentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Student)).sort((a, b) => parseInt(a.studentNumber, 10) - parseInt(b.studentNumber, 10));
          setStudents(studentsData);
        }
        
        const scoreResult = await getStudentScoresForExam(examId, user.uid);
        if (scoreResult.success && scoreResult.scores) setScores(scoreResult.scores as ScoresMap);

      } catch (err: any) {
        console.error("Veri çekme hatası:", err);
        setError(`Veri yüklenirken bir hata oluştu: ${err.message}`);
      } finally {
        setPageLoading(false);
      }
    };
    if (examId) fetchInitialData();
  }, [user, authLoading, router, examId]);

  useEffect(() => {
    if (analysisState?.message) {
        setIsAnalyzing(false); 
        if (analysisState.success) {
            toast.success(analysisState.message);
            const refetchScores = async () => {
                if (!examId || !user?.uid) return;
                const scoreResult = await getStudentScoresForExam(examId, user.uid);
                if (scoreResult.success && scoreResult.scores) setScores(scoreResult.scores as ScoresMap);
            };
            refetchScores();
        } else {
            toast.error(analysisState.message);
        }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisState]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const activeElement = document.activeElement as HTMLInputElement;
      if (!activeElement || !activeElement.hasAttribute('data-cell-index')) return;
      event.preventDefault();
      const currentIndex = parseInt(activeElement.getAttribute('data-cell-index')!, 10);
      const totalInputs = students.length * questions.length;
      let nextIndex = event.key === 'ArrowRight' ? currentIndex + 1 : currentIndex - 1;
      if (nextIndex >= totalInputs) nextIndex = 0;
      if (nextIndex < 0) nextIndex = totalInputs - 1;
      const nextInput = document.querySelector(`input[data-cell-index='${nextIndex}']`) as HTMLInputElement;
      if (nextInput) { nextInput.focus(); nextInput.select(); }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [students, questions]);

  const handleScoreChange = (studentId: string, questionId: string, value: string) => {
    setScores(prev => ({ ...prev, [`${studentId}_${questionId}`]: value }));
  };

  // ***** SADECE BU FONKSİYON GÜNCELLENDİ *****
  const handleSaveScore = async (studentId: string, questionId: string) => {
    if (!user?.uid || !examId) return;

    const key = `${studentId}_${questionId}`;
    const scoreValue = scores[key]; // Bu artık boş olabilir

    // Değer boş değilse, geçerliliğini kontrol et
    if (scoreValue !== '' && scoreValue != null) {
        const score = Number(scoreValue);
        const question = questions.find(q => q.id === questionId);
        if (isNaN(score) || score < 0 || (question && score > question.points)) {
            toast.error(`Puan, 0 ile ${question?.points} arasında geçerli bir sayı olmalıdır.`);
            return; // Hatalıysa sunucuya gönderme
        }
    }

    const formData = new FormData();
    formData.append('examId', examId);
    formData.append('studentId', studentId);
    formData.append('questionId', questionId);
    formData.append('teacherId', user.uid);
    // Değer ne olursa olsun (boş string dahil) sunucuya gönder
    formData.append('score', String(scoreValue ?? ''));

    
    const result = await saveStudentScore(formData);

    // Sadece hata varsa bildirim göster, başarı durumunda arayüz zaten güncelleniyor.
    if (!result.success && result.message) {
        toast.error(result.message);
    }
  };

  if (isPageLoading) return <div className="d-flex vh-100 align-items-center justify-content-center"><Loader2 className="animate-spin h-8 w-8 text-primary" /> <span className="ms-3 fs-5 text-muted">Analiz Sayfası Yükleniyor...</span></div>;
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
            <h1 className="h2">{exam?.title} - Puan Analizi</h1>
            <p className="text-muted mb-0">Puanları manuel girin veya yapay zeka ile otomatik doldurun.</p>
          </div>
          <form action={formAction} onSubmit={() => setIsAnalyzing(true)} className="flex-grow-1 flex-md-grow-0" style={{maxWidth: '300px'}}>
            <input type="hidden" name="examId" value={examId || ''} />
            <SubmitButton />
          </form>
        </div>
      </header>
      
      <div className="table-responsive position-relative">
        {isAnalyzing && <LoadingOverlay />}
        <table className="table table-bordered table-hover">
          <thead className="table-light">
            <tr>
              <th scope="col" style={{ position: 'sticky', left: 0, zIndex: 1, backgroundColor: '#f8f9fa' }}>Öğrenci Adı</th>
              {questions.map(q => (
                <th key={q.id} scope="col" className="text-center text-nowrap">Soru {q.questionNumber} <small className="fw-normal text-muted">({q.points}p)</small></th>
              ))}
              <th scope="col" className="text-center text-nowrap">Toplam Puan</th>
            </tr>
          </thead>
          <tbody>
            {students.length === 0 ? (
                <tr><td colSpan={questions.length + 2} className="text-center p-5">Bu sınıfa henüz öğrenci eklenmemiş.</td></tr>
            ) : ( 
                students.map((student, studentIndex) => {
                    const totalScore = questions.reduce((acc, q) => acc + Number(scores[`${student.id}_${q.id}`] || 0), 0);
                    return (
                      <tr key={student.id}>
                        <td style={{ position: 'sticky', left: 0, zIndex: 1, backgroundColor: '#fff', fontWeight: '500' }}>{student.name}</td>
                        {questions.map((q, questionIndex) => {
                            const key = `${student.id}_${q.id}`;
                            return (
                                <td key={q.id} className="align-middle">
                                    <input
                                        type="number"
                                        data-cell-index={studentIndex * questions.length + questionIndex}
                                        className="form-control form-control-sm text-center border-0 bg-light"
                                        value={scores[key] ?? ''}
                                        onChange={(e) => handleScoreChange(student.id, q.id, e.target.value)}
                                        onBlur={() => handleSaveScore(student.id, q.id)}
                                        min="0"
                                        max={q.points}
                                        style={{minWidth: '60px'}}
                                        disabled={isAnalyzing}
                                    />
                                </td>
                            );
                        })}
                        <td className="text-center fw-bold align-middle">{totalScore}</td>
                      </tr>
                    )
                })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AnalysisPage;
