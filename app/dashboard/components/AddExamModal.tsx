
'use client';

import { useEffect, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/app/context/AuthContext';
import { addExam } from '@/app/actions';
import { Loader2 } from 'lucide-react';

interface Class {
  id: string;
  name: string;
}

interface AddExamModalProps {
  show: boolean;
  handleClose: () => void;
}

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? <><Loader2 className="animate-spin me-2" /> Ekleniyor...</> : 'Sınavı Ekle'}
        </button>
    );
}

export default function AddExamModal({ show, handleClose }: AddExamModalProps) {
  const { user } = useAuth();
  const [classes, setClasses] = useState<Class[]>([]);
  const [formState, formAction] = useFormState(addExam, { message: '', success: false });

  useEffect(() => {
    if (user) {
      const q = query(collection(db, 'classes'), where('teacherId', '==', user.uid));
      const unsubscribe = onSnapshot(q, (querySnapshot) => {
        const classesData: Class[] = [];
        querySnapshot.forEach((doc) => {
          classesData.push({ id: doc.id, ...doc.data() } as Class);
        });
        setClasses(classesData);
      });
      return () => unsubscribe();
    }
  }, [user]);

  useEffect(() => {
    if (formState.success) {
      handleClose();
    }
  }, [formState, handleClose]);

  if (!show) return null;

  return (
    <>
      <div className="modal-backdrop fade show"></div>
      <div className="modal show d-block" tabIndex={-1}>
        <div className="modal-dialog modal-dialog-centered">
          <div className="modal-content shadow-lg">
            <div className="modal-header">
              <h5 className="modal-title">Yeni Sınav Ekle</h5>
              <button type="button" className="btn-close" onClick={handleClose}></button>
            </div>
            <form action={formAction}>
                <div className="modal-body">
                    {user && <input type="hidden" name="teacherId" value={user.uid} />}
                    
                    <div className="mb-3">
                        <label htmlFor="title" className="form-label">Sınav Adı</label>
                        <input type="text" id="title" name="title" className="form-control" required />
                    </div>
                    
                    <div className="mb-3">
                        <label htmlFor="date" className="form-label">Tarih</label>
                        <input type="date" id="date" name="date" className="form-control" required />
                    </div>

                    <div className="mb-3">
                        <label htmlFor="classId" className="form-label">Sınıf</label>
                        <select id="classId" name="classId" className="form-select" required>
                            <option value="">Sınıf Seçin...</option>
                            {classes.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                    </div>
                    
                    {formState?.message && !formState.success && (
                        <div className="alert alert-danger p-2 small" role="alert">
                            {formState.message}
                        </div>
                    )}

                </div>
                <div className="modal-footer">
                    <button type="button" className="btn btn-secondary" onClick={handleClose}>Kapat</button>
                    <SubmitButton />
                </div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
