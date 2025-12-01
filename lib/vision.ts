
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { promises as fs } from 'fs';

// --- Gemini Modeli Başlatma ---
const MODEL_NAME = "gemini-flash-latest";
const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
    console.error("CRITICAL: GEMINI_API_KEY ortam değişkeni ayarlanmamış.");
}

const genAI = new GoogleGenerativeAI(API_KEY || '');
const model = genAI.getGenerativeModel({ model: MODEL_NAME });

// --- YARDIMCI FONKSİYON ---
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
 * @param imagePath Analiz edilecek görselin sunucudaki yerel dosya yolu.
 * @returns Tespit edilen puanları veya bir hata mesajını içeren bir nesne.
 */
export async function analyzeImageFromFile(imagePath: string): Promise<{ success: boolean; scores?: number[]; message?: string; }> {
  if (!API_KEY) {
      console.error("Analiz durduruldu: GEMINI_API_KEY ayarlanmamış.");
      return { success: false, message: 'Yapay zeka hizmeti şu anda yapılandırma hatası nedeniyle devre dışı.' };
  }
    
  try {
    if (!imagePath) {
      return { success: false, message: 'Analiz için bir resim dosya yolu gereklidir.' };
    }

    const mimeType = "image/jpeg"; 
    const imagePart = await fileToGenerativePart(imagePath, mimeType);

    const prompt = `
        Sen, sınav kağıtlarındaki el yazısı puanlarını okuma konusunda uzmanlaşmış bir yapay zeka asistanısın.
        Görevin, verilen öğrenci sınav kağıdı görselini dikkatle analiz etmektir.
        Öncelikle, görüntüdeki el yazısıyla yazılmış sayısal puanları bulmaya odaklan. Bu puanlar genellikle soru numaralarının yanında veya altında bulunur.
        Bulduğun tüm puanları bir JSON nesnesinin 'scores' anahtarı altında bir dizi olarak listele.
        Ek olarak, gördüklerin veya neden puan bulamadığın hakkında kısa bir analizi 'analysis' anahtarı altına ekle.
        Yanıtın SADECE ve SADECE aşağıdaki formatta bir JSON nesnesi olmalıdır. Başka hiçbir metin veya açıklama ekleme.

        Başarılı bir örnek:
        {
          "scores": [10, 8, 5, 10, 9],
          "analysis": "Kağıdın sağ tarafında beş adet puan tespit ettim."
        }

        Puan bulunamayan bir örnek:
        {
          "scores": [],
          "analysis": "Görüntüyü analiz ettim ancak okunabilir bir el yazısı puanı tespit edemedim. El yazısı çok silik veya kağıtta puan yok."
        }
    `;

    const generationConfig = {
      temperature: 0.2, 
      topK: 32,
      topP: 1,
      maxOutputTokens: 2048,
    };
    
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

    if (!cleanedText) {
        console.error("Gemini boş bir metin yanıtı döndürdü. Yanıt detayı:", JSON.stringify(response, null, 2));
        return { success: false, message: "Yapay zeka boş bir yanıt döndürdü." };
    }

    try {
        const responseObject = JSON.parse(cleanedText);
        const scores = responseObject.scores;

        if (!Array.isArray(scores) || !scores.every(s => typeof s === 'number')) {
            console.error("Gemini, 'scores' anahtarında bir sayı dizisi döndürmedi:", cleanedText);
            return { success: false, message: 'Yapay zeka, beklenen formatta bir puan listesi oluşturamadı.' };
        }
        
        // Analiz metnini sunucu loglarına yazdır (hata ayıklama için yararlı olabilir)
        if(responseObject.analysis) {
            console.log(`Yapay Zeka Analizi (${imagePath}): ${responseObject.analysis}`);
        }

        return { success: true, scores: scores };
    } catch (e) {
        console.error("Gemini'den gelen JSON nesnesi ayrıştırılamadı:", cleanedText, e);
        return { success: false, message: 'Yapay zeka yanıtı işlenemedi. Lütfen kağıdın net olduğundan emin olun ve tekrar deneyin.' };
    }

  } catch (error: any) {
      console.error(`--- Gemini Vision Analiz Hatası (${imagePath}) ---`, error);
      const errorMessage = error.message || 'Bilinmeyen bir hata oluştu.';
      return { success: false, message: `Yapay zeka analizi sırasında bir hata oluştu: ${errorMessage}` };
  }
}
