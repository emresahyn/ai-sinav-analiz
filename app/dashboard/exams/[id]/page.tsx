
'use client';

import { useEffect, useState, useRef } from 'react';
import { useFormState } from 'react-dom';
import { doc, getDoc, collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/app/context/AuthContext';
import { addQuestionToExam, updateQuestionInExam, deleteQuestionFromExam } from '@/app/actions';
import { Loader2, Plus, Edit, Trash2, ArrowLeft, BookOpen, AlertTriangle, CheckCircle, X, Upload } from 'lucide-react';
import Link from 'next/link';

// --- Type Definitions --- //
interface ExamData {
  title: string;
  date: string;
  classId?: string;
}
interface Question {
    id: string;
    questionNumber: number;
    points: number;
    kazanim?: string;
}

// --- Main Page Component --- //
export default function ExamDetailPage({ params }: { params: { id: string } }) {
  const { user, loading: authLoading } = useAuth();
  const [examData, setExamData] = useState<ExamData | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);

  const [addState, addAction] = useFormState(addQuestionToExam, { message: '', success: false });
  const [updateState, updateAction] = useFormState(updateQuestionInExam, { message: '', success: false });
  const [formMessage, setFormMessage] = useState<{text: string, success: boolean} | null>(null);

  const addFormRef = useRef<HTMLFormElement>(null);
  const editFormRef = useRef<HTMLFormElement>(null);
  const examId = params.id;

  // Load Exam and Question Data
  useEffect(() => {
    if (user) {
      const examDocRef = doc(db, 'exams', examId);
      getDoc(examDocRef).then(docSnap => {
        if (docSnap.exists()) setExamData(docSnap.data() as ExamData);
      });

      const q = query(collection(db, `exams/${examId}/questions`));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const questionsData: Question[] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Question)).sort((a,b) => a.questionNumber - b.questionNumber);
        setQuestions(questionsData);
        setLoading(false);
      });

      return () => unsubscribe();
    } else if (!authLoading) {
      setLoading(false);
    }
  }, [user, authLoading, examId]);

  // Handle form state messages
  useEffect(() => {
    if(addState.message) setFormMessage({ text: addState.message, success: addState.success });
    if (addState.success) addFormRef.current?.reset();
  }, [addState]);

  useEffect(() => {
    if(updateState.message) setFormMessage({ text: updateState.message, success: updateState.success });
    if (updateState.success) setEditingQuestion(null);
  }, [updateState]);

  const handleDelete = async (questionId: string) => {
      if(confirm('Bu soruyu silmek istediğinizden emin misiniz?')){
          if(!user) return;
          const result = await deleteQuestionFromExam(examId, questionId, user.uid);
          setFormMessage({text: result.message, success: result.success});
      }
  }

  // --- Render --- //
  if (loading || authLoading) {
    return <div className="d-flex vh-100 align-items-center justify-content-center"><Loader2 className="animate-spin h-8 w-8 text-primary" /> <span className="ms-3 fs-5 text-muted">Veriler yükleniyor...</span></div>;
  }

  if (!user) {
    return <div className="alert alert-danger m-5">Bu sayfayı görüntülemek için giriş yapmalısınız.</div>;
  }

  return (
    <div className="container-fluid p-4">
        <header className="border-bottom pb-3 mb-4">
            <div className="d-flex justify-content-between align-items-center">
                 <Link href="/dashboard/exams" className="btn btn-outline-secondary mb-2">
                    <ArrowLeft size={16} className="me-2"/> Sınavlara Dön
                </Link>
            </div>
            <div className="d-flex justify-content-between align-items-center mt-2">
                <div>
                    <h1 className="h2">{examData?.title || 'Sınav Detayları'}</h1>
                    <p className="text-muted">Bu sınavın sorularını, puanlarını ve kazanımlarını yönetin.</p>
                </div>
                {examData?.classId && (
                    <Link href={`/dashboard/exams/${examId}/upload`} className="btn btn-success d-flex align-items-center">
                        <Upload size={18} className="me-2"/> Sınav Kağıtlarını Yükle
                    </Link>
                )}
            </div>
        </header>

        {formMessage && (
            <div className={`alert ${formMessage.success ? 'alert-success' : 'alert-danger'} d-flex align-items-center justify-content-between`}>
                <div className="d-flex align-items-center">
                    {formMessage.success ? <CheckCircle className="me-2"/> : <AlertTriangle className="me-2"/>}
                    {formMessage.text}
                </div>
                <button className="btn-close" onClick={() => setFormMessage(null)}></button>
            </div>
        )}

        <div className="row">
            {/* Add/Edit Form Column */}
            <div className="col-lg-4 mb-4">
                <div className="card shadow-sm">
                    <div className="card-header">
                        <h5 className="mb-0 d-flex align-items-center">
                           {editingQuestion ? <><Edit className="me-2"/> Soruyu Düzenle</> : <><Plus className="me-2"/> Yeni Soru Ekle</>}
                        </h5>
                    </div>
                    <div className="card-body">
                        <form ref={editingQuestion ? editFormRef : addFormRef} action={editingQuestion ? updateAction : addAction} className="d-grid gap-3">
                            <input type="number" name="questionNumber" className="form-control" placeholder="Soru Numarası" defaultValue={editingQuestion?.questionNumber} required />
                            <input type="number" name="points" step="0.5" className="form-control" placeholder="Puan" defaultValue={editingQuestion?.points} required />
                            <input type="text" name="kazanim" className="form-control" placeholder="Kazanım (İsteğe Bağlı)" defaultValue={editingQuestion?.kazanim || ''} />
                            <input type="hidden" name="examId" value={examId} />
                            {user && <input type="hidden" name="teacherId" value={user.uid} />}
                            {editingQuestion && <input type="hidden" name="questionId" value={editingQuestion.id} />}
                            
                            <div className="d-flex gap-2">
                                <button type="submit" className="btn btn-primary w-100">{editingQuestion ? 'Güncelle' : 'Ekle'}</button>
                                {editingQuestion && <button type="button" className="btn btn-secondary" onClick={() => setEditingQuestion(null)}><X size={16}/></button>}
                            </div>
                        </form>
                    </div>
                </div>
            </div>

            {/* Question List Column */}
            <div className="col-lg-8">
                <div className="card shadow-sm">
                     <div className="card-header">
                        <h5 className="mb-0 d-flex align-items-center">
                           <BookOpen className="me-2"/> Soru Listesi ({questions.length} Soru)
                        </h5>
                    </div>
                    <div className="card-body p-0">
                        {questions.length > 0 ? (
                           <div className="table-responsive">
                                <table className="table table-hover table-striped mb-0">
                                    <thead className="table-light">
                                        <tr>
                                            <th scope="col" className="ps-3">Soru No</th>
                                            <th scope="col">Puan</th>
                                            <th scope="col">Kazanım</th>
                                            <th scope="col" className="text-end pe-3">İşlemler</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {questions.map(q => (
                                            <tr key={q.id}>
                                                <td className="ps-3">{q.questionNumber}</td>
                                                <td>{q.points}</td>
                                                <td style={{maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}} title={q.kazanim}>{q.kazanim || <span className="text-muted fst-italic">Belirtilmemiş</span>}</td>
                                                <td className="text-end pe-3">
                                                    <button className="btn btn-sm btn-outline-primary me-2" onClick={() => setEditingQuestion(q)}><Edit size={14}/></button>
                                                    <button className="btn btn-sm btn-outline-danger" onClick={() => handleDelete(q.id)}><Trash2 size={14}/></button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                           </div>
                        ) : (
                            <p className="text-center text-muted p-4">Bu sınava henüz soru eklenmemiş.</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    </div>
  );
}
