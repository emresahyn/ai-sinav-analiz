'use client';

import { useEffect, useState, useRef } from 'react';
import { useFormState } from 'react-dom';
import Link from 'next/link';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/app/context/AuthContext';
import { addClass, deleteClass } from '@/app/actions';
import { Loader2, Users, GraduationCap, Plus, AlertTriangle, CheckCircle, Trash2 } from 'lucide-react';

// --- Type Definitions --- //
interface Class {
  id: string;
  name: string;
  studentCount?: number;
}

// --- Main Page Component --- //
export default function ClassesPage() {
  const { user, loading: authLoading } = useAuth();
  const [classes, setClasses] = useState<Class[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [addState, addAction] = useFormState(addClass, { message: '', success: false });
  const [deleteStatus, setDeleteStatus] = useState<{ message: string; success: boolean } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Load Classes
  useEffect(() => {
    if (user) {
      const q = query(collection(db, 'classes'), where('teacherId', '==', user.uid));
      const unsubscribe = onSnapshot(q, (querySnapshot) => {
        const classesData: Class[] = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), studentCount: 0 } as Class));
        setClasses(classesData);
        setLoading(false);
        
        classesData.forEach(c => {
            const studentQuery = query(collection(db, `classes/${c.id}/students`));
            onSnapshot(studentQuery, (snap) => {
                setClasses(prev => prev.map(pc => pc.id === c.id ? {...pc, studentCount: snap.size} : pc));
            });
        });

      });
      return () => unsubscribe();
    } else if (!authLoading) {
      setLoading(false);
    }
  }, [user, authLoading]);

  // Reset form and close modal on success
  useEffect(() => {
    if (addState.success) {
        setShowModal(false);
        formRef.current?.reset();
    }
  }, [addState]);

  // Handle class deletion
  const handleDelete = async (classId: string) => {
      if (!user) return;
      if (confirm('Bu sınıfı ve içindeki tüm öğrencileri, sınavları ve sınav sonuçlarını kalıcı olarak silmek istediğinizden emin misiniz? Bu işlem geri alınamaz!')) {
          const result = await deleteClass(classId, user.uid);
          setDeleteStatus(result);
          setTimeout(() => setDeleteStatus(null), 5000); // Hide message after 5 seconds
      }
  };

  // --- Render --- //
  if (loading || authLoading) {
    return <div className="d-flex vh-100 align-items-center justify-content-center"><Loader2 className="animate-spin h-8 w-8 text-primary" /> <span className="ms-3 fs-5 text-muted">Sınıflar yükleniyor...</span></div>;
  }

  if (!user) {
    return <div className="alert alert-danger m-5">Lütfen devam etmek için giriş yapın.</div>;
  }

  return (
      <div className="container-fluid p-4">
          <header className="d-flex justify-content-between align-items-center border-bottom pb-3 mb-4">
              <div>
                <h1 className="h2">Sınıflarım</h1>
                <p className="text-muted">Sınıflarınızı yönetin ve öğrencilerinizi ekleyin.</p>
              </div>
              <button className="btn btn-primary d-flex align-items-center" onClick={() => setShowModal(true)}>
                  <Plus size={18} className="me-2"/>
                  Yeni Sınıf Oluştur
              </button>
          </header>

          {/* Server Action State Messages */}
          {addState.message && !addState.success && (
              <div className={`alert alert-danger d-flex align-items-center`}>
                  <AlertTriangle className="me-2"/>
                  {addState.message}
              </div>
          )}
           {deleteStatus && (
              <div className={`alert ${deleteStatus.success ? 'alert-success' : 'alert-danger'} d-flex align-items-center`}>
                  {deleteStatus.success ? <CheckCircle className="me-2"/> : <AlertTriangle className="me-2"/>}
                  {deleteStatus.message}
              </div>
          )}

          {/* Class List */}
          {classes.length > 0 ? (
              <div className="row row-cols-1 row-cols-md-2 row-cols-lg-3 g-4">
                  {classes.map(cls => (
                      <div className="col" key={cls.id}>
                        <div className="card h-100 shadow-sm border-0 d-flex flex-column">
                          <div className="card-body">
                            <div className="d-flex align-items-center mb-3">
                               <div className="p-3 bg-primary bg-opacity-10 rounded-3 me-3">
                                  <GraduationCap className="h-6 w-6 text-primary" />
                               </div>
                               <div>
                                  <h3 className="card-title h5 mb-0">{cls.name}</h3>
                                  <p className="card-text text-muted mt-1">{cls.studentCount ?? 0} Öğrenci</p>
                               </div>
                            </div>
                          </div>
                          <div className="card-footer bg-white border-top-0 mt-auto p-3">
                             <div className="d-flex gap-2">
                                <Link href={`/dashboard/classes/${cls.id}`} className="btn btn-outline-primary w-100">
                                    Sınıfı Görüntüle
                                </Link>
                                <button onClick={() => handleDelete(cls.id)} className="btn btn-outline-danger flex-shrink-0" title="Sınıfı Sil">
                                    <Trash2 size={18}/>
                                </button>
                             </div>
                          </div>
                        </div>
                      </div>
                  ))}
              </div>
          ) : (
              <div className="text-center p-5 bg-light rounded">
                  <Users className="mx-auto h-12 w-12 text-muted" />
                  <h3 className="mt-4 fs-5">Henüz sınıf oluşturmadınız.</h3>
                  <p className="mt-2 text-muted">Başlamak için yukarıdaki düğmeyi kullanarak bir sınıf ekleyin.</p>
              </div>
          )}

          {/* Add Class Modal */}
          <div className={`modal fade ${showModal ? 'show d-block' : ''}`} tabIndex={-1} style={{backgroundColor: showModal ? 'rgba(0,0,0,0.5)' : 'transparent'}}>
              <div className="modal-dialog modal-dialog-centered">
                  <div className="modal-content">
                      <form ref={formRef} action={addAction}>
                          <div className="modal-header">
                              <h5 className="modal-title">Yeni Sınıf Oluştur</h5>
                              <button type="button" className="btn-close" onClick={() => setShowModal(false)}></button>
                          </div>
                          <div className="modal-body">
                                <p>Oluşturmak istediğiniz sınıfın adını girin.</p>
                                <input type="text" name="className" className="form-control" placeholder="Örn: 12-A Fen Lisesi" required />
                                {user && <input type="hidden" name="teacherId" value={user.uid} />}
                          </div>
                          <div className="modal-footer">
                              <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Kapat</button>
                              <button type="submit" className="btn btn-primary">Sınıfı Oluştur</button>
                          </div>
                      </form>
                  </div>
              </div>
          </div>
      </div>
  );
}