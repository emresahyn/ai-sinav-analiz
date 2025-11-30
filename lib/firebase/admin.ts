import * as admin from 'firebase-admin';

// Güvenli yöntem: service-account.json içeriğini doğrudan import etmek yerine
// çevre değişkenlerinden (environment variables) okuyacağız.
// Bu, hem daha güvenli hem de deploy ortamları için standart bir yöntemdir.
const serviceAccountJson = process.env.SERVICE_ACCOUNT_JSON;

if (!admin.apps.length) {
  // Eğer çevre değişkeni tanımlanmamışsa, bu kritik bir hatadır.
  if (!serviceAccountJson) {
    console.error('Firebase Admin SDK başlatma hatası: SERVICE_ACCOUNT_JSON çevre değişkeni bulunamadı. Lütfen projenizin kök dizinine .env.local dosyası oluşturup bu değişkeni tanımlayın.');
    throw new Error('Firebase Admin SDK için gerekli çevre değişkeni eksik.');
  }

  try {
    // Çevre değişkeninden gelen JSON formatındaki string'i JavaScript nesnesine çeviriyoruz.
    const serviceAccount = JSON.parse(serviceAccountJson);

    // Firebase Admin SDK'sını bu bilgilerle başlatıyoruz.
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });
  } catch (error: any) {
    console.error('Firebase Admin SDK başlatılırken KRİTİK HATA. SERVICE_ACCOUNT_JSON çevre değişkeni doğru formatta mı?', error);
    // Sunucunun hatalı bir durumda çalışmasını engellemek için hatayı fırlat
    throw new Error('Firebase Admin SDK başlatılamadı.');
  }
}

export const adminDb = admin.firestore();
