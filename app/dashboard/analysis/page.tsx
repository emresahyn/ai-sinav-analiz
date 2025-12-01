
'use client';

import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, getDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/app/context/AuthContext';
import { Loader2, ArrowRight } from 'lucide-react';
import Link from 'next/link';

interface Exam {
  id: string;
  title: string;
  date: string;
  classId: string;
  className?: string;
}

interface ClassData {
    [classId: string]: { name: string; }
}

export default function AnalysisPage() {
  const { user, loading: authLoading } = useAuth();
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [classData, setClassData] = useState<ClassData>({});

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

  if (loading || authLoading) {
    return <div className="d-flex justify-content-center align-items-center vh-100"><Loader2 className="animate-spin me-2" /> Yükleniyor...</div>;
  }

  if (!user) {
    return <div className="alert alert-danger">Bu sayfayı görüntülemek için giriş yapmalısınız.</div>;
  }

  return (
    <div className="container-fluid p-4">
      <div className="border-bottom pb-3 mb-3">
        <h1 className="h2">Sınav Analizleri</h1>
        <p className="text-muted">Analiz yapmak için bir sınav seçin.</p>
      </div>

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
                <div className="mt-auto">
                   <Link href={`/dashboard/analysis/${exam.id}`} className="btn btn-success btn-sm w-100">
                       Analizi Görüntüle <ArrowRight size={16} className="ms-1"/>
                   </Link>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      
      {exams.length === 0 && !loading && (
          <p className='text-center text-muted'>Analiz edilecek sınav bulunamadı.</p>
      )}

    </div>
  );
}