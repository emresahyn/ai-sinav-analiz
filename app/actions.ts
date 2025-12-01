
'use server';

import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import { revalidatePath } from 'next/cache';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { analyzeImageFromFile } from '@/lib/vision';

// --- Helper --- //
async function verifyOwnership(collectionName: string, docId: string, teacherId: string) {
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

// --- Class Actions --- //
const ClassSchema = z.object({ className: z.string().min(1, 'Sınıf adı gereklidir'), teacherId: z.string() });
export async function addClass(prevState: any, formData: FormData) {
    const validatedFields = ClassSchema.safeParse({ className: formData.get('className'), teacherId: formData.get('teacherId') });
    if (!validatedFields.success) return { message: 'Geçersiz veri: Sınıf adı boş olamaz.', success: false };

    try {
        await adminDb.collection('classes').add({ name: validatedFields.data.className, teacherId: validatedFields.data.teacherId, createdAt: new Date() });
        revalidatePath('/dashboard/classes');
        return { message: 'Sınıf başarıyla oluşturuldu!', success: true };
    } catch (e: any) {
        return { message: `Sunucu hatası: ${e.message}`, success: false };
    }
}

export async function deleteClass(classId: string, teacherId: string) {
    if (!await verifyOwnership('classes', classId, teacherId)) {
        return { message: 'Bu sınıfı silmek için yetkiniz yok.', success: false };
    }

    try {
        const writeBatch = adminDb.batch();

        const examsQuery = adminDb.collection('exams').where('classId', '==', classId).where('teacherId', '==', teacherId);
        const examsSnapshot = await examsQuery.get();

        if (!examsSnapshot.empty) {
            const deleteExamPromises = examsSnapshot.docs.map(doc => deleteExam(doc.id, teacherId));
            const deleteExamResults = await Promise.all(deleteExamPromises);
            const failedDeletions = deleteExamResults.filter(result => !result.success);
            if (failedDeletions.length > 0) {
                const errorMessages = failedDeletions.map(f => f.message).join(', ');
                return { message: `Sınıfa ait bazı sınavlar silinirken hata oluştu: ${errorMessages}`, success: false };
            }
        }

        const studentsQuery = adminDb.collection('classes').doc(classId).collection('students');
        const studentsSnapshot = await studentsQuery.get();
        if (!studentsSnapshot.empty) {
            studentsSnapshot.docs.forEach(doc => writeBatch.delete(doc.ref));
        }

        const classRef = adminDb.collection('classes').doc(classId);
        writeBatch.delete(classRef);

        await writeBatch.commit();

        revalidatePath('/dashboard/classes');
        return { message: 'Sınıf ve tüm ilişkili veriler (öğrenciler, sınavlar) başarıyla silindi.', success: true };

    } catch (error: any) {
        return { message: `Sınıf silinirken bir sunucu hatası oluştu: ${error.message}`, success: false };
    }
}

// --- Student Actions --- //
const StudentSchema = z.object({ 
    studentName: z.string().min(1, 'Öğrenci adı gerekli'), 
    studentNumber: z.string().min(1, 'Öğrenci numarası gerekli'), 
    classId: z.string().min(1), 
    teacherId: z.string().min(1) 
});
export async function addStudent(prevState: any, formData: FormData) {
    const validatedFields = StudentSchema.safeParse(Object.fromEntries(formData));
    if (!validatedFields.success) return { message: 'Tüm alanların doldurulması zorunludur.', success: false };

    const { classId, teacherId, studentName, studentNumber } = validatedFields.data;
    if (!await verifyOwnership('classes', classId, teacherId)) return { message: 'Bu işlem için yetkiniz yok.', success: false };

    try {
        await adminDb.collection('classes').doc(classId).collection('students').add({ name: studentName, studentNumber });
        revalidatePath(`/dashboard/classes/${classId}`);
        return { message: 'Öğrenci başarıyla eklendi!', success: true };
    } catch (e: any) {
        return { message: `Sunucu hatası: ${e.message}`, success: false };
    }
}

export async function addStudentsInBulk(prevState: any, formData: FormData) {
    const studentsData = formData.get('studentsText') as string | null;
    const classId = formData.get('classId') as string | null;
    const teacherId = formData.get('teacherId') as string | null;

    if (!studentsData || studentsData.trim() === '') return { message: 'Öğrenci listesi alanı boş olamaz.', success: false };
    if (!classId) return { message: 'Sınıf kimliği bulunamadı.', success: false };
    if (!teacherId) return { message: 'Öğretmen kimliği bulunamadı.', success: false };

    if (!await verifyOwnership('classes', classId, teacherId)) return { message: 'Bu işlem için yetkiniz yok.', success: false };

    const rows = studentsData.trim().split('\n').filter(row => row.trim() !== '');
    if (rows.length === 0) return { message: 'Girilen listede geçerli öğrenci bulunamadı.', success: false };
    
    const studentsToAdd = rows.map(row => {
        const parts = row.split('\t');
        const studentName = parts[0]?.trim();
        const studentNumber = parts[1]?.trim();
        if (studentName && studentNumber) return { name: studentName, studentNumber: studentNumber };
        return null;
    }).filter((student): student is { name: string; studentNumber: string } => student !== null);

    if (studentsToAdd.length === 0) return { message: 'Liste formatı hatalı. Lütfen her satırda "İsim Soyisim [TAB] Numara" formatında veri girin.', success: false };

    try {
        const studentCollection = adminDb.collection('classes').doc(classId).collection('students');
        const batch = adminDb.batch();
        studentsToAdd.forEach(student => {
            const newStudentRef = studentCollection.doc();
            batch.set(newStudentRef, student);
        });
        await batch.commit();

        revalidatePath(`/dashboard/classes/${classId}`);
        return { message: `${studentsToAdd.length} öğrenci başarıyla eklendi.`, success: true };
    } catch (e: any) {
        return { message: `Toplu öğrenci eklenirken sunucu hatası oluştu: ${e.message}`, success: false };
    }
}

export async function deleteStudent(classId: string, studentId: string, teacherId: string) {
    if (!await verifyOwnership('classes', classId, teacherId)) return { message: 'Yetkisiz işlem.', success: false };
    try {
        await adminDb.collection('classes').doc(classId).collection('students').doc(studentId).delete();
        revalidatePath(`/dashboard/classes/${classId}`);
        return { message: 'Öğrenci başarıyla silindi.', success: true };
    } catch (e: any) {
        return { message: `Hata: ${e.message}`, success: false };
    }
}

// --- Exam Actions --- //
const ExamSchema = z.object({ 
    title: z.string().min(1, 'Sınav adı zorunludur.'), 
    date: z.string().min(1, 'Tarih zorunludur.'), 
    classId: z.string().min(1, 'Sınıf seçimi zorunludur.'),
    teacherId: z.string().min(1)
});
export async function addExam(prevState: any, formData: FormData) {
    const validatedFields = ExamSchema.safeParse(Object.fromEntries(formData));
    if (!validatedFields.success) return { message: 'Lütfen tüm zorunlu alanları doldurun.', success: false };

    const { classId, teacherId } = validatedFields.data;
    if (!await verifyOwnership('classes', classId, teacherId)) return { message: 'Sadece kendi sınıfınıza sınav ekleyebilirsiniz.', success: false };

    try {
        await adminDb.collection('exams').add({ ...validatedFields.data, createdAt: new Date() });
        revalidatePath('/dashboard/exams');
        return { message: 'Sınav başarıyla eklendi!', success: true };
    } catch (e: any) {
        return { message: `Sunucu Hatası: ${e.message}`, success: false };
    }
}

export async function deleteExam(examId: string, teacherId: string) {
    if (!await verifyOwnership('exams', examId, teacherId)) return { message: 'Bu işlem için yetkiniz yok.', success: false };

    try {
        const batch = adminDb.batch();
        
        // Sınava ait skorları sil
        const scoresQuery = adminDb.collection('scores').where('examId', '==', examId).where('teacherId', '==', teacherId);
        const scoresSnapshot = await scoresQuery.get();
        scoresSnapshot.forEach(doc => batch.delete(doc.ref));
        
        // Sınava ait soruları sil
        const questionsQuery = adminDb.collection('exams').doc(examId).collection('questions');
        const questionsSnapshot = await questionsQuery.get();
        questionsSnapshot.forEach(doc => batch.delete(doc.ref));
        
        // **YENİ**: Sınava ait tüm kağıtları veritabanından sil
        const papersQuery = adminDb.collection('exams').doc(examId).collection('papers');
        const papersSnapshot = await papersQuery.get();
        papersSnapshot.forEach(doc => batch.delete(doc.ref));

        // Ana sınav dökümanını sil
        const examRef = adminDb.collection('exams').doc(examId);
        batch.delete(examRef);
        
        await batch.commit();

        revalidatePath('/dashboard/exams');
        revalidatePath('/dashboard/analysis');
        return { message: 'Sınav ve ilişkili tüm veriler (sorular, skorlar, kağıtlar) başarıyla silindi.', success: true };
    } catch (error: any) {
        console.error(`Sınav silme hatası (ID: ${examId}):`, error);
        return { message: `Sınav silinirken bir hata oluştu: ${error.message}`, success: false };
    }
}

// --- Exam Paper Actions (VERİTABANI ODAKLI) --- //
const PaperUploadSchema = z.object({
    examId: z.string().min(1),
    studentId: z.string().min(1),
    teacherId: z.string().min(1),
});

export async function uploadExamPaper(prevState: any, formData: FormData) {
    const validatedFields = PaperUploadSchema.safeParse(Object.fromEntries(formData));
    if (!validatedFields.success) return { message: 'Geçersiz form verileri.', success: false, studentId: formData.get('studentId') as string };
    
    const { examId, studentId, teacherId } = validatedFields.data;
    const papers = formData.getAll('papers') as File[];

    if (!await verifyOwnership('exams', examId, teacherId)) return { message: 'Bu işlem için yetkiniz yok.', success: false, studentId };
    if (!papers || papers.length === 0 || papers[0].name === 'undefined') return { message: 'Yüklenecek dosya seçilmedi.', success: false, studentId };
    
    const papersCollectionRef = adminDb.collection('exams').doc(examId).collection('papers');

    const uploadPromises = papers.map(async (paper) => {
        // Dosyayı Base64'e çevir
        const bytes = await paper.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const base64Data = buffer.toString('base64');

        // Veritabanına kaydet
        const docRef = await papersCollectionRef.add({
            studentId,
            teacherId,
            fileName: paper.name,
            fileType: paper.type,
            createdAt: new Date(),
            base64Data, // Base64 verisini doğrudan kaydet
        });
        
        // Arayüzde kullanılmak üzere doküman ID'sini ve adını döndür
        return { name: paper.name, path: docRef.id };
    });

    try {
        const results = await Promise.all(uploadPromises);
        revalidatePath(`/dashboard/exams/${examId}/upload`);
        return { 
            message: `${results.length} resim dosyası başarıyla veritabanına kaydedildi.`, 
            success: true, 
            studentId,
            uploadedFiles: results // Arayüzün state'i güncellemesi için
        };
    } catch (error: any) {
        return { message: `Veritabanına resim kaydetme hatası: ${error.message}`, success: false, studentId };
    }
}

export async function getUploadedPapers(examId: string, studentId: string) {
    try {
        const papersQuery = adminDb.collection('exams').doc(examId).collection('papers').where('studentId', '==', studentId);
        const snapshot = await papersQuery.get();
        if (snapshot.empty) {
            return { success: true, files: [] };
        }
        
        const fileDetails = snapshot.docs.map(doc => ({
            name: doc.data().fileName,
            path: doc.id // Arayüzde silme ve görüntüleme için doküman ID'sini kullan
        }));
        
        return { success: true, files: fileDetails };
    } catch (error) {
        console.error("Get uploaded papers error:", error);
        return { success: true, files: [] }; // Hata durumunda bile arayüzün çökmemesi için boş döner
    }
}

export async function deleteExamPaper(examId: string, teacherId: string, paperId: string) { // filePath yerine paperId
    if (!await verifyOwnership('exams', examId, teacherId)) return { message: 'Bu işlem için yetkiniz yok.', success: false };
    
    try {
        const paperRef = adminDb.collection('exams').doc(examId).collection('papers').doc(paperId);
        await paperRef.delete();
        
        revalidatePath(`/dashboard/exams/${examId}/upload`);
        return { message: 'Dosya başarıyla veritabanından silindi.', success: true };
    } catch (error: any) {
        return { message: `Dosya silinirken hata: ${error.message}`, success: false };
    }
}

// --- Question Actions --- //
export async function addQuestionToExam(prevState: any, formData: FormData) {
    const QuestionSchema = z.object({
        questionNumber: z.coerce.number().min(1, 'Soru numarası pozitif bir sayı olmalıdır.'),
        points: z.coerce.number().min(0, 'Puan negatif olamaz.'),
        kazanim: z.string().optional(),
        examId: z.string().min(1),
        teacherId: z.string().min(1),
    });
    const validatedFields = QuestionSchema.safeParse(Object.fromEntries(formData));
    if (!validatedFields.success) return { message: 'Geçersiz veri: ' + (validatedFields.error.flatten().fieldErrors.questionNumber || validatedFields.error.flatten().fieldErrors.points), success: false };
    
    const { examId, teacherId, questionNumber, points, kazanim } = validatedFields.data;
    if (!await verifyOwnership('exams', examId, teacherId)) return { message: 'Bu işlem için yetkiniz yok.', success: false };

    try {
        await adminDb.collection('exams').doc(examId).collection('questions').add({ questionNumber, points, kazanim: kazanim || '' });
        revalidatePath(`/dashboard/exams/${examId}`);
        return { message: `Soru ${questionNumber} başarıyla eklendi.`, success: true };
    } catch (e: any) {
        return { message: `Sunucu Hatası: ${e.message}`, success: false };
    }
}

export async function updateQuestionInExam(prevState: any, formData: FormData) {
    const UpdateQuestionSchema = z.object({
        questionNumber: z.coerce.number().min(1),
        points: z.coerce.number().min(0),
        kazanim: z.string().optional(),
        examId: z.string().min(1),
        questionId: z.string().min(1),
        teacherId: z.string().min(1),
    });
    const validatedFields = UpdateQuestionSchema.safeParse(Object.fromEntries(formData));
    if (!validatedFields.success) return { message: 'Geçersiz veri.', success: false };

    const { examId, questionId, teacherId, questionNumber, points, kazanim } = validatedFields.data;
    if (!await verifyOwnership('exams', examId, teacherId)) return { message: 'Bu işlem için yetkiniz yok.', success: false };
    
    try {
        await adminDb.collection('exams').doc(examId).collection('questions').doc(questionId).update({ questionNumber, points, kazanim: kazanim || '' });
        revalidatePath(`/dashboard/exams/${examId}`);
        return { message: 'Soru başarıyla güncellendi.', success: true };
    } catch (e: any) {
        return { message: `Sunucu Hatası: ${e.message}`, success: false };
    }
}

export async function deleteQuestionFromExam(examId: string, questionId: string, teacherId: string) {
    if (!await verifyOwnership('exams', examId, teacherId)) return { message: 'Bu işlem için yetkiniz yok.', success: false };
    try {
        await adminDb.collection('exams').doc(examId).collection('questions').doc(questionId).delete();
        revalidatePath(`/dashboard/exams/${examId}`);
        return { message: 'Soru başarıyla silindi.', success: true };
    } catch (e: any) {
        return { message: `Sunucu Hatası: ${e.message}`, success: false };
    }
}

// --- Analysis Actions (VERİTABANI ODAKLI) --- //
export async function analyzeExamPapers(prevState: any, formData: FormData) {
    console.log("\n--- VERİTABANI ODAKLI SINAV ANALİZİ BAŞLADI ---");
    const AnalysisSchema = z.object({ examId: z.string().min(1) });
    const validatedFields = AnalysisSchema.safeParse(Object.fromEntries(formData));
    if (!validatedFields.success) {
        return { message: 'Geçersiz Sınav ID.', success: false };
    }
    const { examId } = validatedFields.data;

    const examRef = adminDb.collection('exams').doc(examId);
    const examDoc = await examRef.get();
    if (!examDoc.exists) {
        return { message: 'Sınav bulunamadı.', success: false };
    }
    const { teacherId, classId } = examDoc.data() as { teacherId: string; classId: string };

    if (!teacherId || !classId) {
        return { message: 'Sınav bilgileri eksik (öğretmen veya sınıf ID bulunamadı).', success: false };
    }

    try {
        const studentsSnapshot = await adminDb.collection('classes').doc(classId).collection('students').get();
        const students = studentsSnapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as { name: string }) }));

        const questionsSnapshot = await examRef.collection('questions').orderBy('questionNumber').get();
        const questions = questionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as { points: number; questionNumber: number } }));

        if (questions.length === 0) {
            return { message: 'Sınavda hiç soru tanımlanmamış. Analiz yapılamaz.', success: false };
        }

        let processedStudentCount = 0;
        let totalScoresSaved = 0;
        const batch = adminDb.batch();

        for (const student of students) {
            const papersSnapshot = await adminDb.collection('exams').doc(examId).collection('papers').where('studentId', '==', student.id).get();
            if (papersSnapshot.empty) {
                console.log(`  - ${student.name || student.id} için yüklü kağıt bulunamadı. Atlanıyor.`);
                continue;
            }

            processedStudentCount++;
            
            for (const paperDoc of papersSnapshot.docs) {
                const paperData = paperDoc.data();
                const base64Data = paperData.base64Data;
                if (!base64Data) continue;

                const tempPath = path.join(os.tmpdir(), `${paperDoc.id}.jpeg`);
                
                try {
                    const buffer = Buffer.from(base64Data, 'base64');
                    await fs.writeFile(tempPath, buffer);
                    
                    const analysisResult = await analyzeImageFromFile(tempPath);

                    if (!analysisResult.success) {
                        console.error(`YZ Hatası: ${analysisResult.message}`);
                        continue;
                    }

                    const detectedScores = analysisResult.scores || [];
                    if (detectedScores.length === 0) continue;

                    for (let i = 0; i < questions.length; i++) {
                        if (detectedScores[i] !== undefined) {
                            const question = questions[i];
                            const score = Math.min(detectedScores[i], question.points);
                            totalScoresSaved++;
                            
                            const scoreRef = adminDb.collection('scores').doc(`${examId}_${student.id}_${question.id}`);
                            batch.set(scoreRef, {
                                examId, studentId: student.id, questionId: question.id,
                                score: score, teacherId, updatedAt: new Date()
                            }, { merge: true });
                        }
                    }
                } finally {
                    await fs.unlink(tempPath); // Geçici dosyayı her durumda sil
                }
            }
        }

        if (processedStudentCount === 0) {
            return { message: 'Analiz edilecek hiç öğrenci kağıdı bulunamadı.', success: false };
        }

        if (totalScoresSaved > 0) {
            await batch.commit();
        }

        revalidatePath(`/dashboard/analysis/${examId}`);
        revalidatePath(`/dashboard/exams/${examId}/upload`);

        let finalMessage = totalScoresSaved > 0
            ? `Yapay zeka analizi tamamlandı! ${processedStudentCount} öğrencinin kağıdı incelendi ve toplam ${totalScoresSaved} adet puan başarıyla kaydedildi.`
            : "Analiz tamamlandı. İncelenen kağıtlar üzerinde yapay zeka tarafından okunabilecek net bir puan tespit edilemedi.";
            
        return { message: finalMessage, success: true };

    } catch (error: any) {
        console.error("KRİTİK ANALİZ HATASI:", error);
        return { message: `Analiz sırasında beklenmedik bir sunucu hatası oluştu: ${error.message}`, success: false };
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
