
'use client';

import { useEffect, useState, useRef } from 'react';
import { useFormState } from 'react-dom';
import { doc, getDoc, collection, query, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/app/context/AuthContext';
import { Loader2, ArrowLeft, Upload, User, AlertCircle, Trash2, File as FileIcon, Wand2 } from 'lucide-react';
import Link from 'next/link';
import { uploadExamPaper, getUploadedPapers, deleteExamPaper, analyzeExamPapers } from '@/app/actions';

// --- Type Definitions --- //
interface ExamData { title: string; classId?: string; }
interface Student { id: string; name: string; studentNumber: string; }
interface UploadedFile { name: string; path: string; }
interface StudentFiles { [studentId: string]: UploadedFile[]; }

// --- Student Form Component --- //
function StudentUploadForm({ student, examId, teacherId, initialFiles, isAnalysisRunning }: { student: Student; examId: string; teacherId: string, initialFiles: UploadedFile[], isAnalysisRunning: boolean }) {
    const [uploadState, formAction] = useFormState(uploadExamPaper, { message: '', success: false, studentId: student.id, uploadedFiles: [] });
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>(initialFiles);
    const [deleteMessage, setDeleteMessage] = useState<{text: string, success: boolean, key: number} | null>(null);
    const [uploadMessage, setUploadMessage] = useState<{text: string, success: boolean, key: number} | null>(null);
    const formRef = useRef<HTMLFormElement>(null);

    useEffect(() => {
        if (uploadState.message && uploadState.studentId === student.id) {
            if(uploadState.success) {
                setUploadedFiles(prev => [...prev, ...uploadState.uploadedFiles!]);
                setSelectedFiles([]);
                formRef.current?.reset();
            }
            setUploadMessage({ text: uploadState.message, success: uploadState.success, key: Date.now() });
        }
    }, [uploadState, student.id]);

    useEffect(() => {
        if (uploadMessage) {
            const timer = setTimeout(() => setUploadMessage(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [uploadMessage]);

    useEffect(() => {
        if (deleteMessage) {
            const timer = setTimeout(() => setDeleteMessage(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [deleteMessage]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) setSelectedFiles(Array.from(e.target.files));
    };

    const handleDeletePaper = async (paperId: string) => {
        const fileName = uploadedFiles.find(f => f.path === paperId)?.name || 'bu dosyayı';
        if (confirm(`'${fileName}' silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.`)) {
            const result = await deleteExamPaper(examId, teacherId, paperId);
            setDeleteMessage({ text: result.message, success: result.success, key: Date.now() });
            if (result.success) {
                setUploadedFiles(prev => prev.filter(f => f.path !== paperId));
            }
        }
    };

    return (
        <li className={`list-group-item ${isAnalysisRunning ? 'bg-light text-muted' : ''}`}>
            <div className="d-flex flex-wrap align-items-center justify-content-between">
                 <div className="d-flex align-items-center mb-2 mb-md-0 me-3">
                    <User className="me-3 text-muted" size={32}/>
                    <div>
                        <div className="fw-bold">{student.name}</div>
                        <div className="small text-muted">{student.studentNumber}</div>
                    </div>
                </div>
                <form action={formAction} ref={formRef} className="d-flex align-items-center flex-grow-1" style={{minWidth: '320px'}}>
                    <input type="file" name="papers" className="form-control form-control-sm me-2" multiple onChange={handleFileChange} accept="image/*" disabled={isAnalysisRunning} />
                    <input type="hidden" name="examId" value={examId} />
                    <input type="hidden" name="studentId" value={student.id} />
                    <input type="hidden" name="teacherId" value={teacherId} />
                    <button type="submit" className="btn btn-sm btn-primary" disabled={selectedFiles.length === 0 || isAnalysisRunning}> <Upload size={16}/> </button>
                </form>
            </div>

            { (uploadMessage) && (
                <div key={uploadMessage.key} className={`alert ${uploadMessage.success ? 'alert-success' : 'alert-danger'} small p-2 mt-2`}>{uploadMessage.text}</div>
            )}
            { (deleteMessage) && (
                <div key={deleteMessage.key} className={`alert ${deleteMessage.success ? 'alert-success' : 'alert-danger'} small p-2 mt-2`}>{deleteMessage.text}</div>
            )}

            <div className="mt-2 pt-2 border-top">
                {uploadedFiles.length > 0 && (
                    <div>
                        <h6 className="small fw-bold">Yüklenmiş Dosyalar:</h6>
                        <ul className="list-unstyled mb-0">
                            {uploadedFiles.map((file) => (
                                <li key={file.path} className="small d-flex align-items-center justify-content-between">
                                    <span className="d-flex align-items-center text-success">
                                        <FileIcon size={14} className="me-2"/> {file.name}
                                    </span>
                                    <button className="btn btn-sm btn-outline-danger p-0 px-1" onClick={() => handleDeletePaper(file.path)} disabled={isAnalysisRunning}><Trash2 size={12}/></button>
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
  
  const [analysisState, analysisAction] = useFormState(analyzeExamPapers, { message: '', success: false });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [displayMessage, setDisplayMessage] = useState({ text: '', success: false, key: 0 });
  const analysisFormRef = useRef<HTMLFormElement>(null);


  // --- Data Loading Effect ---
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
              
              studentsData.sort((a, b) => {
                  const numA = parseInt(a.studentNumber, 10);
                  const numB = parseInt(b.studentNumber, 10);
                  if (isNaN(numA) && isNaN(numB)) return a.studentNumber.localeCompare(b.studentNumber);
                  if (isNaN(numA)) return 1;
                  if (isNaN(numB)) return -1;
                  return numA - numB;
              });

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

  // --- Analysis State & Submission Effects ---
  useEffect(() => {
    // Sunucudan analiz sonucu geldiğinde çalışır
    if (analysisState.message) {
      setDisplayMessage({ text: analysisState.message, success: analysisState.success, key: Date.now() });
      setIsAnalyzing(false); // Analizi durdur ve arayüzü aç
    }
  }, [analysisState]);
  
  useEffect(() => {
    // isAnalyzing state'i true olunca formu otomatik gönderir
    if (isAnalyzing) {
        analysisFormRef.current?.requestSubmit();
    }
  }, [isAnalyzing]);

  // --- Analysis Message Timer ---
  useEffect(() => {
    if (displayMessage.text) {
        const timer = setTimeout(() => setDisplayMessage({ text: '', success: false, key: 0 }), 5000);
        return () => clearTimeout(timer);
    }
  }, [displayMessage]);
  
  const handleAnalysisClick = () => {
    setIsAnalyzing(true); // Sadece arayüzü kilitle, formu useEffect tetikleyecek
  };
  
  const allFiles = Object.values(initialFiles).flat();
  const hasUploadedFiles = allFiles.length > 0;

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
                       <StudentUploadForm key={student.id} student={student} examId={examId} teacherId={user.uid} initialFiles={initialFiles[student.id] || []} isAnalysisRunning={isAnalyzing} />
                    )) : <p className="p-4 text-center text-muted">Bu sınava atanmış sınıfta öğrenci bulunmuyor.</p>}
                </ul>
            </div>
        </div>

        <div className="card shadow-sm mt-4">
            <div className="card-body">
                <h5 className="card-title d-flex align-items-center"><Wand2 className="me-2"/> Sınav Analizi</h5>
                <p className="card-text text-muted">Tüm öğrenciler için yüklenen sınav kağıtlarının analizini başlatın. Bu işlem, yapay zeka kullanarak her bir kağıttaki puanları okuyacak ve sonuçları analiz tablolarına otomatik olarak işleyecektir.</p>
                <form action={analysisAction} ref={analysisFormRef}>
                    <input type="hidden" name="examId" value={examId} />
                    <button type="button" onClick={handleAnalysisClick} className="btn btn-lg btn-success w-100" disabled={!hasUploadedFiles || isAnalyzing}>
                        {isAnalyzing ? (
                            <><Loader2 className="animate-spin me-2" size={20}/> Analiz Ediliyor, Lütfen bekleyin...</>
                        ) : (
                            <>Analizi Başlat</>
                        )}
                    </button>
                </form>
                {displayMessage.text && (
                    <div key={displayMessage.key} className={`d-flex align-items-center alert ${displayMessage.success ? 'alert-success' : 'alert-danger'} mt-3`}>
                        <AlertCircle className="me-2"/>
                        {displayMessage.text}
                    </div>
                )}
            </div>
        </div>

    </div>
  );
}
