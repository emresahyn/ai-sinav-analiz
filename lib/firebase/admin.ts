
import * as admin from 'firebase-admin';

// Proje dizinindeki 'service-account.json' dosyasını kullanacağımızı varsayıyoruz.
// Bu dosyanın yolu .gitignore dosyasına eklenerek güvenliği sağlanmıştır.
import serviceAccount from '../../service-account.json'; // Kök dizine göre yol

if (!admin.apps.length) {
  try {
    admin.initializeApp({
      // Dosyadan alınan servis hesabı bilgilerini kullanarak kimlik doğrulaması yap
      credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
      // Proje ID'sini de bu dosyadan alarak tutarlılığı sağla
      projectId: serviceAccount.project_id,
    });
  } catch (error: any) {
    console.error('Firebase Admin SDK başlatılırken KRİTİK HATA. service-account.json dosyası projenin kök dizininde ve doğru formatta mı?', error);
    // Sunucunun hatalı bir durumda çalışmasını engellemek için hatayı fırlat
    throw new Error('Firebase Admin SDK başlatılamadı.');
  }
}

export const adminDb = admin.firestore();
