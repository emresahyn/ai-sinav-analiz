
'use client';

import { useEffect, useState } from 'react';
import { doc, getDoc, collection, query, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/app/context/AuthContext';
import { getStudentScoresForExam, saveStudentScore } from '@/app/actions';
import { Loader2, ArrowLeft, AlertCircle } from 'lucide-react';
import Link from 'next/link';

// --- Type Definitions --- //
interface ExamData { title: string; classId?: string; teacherId?: string; }
interface Student { id: string; name: string; studentNumber: string; }
interface Question { id: string; questionNumber: number; points: number; }
interface Scores { [key: string]: number; } // key: `${studentId}_${questionId}`

// --- Score Input Component --- //
const ScoreInput = ({ studentId, question, examId, teacherId, initialScore }: { studentId: string; question: Question; examId: string; teacherId: string; initialScore: number; }) => {
    const [score, setScore] = useState<number | ''> (initialScore);
    const [isEditing, setIsEditing] = useState(false);

    const handleScoreChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setScore(value === '' ? '' : Number(value));
    };

    const handleBlur = async () => {
        setIsEditing(false);
        if (score === '' || score === initialScore) return; // No change or empty

        const formData = new FormData();
        formData.append('examId', examId);
        formData.append('studentId', studentId);
        formData.append('questionId', question.id);
        formData.append('teacherId', teacherId);
        formData.append('score', String(score));
        
        await saveStudentScore(formData);
        // We can add better status handling here later if needed
    };

    return (
        <td onClick={() => setIsEditing(true)} className="text-center">
            {isEditing ? (
                <input 
                    type="number"
                    value={score}
                    onChange={handleScoreChange}
                    onBlur={handleBlur}
                    autoFocus
                    className="form-control form-control-sm text-center p-1" 
                    style={{ maxWidth: '70px', margin: 'auto'}}
                    max={question.points}
                    min={0}
                />
            ) : (
                <span>{score}</span>
            )}
        </td>
    );
};


// --- Main Page Component --- //
export default function AnalysisDetailPage({ params }: { params: { id: string } }) {
    const { user, loading: authLoading } = useAuth();
    const [examData, setExamData] = useState<ExamData | null>(null);
    const [students, setStudents] = useState<Student[]>([]);
    const [questions, setQuestions] = useState<Question[]>([]);
    const [scores, setScores] = useState<Scores>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const examId = params.id;

    useEffect(() => {
        if (!user || !examId) return;

        async function fetchData() {
            setLoading(true);
            setError(null);
            
            try {
                // Fetch Exam Data
                const examRef = doc(db, 'exams', examId);
                const examSnap = await getDoc(examRef);
                if (!examSnap.exists() || examSnap.data().teacherId !== user.uid) {
                    setError('Sınav bulunamadı veya bu analizi görüntüleme yetkiniz yok.');
                    setLoading(false);
                    return;
                }
                const exam = examSnap.data() as ExamData;
                setExamData(exam);

                // Fetch Initial Scores
                const scoreResult = await getStudentScoresForExam(examId, user.uid);
                if(scoreResult.success) {
                    setScores(scoreResult.scores);
                } else {
                    throw new Error(scoreResult.message);
                }

                // Set up listeners
                let studentsUnsub: (() => void) | undefined;
                if (exam.classId) {
                    const studentQuery = query(collection(db, `classes/${exam.classId}/students`));
                    studentsUnsub = onSnapshot(studentQuery, (snap) => setStudents(snap.docs.map(d => ({ id: d.id, ...d.data() } as Student))));
                }

                const questionQuery = query(collection(db, `exams/${examId}/questions`), orderBy('questionNumber'));
                const questionsUnsub = onSnapshot(questionQuery, (snap) => setQuestions(snap.docs.map(d => ({ id: d.id, ...d.data() } as Question))));

                setLoading(false);
                return () => {
                    if(studentsUnsub) studentsUnsub();
                    if(questionsUnsub) questionsUnsub();
                };

            } catch (err: any) {
                setError(err.message || 'Veriler yüklenirken bir hata oluştu.');
                setLoading(false);
            }
        }

        fetchData();

    }, [user, examId]);

    if (loading || authLoading) {
        return <div className="d-flex vh-100 justify-content-center align-items-center"><Loader2 className="animate-spin me-3" /> Analiz verileri yükleniyor...</div>;
    }

    if (error) {
        return <div className="alert alert-danger m-4 d-flex align-items-center"><AlertCircle className="me-2"/> {error}</div>;
    }

    return (
        <div className="container-fluid p-4">
            <header className="border-bottom pb-3 mb-4">
                 <Link href={`/dashboard/analysis`} className="btn btn-outline-secondary mb-3">
                    <ArrowLeft size={16} className="me-2"/> Tüm Analizler
                </Link>
                <h1 className="h2">{examData?.title} - Puan Analizi</h1>
                <p className="text-muted">Öğrencilerin her sorudan aldığı puanları girmek için tablo hücrelerine tıklayın.</p>
            </header>

            <div className="table-responsive shadow-sm">
                <table className="table table-bordered table-hover bg-white mb-0">
                    <thead className="table-light align-middle">
                        <tr>
                            <th className="text-start sticky-left bg-light">Öğrenci Adı</th>
                            {questions.map(q => (
                                <th key={q.id} className="text-center">
                                    Soru {q.questionNumber}<br/>
                                    <small className="fw-normal text-muted">({q.points} Puan)</small>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {students.length > 0 ? students.map(student => (
                            <tr key={student.id}>
                                <td className="fw-bold text-start sticky-left bg-white">{student.name}</td>
                                {questions.map(q => (
                                    <ScoreInput 
                                        key={q.id}
                                        studentId={student.id}
                                        question={q}
                                        examId={examId}
                                        teacherId={user!.uid}
                                        initialScore={scores[`${student.id}_${q.id}`] || 0}
                                    />
                                ))}
                            </tr>
                        )) : (
                            <tr><td colSpan={questions.length + 1} className="text-center p-4 text-muted">Bu sınıfta öğrenci bulunmuyor.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            { students.length > 0 && questions.length === 0 &&
                 <div className="alert alert-warning mt-4">Bu sınav için henüz soru eklenmemiş. Analiz tablosunu görüntülemek için lütfen önce <Link href={`/dashboard/exams/${examId}`}>sınav detay sayfasından</Link> soru ekleyin.</div>
            }
        </div>
    );
}
