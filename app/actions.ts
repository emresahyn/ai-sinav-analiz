'use server';

import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import { revalidatePath } from 'next/cache';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { analyzeImageFromFile } from '@/lib/vision';
import sharp from 'sharp';
import XlsxPopulate from 'xlsx-populate'; 
import PDFParser from "pdf2json";

// --- Genel Tipler ve Yardımcı Fonksiyonlar --- //

export type ActionState = {
    message: string;
    success: boolean;
    studentId?: string;
    uploadedFiles?: { name: string; path: string }[];
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function verifyOwnership(collectionName: string, docId: string, teacherId: string): Promise<boolean> {
    if (!docId || !teacherId) return false;
    try {
        const docRef = adminDb.collection(collectionName).doc(docId);
        const doc = await docRef.get();
        return doc.exists && doc.data()?.teacherId === teacherId;
    } catch (error) {
        console.error("Sahiplik doğrulaması başarısız:", error);
        return false;
    }
}

async function compressAndEncodeImage(file: File): Promise<string> {
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const compressedBuffer = await sharp(buffer)
        .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 70 })
        .toBuffer();
    const extension = file.name.split('.').pop() || 'jpeg';
    return `data:image/${extension};base64,${compressedBuffer.toString('base64')}`;
}

// --- Sınıf Eylemleri --- //
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

// --- Öğrenci Eylemleri --- //
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

// --- Sınav Eylemleri --- //
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

// --- BU FONKSİYONU app/actions.ts DOSYASINA EKLEYİN ---

const CloneExamSchema = z.object({
    sourceExamId: z.string().min(1, "Kaynak sınav ID'si gerekli."),
    targetClassId: z.string().min(1, "Hedef sınıf ID'si gerekli."),
    teacherId: z.string().min(1, "Öğretmen ID'si gerekli."),
});

export async function cloneExam(prevState: any, formData: FormData) {
    const validatedFields = CloneExamSchema.safeParse(Object.fromEntries(formData));

    if (!validatedFields.success) {
        return { success: false, message: 'Geçersiz veri: Sınav veya sınıf seçilmemiş.' };
    }

    const { sourceExamId, targetClassId, teacherId } = validatedFields.data;

    // 1. Güvenlik Kontrolü: Öğretmenin hem kaynak sınava hem de hedef sınıfa sahip olduğunu doğrula
    if (!await verifyOwnership('exams', sourceExamId, teacherId)) {
        return { success: false, message: 'Kaynak sınavı kopyalama yetkiniz yok.' };
    }
    if (!await verifyOwnership('classes', targetClassId, teacherId)) {
        return { success: false, message: 'Hedef sınıfa sınav kopyalama yetkiniz yok.' };
    }
    
    try {
        const sourceExamDoc = await adminDb.collection('exams').doc(sourceExamId).get();
        if (!sourceExamDoc.exists) {
            return { success: false, message: 'Kopyalanacak sınav bulunamadı.' };
        }

        // Sınavın zaten bu sınıfa ait olup olmadığını kontrol et
        if (sourceExamDoc.data()?.classId === targetClassId) {
            return { success: false, message: 'Sınav zaten bu sınıfa ait. Lütfen farklı bir sınıf seçin.' };
        }
        
        const batch = adminDb.batch();

        // 2. Kaynak sınav bilgilerini al ve yeni bir sınav oluştur
        const newExamRef = adminDb.collection('exams').doc(); // Yeni sınav için otomatik ID
       // YUKARIDAKİ KODU BU DOĞRU KODLA DEĞİŞTİRİN

        const sourceData = sourceExamDoc.data();

        // Tarih alanını güvenli bir şekilde işle:
        // 1. Orijinal sınavda tarih var mı diye kontrol et (varsa Timestamp'tır).
        // 2. Varsa, JavaScript'in anlayacağı bir Date nesnesine çevir (.toDate()).
        // 3. Eğer orijinal sınavda hiç tarih alanı yoksa, bugünün tarihini varsayılan olarak ata.

        batch.set(newExamRef, {
            title: sourceData?.title, // İsteğiniz üzerine "(Kopya)" eki kaldırıldı.
            classId: targetClassId,
            teacherId: teacherId,
            date: sourceData?.date, // Güvenli ve doğru tarih formatı burada kullanılıyor.
            sourceExamId: sourceExamId,
            createdAt: new Date()
        });


        // 3. Kaynak sınavın tüm sorularını oku
        const questionsSnapshot = await adminDb.collection('exams').doc(sourceExamId).collection('questions').get();
        
        // 4. Soruları yeni sınava ekle
        if (!questionsSnapshot.empty) {
            const newQuestionsCollectionRef = newExamRef.collection('questions');
            questionsSnapshot.docs.forEach(questionDoc => {
                const newQuestionDocRef = newQuestionsCollectionRef.doc(); // Her soru için yeni ID
                batch.set(newQuestionDocRef, questionDoc.data());
            });
        }

        // 5. Tüm işlemleri tek seferde veritabanına işle
        await batch.commit();

        revalidatePath('/dashboard/exams'); // Ana sınav listesini yenile

        return { 
            success: true, 
            message: 'Sınav başarıyla yeni sınıfa kopyalandı.', 
            newExamId: newExamRef.id 
        };

    } catch (error: any) {
        console.error("Sınav kopyalama hatası:", error);
        return { success: false, message: `Sunucu hatası: ${error.message}` };
    }
}


// --- Sınav Kağıdı Eylemleri --- //
const PaperUploadSchema = z.object({
    examId: z.string().min(1),
    studentId: z.string().min(1),
    teacherId: z.string().min(1),
});
// YARDIMCI FONKSİYON: Bu fonksiyonu app/actions.ts dosyasında
// mevcut `uploadExamPaper` fonksiyonunun hemen üzerine ekleyin.
async function analyzeAndScoreSinglePaper(
    examId: string,
    studentId: string,
    teacherId: string,
    paper: { id: string; base64Data: string; name: string },
    questions: { id: string; points: number; questionNumber: number }[]
): Promise<{ savedScores: number, error?: string }> {
    const tempPath = path.join(os.tmpdir(), `${paper.id}.jpeg`);
    let savedScores = 0;

    try {
        // 1. Analiz için geçici dosya oluştur
        const pureBase64 = paper.base64Data.includes(',') ? paper.base64Data.split(',')[1] : paper.base64Data;
        await fs.writeFile(tempPath, Buffer.from(pureBase64, 'base64'));

        // 2. Yapay zeka analizini çağır
        const { success, scores, studentId: returnedStudentId, message } = await analyzeImageFromFile(tempPath, studentId);

        if (!success || !scores) {
            const errorMessage = `YZ Analiz Hatası (Kağıt: ${paper.name}): ${message || 'Skorlar alınamadı'}`;
            console.error(errorMessage);
            return { savedScores, error: errorMessage };
        }

        // 3. Güvenlik Kontrolü: Dönen öğrenci ID'si ile beklenen ID'nin eşleştiğini doğrula
        if (returnedStudentId !== studentId) {
            const errorMessage = `Güvenlik Uyarısı: Analiz edilen kağıt (${paper.name}) için beklenen öğrenci ID'si (${studentId}) ile yapay zeka tarafından döndürülen ID (${returnedStudentId}) eşleşmiyor. Puanlar kaydedilmeyecek.`;
            console.warn(errorMessage);
            return { savedScores, error: errorMessage };
        }

        // 4. Puanları Firestore'a kaydet
        const batch = adminDb.batch();
        for (const questionNumberStr in scores) {
            const questionNumber = parseInt(questionNumberStr, 10);
            const scoreValue = scores[questionNumberStr];
            const question = questions.find(q => q.questionNumber === questionNumber);

            if (question) {
                const finalScore = Math.min(scoreValue, question.points); // Puanı sorunun maksimum puanıyla sınırla
                const scoreRef = adminDb.collection('scores').doc(`${examId}_${studentId}_${question.id}`);
                batch.set(scoreRef, {
                    examId,
                    studentId,
                    questionId: question.id,
                    score: finalScore,
                    teacherId,
                    updatedAt: new Date()
                }, { merge: true });
                savedScores++;
            } else {
                 console.warn(`UYARI: Yapay zeka ${questionNumber} numaralı bir soru için puan döndü, ancak bu numarada bir soru bulunamadı. Bu puan yok sayılıyor.`);
            }
        }
        if (savedScores > 0) {
            await batch.commit();
        }
        return { savedScores };

    } catch (error: any) {
        const errorMessage = `Kağıt analizi sırasında beklenmedik hata (${paper.name}): ${error.message}`;
        console.error(errorMessage);
        return { savedScores, error: errorMessage };
    } finally {
        // 5. Geçici dosyayı sil
        await fs.unlink(tempPath).catch(err => console.error(`Geçici dosya silinemedi: ${tempPath}`, err));
    }
}


// GÜNCELLENMİŞ FONKSİYON: Bu fonksiyon, kağıtları yükler, anında analiz eder ve puanları kaydeder.
export async function uploadExamPaper(prevState: ActionState | undefined, formData: FormData): Promise<ActionState> {
    const studentId = formData.get('studentId') as string;
    // Form verilerini doğrula
    const validatedFields = PaperUploadSchema.safeParse(Object.fromEntries(formData));
    if (!validatedFields.success) {
        return { message: 'Geçersiz form verileri.', success: false, studentId };
    }

    const { examId, teacherId } = validatedFields.data;
    const papers = formData.getAll('papers') as File[];

    // Yetki ve dosya kontrolleri
    if (!await verifyOwnership('exams', examId, teacherId)) {
        return { message: 'Bu işlem için yetkiniz yok.', success: false, studentId };
    }
    if (!papers || papers.length === 0 || papers[0].name === 'undefined') {
        return { message: 'Yüklenecek dosya seçilmedi.', success: false, studentId };
    }

    // Analiz için sınavın sorularını önceden getir
    const questionsSnapshot = await adminDb.collection('exams').doc(examId).collection('questions').orderBy('questionNumber').get();
    const questions = questionsSnapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as { points: number; questionNumber: number }) }));

    if (questions.length === 0) {
        return { message: 'Sınavda hiç soru tanımlanmamış. Lütfen önce sınav detay sayfasından soru ekleyin.', success: false, studentId };
    }

    const papersCollectionRef = adminDb.collection('exams').doc(examId).collection('papers');
    const uploadedFileResults: { name: string; path: string }[] = [];
    const processingErrors: string[] = [];
    let totalScoresSaved = 0;

    // Her bir kağıdı sırayla işle
    for (const paper of papers) {
        const tempPath = path.join(os.tmpdir(), `paper_${Date.now()}_${paper.name}`);
        try {
            // 1. Görüntüyü sıkıştır ve geçici olarak diske yaz
            const base64Data = await compressAndEncodeImage(paper);
            if (Buffer.byteLength(base64Data, 'utf8') > 1048576) {
                 processingErrors.push(`"${paper.name}" dosyasının boyutu (sıkıştırıldıktan sonra) 1MB limitini aşıyor ve işlenemedi.`);
                 continue; // Bu dosyayı atla, sonrakine geç
            }
            const pureBase64 = base64Data.split(',')[1];
            await fs.writeFile(tempPath, Buffer.from(pureBase64, 'base64'));

            // 2. Yapay zeka ile görüntüyü analiz et
            const analysisResult = await analyzeImageFromFile(tempPath, studentId);

            if (!analysisResult.success || !analysisResult.scores) {
                processingErrors.push(`"${paper.name}" analiz edilemedi: ${analysisResult.message || 'Skorlar alınamadı'}`);
                continue;
            }
            if (analysisResult.studentId !== studentId) {
                processingErrors.push(`Güvenlik Uyarısı: "${paper.name}" için beklenen öğrenci ID'si (${studentId}) ile dönen ID (${analysisResult.studentId}) eşleşmiyor.`);
                continue;
            }

            // 3. Kağıt kaydını ve puanları tek bir işlemde veritabanına yaz
            const batch = adminDb.batch();
            
            // Kağıdı veritabanına ekle
            const paperDocRef = papersCollectionRef.doc(); // Yeni döküman referansı oluştur
            batch.set(paperDocRef, {
                studentId, teacherId,
                fileName: paper.name, fileType: paper.type, createdAt: new Date(),
                // Not: base64 verisini burada kaydetmek yerine Storage kullanmak daha verimli olabilir.
                // Şimdilik mevcut yapıya sadık kalıyoruz.
                base64Data, 
            });

            // Analizden gelen puanları ekle
            for (const qNumStr in analysisResult.scores) {
                const qNum = parseInt(qNumStr, 10);
                const question = questions.find(q => q.questionNumber === qNum);
                if (question) {
                    const score = Math.min(analysisResult.scores[qNumStr], question.points);
                    const scoreRef = adminDb.collection('scores').doc(`${examId}_${studentId}_${question.id}`);
                    batch.set(scoreRef, { examId, studentId, questionId: question.id, score, teacherId, updatedAt: new Date() }, { merge: true });
                    totalScoresSaved++;
                }
            }
            
            await batch.commit(); // Tüm işlemleri gerçekleştir
            uploadedFileResults.push({ name: paper.name, path: paperDocRef.id });

        } catch (error: any) {
            processingErrors.push(`"${paper.name}" işlenirken kritik hata: ${error.message}`);
        } finally {
            await fs.unlink(tempPath).catch(() => {}); // Geçici dosyayı her durumda sil
        }
    }

    // İlgili sayfaların verilerini yenile
    revalidatePath(`/dashboard/exams/${examId}/upload`);
    revalidatePath(`/dashboard/analysis/${examId}`);

    if (uploadedFileResults.length === 0) {
        return { message: `Hiçbir kağıt işlenemedi. Hatalar: ${processingErrors.join('; ')}`, success: false, studentId };
    }

    let message = `${uploadedFileResults.length} kağıt başarıyla işlendi ve ${totalScoresSaved} puan kaydedildi.`;
    if (processingErrors.length > 0) {
        message += ` Bazı hatalar oluştu: ${processingErrors.join('; ')}`;
    }

    return {
        message,
        success: true,
        studentId,
        uploadedFiles: uploadedFileResults
    };
}



export async function getUploadedPapers(examId: string, studentId: string) {
    try {
        const papersQuery = adminDb.collection('exams').doc(examId).collection('papers').where('studentId', '==', studentId);
        const snapshot = await papersQuery.get();
        if (snapshot.empty) return { success: true, files: [] };
        const fileDetails = snapshot.docs.map(doc => ({ name: doc.data().fileName, path: doc.id }));
        return { success: true, files: fileDetails };
    } catch (error: unknown) {
        console.error("Yüklenen kağıtları getirirken hata:", error);
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

// --- Soru Eylemleri --- //
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

// --- Analiz ve Puanlama Eylemleri --- //
// YENİ FONKSİYON: Öğrencinin tüm puanlarını siler
export async function deleteAllScoresForStudent(examId: string, studentId: string, teacherId: string): Promise<ActionState> {
    if (!await verifyOwnership('exams', examId, teacherId)) {
        return { success: false, message: 'Bu işlem için yetkiniz yok.' };
    }

    try {
        const scoresQuery = adminDb.collection('scores')
            .where('examId', '==', examId)
            .where('studentId', '==', studentId)
            .where('teacherId', '==', teacherId);

        const snapshot = await scoresQuery.get();
        if (snapshot.empty) {
            return { success: true, message: 'Öğrenciye ait zaten puan kaydı bulunamadı.' };
        }

        const batch = adminDb.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();

        revalidatePath(`/dashboard/analysis/${examId}`);
        return { success: true, message: 'Öğrencinin tüm puanları başarıyla silindi.' };

    } catch (error: any) {
        return { success: false, message: `Puanlar silinirken bir hata oluştu: ${error.message}` };
    }
}


// YENİ FONKSİYON: Sadece seçili öğrencileri yeniden analiz eder
export async function analyzeSelectedStudents(prevState: ActionState | undefined, formData: FormData): Promise<ActionState> {
    const { examId, studentIds: studentIdsString } = z.object({
        examId: z.string().min(1, "Sınav ID'si gerekli."),
        studentIds: z.string().min(1, "Analiz için en az bir öğrenci seçilmelidir."),
    }).parse(Object.fromEntries(formData));

    const studentIds = studentIdsString.split(',');

    const examDoc = await adminDb.collection('exams').doc(examId).get();
    if (!examDoc.exists) {
        return { message: 'Sınav bulunamadı.', success: false };
    }

    const { teacherId } = examDoc.data() as { teacherId: string };
    if (!teacherId || !await verifyOwnership('exams', examId, teacherId)) {
        return { message: 'Bu işlem için yetkiniz yok.', success: false };
    }
    
    // Orijinal 'analyzeExamPapers' fonksiyonunu seçili öğrencilerle çağır
    // Bu, kod tekrarını önler ve merkezi analiz mantığını korur.
    return await analyzeExamPapers(undefined, formData);
}


// GÜNCELLENMİŞ FONKSİYON
export async function analyzeExamPapers(prevState: ActionState | undefined, formData: FormData): Promise<ActionState> {
    const schema = z.object({
        examId: z.string().min(1),
        // studentIds, virgülle ayrılmış bir string olarak gelebilir veya hiç gelmeyebilir
        studentIds: z.string().optional(),
    });

    const validatedData = schema.parse(Object.fromEntries(formData));
    const { examId, studentIds: studentIdsString } = validatedData;

    const examDoc = await adminDb.collection('exams').doc(examId).get();
    if (!examDoc.exists) return { message: 'Sınav bulunamadı.', success: false };

    const { teacherId, classId } = examDoc.data() as { teacherId: string; classId: string };
    if (!teacherId || !classId) return { message: 'Sınav bilgileri eksik.', success: false };

    try {
        let studentsToProcess: { id: string, name: string }[] = [];

        // Eğer formdan öğrenci ID'leri geldiyse, sadece o öğrencileri al
        if (studentIdsString) {
            const studentIds = studentIdsString.split(',');
            if (studentIds.length === 0) {
                 return { message: 'Analiz için öğrenci seçilmedi.', success: false };
            }
            const studentDocs = await Promise.all(
                studentIds.map(id => adminDb.collection('classes').doc(classId).collection('students').doc(id).get())
            );
            studentsToProcess = studentDocs
                .filter(doc => doc.exists)
                .map(doc => ({ id: doc.id, ...(doc.data() as { name: string }) }));

        // Eğer öğrenci ID'leri gelmediyse, tüm öğrencileri al (eski davranış)
        } else {
            const studentsSnapshot = await adminDb.collection('classes').doc(classId).collection('students').get();
            studentsToProcess = studentsSnapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as { name: string }) }));
        }

        if (studentsToProcess.length === 0) {
            return { message: 'İşlem için uygun öğrenci bulunamadı.', success: false };
        }

        const questionsSnapshot = await adminDb.collection('exams').doc(examId).collection('questions').orderBy('questionNumber').get();
        const questions = questionsSnapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as { points: number; questionNumber: number }) }));

        if (questions.length === 0) return { message: 'Sınavda hiç soru tanımlanmamış. Analiz yapılamaz.', success: false };

        let processedStudentCount = 0, totalScoresSaved = 0, totalPapersProcessed = 0;

        for (const student of studentsToProcess) {
            const papersSnapshot = await adminDb.collection('exams').doc(examId).collection('papers').where('studentId', '==', student.id).get();
            if (papersSnapshot.empty) continue;
            
            processedStudentCount++;
            
            for (const paperDoc of papersSnapshot.docs) {
                // API limitlerini aşmamak için bekleme (isteğe bağlı, ama iyi bir pratik)
                if (totalPapersProcessed > 0 && totalPapersProcessed % 10 === 0) {
                    await delay(20000); // 20 saniye bekle
                }
                totalPapersProcessed++;

                const base64Data = paperDoc.data().base64Data;
                if (!base64Data) continue;

                const tempPath = path.join(os.tmpdir(), `${paperDoc.id}.jpeg`);
                try {
                    const pureBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
                    await fs.writeFile(tempPath, Buffer.from(pureBase64, 'base64'));

                    const { success, scores } = await analyzeImageFromFile(tempPath, student.id);
                    
                    if (success && scores) {
                        const batch = adminDb.batch();
                        for (const questionNumberStr in scores) {
                            const questionNumber = parseInt(questionNumberStr, 10);
                            const scoreValue = scores[questionNumberStr];
                            const question = questions.find(q => q.questionNumber === questionNumber);

                            if (question) {
                                const finalScore = Math.min(scoreValue, question.points);
                                totalScoresSaved++;
                                const scoreRef = adminDb.collection('scores').doc(`${examId}_${student.id}_${question.id}`);
                                batch.set(scoreRef, { examId, studentId: student.id, questionId: question.id, score: finalScore, teacherId, updatedAt: new Date() }, { merge: true });
                            }
                        }
                         if (Object.keys(scores).length > 0) await batch.commit();
                    }
                } finally {
                    await fs.unlink(tempPath).catch(() => {});
                }
            }
        }

        if (totalScoresSaved === 0 && totalPapersProcessed > 0) {
             return { message: `Analiz tamamlandı, ancak ${processedStudentCount} öğrenciye ait ${totalPapersProcessed} kağıttan yeni puan kaydedilmedi. Kağıtlar daha önce doğru analiz edilmiş olabilir.`, success: true };
        }
        
        revalidatePath(`/dashboard/analysis/${examId}`);

        return { message: `Analiz tamamlandı. ${processedStudentCount} öğrenci için ${totalScoresSaved} adet puan başarıyla kaydedildi/güncellendi.`, success: true };
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu.';
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
       console.error("Puanları getirirken hata:", error);
       return { success: false, message: `Puanlar getirilirken hata: ${error.message}`, scores: {} };
   }
}

// --- Puanlama Eylemleri --- //

// GÜNCELLENDİ: Puanın silinebilmesi için şema güncellendi.
const ScoreSchema = z.object({
    examId: z.string().min(1),
    studentId: z.string().min(1),
    questionId: z.string().min(1),
    teacherId: z.string().min(1),
    // Puanın boş bir string olabileceğini belirtiyoruz ki silme işlemini ayırt edebilelim.
    score: z.string().optional(), 
});

// GÜNCELLENDİ: Hem puan kaydetme hem de silme işlemini yöneten fonksiyon.
export async function saveStudentScore(formData: FormData) {
    const validatedFields = ScoreSchema.safeParse(Object.fromEntries(formData));

    if (!validatedFields.success) {
        return { success: false, message: 'Geçersiz form verileri.' };
    }
    
    const { examId, studentId, questionId, teacherId, score: scoreString } = validatedFields.data;

    // Yetkilendirme kontrolü
    if (!await verifyOwnership('exams', examId, teacherId)) {
        return { success: false, message: 'Bu işlem için yetkiniz yok.' };
    }
    
    const scoreRef = adminDb.collection('scores').doc(`${examId}_${studentId}_${questionId}`);

    try {
        // Eğer gelen puan boş bir string ise, veritabanından bu puan kaydını sil.
        if (scoreString === '' || scoreString === undefined) {
            await scoreRef.delete();
            revalidatePath(`/dashboard/analysis/${examId}`);
            return { success: true, message: 'Puan kaldırıldı.' };
        }

        // Değilse, gelen değeri sayıya çevir ve kaydet.
        const score = Number(scoreString);

        // Sayının geçerli olup olmadığını kontrol et.
        if (isNaN(score) || score < 0) {
            return { success: false, message: 'Puan, negatif olmayan geçerli bir sayı olmalıdır.' };
        }
        
        // Sunucu tarafında da maksimum puan kontrolü yapmak, istemci tarafındaki
        // doğrulamayı aşabilecek durumlara karşı ek bir güvenlik katmanı sağlar.
        const questionDoc = await adminDb.collection('exams').doc(examId).collection('questions').doc(questionId).get();
        if (questionDoc.exists) {
            const maxPoints = questionDoc.data()?.points;
            if (typeof maxPoints === 'number' && score > maxPoints) {
                 return { success: false, message: `Puan, sorunun maksimum puanı olan ${maxPoints} değerini aşamaz.` };
            }
        }

        // Geçerli puanı veritabanına kaydet/güncelle.
        await scoreRef.set({ examId, studentId, questionId, score, teacherId, updatedAt: new Date() }, { merge: true });
        revalidatePath(`/dashboard/analysis/${examId}`);
        return { success: true, message: 'Puan başarıyla kaydedildi.' };

    } catch (error: any) {
        console.error("Puan kaydetme/silme hatası:", error);
        return { success: false, message: `Sunucu hatası: ${error.message}` };
    }
}
// BU FONKSİYONU OLDUĞU GİBİ app/actions.ts DOSYANIZIN SONUNA EKLEYİN

/**
 * Bir sınava ait tüm verileri toplayıp analiz ederek detaylı bir rapor objesi oluşturan sunucu eylemi.
 * 
 * @param examId Raporu oluşturulacak sınavın kimliği (ID).
 * @param teacherId İşlemi yapan öğretmenin kimliği (güvenlik kontrolü için).
 * @returns Başarı durumunu ve 'data' anahtarı altında tüm rapor verilerini içeren bir obje döner.
 *          Hata durumunda 'message' anahtarı altında bir hata mesajı içerir.
 */
export async function getReportData(examId: string, teacherId: string): Promise<{
    success: boolean;
    message?: string;
    data?: any;
}> {
    // 1. GÜVENLİK VE YETKİ KONTROLÜ
    if (!await verifyOwnership('exams', examId, teacherId)) {
        return { success: false, message: 'Bu raporu görüntüleme yetkiniz yok.' };
    }

    try {
        // 2. VERİLERİ VERİTABANINDAN PARALEL OLARAK ÇEKME
        const [examDoc, questionsSnapshot, scoresSnapshot] = await Promise.all([
            adminDb.collection('exams').doc(examId).get(),
            adminDb.collection('exams').doc(examId).collection('questions').get(),
            adminDb.collection('scores').where('examId', '==', examId).where('teacherId', '==', teacherId).get()
        ]);

        if (!examDoc.exists) {
            return { success: false, message: 'Sınav bulunamadı.' };
        }

        const examData = examDoc.data() as { title: string; classId: string; };
        if (!examData.classId) {
            return { success: false, message: 'Bu sınava atanmış bir sınıf bulunamadığı için rapor oluşturulamıyor.' };
        }

        const [classDoc, studentsSnapshot] = await Promise.all([
            adminDb.collection('classes').doc(examData.classId).get(),
            adminDb.collection('classes').doc(examData.classId).collection('students').get()
        ]);
        
        if (!classDoc.exists) return { success: false, message: 'Sınıf bulunamadı.' };
        const className = classDoc.data()?.name || 'Bilinmeyen Sınıf';

        // 3. VERİLERİ İŞLENEBİLİR FORMATLARA DÖNÜŞTÜRME
        const questions = questionsSnapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() } as { id: string; questionNumber: number; points: number; kazanim?: string }))
            .sort((a, b) => a.questionNumber - b.questionNumber);

        const students = studentsSnapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() } as { id: string; name: string; studentNumber: string }))
            .sort((a, b) => parseInt(a.studentNumber, 10) - parseInt(b.studentNumber, 10));
        
        const scores: { [key: string]: number } = {};
        scoresSnapshot.forEach(doc => {
            const data = doc.data();
            scores[`${data.studentId}_${data.questionId}`] = data.score;
        });

        if (students.length === 0) {
            return { success: false, message: 'Bu sınıfta hiç öğrenci bulunamadığı için rapor oluşturulamıyor.' };
        }
        if (questions.length === 0) {
            return { success: false, message: 'Bu sınavda hiç soru bulunamadığı için rapor oluşturulamıyor.' };
        }

        // 4. HESAPLAMALARI YAPMA
        const totalPointsPossible = questions.reduce((sum, q) => sum + q.points, 0);

        // 4.1. Öğrenci Bazlı Sonuçlar
        const studentResults = students.map(student => {
            const hasParticipated = questions.some(q => scores.hasOwnProperty(`${student.id}_${q.id}`));

            if (!hasParticipated) {
                return {
                    ...student,
                    scores: questions.map(q => ({ questionId: q.id, score: null })),
                    totalScore: null,
                    status: 'Girmedi',
                };
            }
            
            const totalScoreAchieved = questions.reduce((sum, q) => sum + (scores[`${student.id}_${q.id}`] ?? 0), 0);
            const gradeOutOf100 = totalPointsPossible > 0 ? (totalScoreAchieved / totalPointsPossible) * 100 : 0;

            return {
                ...student,
                scores: questions.map(q => ({ questionId: q.id, score: scores[`${student.id}_${q.id}`] ?? null })),
                totalScore: totalScoreAchieved,
                status: gradeOutOf100 >= 50 ? 'Başarılı' : 'Başarısız',
            };
        });
        
        // 4.2. Sınava Katılan Öğrencileri Belirle (diğer hesaplamalar için)
        const participatingStudentIds = studentResults
            .filter(s => s.status !== 'Girmedi')
            .map(s => s.id);

        // 4.3. Soru Bazlı Analiz (Sadece katılanlara göre)
        const questionAnalysis = questions.map(question => {
            const scoresForQuestion = participatingStudentIds
                .map(studentId => scores[`${studentId}_${question.id}`])
                .filter(score => score !== undefined && score !== null);

            if (scoresForQuestion.length === 0) {
                return { ...question, averageScore: 0, successPercentage: 0 };
            }

            const averageScore = scoresForQuestion.reduce((sum, score) => sum + score, 0) / scoresForQuestion.length;
            const successPercentage = question.points > 0 ? (averageScore / question.points) * 100 : 0;
            
            return {
                ...question,
                averageScore: parseFloat(averageScore.toFixed(2)),
                successPercentage: parseFloat(successPercentage.toFixed(2)),
            };
        });
        
        // 4.4. Genel İstatistikler
        const participatingStudentsCount = participatingStudentIds.length;
        const successfulStudentsCount = studentResults.filter(s => s.status === 'Başarılı').length;
        const unsuccessfulStudentsCount = studentResults.filter(s => s.status === 'Başarısız').length;
        const overallSuccessPercentage = participatingStudentsCount > 0 ? (successfulStudentsCount / participatingStudentsCount) * 100 : 0;

        // 4.5. Kazanım Bazlı Analiz (Sadece katılanlara göre)
        const kazanimPerformance: { [key: string]: { achieved: number; possible: number; } } = {};
        questions.forEach(question => {
            if (question.kazanim) {
                if (!kazanimPerformance[question.kazanim]) {
                    kazanimPerformance[question.kazanim] = { achieved: 0, possible: 0 };
                }
                const scoresForQuestion = participatingStudentIds.map(studentId => scores[`${studentId}_${question.id}`] ?? 0);
                kazanimPerformance[question.kazanim].achieved += scoresForQuestion.reduce((sum, score) => sum + score, 0);
                kazanimPerformance[question.kazanim].possible += question.points * participatingStudentIds.length;
            }
        });

                    // --- Kazanım Analizi ve Özet Notu Mantığı ---

        // 1. Kazanım performanslarını hesapla
        const kazanimPerformanceValues = Object.keys(kazanimPerformance).map(kazanim => {
            const performance = kazanimPerformance[kazanim];
            const percentage = performance.possible > 0 ? (performance.achieved / performance.possible) * 100 : 0;
            return { kazanim, successPercentage: parseFloat(percentage.toFixed(2)) };
        });

        // 2. Raporlama için kazanımları sınavdaki soru sırasına göre sırala
        const orderedUniqueKazanims = questions
            .map(q => q.kazanim)
            .filter((value, index, self): value is string => value != null && value !== '' && self.indexOf(value) === index);
        
        const kazanimAnalysis = orderedUniqueKazanims.map(kazanim => 
            kazanimPerformanceValues.find(p => p.kazanim === kazanim)!
        ).filter(Boolean); // Olası undefined değerleri temizle

        // 3. En düşük başarıya sahip kazanımları bul (özet notu için)
        let lowestPerformingKazanims: { kazanim: string, successPercentage: number }[] = [];
        if (kazanimPerformanceValues.length > 0) {
            const sortedByPerformance = [...kazanimPerformanceValues].sort((a, b) => a.successPercentage - b.successPercentage);
            const lowestScore = sortedByPerformance[0].successPercentage;
            lowestPerformingKazanims = sortedByPerformance.filter(k => k.successPercentage === lowestScore);
        }

        // 4. Grafik verilerini oluştur
        const questionSuccessChartData = {
            labels: questionAnalysis.map(q => `Soru ${q.questionNumber}`),
            datasets: [{ label: 'Soru Başarı Yüzdesi (%)', data: questionAnalysis.map(q => q.successPercentage), backgroundColor: 'rgba(54, 162, 235, 0.6)', borderColor: 'rgba(54, 162, 235, 1)', borderWidth: 1 }],
        };
        const kazanimChartData = {
            labels: kazanimAnalysis.map(k => k.kazanim),
            datasets: [{ label: 'Kazanım Başarı Yüzdesi (%)', data: kazanimAnalysis.map(k => k.successPercentage), backgroundColor: 'rgba(153, 102, 255, 0.6)', borderColor: 'rgba(153, 102, 255, 1)', borderWidth: 1 }],
        };
                // YENİ: Öğrenci Puan Grafiği verisini oluştur
                const studentScoresChartData = {
                    labels: studentResults.map(s => s.name),
                    datasets: [{
                        label: 'Öğrenci Puanı (100 üzerinden)',
                        data: studentResults.map(s => {
                            // Sınava girmeyen öğrencinin puanını grafikte 0 olarak göster
                            if (s.status === 'Girmedi' || s.totalScore === null) return 0;
                            // Başarılı/Başarısız öğrencilerin puanını 100'lük sisteme çevir
                            return totalPointsPossible > 0 ? parseFloat(((s.totalScore / totalPointsPossible) * 100).toFixed(2)) : 0;
                        }),
                        backgroundColor: 'rgba(75, 192, 192, 0.6)',
                        borderColor: 'rgba(75, 192, 192, 1)',
                        borderWidth: 1,
                    }],
                };
        

                // 5. Gelişmiş özet notunu oluştur
                const notEnteredCount = students.length - participatingStudentsCount;
                let summaryNote = `Sınıfa kayıtlı ${students.length} öğrenciden ${participatingStudentsCount} tanesi sınava girmiştir.`;
                if (participatingStudentsCount > 0) {
                    summaryNote += ` Sınava girenler arasındaki genel başarı yüzdesi %${overallSuccessPercentage.toFixed(1)}'dir. Bu öğrencilerden ${unsuccessfulStudentsCount} öğrenci 50 puan barajının altında kalmıştır.`;
                }
                if (notEnteredCount > 0) {
                    summaryNote += ` ${notEnteredCount} öğrenci ise sınava girmemiştir.`;
                }
                
                // Kazanım özeti mantığı
                if (participatingStudentsCount > 0 && lowestPerformingKazanims.length > 0) {
                    const lowestScore = lowestPerformingKazanims[0].successPercentage;
                    
                    // Eğer en düşük başarı %50'nin altındaysa, bu kazanımları listele
                    if (lowestScore < 50) {
                        const lowestPercentage = lowestScore.toFixed(1);
                        if (lowestPerformingKazanims.length === 1) {
                            const kazanim = lowestPerformingKazanims[0].kazanim;
                            summaryNote += ` Sınava katılan öğrenciler arasında en çok zorlanılan kazanım (%${lowestPercentage} başarı) \"${kazanim}\" olmuştur.`;
                        } else {
                            const kazanimNames = lowestPerformingKazanims.map(k => `\"${k.kazanim}\"`).join(' ve ');
                            summaryNote += ` Sınava katılan öğrenciler arasında en çok zorlanılan kazanımlar (%${lowestPercentage} başarı ile) ${kazanimNames} olmuştur.`;
                        }
                    } else {
                        // Eğer en düşük başarı bile %50 ve üzerindeyse, hepsi başarılı demektir
                        summaryNote += ` Sınava katılan öğrenciler arasında tüm kazanımlar başarılı olmuştur.`;
                    }
                }
        


        // 7. TÜM VERİLERİ BİRLEŞTİRME
        return {
            success: true,
            data: {
                exam: { id: examId, title: examData.title },
                classInfo: { id: examData.classId, name: className },
                questions: questions,
                studentResults,
                questionAnalysis,
                stats: {
                    totalStudents: students.length,
                    participatingStudents: participatingStudentsCount,
                    successfulStudents: successfulStudentsCount,
                    unsuccessfulStudents: unsuccessfulStudentsCount,
                    overallSuccessPercentage: parseFloat(overallSuccessPercentage.toFixed(2)),
                },
                kazanimAnalysis,
                charts: {
                    questionSuccess: questionSuccessChartData,
                    kazanimSuccess: kazanimChartData,
                    studentScores: studentScoresChartData, // Bu satırı ekleyin
                },

                summaryNote,
            },
        };

    } catch (error: any) {
        console.error("Rapor verisi oluşturulurken kritik hata:", error);
        return { success: false, message: `Rapor oluşturulurken beklenmedik bir sunucu hatası oluştu: ${error.message}` };
    }
}// --- YENİ SUNUCU EYLEMİ: Excel Raporu Oluşturma ---

// app/actions.ts dosyasında bu fonksiyonu bulun ve aşağıdakiyle değiştirin

export async function generateExcelReport(reportData: any, chartImages: { [key: string]: string }): Promise<{ 
    success: boolean; 
    fileData?: string; // Dosyayı base64 string olarak döneceğiz
    message?: string;
}> {
    if (!reportData) {
        return { success: false, message: "Rapor verisi bulunamadı." };
    }

    const { exam, classInfo, stats, studentResults, questionAnalysis, kazanimAnalysis, summaryNote } = reportData;

    try {
        const workbook = await XlsxPopulate.fromBlankAsync();
        const sheet = workbook.sheet(0).name("Analiz Raporu");

        const titleStyle = { fontFamily: 'Arial', fontSize: 18, bold: true, horizontalAlignment: 'center', verticalAlignment: 'center' };
        const subtitleStyle = { fontFamily: 'Arial', fontSize: 14, italic: true, horizontalAlignment: 'center', verticalAlignment: 'center' };
        const sectionHeaderStyle = { fontFamily: 'Arial', fontSize: 12, bold: true, fill: '4F81BD', fontColor: 'FFFFFF', verticalAlignment: 'center' };
        const tableHeaderStyle = { fontFamily: 'Arial', fontSize: 10, bold: true, fill: 'D9D9D9', border: true, horizontalAlignment: 'center' };
        const cellStyle = { border: true, verticalAlignment: 'center', wrapText: true };

        let currentRow = 1;

        // Başlık
        sheet.cell(`A${currentRow}`).value(`${exam.title} - Analiz Raporu`).style(titleStyle);
        sheet.range(`A${currentRow}:I${currentRow}`).merged(true).style({ horizontalAlignment: 'center' });
        currentRow++;
        sheet.cell(`A${currentRow}`).value(`${classInfo.name} Sınıfı`).style(subtitleStyle);
        sheet.range(`A${currentRow}:I${currentRow}`).merged(true).style({ horizontalAlignment: 'center' });
        currentRow += 2;

        // Özet Notu
        sheet.cell(`A${currentRow}`).value("Genel Değerlendirme").style(sectionHeaderStyle);
        sheet.range(`A${currentRow}:I${currentRow}`).merged(true);
        currentRow++;
        sheet.cell(`A${currentRow}`).value(summaryNote).style({ wrapText: true, verticalAlignment: 'top' });
        sheet.range(`A${currentRow}:I${currentRow + 1}`).merged(true);
        currentRow += 3;

        // İstatistikler
        sheet.cell(`A${currentRow}`).value("Genel İstatistikler").style(tableHeaderStyle);
        sheet.range(`A${currentRow}:B${currentRow}`).merged(true);
        currentRow++;
        sheet.cell(`A${currentRow}`).value([["Kayıtlı Öğrenci", stats.totalStudents],["Sınava Giren", stats.participatingStudents],["Başarısız Öğrenci", stats.unsuccessfulStudents],["Genel Başarı", `%${stats.overallSuccessPercentage.toFixed(1)}`]]);
        sheet.range(`A${currentRow}:B${currentRow+3}`).style(cellStyle);
        currentRow += 5;

        // Öğrenci Sonuçları
        const studentTableStart = currentRow;
        sheet.cell(`A${studentTableStart}`).value("Öğrenci Sonuçları").style(sectionHeaderStyle);
        sheet.range(`A${studentTableStart}:D${studentTableStart}`).merged(true);
        currentRow++;
        sheet.row(currentRow).cell(1).value([["Öğrenci No", "Öğrenci Adı", "Toplam Puan", "Durum"]]).style(tableHeaderStyle);
        studentResults.forEach((s: any) => {
            currentRow++;
            sheet.row(currentRow).cell(1).value([[s.studentNumber, s.name, s.totalScore ?? 'N/A', s.status]]);
        });
        sheet.range(`A${studentTableStart + 1}:D${currentRow}`).style(cellStyle);
        sheet.range(`A${studentTableStart + 1}:A${currentRow}`).style({ horizontalAlignment: 'center' });
        sheet.range(`C${studentTableStart + 1}:D${currentRow}`).style({ horizontalAlignment: 'center' });
        currentRow += 2;

        // Analizler
        const analysisTableStart = currentRow;
        sheet.cell(`A${analysisTableStart}`).value("Soru Bazında Analiz").style(tableHeaderStyle);
        sheet.range(`A${analysisTableStart}:C${analysisTableStart}`).merged(true);
        sheet.row(analysisTableStart + 1).cell(1).value([["Soru No", "Ortalama Puan", "Başarı Yüzdesi"]]).style(tableHeaderStyle);
        questionAnalysis.forEach((q: any, i: number) => {
            sheet.row(analysisTableStart + 2 + i).cell(1).value([[q.questionNumber, q.averageScore, `${q.successPercentage.toFixed(1)}%`]]);
        });

        if (kazanimAnalysis && kazanimAnalysis.length > 0) {
            sheet.cell(`E${analysisTableStart}`).value("Kazanım Bazında Analiz").style(tableHeaderStyle);
            sheet.range(`E${analysisTableStart}:F${analysisTableStart}`).merged(true);
            sheet.row(analysisTableStart + 1).cell(5).value([["Kazanım", "Başarı Yüzdesi"]]).style(tableHeaderStyle);
            kazanimAnalysis.forEach((k: any, i: number) => {
                sheet.row(analysisTableStart + 2 + i).cell(5).value([[k.kazanim, `${k.successPercentage.toFixed(1)}%`]]);
            });
        }
        const analysisMaxRow = Math.max(questionAnalysis.length, kazanimAnalysis?.length || 0);
        const analysisRange = `A${analysisTableStart+1}:F${analysisTableStart + 1 + analysisMaxRow}`;
        if(analysisMaxRow > 0) {
           sheet.range(analysisRange).style(cellStyle).style({ horizontalAlignment: 'center' });
        }
        currentRow = analysisTableStart + analysisMaxRow + 4;

        // --- HATA DÜZELTMESİ BURADA ---
        // Grafikler
        for (const chartId of ['studentScores', 'questionSuccess', 'kazanimSuccess']) {
            if (chartImages[chartId]) {
                const imageData = chartImages[chartId].split(',')[1];
                if (imageData) {
                    // YANLIŞ KULLANIM: sheet.addImage(...)
                    // DOĞRU KULLANIM: sheet.image(...)
                    sheet.image(imageData, {
                        anchor: {
                            type: 'twoCellAnchor',
                            from: { col: 1, row: currentRow },
                            to: { col: 8, row: currentRow + 20 }
                        }
                    });
                    currentRow += 22; // Resmi yerleştirmek için satır atla
                }
            }
        }
        
        // Sütun Genişlikleri
        sheet.column('B').width(15);
        sheet.column('C').width(15);
        sheet.column('D').width(15);
        sheet.column('A').width(20);
        sheet.column('E').width(40);
        sheet.column('F').width(20);
        
        const fileData = await workbook.outputAsync('base64');

        return { success: true, fileData };

    } catch (error: any) {
        console.error("Excel Raporu Sunucu Eylemi Hatası:", error);
        return { success: false, message: `Excel raporu oluşturulurken sunucuda bir hata oluştu: ${error.message}` };
    }
}

// --- YENİ EYLEM: Mevcut Soruları PDF'ten Gelen Kazanımlarla Güncelleme ---
// LÜTFEN ÖNCEKİ FONKSİYONUN TAMAMINI SİLİP BUNU YAPIŞTIRIN

const PdfImportSchema = z.object({
    examId: z.string().min(1, "Sınav ID'si eksik."),
    teacherId: z.string().min(1, "Öğretmen ID'si eksik."),
    pageNumber: z.coerce.number().min(1, "Sayfa numarası 1'den büyük veya eşit olmalıdır."),
    pdfUrl: z.string().url("Geçerli bir URL girmelisiniz.").optional().or(z.literal('')),
    pdfFile: z.any().optional(),
}).refine(data => data.pdfUrl || (data.pdfFile && data.pdfFile.size > 0), {
    message: "Bir PDF dosyası yüklemeli veya bir PDF bağlantısı sağlamalısınız.",
    path: ["pdfFile"],
});


export async function importKazanimsFromPdf(prevState: ActionState | undefined, formData: FormData): Promise<ActionState> {
    const validatedFields = PdfImportSchema.safeParse(Object.fromEntries(formData));

    if (!validatedFields.success) {
        const errorMessage = validatedFields.error.flatten().fieldErrors;
        const message = Object.values(errorMessage).flat().join(' ') || "Form verileri geçersiz.";
        return { success: false, message };
    }

    const { examId, teacherId, pageNumber, pdfUrl, pdfFile } = validatedFields.data;

    if (!await verifyOwnership('exams', examId, teacherId)) {
        return { success: false, message: "Bu işlem için yetkiniz bulunmamaktadır." };
    }

    try {
        let pdfBuffer: Buffer;
        if (pdfUrl) {
            const response = await fetch(pdfUrl);
            if (!response.ok) {
                return { success: false, message: `PDF URL'sinden dosya indirilemedi. (Hata: ${response.statusText})` };
            }
            const arrayBuffer = await response.arrayBuffer();
            pdfBuffer = Buffer.from(arrayBuffer);
        } else if (pdfFile && pdfFile.size > 0) {
            const arrayBuffer = await pdfFile.arrayBuffer();
            pdfBuffer = Buffer.from(arrayBuffer);
        } else {
            return { success: false, message: "Geçerli bir PDF dosyası veya URL'si sağlanmadı." };
        }

        // --- GÜVENİLİR PDF2JSON KÜTÜPHANESİ İLE PDF OKUMA ---
        const pageText = await new Promise<string>((resolve, reject) => {
            //@ts-ignore
            const pdfParser = new PDFParser(this, 1);

            pdfParser.on("pdfParser_dataError", (errData: any) => {
                console.error(errData.parserError);
                reject(new Error("PDF dosyası okunurken bir hata oluştu. Lütfen dosyanın bozuk olmadığından emin olun."));
            });

            pdfParser.on("pdfParser_dataReady", (pdfData: any) => {
                const numPages = pdfData.Pages.length;
                if (pageNumber > numPages) {
                    reject(new Error(`Belirtilen sayfa numarası (${pageNumber}), PDF'in toplam sayfa sayısından (${numPages}) büyük.`));
                    return;
                }
                
                const page = pdfData.Pages[pageNumber - 1];
                const allText = page.Texts.map((text: any) => decodeURIComponent(text.R[0].T)).join(" ");
                resolve(allText);
            });

            pdfParser.parseBuffer(pdfBuffer);
        });
        
        if (!pageText || pageText.trim() === '') {
            return { success: false, message: `PDF'in ${pageNumber}. sayfası okunamadı veya bu sayfada metin bulunmuyor.` };
        }

        // --- KAZANIMLARI AYIKLAMA ---
        const kazan_regex = /[A-Z]\.\d{1,2}\.\d{1,2}\.\d{1,2}\.\d{1,2}\.[\s\S]*?\./g;
        const matches = pageText.match(kazan_regex);
        
        if (!matches || matches.length === 0) {
            return { success: false, message: `Belirtilen sayfada 'F.X.X.X.X. Açıklama' formatında kazanım bulunamadı. Lütfen sayfa numarasını ve PDF formatını kontrol edin.` };
        }

        const cleanedMatches = matches.map(m => m.replace(/\s+/g, ' ').trim()).filter(m => m.length > 10);

        if (cleanedMatches.length === 0) {
             return { success: false, message: "Eşleşme bulundu ancak geçerli kazanım metni ayıklanamadı." };
        }

        // --- YENİ LOGIC: Yeni soru eklemek yerine mevcut soruları güncelle ---
        const questionsRef = adminDb.collection('exams').doc(examId).collection('questions');
        const questionsSnapshot = await questionsRef.orderBy('questionNumber').get();
        
        if (questionsSnapshot.empty) {
            return { success: false, message: "Bu sınavda henüz hiç soru bulunmuyor. Lütfen önce soruları ekleyin." };
        }

        const existingQuestions = questionsSnapshot.docs;
        const batch = adminDb.batch();
        const updateCount = Math.min(existingQuestions.length, cleanedMatches.length);

        // Bulunan kazanımları sırayla mevcut sorulara ata
        for (let i = 0; i < updateCount; i++) {
            const questionDoc = existingQuestions[i];
            const newKazanim = cleanedMatches[i];
            batch.update(questionDoc.ref, { kazanim: newKazanim });
        }

        await batch.commit();

        // Kullanıcıyı bilgilendirme mesajı oluştur
        let message = `Başarıyla ${updateCount} sorunun kazanımı güncellendi.`;
        if (cleanedMatches.length > existingQuestions.length) {
            message += ` PDF'te ${cleanedMatches.length} kazanım bulundu ama sınavda ${existingQuestions.length} soru vardı. Fazla olan kazanımlar göz ardı edildi.`;
        } else if (cleanedMatches.length < existingQuestions.length) {
            message += ` PDF'te ${cleanedMatches.length} kazanım bulundu. Sınavdaki ilk ${cleanedMatches.length} soru güncellendi, geri kalanı değişmedi.`;
        }

        revalidatePath(`/dashboard/exams/${examId}`);
        return { success: true, message: message };

    } catch (error: any) {
        console.error("PDF'ten kazanım aktarma hatası:", error);
        return { success: false, message: `Beklenmedik bir sunucu hatası oluştu: ${error.message}` };
    }
}
