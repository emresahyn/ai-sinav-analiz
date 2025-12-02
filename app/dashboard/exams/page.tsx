
'use client';

import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/app/context/AuthContext';
import { PlusCircle, Loader2, Trash2, ArrowRight } from 'lucide-react';
import AddExamModal from '@/app/dashboard/components/AddExamModal';
import Link from 'next/link';
import { deleteExam } from '@/app/actions'; // Import the server action

interface Exam {
  id: string;
  title: string;
  date: string;
  classId: string;
  className?: string; // Add className to the interface
}

interface ClassData {
    [classId: string]: {
        name: string;
    }
}

export default function ExamsPage() {
  const { user, loading: authLoading } = useAuth();
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [classData, setClassData] = useState<ClassData>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      const q = query(collection(db, 'exams'), where('teacherId', '==', user.uid));
      const unsubscribe = onSnapshot(q, async (querySnapshot) => {
        const examsData: Exam[] = [];
        const classIds = new Set<string>();

        querySnapshot.forEach(doc => {
          const data = doc.data();
          examsData.push({ id: doc.id, ...data } as Exam);
          if(data.classId) classIds.add(data.classId);
        });

        // Fetch class names for all unique classIds
        if (classIds.size > 0) {
            const newClassData = { ...classData };
            let needsUpdate = false;
            for (const id of Array.from(classIds)) {
                if(!newClassData[id]) {
                    const docRef = doc(db, 'classes', id);
                    const docSnap = await getDoc(docRef);
                    if(docSnap.exists()) {
                        newClassData[id] = { name: docSnap.data().name };
                        needsUpdate = true;
                    }
                }
            }
            if(needsUpdate) setClassData(newClassData);
        }
        
        setExams(examsData);
        setLoading(false);
      }, (error) => {
          console.error("Error fetching exams: ", error);
          setLoading(false);
      });

      return () => unsubscribe();
    } else if (!authLoading) {
      setLoading(false);
    }
  }, [user, authLoading, classData]);

  const handleDelete = async (examId: string) => {
      if (confirm('Bu sınavı ve ilişkili tüm kağıtları kalıcı olarak silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.')) {
          if(!user) return;
          const result = await deleteExam(examId, user.uid);
          if (!result.success) {
              setError(result.message);
          } else {
              setError(null); // Clear previous errors
          }
      }
  }

  if (loading || authLoading) {
    return <div className="d-flex justify-content-center align-items-center vh-100"><Loader2 className="animate-spin me-2" /> Yükleniyor...</div>;
  }

  if (!user) {
    return <div className="alert alert-danger">Bu sayfayı görüntülemek için giriş yapmalısınız.</div>;
  }

  return (
    <div className="container-fluid p-4">
      <div className="d-flex justify-content-between align-items-center border-bottom pb-3 mb-3">
        <h1 className="h2">Sınavlar</h1>
        <button onClick={() => setShowModal(true)} className="btn btn-primary d-flex align-items-center">
          <PlusCircle size={20} className="me-2" />
          Yeni Sınav Ekle
        </button>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="row g-4">
        {exams.map((exam) => (
          <div key={exam.id} className="col-md-6 col-lg-4">
            <div className="card h-100 shadow-sm">
              <div className="card-body d-flex flex-column">
                <h5 className="card-title">{exam.title}</h5>
                <p className="card-text text-muted small">
                    {classData[exam.classId] ? `Sınıf: ${classData[exam.classId].name}` : 'Sınıf atanmamış'}
                    <br/>
                    Tarih: {new Date(exam.date).toLocaleDateString()}
                </p>
                <div className="mt-auto d-flex justify-content-between">
                   <Link href={`/dashboard/exams/${exam.id}`} className="btn btn-outline-primary btn-sm">
                       Detaylar <ArrowRight size={16} className="ms-1"/>
                   </Link>
                   <button onClick={() => handleDelete(exam.id)} className="btn btn-outline-danger btn-sm">
                       <Trash2 size={16}/>
                   </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      
      {exams.length === 0 && !loading && (
          <p className='text-center text-muted'>Henüz sınav eklenmemiş. Sağ üstteki butondan yeni bir sınav ekleyebilirsiniz.</p>
      )}

      <AddExamModal show={showModal} handleClose={() => setShowModal(false)} />
    </div>
  );
}