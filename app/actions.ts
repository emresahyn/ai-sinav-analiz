
'use server';

import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import { revalidatePath } from 'next/cache';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { analyzeImageFromFile } from '@/lib/vision';
import sharp from 'sharp';

// --- General Types & Helpers --- //

/**
 * Defines the common return shape for server actions.
 */
export type ActionState = {
    message: string;
    success: boolean;
    studentId?: string;
    uploadedFiles?: { name: string; path: string }[];
};

/**
 * Verifies if a teacher has ownership of a document.
 */
async function verifyOwnership(collectionName: string, docId: string, teacherId: string): Promise<boolean> {
    if (!docId || !teacherId) return false;
    try {
        const docRef = adminDb.collection(collectionName).doc(docId);
        const doc = await docRef.get();
        return doc.exists && doc.data()?.teacherId === teacherId;
    } catch (error) {
        console.error("Ownership verification failed:", error);
        return false;
    }
}

/**
 * Compresses an image, converts it to base64, and returns the string.
 */
async function compressAndEncodeImage(file: File): Promise<string> {
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Compress the image aggressively for storage
    const compressedBuffer = await sharp(buffer)
        .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 70 })
        .toBuffer();

    const extension = file.name.split('.').pop() || 'jpeg';
    return `data:image/${extension};base64,${compressedBuffer.toString('base64')}`;
}

// --- Class Actions --- //
const ClassSchema = z.object({ className: z.string().min(1, 'Sınıf adı gereklidir'), teacherId: z.string() });

export async function addClass(prevState: ActionState | undefined, formData: FormData): Promise<ActionState> {
    const validatedFields = ClassSchema.safeParse({ className: formData.get('className'), teacherId: formData.get('teacherId') });
    if (!validatedFields.success) return { message: 'Geçersiz veri: Sınıf adı boş olamaz.', success: false };

    try {
        await adminDb.collection('classes').add({ name: validatedFields.data.className, teacherId: validatedFields.data.teacherId, createdAt: new Date() });
        revalidatePath('/dashboard/classes');
        return { message: 'Sınıf başarıyla oluşturuldu!', success: true };
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu.';
        return { message: `Sunucu hatası: ${errorMessage}`, success: false };
    }
}

export async function deleteClass(classId: string, teacherId: string): Promise<ActionState> {
    if (!await verifyOwnership('classes', classId, teacherId)) {
        return { message: 'Bu sınıfı silmek için yetkiniz yok.', success: false };
    }

    try {
        const writeBatch = adminDb.batch();
        const examsQuery = adminDb.collection('exams').where('classId', '==', classId).where('teacherId', '==', teacherId);
        const examsSnapshot = await examsQuery.get();

        if (!examsSnapshot.empty) {
            const deleteExamPromises = examsSnapshot.docs.map(doc => deleteExam(doc.id, teacherId));
            await Promise.all(deleteExamPromises);
        }

        const studentsQuery = adminDb.collection('classes').doc(classId).collection('students');
        const studentsSnapshot = await studentsQuery.get();
        studentsSnapshot.docs.forEach(doc => writeBatch.delete(doc.ref));

        const classRef = adminDb.collection('classes').doc(classId);
        writeBatch.delete(classRef);

        await writeBatch.commit();
        revalidatePath('/dashboard/classes');
        return { message: 'Sınıf ve tüm ilişkili veriler (öğrenciler, sınavlar) başarıyla silindi.', success: true };
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu.';
        return { message: `Sınıf silinirken bir sunucu hatası oluştu: ${errorMessage}`, success: false };
    }
}


// --- Student Actions --- //
const StudentSchema = z.object({ 
    studentName: z.string().min(1, 'Öğrenci adı gerekli'), 
    studentNumber: z.string().min(1, 'Öğrenci numarası gerekli'), 
    classId: z.string().min(1), 
    teacherId: z.string().min(1) 
});

export async function addStudent(prevState: ActionState | undefined, formData: FormData): Promise<ActionState> {
    const validatedFields = StudentSchema.safeParse(Object.fromEntries(formData));
    if (!validatedFields.success) return { message: 'Tüm alanların doldurulması zorunludur.', success: false };

    const { classId, teacherId, studentName, studentNumber } = validatedFields.data;
    if (!await verifyOwnership('classes', classId, teacherId)) return { message: 'Bu işlem için yetkiniz yok.', success: false };

    try {
        await adminDb.collection('classes').doc(classId).collection('students').add({ name: studentName, studentNumber });
        revalidatePath(`/dashboard/classes/${classId}`);
        return { message: 'Öğrenci başarıyla eklendi!', success: true };
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu.';
        return { message: `Sunucu hatası: ${errorMessage}`, success: false };
    }
}

export async function addStudentsInBulk(prevState: ActionState | undefined, formData: FormData): Promise<ActionState> {
    const studentsData = formData.get('studentsText') as string | null;
    const classId = formData.get('classId') as string | null;
    const teacherId = formData.get('teacherId') as string | null;

    if (!studentsData || !classId || !teacherId) return { message: 'Eksik bilgi: Öğrenci listesi, sınıf veya öğretmen kimliği bulunamadı.', success: false };
    if (!await verifyOwnership('classes', classId, teacherId)) return { message: 'Bu işlem için yetkiniz yok.', success: false };

    const rows = studentsData.trim().split('\n').filter(row => row.trim() !== '');
    const studentsToAdd = rows.map(row => {
        const parts = row.split('\t');
        const studentName = parts[0]?.trim();
        const studentNumber = parts[1]?.trim();
        return (studentName && studentNumber) ? { name: studentName, studentNumber } : null;
    }).filter((s): s is { name: string; studentNumber: string } => s !== null);

    if (studentsToAdd.length === 0) return { message: 'Liste formatı hatalı veya listede geçerli öğrenci yok.', success: false };

    try {
        const batch = adminDb.batch();
        const studentCollection = adminDb.collection('classes').doc(classId).collection('students');
        studentsToAdd.forEach(student => batch.set(studentCollection.doc(), student));
        await batch.commit();

        revalidatePath(`/dashboard/classes/${classId}`);
        return { message: `${studentsToAdd.length} öğrenci başarıyla eklendi.`, success: true };
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu.';
        return { message: `Toplu öğrenci eklenirken sunucu hatası oluştu: ${errorMessage}`, success: false };
    }
}

export async function deleteStudent(classId: string, studentId: string, teacherId: string): Promise<ActionState> {
    if (!await verifyOwnership('classes', classId, teacherId)) return { message: 'Yetkisiz işlem.', success: false };
    try {
        await adminDb.collection('classes').doc(classId).collection('students').doc(studentId).delete();
        revalidatePath(`/dashboard/classes/${classId}`);
        return { message: 'Öğrenci başarıyla silindi.', success: true };
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu.';
        return { message: `Hata: ${errorMessage}`, success: false };
    }
}


// --- Exam Actions --- //
const ExamSchema = z.object({ 
    title: z.string().min(1, 'Sınav adı zorunludur.'), 
    date: z.string().min(1, 'Tarih zorunludur.'), 
    classId: z.string().min(1, 'Sınıf seçimi zorunludur.'),
    teacherId: z.string().min(1)
});

export async function addExam(prevState: ActionState | undefined, formData: FormData): Promise<ActionState> {
    const validatedFields = ExamSchema.safeParse(Object.fromEntries(formData));
    if (!validatedFields.success) return { message: 'Lütfen tüm zorunlu alanları doldurun.', success: false };

    const { classId, teacherId } = validatedFields.data;
    if (!await verifyOwnership('classes', classId, teacherId)) return { message: 'Sadece kendi sınıfınıza sınav ekleyebilirsiniz.', success: false };

    try {
        await adminDb.collection('exams').add({ ...validatedFields.data, createdAt: new Date() });
        revalidatePath('/dashboard/exams');
        return { message: 'Sınav başarıyla eklendi!', success: true };
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu.';
        return { message: `Sunucu Hatası: ${errorMessage}`, success: false };
    }
}

export async function deleteExam(examId: string, teacherId: string): Promise<ActionState> {
    if (!await verifyOwnership('exams', examId, teacherId)) return { message: 'Bu işlem için yetkiniz yok.', success: false };

    try {
        const batch = adminDb.batch();
        const collectionsToDelete = ['scores', 'questions', 'papers'];
        
        for (const collection of collectionsToDelete) {
            const query = collection === 'scores' 
                ? adminDb.collection(collection).where('examId', '==', examId).where('teacherId', '==', teacherId)
                : adminDb.collection('exams').doc(examId).collection(collection);
            const snapshot = await query.get();
            snapshot.forEach(doc => batch.delete(doc.ref));
        }

        batch.delete(adminDb.collection('exams').doc(examId));
        await batch.commit();

        revalidatePath('/dashboard/exams');
        revalidatePath('/dashboard/analysis');
        return { message: 'Sınav ve tüm ilişkili veriler başarıyla silindi.', success: true };
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu.';
        console.error(`Sınav silme hatası (ID: ${examId}):`, error);
        return { message: `Sınav silinirken bir hata oluştu: ${errorMessage}`, success: false };
    }
}

// --- Exam Paper Actions --- //
const PaperUploadSchema = z.object({
    examId: z.string().min(1),
    studentId: z.string().min(1),
    teacherId: z.string().min(1),
});

export async function uploadExamPaper(prevState: ActionState | undefined, formData: FormData): Promise<ActionState> {
    const studentId = formData.get('studentId') as string;
    const validatedFields = PaperUploadSchema.safeParse(Object.fromEntries(formData));
    if (!validatedFields.success) return { message: 'Geçersiz form verileri.', success: false, studentId };
    
    const { examId, teacherId } = validatedFields.data;
    const papers = formData.getAll('papers') as File[];

    if (!await verifyOwnership('exams', examId, teacherId)) return { message: 'Bu işlem için yetkiniz yok.', success: false, studentId };
    if (!papers || papers.length === 0 || papers[0].name === 'undefined') return { message: 'Yüklenecek dosya seçilmedi.', success: false, studentId };
    
    const papersCollectionRef = adminDb.collection('exams').doc(examId).collection('papers');

    const uploadPromises = papers.map(async (paper) => {
        const base64Data = await compressAndEncodeImage(paper);

        // Firestore'un 1 MiB'lık döküman limitini kontrol et
        if (Buffer.byteLength(base64Data, 'utf8') > 1048576) {
             throw new Error(`Dosya "${paper.name}" boyutu (sıkıştırıldıktan sonra) 1MB limitini aşıyor.`);
        }

        const docRef = await papersCollectionRef.add({
            studentId, teacherId,
            fileName: paper.name,
            fileType: paper.type,
            createdAt: new Date(),
            base64Data,
        });
        
        return { name: paper.name, path: docRef.id };
    });

    try {
        const results = await Promise.all(uploadPromises);
        revalidatePath(`/dashboard/exams/${examId}/upload`);
        return { 
            message: `${results.length} resim dosyası başarıyla veritabanına kaydedildi.`, 
            success: true, 
            studentId,
            uploadedFiles: results
        };
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu.';
        return { message: `Veritabanına resim kaydetme hatası: ${errorMessage}`, success: false, studentId };
    }
}

export async function getUploadedPapers(examId: string, studentId: string) {
    try {
        const papersQuery = adminDb.collection('exams').doc(examId).collection('papers').where('studentId', '==', studentId);
        const snapshot = await papersQuery.get();
        if (snapshot.empty) return { success: true, files: [] };
        
        const fileDetails = snapshot.docs.map(doc => ({
            name: doc.data().fileName,
            path: doc.id
        }));
        
        return { success: true, files: fileDetails };
    } catch (error: unknown) {
        console.error("Get uploaded papers error:", error);
        return { success: true, files: [] };
    }
}

export async function deleteExamPaper(examId: string, teacherId: string, paperId: string): Promise<ActionState> {
    if (!await verifyOwnership('exams', examId, teacherId)) return { message: 'Bu işlem için yetkiniz yok.', success: false };
    
    try {
        await adminDb.collection('exams').doc(examId).collection('papers').doc(paperId).delete();
        revalidatePath(`/dashboard/exams/${examId}/upload`);
        return { message: 'Dosya başarıyla veritabanından silindi.', success: true };
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu.';
        return { message: `Dosya silinirken hata: ${errorMessage}`, success: false };
    }
}

// --- Question Actions --- //
const QuestionSchema = z.object({
    questionNumber: z.coerce.number().min(1, 'Soru numarası pozitif bir sayı olmalıdır.'),
    points: z.coerce.number().min(0, 'Puan negatif olamaz.'),
    kazanim: z.string().optional(),
    examId: z.string().min(1),
    teacherId: z.string().min(1),
});

export async function addQuestionToExam(prevState: ActionState | undefined, formData: FormData): Promise<ActionState> {
    const validatedFields = QuestionSchema.safeParse(Object.fromEntries(formData));
    if (!validatedFields.success) return { message: 'Geçersiz veri: ' + (validatedFields.error.flatten().fieldErrors.questionNumber || validatedFields.error.flatten().fieldErrors.points), success: false };
    
    const { examId, teacherId, questionNumber, points, kazanim } = validatedFields.data;
    if (!await verifyOwnership('exams', examId, teacherId)) return { message: 'Bu işlem için yetkiniz yok.', success: false };

    try {
        await adminDb.collection('exams').doc(examId).collection('questions').add({ questionNumber, points, kazanim: kazanim || '' });
        revalidatePath(`/dashboard/exams/${examId}`);
        return { message: `Soru ${questionNumber} başarıyla eklendi.`, success: true };
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu.';
        return { message: `Sunucu Hatası: ${errorMessage}`, success: false };
    }
}

// --- Analysis & Scoring Actions --- //



export async function analyzeExamPapers(prevState: ActionState | undefined, formData: FormData): Promise<ActionState> {
    const { examId } = z.object({ examId: z.string().min(1) }).parse(Object.fromEntries(formData));
    const examDoc = await adminDb.collection('exams').doc(examId).get();
    if (!examDoc.exists) return { message: 'Sınav bulunamadı.', success: false };

    const { teacherId, classId } = examDoc.data() as { teacherId: string; classId: string };
    if (!teacherId || !classId) return { message: 'Sınav bilgileri eksik.', success: false };

    try {
        const studentsSnapshot = await adminDb.collection('classes').doc(classId).collection('students').get();
        const students = studentsSnapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as { name: string }) }));
        const questionsSnapshot = await adminDb.collection('exams').doc(examId).collection('questions').orderBy('questionNumber').get();
        const questions = questionsSnapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as { points: number; questionNumber: number }) }));

        if (questions.length === 0) return { message: 'Sınavda hiç soru tanımlanmamış.', success: false };

        const batch = adminDb.batch();
        let processedStudentCount = 0, totalScoresSaved = 0;

        for (const student of students) {
            const papersSnapshot = await adminDb.collection('exams').doc(examId).collection('papers').where('studentId', '==', student.id).get();
            if (papersSnapshot.empty) continue;
            processedStudentCount++;
            
            for (const paperDoc of papersSnapshot.docs) {
                const base64Data = paperDoc.data().base64Data;
                if (!base64Data) continue;

                const tempPath = path.join(os.tmpdir(), `${paperDoc.id}.jpeg`);
                try {
                    await fs.writeFile(tempPath, Buffer.from(base64Data, 'base64'));
                    const { success, scores, message } = await analyzeImageFromFile(tempPath);
                    if (!success) {
                        console.error(`YZ Hatası: ${message}`);
                        continue;
                    }
                    (scores || []).forEach((score, i) => {
                        if (questions[i] !== undefined) {
                            const question = questions[i];
                            const finalScore = Math.min(score, question.points);
                            totalScoresSaved++;
                            const scoreRef = adminDb.collection('scores').doc(`${examId}_${student.id}_${question.id}`);
                            batch.set(scoreRef, { examId, studentId: student.id, questionId: question.id, score: finalScore, teacherId, updatedAt: new Date() }, { merge: true });
                        }
                    });
                } finally {
                    await fs.unlink(tempPath);
                }
            }
        }

        if (totalScoresSaved > 0) await batch.commit();

        revalidatePath(`/dashboard/analysis/${examId}`);
        revalidatePath(`/dashboard/exams/${examId}/upload`);

        return { message: `Analiz tamamlandı. ${processedStudentCount} öğrenci incelendi, ${totalScoresSaved} puan kaydedildi.`, success: true };
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu.';
        console.error("KRİTİK ANALİZ HATASI:", error);
        return { message: `Analiz sırasında beklenmedik bir hata oluştu: ${errorMessage}`, success: false };
    }
}
export async function getStudentScoresForExam(examId: string, teacherId: string) {
    if (!await verifyOwnership('exams', examId, teacherId)) {
       return { success: false, message: 'Skorları getirme yetkiniz yok.', scores: {} };
   }
   try {
       const scoresQuery = adminDb.collection('scores').where('examId', '==', examId).where('teacherId', '==', teacherId);
       const querySnapshot = await scoresQuery.get();
       const scores: { [key: string]: number } = {};
       querySnapshot.forEach(doc => {
           const data = doc.data();
           scores[`${data.studentId}_${data.questionId}`] = data.score;
       });
       return { success: true, scores };
   } catch (error: any) {
       console.error("Score fetching error:", error);
       return { success: false, message: `Puanlar getirilirken hata: ${error.message}`, scores: {} };
   }
}
// --- Scoring Actions --- //
const ScoreSchema = z.object({
    examId: z.string().min(1),
    studentId: z.string().min(1),
    questionId: z.string().min(1),
    teacherId: z.string().min(1),
    score: z.coerce.number().min(0, 'Puan negatif olamaz.'),
});
export async function saveStudentScore(formData: FormData) {
    const validatedFields = ScoreSchema.safeParse(Object.fromEntries(formData));
    if (!validatedFields.success) return { success: false, message: 'Geçersiz veri.' };
    
    const { examId, studentId, questionId, teacherId, score } = validatedFields.data;
    if (!await verifyOwnership('exams', examId, teacherId)) return { success: false, message: 'Yetkisiz işlem.' };
    
    try {
        const scoreRef = adminDb.collection('scores').doc(`${examId}_${studentId}_${questionId}`);
        await scoreRef.set({ examId, studentId, questionId, score, teacherId, updatedAt: new Date() }, { merge: true });
        revalidatePath(`/dashboard/analysis/${examId}`);
        return { success: true, message: 'Puan kaydedildi.' };
    } catch (error: any) {
        return { success: false, message: `Hata: ${error.message}` };
    }
}
