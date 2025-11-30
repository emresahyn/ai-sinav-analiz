
'use server';

import { adminDb } from '@/lib/firebase/admin';
import { revalidatePath } from 'next/cache';
import { firestore } from 'firebase-admin';

// Güvenlik: Bir sınavın belirli bir öğretmene ait olup olmadığını doğrular.
async function verifyExamOwnership(examId: string, teacherId: string): Promise<boolean> {
    if (!examId || !teacherId) return false;
    const docRef = adminDb.collection('exams').doc(examId);
    const doc = await docRef.get();
    return doc.exists && doc.data()?.teacherId === teacherId;
}


export async function runAnalysis(examId: string, teacherId: string) {
    // 1. Yetki Kontrolü
    if (!await verifyExamOwnership(examId, teacherId)) {
        return { success: false, message: 'Bu sınav için analiz başlatma yetkiniz yok.' };
    }

    try {
        const examRef = adminDb.collection('exams').doc(examId);
        const examDoc = await examRef.get();
        const examData = examDoc.data();

        // 2. Veri Doğrulama
        if (!examData?.answerKeyPath) {
            return { success: false, message: 'Analizi başlatmak için önce bir cevap anahtarı yüklemelisiniz.' };
        }

        const acquisitionsSnapshot = await examRef.collection('acquisitions').get();
        if (acquisitionsSnapshot.empty) {
            return { success: false, message: 'Analizi başlatmak için en az bir soru/kazanım eklemelisiniz.' };
        }
        const questions = acquisitionsSnapshot.docs.map(doc => doc.data().questionNumber as string);

        const papersSnapshot = await examRef.collection('papers').get();
        if (papersSnapshot.empty) {
            return { success: false, message: 'Analiz edilecek en az bir öğrenci kağıdı yüklenmelidir.' };
        }

        // 3. Analiz Sürecini Başlat (Yapay Zeka Simülasyonu)
        const batch = adminDb.batch();
        let analyzedCount = 0;

        for (const paperDoc of papersSnapshot.docs) {
            const paperRef = paperDoc.ref;
            const analysisResult: { [key: string]: 'Doğru' | 'Yanlış' | 'Boş' } = {};

            // SAHTE ANALİZ: Her soru için rastgele bir sonuç ata
            const options: ('Doğru' | 'Yanlış' | 'Boş')[] = ['Doğru', 'Yanlış', 'Boş'];
            for (const q of questions) {
                analysisResult[q] = options[Math.floor(Math.random() * options.length)];
            }
            
            batch.update(paperRef, { 
                status: 'Analiz Edildi',
                analysis: analysisResult,
                analyzedAt: firestore.FieldValue.serverTimestamp()
            });
            analyzedCount++;
        }

        // 4. Batch işlemini gerçekleştir ve sonucu döndür
        await batch.commit();

        revalidatePath(`/dashboard/exams/${examId}`);
        return { success: true, message: `${analyzedCount} öğrenci kağıdı başarıyla analiz edildi!` };

    } catch (error: any) {
        console.error("Analysis failed:", error);
        return { success: false, message: `Analiz sırasında beklenmedik bir hata oluştu: ${error.message}` };
    }
}
