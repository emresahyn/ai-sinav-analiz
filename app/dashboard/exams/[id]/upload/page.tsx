
'use client';

import { useEffect, useState, useRef } from 'react';
import { useFormState } from 'react-dom';
import { doc, getDoc, collection, query, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/app/context/AuthContext';
import { Loader2, ArrowLeft, Upload, User, Paperclip, Check, AlertCircle, Trash2, File as FileIcon } from 'lucide-react';
import Link from 'next/link';
import { uploadExamPaper, getUploadedPapers, deleteExamPaper } from '@/app/actions';

// --- Type Definitions --- //
interface ExamData { title: string; classId?: string; }
interface Student { id: string; name: string; studentNumber: string; }
interface UploadedFile { name: string; path: string; }
interface StudentFiles { [studentId: string]: UploadedFile[]; }

// --- Student Form Component --- //
function StudentUploadForm({ student, examId, teacherId, initialFiles }: { student: Student; examId: string; teacherId: string, initialFiles: UploadedFile[] }) {
    const [uploadState, formAction] = useFormState(uploadExamPaper, { message: '', success: false, studentId: student.id, uploadedFiles: [] });
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>(initialFiles);
    const [deleteMessage, setDeleteMessage] = useState<{text: string, success: boolean} | null>(null);
    const formRef = useRef<HTMLFormElement>(null);

    useEffect(() => {
        if (uploadState.success && uploadState.studentId === student.id) {
            setUploadedFiles(prev => [...prev, ...uploadState.uploadedFiles!]);
            setSelectedFiles([]);
            formRef.current?.reset();
        }
    }, [uploadState]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) setSelectedFiles(Array.from(e.target.files));
    };

    const handleDeletePaper = async (filePath: string) => {
        if (confirm(`'${filePath.split('/').pop()}' dosyasını silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.`)) {
            const result = await deleteExamPaper(examId, teacherId, filePath);
            setDeleteMessage({ text: result.message, success: result.success });
            if (result.success) {
                setUploadedFiles(prev => prev.filter(f => f.path !== filePath));
            }
        }
    };

    return (
        <li className="list-group-item">
            <div className="d-flex flex-wrap align-items-center justify-content-between">
                 <div className="d-flex align-items-center mb-2 mb-md-0 me-3">
                    <User className="me-3 text-muted" size={32}/> 
                    <div>
                        <div className="fw-bold">{student.name}</div>
                        <div className="small text-muted">{student.studentNumber}</div>
                    </div>
                </div>
                <form action={formAction} ref={formRef} className="d-flex align-items-center flex-grow-1" style={{minWidth: '320px'}}>
                    <input type="file" name="papers" className="form-control form-control-sm me-2" multiple onChange={handleFileChange} />
                    <input type="hidden" name="examId" value={examId} />
                    <input type="hidden" name="studentId" value={student.id} />
                    <input type="hidden" name="teacherId" value={teacherId} />
                    <button type="submit" className="btn btn-sm btn-primary" disabled={selectedFiles.length === 0}> <Upload size={16}/> </button>
                </form>
            </div>

            {/* Status Messages */}
            { (uploadState.message && uploadState.studentId === student.id) && (
                <div className={`alert ${uploadState.success ? 'alert-success' : 'alert-danger'} small p-2 mt-2`}>{uploadState.message}</div>
            )}
            { (deleteMessage) && (
                <div className={`alert ${deleteMessage.success ? 'alert-success' : 'alert-danger'} small p-2 mt-2`}>{deleteMessage.text}</div>
            )}
            
            <div className="mt-2 pt-2 border-top">
                {selectedFiles.length > 0 && (
                    <div>
                         <h6 className="small fw-bold">Yüklenecek Dosyalar:</h6>
                         <ul className="list-unstyled"> {selectedFiles.map((file, i) => <li key={i} className="small d-flex align-items-center"><Paperclip size={14} className="me-1 text-muted"/> {file.name}</li>)} </ul>
                    </div>
                )}
                {uploadedFiles.length > 0 && (
                    <div>
                        <h6 className="small fw-bold mt-2">Yüklenmiş Dosyalar:</h6>
                        <ul className="list-unstyled">
                            {uploadedFiles.map((file) => (
                                <li key={file.path} className="small d-flex align-items-center justify-content-between">
                                    <a href={file.path} target="_blank" rel="noopener noreferrer" className="d-flex align-items-center">
                                        <FileIcon size={14} className="me-1 text-success"/> {file.name}
                                    </a>
                                    <button className="btn btn-sm btn-outline-danger p-0 px-1" onClick={() => handleDeletePaper(file.path)}><Trash2 size={12}/></button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                {uploadedFiles.length === 0 && selectedFiles.length === 0 && <p className="small text-muted fst-italic mt-2 mb-0">Bu öğrenci için henüz kağıt yüklenmemiş.</p>}
            </div>
        </li>
    );
}

// --- Main Page Component --- //
export default function UploadPage({ params }: { params: { id: string } }) {
  const { user, loading: authLoading } = useAuth();
  const [examData, setExamData] = useState<ExamData | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [initialFiles, setInitialFiles] = useState<StudentFiles>({});
  const [loading, setLoading] = useState(true);
  const examId = params.id;

  useEffect(() => {
    if (user) {
      const examDocRef = doc(db, 'exams', examId);
      getDoc(examDocRef).then(async (docSnap) => {
        if (docSnap.exists()) {
          const exam = docSnap.data() as ExamData;
          setExamData(exam);
          if (exam.classId) {
            const studentsQuery = query(collection(db, `classes/${exam.classId}/students`));
            const unsubscribe = onSnapshot(studentsQuery, async (snapshot) => {
              const studentsData: Student[] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Student));
              setStudents(studentsData);

              const filePromises = studentsData.map(s => getUploadedPapers(examId, s.id));
              const filesResults = await Promise.all(filePromises);
              
              const filesByStudent: StudentFiles = {};
              filesResults.forEach((result, index) => {
                  if(result.success) filesByStudent[studentsData[index].id] = result.files || [];
              });
              setInitialFiles(filesByStudent);
              setLoading(false);
            });
            return () => unsubscribe();
          }
        } else { setLoading(false); }
      });
    } else if (!authLoading) { setLoading(false); }
  }, [user, authLoading, examId]);

  if (loading || authLoading) {
    return <div className="d-flex vh-100 align-items-center justify-content-center"><Loader2 className="animate-spin h-8 w-8 text-primary" /> <span className="ms-3 fs-5 text-muted">Öğrenciler ve dosyalar yükleniyor...</span></div>;
  }
  if (!user) { return <div className="alert alert-danger m-5">Bu sayfayı görüntülemek için giriş yapmalısınız.</div>; }

  return (
    <div className="container-fluid p-4">
        <header className="border-bottom pb-3 mb-4">
            <Link href={`/dashboard/exams/${examId}`} className="btn btn-outline-secondary mb-3">
                <ArrowLeft size={16} className="me-2"/> Sınav Detayına Dön
            </Link>
            <h1 className="h2">Sınav Kağıtlarını Yükle</h1>
            <p className="text-muted">{examData?.title || 'Sınav'} için öğrenci sınav kağıtlarını yükleyin.</p>
        </header>
        <div className="card shadow-sm">
            <div className="card-header"> <h5 className="mb-0">Öğrenci Listesi</h5> </div>
            <div className="card-body p-0">
                <ul className="list-group list-group-flush">
                    {students.length > 0 ? students.map(student => (
                       <StudentUploadForm key={student.id} student={student} examId={examId} teacherId={user.uid} initialFiles={initialFiles[student.id] || []} />
                    )) : <p className="p-4 text-center text-muted">Bu sınava atanmış sınıfta öğrenci bulunmuyor.</p>}
                </ul>
            </div>
        </div>
    </div>
  );
}
