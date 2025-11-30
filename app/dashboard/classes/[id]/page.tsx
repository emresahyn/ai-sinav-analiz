
'use client';

import { useEffect, useState, useRef } from 'react';
import { useFormState } from 'react-dom';
import { doc, getDoc, collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/app/context/AuthContext';
import { addStudent, addStudentsInBulk, deleteStudent } from '@/app/actions';
import { Loader2, UserPlus, Users, ArrowLeft, AlertTriangle, CheckCircle, Trash2, Upload } from 'lucide-react';
import Link from 'next/link';

// --- Type Definitions --- //
interface ClassData {
  name: string;
}
interface Student {
    id: string;
    name: string;
    studentNumber: string;
}

// --- Main Page Component --- //
export default function ClassDetailPage({ params }: { params: { id: string } }) {
  const { user, loading: authLoading } = useAuth();
  const [classData, setClassData] = useState<ClassData | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [actionMessage, setActionMessage] = useState<{text: string, success: boolean} | null>(null);

  const [addState, addAction] = useFormState(addStudent, { message: '', success: false });
  const [bulkAddState, bulkAddAction] = useFormState(addStudentsInBulk, { message: '', success: false });
  
  const addFormRef = useRef<HTMLFormElement>(null);
  const bulkFormRef = useRef<HTMLFormElement>(null);
  const classId = params.id;

  // Load Class and Student Data
  useEffect(() => {
    if (user) {
      const classDocRef = doc(db, 'classes', classId);
      getDoc(classDocRef).then(docSnap => {
        if (docSnap.exists()) setClassData(docSnap.data() as ClassData);
      });

      const q = query(collection(db, `classes/${classId}/students`));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const studentsData: Student[] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Student));
        setStudents(studentsData);
        setLoading(false);
      });

      return () => unsubscribe();
    } else if (!authLoading) {
      setLoading(false);
    }
  }, [user, authLoading, classId]);

  // Handle form states
  useEffect(() => {
    if (addState.message) setActionMessage({ text: addState.message, success: addState.success });
    if (addState.success) addFormRef.current?.reset();
  }, [addState]);

  useEffect(() => {
    if (bulkAddState.message) setActionMessage({ text: bulkAddState.message, success: bulkAddState.success });
    if (bulkAddState.success) {
        bulkFormRef.current?.reset();
        setShowBulkModal(false);
    }
  }, [bulkAddState]);

  // Handle student deletion
  const handleDeleteStudent = async (studentId: string) => {
      if(confirm('Bu öğrenciyi silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.')){
          if(!user) return;
          const result = await deleteStudent(classId, studentId, user.uid);
          setActionMessage({ text: result.message, success: result.success });
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
        <header className="d-flex justify-content-between align-items-center border-bottom pb-3 mb-4">
            <div>
                <Link href="/dashboard/classes" className="btn btn-outline-secondary mb-2">
                    <ArrowLeft size={16} className="me-2"/> Sınıflara Dön
                </Link>
                <h1 className="h2">{classData?.name || 'Sınıf Detayları'}</h1>
                <p className="text-muted">Bu sınıftaki öğrencileri yönetin.</p>
            </div>
             <button className="btn btn-info d-flex align-items-center" onClick={() => setShowBulkModal(true)}>
                  <Upload size={18} className="me-2"/>
                  Toplu Öğrenci Ekle
              </button>
        </header>

        {actionMessage && (
            <div className={`alert ${actionMessage.success ? 'alert-success' : 'alert-danger'}`}>
                {actionMessage.text}
            </div>
        )}

        <div className="row">
            {/* Add Student Form */}
            <div className="col-lg-4 mb-4">
                <div className="card shadow-sm h-100">
                    <div className="card-header">
                        <h5 className="mb-0 d-flex align-items-center"><UserPlus className="me-2"/> Yeni Öğrenci Ekle</h5>
                    </div>
                    <div className="card-body">
                        <form ref={addFormRef} action={addAction} className="d-grid gap-3">
                            <input type="text" name="studentName" className="form-control" placeholder="Öğrenci Adı Soyadı" required />
                            <input type="text" name="studentNumber" className="form-control" placeholder="Öğrenci Numarası" required />
                            <input type="hidden" name="classId" value={classId} />
                            {user && <input type="hidden" name="teacherId" value={user.uid} />}
                            <button type="submit" className="btn btn-primary">Öğrenciyi Kaydet</button>
                        </form>
                    </div>
                </div>
            </div>

            {/* Student List */}
            <div className="col-lg-8">
                <div className="card shadow-sm">
                     <div className="card-header d-flex justify-content-between align-items-center">
                        <h5 className="mb-0 d-flex align-items-center"><Users className="me-2"/> Öğrenci Listesi</h5>
                        <span className="badge bg-primary rounded-pill">{students.length} Öğrenci</span>
                    </div>
                    <div className="card-body p-0">
                        {students.length > 0 ? (
                           <ul className="list-group list-group-flush">
                                {students.map(student => (
                                    <li key={student.id} className="list-group-item d-flex justify-content-between align-items-center">
                                        <div>
                                            <span className='fw-bold'>{student.name}</span>
                                            <br/>
                                            <small className="text-muted">{student.studentNumber}</small>
                                        </div>
                                        <button className="btn btn-sm btn-outline-danger" onClick={() => handleDeleteStudent(student.id)}><Trash2 size={14}/></button>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-center text-muted p-4">Bu sınıfta henüz öğrenci bulunmuyor.</p>
                        )}
                    </div>
                </div>
            </div>
        </div>

        {/* Bulk Add Modal */}
        <div className={`modal fade ${showBulkModal ? 'show d-block' : ''}`} tabIndex={-1} style={{backgroundColor: showBulkModal ? 'rgba(0,0,0,0.5)' : 'transparent'}}>
            <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content">
                    <form ref={bulkFormRef} action={bulkAddAction}>
                        <div className="modal-header">
                            <h5 className="modal-title">Toplu Öğrenci Ekle</h5>
                            <button type="button" className="btn-close" onClick={() => setShowBulkModal(false)}></button>
                        </div>
                        <div className="modal-body">
                              <p className='text-muted'>Öğrencileri her satıra bir öğrenci gelecek şekilde yapıştırın. Ad ve numara arasında TAB veya birden çok boşluk bırakın.</p>
                              <textarea name="studentsText" className="form-control" rows={10} placeholder={'İsim Soyisim\t12345\nBaşka İsim\t67890'} required></textarea>
                              <input type="hidden" name="classId" value={classId} />
                              {user && <input type="hidden" name="teacherId" value={user.uid} />}
                        </div>
                        <div className="modal-footer">
                            <button type="button" className="btn btn-secondary" onClick={() => setShowBulkModal(false)}>Kapat</button>
                            <button type="submit" className="btn btn-primary">Öğrencileri Ekle</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>

    </div>
  );
}
