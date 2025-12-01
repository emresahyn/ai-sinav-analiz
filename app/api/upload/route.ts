
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { db } from '@/lib/firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const examId = formData.get('examId') as string | null;
    const studentId = formData.get('studentId') as string | null;

    if (!file || !examId || !studentId) {
      return NextResponse.json({ error: 'Eksik dosya, sınav ID veya öğrenci ID bilgisi.' }, { status: 400 });
    }

    // Dosyadan bir tampon bellek (buffer) oluştur
    const buffer = Buffer.from(await file.arrayBuffer());

    // Yüklenecek dizini tanımla ve eğer yoksa oluştur
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', examId, studentId);
    await fs.mkdir(uploadDir, { recursive: true });

    // Dosyanın tam yolunu tanımla
    const filePath = path.join(uploadDir, file.name);

    // Dosyayı sunucunun dosya sistemine yaz
    await fs.writeFile(filePath, buffer);

    // Dosyanın genel (public) erişim yolunu oluştur
    const publicPath = `/uploads/${examId}/${studentId}/${file.name}`;

    // --- Firestore'a Kaydetme ---
    const docRef = doc(db, "studentPapers", `${examId}_${studentId}`);
    const docSnap = await getDoc(docRef);

    let existingUrls: string[] = [];
    if (docSnap.exists()) {
      existingUrls = docSnap.data().paperUrls || [];
    }

    // Yeni dosyayı ekle ve tekrar edenleri kaldır
    const updatedUrls = [...new Set([...existingUrls, publicPath])];

    await setDoc(docRef, {
        examId: examId,
        studentId: studentId,
        paperUrls: updatedUrls,
        uploadedAt: new Date()
    }, { merge: true });

    return NextResponse.json({ success: true, path: publicPath });
  } catch (error) {
    console.error('Yükleme API hatası:', error);
    const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu.';
    return NextResponse.json({ error: `Yükleme başarısız oldu: ${errorMessage}` }, { status: 500 });
  }
}