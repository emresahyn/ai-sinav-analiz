
'use server';

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { adminDb } from '@/lib/firebase/admin';
import { revalidatePath } from 'next/cache';

/**
 * Bir öğrencinin sınav kağıdını sunucuya yükler ve Firestore'a kaydeder.
 */
export async function uploadExamPaper(examId: string, studentId: string, formData: FormData) {
    const file = formData.get('examPaper') as File;
    if (!file || file.size === 0) {
        return { success: false, message: 'Lütfen bir dosya seçin.' };
    }

    try {
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        const extension = file.name.split('.').pop() || 'jpg';
        const filename = `${studentId}.${extension}`;
        const uploadDir = join(process.cwd(), 'public', 'uploads', examId);
        const path = join(uploadDir, filename);

        await mkdir(uploadDir, { recursive: true });
        await writeFile(path, buffer);

        const paperRef = adminDb.collection('exams').doc(examId).collection('papers').doc(studentId);
        await paperRef.set({
            studentId: studentId,
            filePath: `/uploads/${examId}/${filename}`,
            uploadedAt: new Date(),
        });

        revalidatePath(`/dashboard/exams/${examId}`);
        return { success: true, message: 'Kağıt yüklendi!' };
    } catch (error: any) {
        console.error('File upload error:', error);
        return { success: false, message: `Hata: ${error.message}` };
    }
}

/**
 * Bir sınavın cevap anahtarını sunucuya yükler ve Firestore'a kaydeder.
 */
export async function uploadAnswerKey(examId: string, formData: FormData) {
    const file = formData.get('answerKey') as File;
    if (!file || file.size === 0) {
        return { success: false, message: 'Lütfen bir cevap anahtarı dosyası seçin.' };
    }

    try {
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        const extension = file.name.split('.').pop() || 'jpg';
        const filename = `answer-key.${extension}`;
        const uploadDir = join(process.cwd(), 'public', 'uploads', examId);
        const path = join(uploadDir, filename);

        await mkdir(uploadDir, { recursive: true });
        await writeFile(path, buffer);

        const examRef = adminDb.collection('exams').doc(examId);
        await examRef.update({
            answerKeyPath: `/uploads/${examId}/${filename}`,
        });

        revalidatePath(`/dashboard/exams/${examId}`);
        return { success: true, message: 'Cevap anahtarı başarıyla yüklendi!' };
    } catch (error: any) {
        console.error('Answer key upload error:', error);
        return { success: false, message: `Hata: ${error.message}` };
    }
}
