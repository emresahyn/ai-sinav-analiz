'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useFormState, useFormStatus } from 'react-dom';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/app/context/AuthContext';
import { toast, Toaster } from 'react-hot-toast';
import { getStudentScoresForExam, saveStudentScore, analyzeExamPapers } from '@/app/actions';
import { Loader2, ArrowLeft, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { Alert, Button } from 'react-bootstrap';

// --- Tür Tanımları ---
interface Question { id: string; questionNumber: number; points: number; }
interface Student { id: string; name: string; studentNumber: string; }
interface ScoresMap { [key: string]: number | string; }

// --- Alt Bileşenler ---
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

  const [exam, setExam] = useState<any>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [scores, setScores] = useState<ScoresMap>({});
  const [isPageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [analysisState, formAction] = useFormState(analyzeExamPapers, { success: false, message: '' });

  // Verileri sadece bir kere, ilk yüklemede çeken Effect.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push('/login');
      return;
    }

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
        const examData = examSnap.data();
        setExam(examData);

        const questionsRef = collection(db, 'exams', examId, 'questions');
        const questionsSnap = await getDocs(questionsRef);
        const questionsList = questionsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Question)).sort((a, b) => a.questionNumber - b.questionNumber);
        setQuestions(questionsList);

        if (examData.classId) {
          const studentsRef = collection(db, 'classes', examData.classId, 'students');
          const studentsSnap = await getDocs(studentsRef);
          let studentsData = studentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Student));
          
          // **YENİ**: Öğrencileri numaralarına göre sayısal olarak sırala
          studentsData.sort((a, b) => {
              const numA = parseInt(a.studentNumber, 10);
              const numB = parseInt(b.studentNumber, 10);
              if (isNaN(numA) && isNaN(numB)) return a.studentNumber.localeCompare(b.studentNumber);
              if (isNaN(numA)) return 1;
              if (isNaN(numB)) return -1;
              return numA - numB;
          });

          setStudents(studentsData);
        }
        
        const scoreResult = await getStudentScoresForExam(examId, user.uid);
        if (scoreResult.success && scoreResult.scores) {
          setScores(scoreResult.scores);
        }
      } catch (err) {
        console.error("Veri çekme hatası:", err);
        setError('Veri yüklenirken bir hata oluştu.');
      } finally {
        setPageLoading(false);
      }
    };

    if (examId) { 
        fetchInitialData();
    }
  }, [user, authLoading, router, examId]);

  // Sadece yapay zeka analizi bittiğinde çalışır ve sadece skorları günceller.
  useEffect(() => {
    if (analysisState?.message) {
      if (analysisState.success) {
        toast.success(analysisState.message);
        const refetchScores = async () => {
            if (!examId || !user?.uid) return;
            const scoreResult = await getStudentScoresForExam(examId, user.uid);
            if (scoreResult.success && scoreResult.scores) {
                setScores(scoreResult.scores);
            }
        };
        refetchScores();
      } else {
        toast.error(analysisState.message);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisState]);

  const handleScoreChange = (studentId: string, questionId: string, value: string) => {
    const key = `${studentId}_${questionId}`;
    setScores(prevScores => ({ ...prevScores, [key]: value }));
  };

  const handleSaveScore = async (studentId: string, questionId: string) => {
    if (!user?.uid || !examId) return;
    const key = `${studentId}_${questionId}`;
    const scoreValue = scores[key];
    const score = Number(scoreValue);
    const question = questions.find(q => q.id === questionId);

    if (scoreValue === '' || isNaN(score) || score < 0 || (question && score > question.points)) {
        toast.error(`Puan, 0 ile ${question?.points} arasında geçerli bir sayı olmalıdır.`);
        return;
    }

    const formData = new FormData();
    formData.append('examId', examId);
    formData.append('studentId', studentId);
    formData.append('questionId', questionId);
    formData.append('teacherId', user.uid);
    formData.append('score', String(score));

    const result = await saveStudentScore(formData);
    if (!result.success) {
        toast.error(result.message || 'Puan kaydedilemedi.');
    }
  };

  if (isPageLoading) {
    return <div className="d-flex vh-100 align-items-center justify-content-center"><Loader2 className="animate-spin h-8 w-8 text-primary" /> <span className="ms-3 fs-5 text-muted">Analiz Sayfası Yükleniyor...</span></div>;
  }

  if (error) { return <Alert variant="danger" className="m-4">{error}</Alert>; }

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
          <form action={formAction} className="flex-grow-1 flex-md-grow-0" style={{maxWidth: '300px'}}>
            <input type="hidden" name="examId" value={examId || ''} />
            <SubmitButton />
          </form>
        </div>
      </header>
      
      <div className="table-responsive">
        <table className="table table-bordered table-hover">
          <thead className="table-light">
            <tr>
              <th scope="col" style={{ position: 'sticky', left: 0, zIndex: 1, backgroundColor: '#f8f9fa' }}>Öğrenci Adı</th>
              {questions.map(q => (
                <th key={q.id} scope="col" className="text-center text-nowrap">
                  Soru {q.questionNumber} <small className="fw-normal text-muted">({q.points}p)</small>
                </th>
              ))}
              <th scope="col" className="text-center text-nowrap">Toplam Puan</th>
            </tr>
          </thead>
          <tbody>
            {students.length === 0 ? (
                <tr><td colSpan={questions.length + 2} className="text-center p-5">Bu sınıfa henüz öğrenci eklenmemiş.</td></tr>
            ) : ( 
                students.map(student => {
                    const totalScore = questions.reduce((acc, q) => acc + Number(scores[`${student.id}_${q.id}`] || 0), 0);
                    return (
                      <tr key={student.id}>
                        <td style={{ position: 'sticky', left: 0, zIndex: 1, backgroundColor: '#fff', fontWeight: '500' }}>{student.name}</td>
                        {questions.map(q => {
                            const key = `${student.id}_${q.id}`;
                            return (
                                <td key={q.id} className="align-middle">
                                    <input
                                        type="number"
                                        className="form-control form-control-sm text-center border-0 bg-light"
                                        value={scores[key] ?? ''}
                                        onChange={(e) => handleScoreChange(student.id, q.id, e.target.value)}
                                        onBlur={() => handleSaveScore(student.id, q.id)}
                                        min="0"
                                        max={q.points}
                                        style={{minWidth: '60px'}}
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