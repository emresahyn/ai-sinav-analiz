
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { promises as fs } from 'fs';

// --- Gemini Modeli Başlatma ---
const MODEL_NAME = "gemini-flash-latest";
const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
    console.error("KRİTİK: GEMINI_API_KEY ortam değişkeni ayarlanmamış.");
}

const genAI = new GoogleGenerativeAI(API_KEY || '');
const model = genAI.getGenerativeModel({ model: MODEL_NAME });

// --- YARDIMCI FONKSİYONLAR ---
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fileToGenerativePart(filePath: string, mimeType: string) {
  try {
    const imageBuffer = await fs.readFile(filePath);
    return {
      inlineData: {
        data: imageBuffer.toString("base64"),
        mimeType
      },
    };
  } catch(error: any) {
    console.error(`Dosya okunurken veya base64'e çevrilirken hata: ${filePath}`, error);
    throw new Error(`Dosya işlenemedi: ${filePath}`);
  }
}

/**
 * BİR SINAV KAĞIDI DOSYASINI Google Gemini Pro Vision kullanarak analiz eder.
 * Hata durumunda 10 saniye bekleyip bir kez daha dener.
 * @param imagePath Analiz edilecek görselin sunucudaki yerel dosya yolu.
 * @param studentId Kağıdın sahibi olan öğrencinin kimliği.
 * @returns Başarı durumu, öğrenci kimliği, skorlar ve mesaj içeren bir nesne döndürür.
 */
export async function analyzeImageFromFile(imagePath: string, studentId: string): Promise<{ success: boolean; studentId?: string; scores?: { [key: string]: number }; message?: string; }> {
  if (!API_KEY) {
      return { success: false, message: 'Yapay zeka hizmeti yapılandırma hatası nedeniyle devre dışı.' };
  }
  if (!imagePath || !studentId) {
      return { success: false, message: 'Analiz için resim yolu ve öğrenci kimliği gereklidir.' };
  }

  const maxRetries = 1; 
  const retryDelay = 10000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const mimeType = "image/jpeg"; 
      const imagePart = await fileToGenerativePart(imagePath, mimeType);

      // --- GÜNCELLENDİ: Prompt artık öğrenci ID'sini de istiyor ---
      const prompt = `
          Sen, sınav kağıtlarındaki el yazısı puanlarını okuma konusunda uzmanlaşmış bir yapay zeka asistanısın.
          Görevin, verilen öğrenci sınav kağıdı görselini dikkatle analiz etmektir.
          Öncelikle, görüntüdeki el yazısıyla yazılmış ve daire içine alınmış sayısal puanları bulmaya odaklan. Bu puanlar genellikle soru numaralarının yanında veya altında bulunur.
          Bulduğun tüm puanları, soru numarasını anahtar (string) ve puanı değer (number) olarak belirterek bir JSON nesnesinin 'scores' anahtarı altında bir NESNE olarak listele.
          Ayrıca, sana verdiğim öğrenci ID'sini JSON çıktısına 'studentId' anahtarıyla ekle.
          Son olarak, gördüklerin hakkında kısa bir analizi 'analysis' anahtarı altına ekle.
          Yanıtın SADECE ve SADECE aşağıdaki formatta bir JSON nesnesi olmalıdır. Başka hiçbir metin veya açıklama ekleme.
          Eğer kağıdı inceledin ve el yazısı tespit edemediysen o soru ile ilgili puana 0 yazabilirsin. Yani puanlanmamış soru kalmasın.
          Ayrıca puanlamalar doğal sayı olmak zorundadır.
          Verilen Öğrenci ID: ${studentId}

          BAŞARILI ÖRNEK:
          {
            "studentId": "${studentId}",
            "scores": { "1": 10, "2": 8, "5": 7 },
            "analysis": "Kağıdın sağ tarafında üç adet puan tespit ettim."
          }

          PUAN BULUNAMAYAN ÖRNEK:
          {
            "studentId": "${studentId}",
            "scores": {"1": 0, "2": 0, "5": 0},
            "analysis": "Görüntüyü analiz ettim ancak okunabilir bir el yazısı puanı tespit edemedim."
          }
      `;

      const generationConfig = { temperature: 0.2, topK: 32, topP: 1, maxOutputTokens: 2048 };
      const safetySettings = [
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      ];

      const result = await model.generateContent({
          contents: [{ role: "user", parts: [imagePart, {text: prompt}] }],
          generationConfig,
          safetySettings,
      });

      const response = result.response;
      const text = response.text();
      const cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim();

      if (!cleanedText) { throw new Error("Yapay zeka boş bir yanıt döndürdü."); }
      
      const responseObject = JSON.parse(cleanedText);
      const { scores, studentId: returnedStudentId, analysis } = responseObject;

      if (typeof scores !== 'object' || scores === null || Array.isArray(scores)) {
          throw new Error("Yapay zeka, beklenen formatta bir puan nesnesi oluşturamadı.");
      }
      if (typeof returnedStudentId !== 'string') {
        throw new Error("Yapay zeka, yanıtta geçerli bir öğrenci kimliği döndürmedi.");
      }

      if(analysis) { console.log(`Yapay Zeka Analizi (${imagePath}): ${analysis}`); }

      // Başarılı olursa döngüden çık ve sonucu döndür
      return { success: true, studentId: returnedStudentId, scores: scores };

    } catch (error: any) {
        console.error(`--- Gemini Analiz Hatası (Deneme ${attempt + 1}/${maxRetries + 1}) ---`, error.message);
        if (attempt === maxRetries) {
            return { success: false, message: `Kağıt analizi birkaç denemeden sonra başarısız oldu: ${error.message}` };
        }
        console.log(`${retryDelay / 1000} saniye sonra yeniden denenecek...`);
        await delay(retryDelay);
    }
  }

  return { success: false, message: 'Yapay zeka analizi bilinmeyen bir nedenle başarısız oldu.' };
}
