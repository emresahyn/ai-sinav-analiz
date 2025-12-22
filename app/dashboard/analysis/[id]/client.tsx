'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFormState, useFormStatus } from 'react-dom';
import { doc, getDoc, collection, getDocs, DocumentData } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/app/context/AuthContext';
import { toast, Toaster } from 'react-hot-toast';
import { 
    getStudentScoresForExam, 
    saveStudentScore, 
    analyzeSelectedStudents, 
    deleteAllScoresForStudent 
} from '@/app/actions';
import { Loader2, ArrowLeft, Sparkles, ShieldX, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { Alert, Button, Form } from 'react-bootstrap';

// --- Tür Tanımları ---
interface Exam extends DocumentData { title: string; classId: string; teacherId: string; }
interface Question { id: string; questionNumber: number; points: number; }
interface Student { id: string; name: string; studentNumber: string; }
interface ScoresMap { [key: string]: number | string; }

// --- Bileşenler ---
const LoadingOverlay = () => (
  <div className="position-absolute top-0 start-0 w-100 h-100 d-flex flex-column align-items-center justify-content-center bg-white bg-opacity-75 rounded-3" style={{ zIndex: 10 }}>
    <Loader2 size={48} className="animate-spin text-primary mb-3" />
    <h4 className="fw-bold">Yapay Zeka Analizi Sürüyor...</h4>
    <p className="text-muted">Bu işlem birkaç dakika sürebilir. Lütfen sayfayı kapatmayın.</p>
  </div>
);

const AnalyzeSubmitButton = ({ selectedCount }: { selectedCount: number }) => {
  const { pending } = useFormStatus();
  const isDisabled = pending || selectedCount === 0;
  return (
    <Button type="submit" disabled={isDisabled} variant="primary" className="w-100">
      {pending ? <><Loader2 size={16} className="animate-spin me-2" /> Analiz Başladı...</> : <><Sparkles size={16} className="me-2" /> Seçili ({selectedCount}) Öğrenciyi Yeniden Analiz Et</>}
    </Button>
  );
};

// --- Ana İstemci Bileşeni ---
export default function AnalysisClientPage({ id }: { id: string }) {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const examId = id;

  const [exam, setExam] = useState<Exam | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [scores, setScores] = useState<ScoresMap>({});
  const [isPageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const [selectedStudents, setSelectedStudents] = useState(new Set<string>());
  const [deletingStudentId, setDeletingStudentId] = useState<string | null>(null);

  const [analysisState, formAction] = useFormState(analyzeSelectedStudents, { success: false, message: '' });

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push('/login'); return; }

    const fetchInitialData = async () => {
      setPageLoading(true);
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
        setError(`Veri yüklenirken bir hata oluştu: ${err.message}`);
      } finally {
        setPageLoading(false);
      }
    };
    if (examId && user) fetchInitialData();
  }, [user, authLoading, router, examId]);
  
  useEffect(() => {
    if (analysisState?.message) {
        setIsAnalyzing(false); 
        if (analysisState.success) {
            toast.success(analysisState.message);
            setSelectedStudents(new Set());
            const refetchScores = async () => {
                if (!examId || !user?.uid) return;
                const scoreResult = await getStudentScoresForExam(examId, user.uid);
                if (scoreResult.success && scoreResult.scores) setScores(scoreResult.scores as ScoresMap);
            };
            refetchScores();
        } else {
            toast.error(`Analiz Hatası: ${analysisState.message}`);
        }
    }
  }, [analysisState, examId, user?.uid]);

  const handleSelectionChange = (studentId: string) => {
    setSelectedStudents(prev => {
      const newSet = new Set(prev);
      if (newSet.has(studentId)) {
        newSet.delete(studentId);
      } else {
        newSet.add(studentId);
      }
      return newSet;
    });
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedStudents(new Set(students.map(s => s.id)));
    } else {
      setSelectedStudents(new Set());
    }
  };
  
  const handleDeleteAllScores = async (studentId: string) => {
      if (!user) return;
      const student = students.find(s => s.id === studentId);
      const isConfirmed = window.confirm(`"${student?.name}" adlı öğrencinin bu sınava ait TÜM puanlarını kalıcı olarak silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.`);
      if (isConfirmed) {
          setDeletingStudentId(studentId);
          const result = await deleteAllScoresForStudent(examId, studentId, user.uid);
          if (result.success) {
              toast.success(result.message);
              setScores(prevScores => {
                  const newScores = { ...prevScores };
                  questions.forEach(q => {
                      delete newScores[`${studentId}_${q.id}`];
                  });
                  return newScores;
              });
          } else {
              toast.error(result.message);
          }
          setDeletingStudentId(null);
      }
  };
  
  const handleScoreChange = (studentId: string, questionId: string, value: string) => {
    setScores(prev => ({ ...prev, [`${studentId}_${questionId}`]: value }));
  };

  const handleSaveScore = async (studentId: string, questionId: string) => {
    if (!user?.uid || !examId) return;

    const key = `${studentId}_${questionId}`;
    const scoreValue = scores[key];

    if (scoreValue !== '' && scoreValue != null) {
        const score = Number(scoreValue);
        const question = questions.find(q => q.id === questionId);
        if (isNaN(score) || score < 0 || (question && score > question.points)) {
            toast.error(`Puan, 0 ile ${question?.points} arasında geçerli bir sayı olmalıdır.`);
            return;
        }
    }

    const formData = new FormData();
    formData.append('examId', examId);
    formData.append('studentId', studentId);
    formData.append('questionId', questionId);
    formData.append('teacherId', user.uid);
    formData.append('score', String(scoreValue ?? ''));

    
    const result = await saveStudentScore(formData);

    if (!result.success && result.message) {
        toast.error(result.message);
    }
  };

  if (isPageLoading) return <div className="d-flex vh-100 align-items-center justify-content-center"><Loader2 className="animate-spin h-8 w-8 text-primary" /> <span className="ms-3 fs-5 text-muted">Analiz Sayfası Yükleniyor...</span></div>;
  if (error) return <Alert variant="danger" className="m-4"><ShieldX className="me-2"/>{error}</Alert>;

  const isAllSelected = selectedStudents.size > 0 && selectedStudents.size === students.length;

  return (
    <div className="container-fluid p-4">
      <Toaster position="bottom-right" />
      <header className="border-bottom pb-3 mb-4">
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-3">
          <div>
            <Link href="/dashboard/analysis" className="btn btn-outline-secondary mb-3">
              <ArrowLeft size={16} className="me-2"/> Analiz Listesine Dön
            </Link>
            <h1 className="h2">{exam?.title} - Puan Analizi</h1>
            <p className="text-muted mb-0">Öğrencileri seçerek kağıtlarını yeniden analiz edebilir veya notları silebilirsiniz.</p>
          </div>
          <Form action={formAction} onSubmit={() => setIsAnalyzing(true)} className="flex-grow-1 flex-md-grow-0" style={{maxWidth: '400px'}}>
            <input type="hidden" name="examId" value={examId || ''} />
            <input type="hidden" name="studentIds" value={Array.from(selectedStudents).join(',')} />
            <AnalyzeSubmitButton selectedCount={selectedStudents.size} />
          </Form>
        </div>
      </header>
      
      <div className="table-responsive position-relative">
        {isAnalyzing && <LoadingOverlay />}
        <table className="table table-bordered table-hover align-middle">
          <thead className="table-light">
            <tr>
              <th scope="col" className="text-center" style={{ width: '50px' }}>
                <Form.Check 
                  type="checkbox"
                  onChange={handleSelectAll}
                  checked={isAllSelected}
                  aria-label="Tümünü seç"
                />
              </th>
              <th scope="col" style={{ position: 'sticky', left: 0, zIndex: 1, backgroundColor: '#f8f9fa', minWidth: '200px' }}>Öğrenci Adı</th>
              {questions.map(q => (
                <th key={q.id} scope="col" className="text-center text-nowrap">Soru {q.questionNumber} <small className="fw-normal text-muted">({q.points}p)</small></th>
              ))}
              <th scope="col" className="text-center text-nowrap">Toplam Puan</th>
              <th scope="col" className="text-center text-nowrap">İşlemler</th>
            </tr>
          </thead>
          <tbody>
            {students.length === 0 ? (
                <tr><td colSpan={questions.length + 4} className="text-center p-5">Bu sınıfa henüz öğrenci eklenmemiş.</td></tr>
            ) : ( 
                students.map((student) => {
                    const totalScore = questions.reduce((acc, q) => acc + Number(scores[`${student.id}_${q.id}`] || 0), 0);
                    return (
                      <tr key={student.id}>
                        <td className="text-center">
                           <Form.Check 
                             type="checkbox"
                             onChange={() => handleSelectionChange(student.id)}
                             checked={selectedStudents.has(student.id)}
                             aria-label={`${student.name} seç`}
                           />
                        </td>
                        <td style={{ position: 'sticky', left: 0, zIndex: 1, backgroundColor: '#fff', fontWeight: '500' }}>{student.name}</td>
                        {questions.map((q) => (
                            <td key={q.id}>
                                <input
                                    type="number"
                                    className="form-control form-control-sm text-center border-0 bg-light"
                                    value={scores[`${student.id}_${q.id}`] ?? ''}
                                    onChange={(e) => handleScoreChange(student.id, q.id, e.target.value)}
                                    onBlur={() => handleSaveScore(student.id, q.id)}
                                    min="0"
                                    max={q.points}
                                    style={{minWidth: '60px'}}
                                    disabled={isAnalyzing || deletingStudentId === student.id}
                                />
                            </td>
                        ))}
                        <td className="text-center fw-bold">{totalScore}</td>
                        <td className="text-center">
                          <Button 
                            variant="outline-danger" 
                            size="sm"
                            onClick={() => handleDeleteAllScores(student.id)}
                            disabled={deletingStudentId === student.id || isAnalyzing}
                            aria-label={`${student.name} için tüm puanları sil`}
                          >
                            {deletingStudentId === student.id 
                              ? <Loader2 size={16} className="animate-spin" />
                              : <Trash2 size={16} />
                            }
                          </Button>
                        </td>
                      </tr>
                    )
                })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
