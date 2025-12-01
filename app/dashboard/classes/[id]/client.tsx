'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useFormStatus, useFormState } from 'react-dom';
import { collection, doc, onSnapshot, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/app/context/AuthContext';
import { addStudent, addStudentsInBulk, deleteStudent } from '@/app/actions';
import { Loader2, AlertCircle, ArrowLeft, Trash2, UserPlus, Upload, Users } from 'lucide-react';

// --- Tür Tanımları --- //
interface ClassDetails { id: string; name: string; }
interface Student { id: string; name: string; studentNumber: string; }

// --- Submit Butonları --- //
function SubmitButton({ text, icon: Icon }: { text: string; icon: React.ElementType }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="w-full flex justify-center items-center px-4 py-3 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-indigo-400 disabled:cursor-not-allowed transition-all duration-200">
      {pending ? <Loader2 className="animate-spin h-5 w-5" /> : <Icon className="h-5 w-5" />}
      <span className="ml-2">{pending ? 'İşleniyor...' : text}</span>
    </button>
  );
}

// --- Ana Sayfa Bileşeni --- //
export default function ClassDetailClientPage({ id }: { id: string }) {
  const { user, loading: authLoading } = useAuth();
  
  // Durumlar
  const [classDetails, setClassDetails] = useState<ClassDetails | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [deleteStatus, setDeleteStatus] = useState<{ message: string; success: boolean } | null>(null);

  // Yükleme ve Hata Durumları
  const [pageState, setPageState] = useState<'loading' | 'error' | 'success'>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Form Durumları
  const [addStudentState, addStudentAction] = useFormState(addStudent, { message: '', success: false });
  const [bulkAddState, bulkAddAction] = useFormState(addStudentsInBulk, { message: '', success: false });
  const addStudentFormRef = useRef<HTMLFormElement>(null);
  const bulkAddFormRef = useRef<HTMLFormElement>(null);

  // Ana Veri Yükleme
  useEffect(() => {
    if (!id || !user) {
      if (!authLoading) {
        setPageState('error');
        setErrorMessage('Kimlik doğrulama başarısız oldu veya sınıf kimliği bulunamadı.');
      }
      return;
    }

    setPageState('loading');

    const unsubscribers: (() => void)[] = [];

    const classDocRef = doc(db, 'classes', id);
    unsubscribers.push(onSnapshot(classDocRef, 
      (doc) => {
        if (doc.exists() && doc.data().teacherId === user.uid) {
          setClassDetails({ id: doc.id, name: doc.data().name });
          setPageState('success');
        } else {
          setPageState('error');
          setErrorMessage('Bu sınıfa erişiminiz yok veya sınıf mevcut değil.');
        }
      },
      (err) => {
        console.error("Sınıf detayı alınırken hata:", err);
        setPageState('error');
        setErrorMessage(`Sınıf verileri alınamadı: ${err.message}`);
      }
    ));

    const studentsQuery = query(collection(db, `classes/${id}/students`));
    unsubscribers.push(onSnapshot(studentsQuery, 
        (snapshot) => setStudents(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Student))),
        (err) => console.error("Öğrenciler alınırken hata:", err) 
    ));

    return () => unsubscribers.forEach(unsub => unsub());

  }, [id, user, authLoading]);

  // Form sıfırlama
  useEffect(() => { if (addStudentState.success) addStudentFormRef.current?.reset(); }, [addStudentState]);
  useEffect(() => { if (bulkAddState.success) bulkAddFormRef.current?.reset(); }, [bulkAddState]);

  // Öğrenci silme işlemi
  const handleDelete = async (studentId: string) => {
      if(confirm('Bu öğrenciyi silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.')){
        if(!user) return;
        const result = await deleteStudent(id, studentId, user.uid);
        setDeleteStatus(result);
        setTimeout(() => setDeleteStatus(null), 3000);
      }
  };

  // --- RENDER KISMI ---
  if (pageState === 'loading' || authLoading) {
    return <div className="flex h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-blue-600"/> <span className="ml-4 text-slate-600">Yükleniyor...</span></div>;
  }

  if (pageState === 'error') {
    return <div className="flex h-screen items-center justify-center p-8 text-center"><AlertCircle className="h-8 w-8 mr-2 text-red-500"/> <span className="text-red-500">{errorMessage}</span></div>;
  }

  if (pageState === 'success' && classDetails && user) {
      return (
        <div className="flex min-h-screen bg-slate-100 font-sans">
            <main className="flex-1 p-10">
                <Link href="/dashboard/classes" className="inline-flex items-center text-slate-500 hover:text-blue-600 mb-6 font-semibold group">
                    <ArrowLeft className="mr-2 h-4 w-4 transition-transform group-hover:-translate-x-1"/>
                    Tüm Sınıflara Geri Dön
                </Link>
                <header className="mb-10">
                    <h1 className="text-4xl font-bold text-slate-800">{classDetails.name} Sınıfı</h1>
                    <p className="mt-2 text-lg text-slate-500">Bu sınıftaki öğrencileri yönetin ve toplu olarak öğrenci ekleyin.</p>
                </header>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
                    <div className="lg:col-span-1 space-y-8">
                        <div className="bg-white rounded-xl shadow-xl p-8">
                            <h2 className="text-2xl font-semibold text-slate-700 mb-6">Yeni Öğrenci Ekle</h2>
                            <form ref={addStudentFormRef} action={addStudentAction} className="space-y-4">
                                <div>
                                    <label htmlFor="studentName" className="block text-sm font-medium text-slate-600 mb-1">Öğrenci Adı Soyadı</label>
                                    <input type="text" id="studentName" name="studentName" required className="w-full rounded-md border-slate-300 shadow-sm"/>
                                </div>
                                <div>
                                    <label htmlFor="studentNumber" className="block text-sm font-medium text-slate-600 mb-1">Öğrenci Numarası</label>
                                    <input type="text" id="studentNumber" name="studentNumber" required className="w-full rounded-md border-slate-300 shadow-sm"/>
                                </div>
                                <input type="hidden" name="classId" value={id} />
                                <input type="hidden" name="teacherId" value={user.uid} />
                                <SubmitButton text="Öğrenciyi Ekle" icon={UserPlus}/>
                            </form>
                             {addStudentState.message && <div className={`mt-4 p-3 rounded-lg text-sm ${addStudentState.success ? 'text-green-800 bg-green-100' : 'text-red-800 bg-red-100'}`}>{addStudentState.message}</div>}
                        </div>
                        
                         <div className="bg-white rounded-xl shadow-xl p-8">
                            <h2 className="text-2xl font-semibold text-slate-700 mb-6">Toplu Öğrenci Ekle</h2>
                            <form ref={bulkAddFormRef} action={bulkAddAction} className="space-y-4">
                                <textarea name="studentsData" rows={8} className="w-full rounded-md border-slate-300" placeholder="Her satıra bir öğrenci:\nAhmet Yılmaz	123"></textarea>
                                <input type="hidden" name="teacherId" value={user.uid} />
                                <input type="hidden" name="classId" value={id} />
                                <SubmitButton text="Toplu Ekle" icon={Upload}/>
                            </form>
                            {bulkAddState.message && <div className={`mt-4 p-3 rounded-lg text-sm ${bulkAddState.success ? 'text-green-800 bg-green-100' : 'text-red-800 bg-red-100'}`}>{bulkAddState.message}</div>}
                        </div>
                    </div>

                    <div className="lg:col-span-2 bg-white rounded-xl shadow-xl p-8">
                        <h2 className="text-2xl font-semibold text-slate-700 mb-6">Öğrenciler ({students.length})</h2>
                        {deleteStatus && <div className={`mb-4 p-3 rounded-lg text-sm ${deleteStatus.success ? 'text-green-800 bg-green-100' : 'text-red-800 bg-red-100'}`}>{deleteStatus.message}</div>}
                        {students.length > 0 ? (
                            <ul className="divide-y divide-slate-200">
                                {students.map(student => (
                                    <li key={student.id} className="flex items-center justify-between py-3 group">
                                        <div>
                                            <p className="font-medium text-slate-800">{student.name}</p>
                                            <p className="text-sm text-slate-500">{student.studentNumber}</p>
                                        </div>
                                        <button onClick={() => handleDelete(student.id)} className="text-slate-400 hover:text-red-600 opacity-0 group-hover:opacity-100">
                                            <Trash2 className="h-5 w-5" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                             <div className="text-center py-10 bg-slate-50 rounded-lg">
                                <Users className="mx-auto h-12 w-12 text-slate-400" />
                                <h3 className="mt-2 font-medium text-slate-900">Bu sınıfta öğrenci yok.</h3>
                                <p className="mt-1 text-sm text-slate-500">Başlamak için öğrenci ekleyin.</p>
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
      );
  }
  
  return <div className="flex h-screen items-center justify-center text-red-500">Beklenmedik bir hata oluştu.</div>;
}