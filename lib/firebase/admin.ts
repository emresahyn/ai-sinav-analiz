import admin from 'firebase-admin';

// Ortam değişkeni yoksa veya zaten başlatılmışsa tekrar başlatma
if (!admin.apps.length) {
  // Base64 kodlu ortam değişkenini al ve çöz
  const serviceAccountString = Buffer.from(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON as string, 
    'base64'
  ).toString('utf8');
  
  const serviceAccount = JSON.parse(serviceAccountString);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    // Eğer Storage kullanıyorsanız bu satırı da ekleyin
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET 
  });
}

export const adminDb = admin.firestore();
export const adminStorage = admin.storage();
