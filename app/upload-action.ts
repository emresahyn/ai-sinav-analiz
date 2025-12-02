
'use server';

import { adminDb } from '@/lib/firebase/admin';
import { revalidatePath } from 'next/cache';
import sharp from 'sharp';

/**
 * Compresses an image, converts it to base64, and returns it.
 * @param file The image file to process.
 * @returns The base64 encoded string of the compressed image.
 */
async function compressAndEncodeImage(file: File): Promise<string> {
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Compress the image with sharp more aggressively
    const compressedBuffer = await sharp(buffer)
        .resize(800, 800, { fit: 'inside', withoutEnlargement: true }) // Resize to max 800x800
        .jpeg({ quality: 70 }) // Convert to JPEG with 70% quality
        .toBuffer();

    // Convert the compressed buffer to a base64 string
    const extension = file.name.split('.').pop() || 'jpeg';
    const base64Image = `data:image/${extension};base64,${compressedBuffer.toString('base64')}`;

    return base64Image;
}

/**
 * Bir öğrencinin sınav kağıdını sunucuya yükler, sıkıştırır ve base64 olarak Firestore'a kaydeder.
 */
export async function uploadExamPaper(examId: string, studentId: string, formData: FormData) {
    const file = formData.get('examPaper') as File;
    if (!file || file.size === 0) {
        return { success: false, message: 'Lütfen bir dosya seçin.' };
    }

    try {
        const base64Image = await compressAndEncodeImage(file);

        // Check the size of the base64 string. Firestore documents have a 1 MiB limit.
        if (Buffer.byteLength(base64Image, 'utf8') > 1048576) {
             return { success: false, message: 'Sıkıştırılmış dosya boyutu hala çok büyük (1MB\'dan fazla). Lütfen daha düşük çözünürlüklü bir resim deneyin.' };
        }

        const paperRef = adminDb.collection('exams').doc(examId).collection('papers').doc(studentId);
        await paperRef.set({
            studentId: studentId,
            fileBase64: base64Image, // Save base64 string instead of file path
            uploadedAt: new Date(),
        });

        revalidatePath(`/dashboard/exams/${examId}`);
        return { success: true, message: 'Kağıt yüklendi!' };
    } catch (error: unknown) {
        console.error('File upload error:', error);
        if (error instanceof Error) {
            return { success: false, message: `Hata: ${error.message}` };
        }
        return { success: false, message: 'Bilinmeyen bir hata oluştu.' };
    }
}

/**
 * Bir sınavın cevap anahtarını sunucuya yükler, sıkıştırır ve base64 olarak Firestore'a kaydeder.
 */
export async function uploadAnswerKey(examId: string, formData: FormData) {
    const file = formData.get('answerKey') as File;
    if (!file || file.size === 0) {
        return { success: false, message: 'Lütfen bir cevap anahtarı dosyası seçin.' };
    }

    try {
        const base64Image = await compressAndEncodeImage(file);

        if (Buffer.byteLength(base64Image, 'utf8') > 1048576) {
             return { success: false, message: 'Sıkıştırılmış dosya boyutu hala çok büyük (1MB\'dan fazla). Lütfen daha düşük çözünürlüklü bir resim deneyin.' };
        }

        const examRef = adminDb.collection('exams').doc(examId);
        await examRef.update({
            answerKeyBase64: base64Image, // Save base64 string
        });

        revalidatePath(`/dashboard/exams/${examId}`);
        return { success: true, message: 'Cevap anahtarı başarıyla yüklendi!' };
    } catch (error: unknown) {
        console.error('Answer key upload error:', error);
        if (error instanceof Error) {
            return { success: false, message: `Hata: ${error.message}` };
        }
        return { success: false, message: 'Bilinmeyen bir hata oluştu.' };
    }
}
