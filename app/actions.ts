
'use server';

import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import { revalidatePath } from 'next/cache';
import { promises as fs } from 'fs';
import path from 'path';
// YENİ VE DOĞRU İÇE AKTARMA
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
        const scoresQuery = adminDb.collection('scores').where('examId', '==', examId).where('teacherId', '==', teacherId);
        const scoresSnapshot = await scoresQuery.get();
        const batch = adminDb.batch();
        scoresSnapshot.forEach(doc => batch.delete(doc.ref));
        await batch.commit();

        const questionsQuery = adminDb.collection('exams').doc(examId).collection('questions');
        const questionsSnapshot = await questionsQuery.get();
        const questionsBatch = adminDb.batch();
        questionsSnapshot.forEach(doc => questionsBatch.delete(doc.ref));
        await questionsBatch.commit();

        const examRef = adminDb.collection('exams').doc(examId);
        await examRef.delete();

        const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'exams', examId);
        await fs.rm(uploadDir, { recursive: true, force: true });

        revalidatePath('/dashboard/exams');
        revalidatePath('/dashboard/analysis');
        return { message: 'Sınav ve ilişkili tüm veriler başarıyla silindi.', success: true };
    } catch (error: any) {
        console.error(`Sınav silme hatası (ID: ${examId}):`, error);
        return { message: `Sınav silinirken bir hata oluştu: ${error.message}`, success: false };
    }
}

// --- Exam Paper Actions --- //
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
    
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'exams', examId, studentId);
    try {
        await fs.mkdir(uploadDir, { recursive: true });
    } catch (error: any) {
        return { message: `Klasör oluşturulamadı: ${error.message}`, success: false, studentId };
    }

    const uploadPromises = papers.map(async (paper) => {
        const bytes = await paper.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const filePath = path.join(uploadDir, paper.name);
        await fs.writeFile(filePath, buffer);
        return { name: paper.name, path: `/uploads/exams/${examId}/${studentId}/${paper.name}` };
    });

    try {
        const results = await Promise.all(uploadPromises);
        revalidatePath(`/dashboard/exams/${examId}/upload`);
        return { 
            message: `${results.length} dosya başarıyla yüklendi.`, 
            success: true, 
            studentId,
            uploadedFiles: results
        };
    } catch (error: any) {
        return { message: `Dosya yükleme hatası: ${error.message}`, success: false, studentId };
    }
}

export async function getUploadedPapers(examId: string, studentId: string) {
    const dirPath = path.join(process.cwd(), 'public', 'uploads', 'exams', examId, studentId);
    try {
        await fs.access(dirPath);
        const files = await fs.readdir(dirPath);
        const fileDetails = files.map(file => ({ name: file, path: `/uploads/exams/${examId}/${studentId}/${file}` }));
        return { success: true, files: fileDetails };
    } catch (error) {
        return { success: true, files: [] };
    }
}

export async function deleteExamPaper(examId: string, teacherId: string, filePath: string) {
    if (!await verifyOwnership('exams', examId, teacherId)) return { message: 'Bu işlem için yetkiniz yok.', success: false };
    
    const fullPath = path.join(process.cwd(), 'public', filePath);
    try {
        await fs.unlink(fullPath);
        revalidatePath(`/dashboard/exams/${examId}/upload`);
        return { message: 'Dosya başarıyla silindi.', success: true };
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            revalidatePath(`/dashboard/exams/${examId}/upload`);
            return { message: 'Dosya zaten mevcut değil.', success: true };
        }
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

// --- Analysis Actions (SON DÜZELTME) --- //

export async function analyzeExamPapers(prevState: any, formData: FormData) {
    console.log("\n--- YENİ SINAV ANALİZİ BAŞLADI ---");
    const AnalysisSchema = z.object({ examId: z.string().min(1) });
    const validatedFields = AnalysisSchema.safeParse(Object.fromEntries(formData));
    if (!validatedFields.success) {
        console.error("Analiz Başarısız: Geçersiz Sınav ID.");
        return { message: 'Geçersiz Sınav ID.', success: false };
    }
    const { examId } = validatedFields.data;
    console.log(`Sınav ID doğrulandı: ${examId}`);

    console.log("Sınav bilgileri ve yetki kontrolü yapılıyor...");
    const examRef = adminDb.collection('exams').doc(examId);
    const examDoc = await examRef.get();
    if (!examDoc.exists) {
        console.error(`Hata: Sınav bulunamadı (ID: ${examId})`);
        return { message: 'Sınav bulunamadı.', success: false };
    }
    const { teacherId, classId } = examDoc.data() as { teacherId: string; classId: string };
    console.log(`Sınav bilgileri alındı: Sınıf ID ${classId}, Öğretmen ID ${teacherId}`);

    if (!teacherId || !classId) {
        console.error("Hata: Sınav bilgileri eksik (öğretmen veya sınıf ID bulunamadı).");
        return { message: 'Sınav bilgileri eksik.', success: false };
    }

    try {
        console.log("Sınıftaki öğrenciler ve sınavdaki sorular veritabanından çekiliyor...");
        const studentsSnapshot = await adminDb.collection('classes').doc(classId).collection('students').get();
        const students = studentsSnapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as { name: string }) }));
        console.log(`${students.length} öğrenci bulundu.`);

        const questionsSnapshot = await examRef.collection('questions').orderBy('questionNumber').get();
        const questions = questionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as { points: number; questionNumber: number } }));
        console.log(`${questions.length} soru bulundu.`);

        if (questions.length === 0) {
            console.warn("Analiz durduruldu: Sınavda hiç soru tanımlanmamış.");
            return { message: 'Sınavda hiç soru tanımlanmamış. Analiz yapılamaz.', success: false };
        }

        let processedStudentCount = 0;
        let totalScoresSaved = 0;
        const batch = adminDb.batch();

        console.log("--- Öğrenci Kağıtlarını İşleme Döngüsü Başladı ---");
        for (const student of students) {
            console.log(`\n-> İşleniyor: Öğrenci ${student.name || student.id}`);
            const uploadedPapers = await getUploadedPapers(examId, student.id);
            if (!uploadedPapers.success || uploadedPapers.files.length === 0) {
                console.log(`  - ${student.name || student.id} için yüklü kağıt bulunamadı. Atlanıyor.`);
                continue;
            }

            processedStudentCount++;
            console.log(`  - ${uploadedPapers.files.length} adet kağıt bulundu. Analiz edilecek.`);

            for (const paper of uploadedPapers.files) {
                if (!paper.path) continue;
                
                // YENİ YÖNTEM: Dosyanın tam fiziksel yolunu oluşturuyoruz.
                const physicalPath = path.join(process.cwd(), 'public', paper.path);
                console.log(`    - Kağıt analiz ediliyor: ${physicalPath}`);
                
                console.log("    - Yapay zeka (Gemini) çağrılıyor (Dosya ile)...");
                // YENİ YÖNTEM: Yapay zekaya URL yerine dosya yolunu veriyoruz.
                const analysisResult = await analyzeImageFromFile(physicalPath);

                if (!analysisResult.success) {
                    const errorMessage = `      * YZ Hatası: ${analysisResult.message}`;
                    console.error(errorMessage);
                    continue;
                }

                const detectedScores = analysisResult.scores || [];
                console.log(`    - Yapay zeka sonucu alındı: [${detectedScores.join(', ')}]`);

                if (detectedScores.length === 0) {
                    console.log("      - Bu kağıtta okunabilir puan bulunamadı.");
                    continue;
                }

                console.log(`      - ${detectedScores.length} adet puan bulundu. Veritabanına işleniyor...`);
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
                        console.log(`        - Soru ${question.questionNumber} için puan ${score} olarak kaydedildi.`);
                    }
                }
            }
        }
        console.log("\n--- Öğrenci Kağıtlarını İşleme Döngüsü Tamamlandı ---");

        if (processedStudentCount === 0) {
            console.warn("Sonuç: Analiz edilecek hiç öğrenci kağıdı bulunamadı.");
            return { message: 'Analiz edilecek hiç öğrenci kağıdı bulunamadı.', success: false };
        }

        if (totalScoresSaved > 0) {
            console.log(`Toplam ${totalScoresSaved} puan kaydedildi. Veritabanına yazılıyor...`);
            await batch.commit();
            console.log("Veritabanı başarıyla güncellendi.");
        }

        revalidatePath(`/dashboard/analysis/${examId}`);
        revalidatePath(`/dashboard/exams/${examId}/upload`);

        let finalMessage = "";
        if (totalScoresSaved > 0) {
            finalMessage = `Yapay zeka analizi tamamlandı! ${processedStudentCount} öğrencinin kağıdı incelendi ve toplam ${totalScoresSaved} adet puan başarıyla kaydedildi.`
        } else {
            finalMessage = "Analiz tamamlandı. İncelenen kağıtlar üzerinde yapay zeka tarafından okunabilecek net bir puan tespit edilemedi.";
        }
        console.log(`Nihai Sonuç: ${finalMessage}`);
        console.log("--- ANALİZ BAŞARIYLA SONA ERDİ ---");
        return { message: finalMessage, success: true };

    } catch (error: any) {
        console.error("!!! KRİTİK ANALİZ HATASI !!!:", error);
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
