'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { doc, getDoc, collection, getDocs, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase'; // db importu düzeltildi
import { useAuth } from '@/app/context/AuthContext'; // useAuth importu düzeltildi
import { toast, Toaster } from 'react-hot-toast';

interface Question {
  id: string;
  text: string;
  answer: string;
  points: number;
}

interface Student {
  id: string;
  name: string;
  studentNumber: string;
}

interface Score {
  [studentId: string]: {
    [questionId: string]: number;
  };
}

const AnalysisPage = () => {
  const { user } = useAuth();
  const params = useParams();
  const router = useRouter();
  const examId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [exam, setExam] = useState<any>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [scores, setScores] = useState<Score>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!examId || !user) {
        if(!user){
            setLoading(false)
            setError("Bu sayfayı görüntülemek için giriş yapmalısınız.")
        }
      return;
    }

    const fetchExamData = async () => {
      try {
        setLoading(true);

        // Yetki kontrolü
        const examRef = doc(db, 'exams', examId);
        const examSnap = await getDoc(examRef);
        if (!user || !examSnap.exists() || examSnap.data().teacherId !== user.uid) {
            setError('Sınav bulunamadı veya bu analizi görüntüleme yetkiniz yok.');
            setLoading(false);
            return;
        }
        
        const examData = examSnap.data();
        setExam(examData);

        // Soruları çek
        const questionsRef = collection(db, 'exams', examId, 'questions');
        const questionsSnap = await getDocs(questionsRef);
        const questionsList = questionsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Question[];
        setQuestions(questionsList);

        // Sınıf öğrencilerini çek
        if (examData.classId) {
          const studentsRef = collection(db, 'classes', examData.classId, 'students');
          const studentsSnap = await getDocs(studentsRef);
          const studentsList = studentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Student[];
          setStudents(studentsList);
        }

        // Puanları çek
        const scoresRef = doc(db, 'scores', examId);
        const scoresSnap = await getDoc(scoresRef);
        if (scoresSnap.exists()) {
          setScores(scoresSnap.data() as Score);
        }

      } catch (err) {
        console.error(err);
        setError('Veri yüklenirken bir hata oluştu.');
        toast.error('Veri yüklenirken bir hata oluştu.');
      } finally {
        setLoading(false);
      }
    };

    fetchExamData();
  }, [examId, user, router]);

  const handleScoreChange = (studentId: string, questionId: string, value: string) => {
    const points = Number(value);
    setScores(prev => ({
      ...prev,
      [studentId]: {
        ...prev[studentId],
        [questionId]: points
      }
    }));
  };

  const saveStudentScore = async (studentId: string, questionId: string) => {
    const score = scores[studentId]?.[questionId];
    const question = questions.find(q => q.id === questionId);

    if (score === undefined || score < 0 || (question && score > question.points)) {
        toast.error(`Puan, 0 ile ${question?.points} arasında olmalıdır.`);
        return;
    }

    try {
        const scoreRef = doc(db, 'scores', examId);
        // We use set with merge:true to create or update the document
        await setDoc(scoreRef, {
            [studentId]: {
                [questionId]: score
            }
        }, { merge: true });
        toast.success('Puan kaydedildi!');
    } catch (error) {
        console.error("Puan kaydedilirken hata:", error);
        toast.error('Puan kaydedilirken bir hata oluştu.');
    }
  };


  if (loading) {
    return <div className="d-flex justify-content-center align-items-center" style={{ height: '80vh' }}><div className="spinner-border text-primary" role="status"><span className="visually-hidden">Yükleniyor...</span></div></div>;
  }

  if (error) {
    return <div className="alert alert-danger m-4">{error}</div>;
  }

  if (!exam) {
    return <div className="alert alert-warning m-4">Sınav bilgileri yüklenemedi.</div>;
  }

  return (
    <div className="container-fluid p-4">
        <Toaster position="bottom-right" />
        <div className="border-bottom pb-3 mb-4">
            <h1 className="h2">{exam.title} - Puan Analizi</h1>
            <p className="text-muted">Öğrencilerinize ait sınav puanlarını girin ve kaydedin.</p>
        </div>
        
        <div className="table-responsive"> 
            <table className="table table-bordered table-hover">
                <thead className="table-light">
                    <tr>
                        <th scope="col" className='bg-light'>Öğrenci Adı</th>
                        {questions.map(q => (
                            <th key={q.id} scope="col" className="text-center">
                                Soru {questions.indexOf(q) + 1}
                                <br/>
                                <small className="fw-normal text-muted">({q.points} Puan)</small>
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {students.map(student => (
                        <tr key={student.id}>
                            <td className='bg-light font-weight-bold'>{student.name}</td>
                            {questions.map(q => (
                                <td key={q.id}>
                                    <div className="input-group">
                                        <input 
                                            type="number"
                                            className="form-control form-control-sm"
                                            value={scores[student.id]?.[q.id] || ''}
                                            onChange={(e) => handleScoreChange(student.id, q.id, e.target.value)}
                                            onBlur={() => saveStudentScore(student.id, q.id)}
                                            min="0"
                                            max={q.points}
                                        />
                                    </div>
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    </div>
  );
};

export default AnalysisPage;
