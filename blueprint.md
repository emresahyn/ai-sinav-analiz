
# Proje Planı ve Geliştirme Notları: Sınav Analiz Uygulaması v2.4

## 1. Genel Bakış

Bu belge, Sınav Analiz uygulamasının kapsamlı bir şekilde yeniden yapılandırılmasını ve geliştirilmesini detaylandırmaktadır. Proje, modern web teknolojilerini kullanarak öğretmenler için modüler, kullanıcı dostu ve zengin özellikli bir sınav analiz platformu oluşturmayı hedefler. Uygulama, Next.js (App Router), Firebase (Authentication, Firestore) ve Bootstrap üzerine inşa edilmiştir. Dosya depolama ve analiz işlemleri için sunucunun kendi dosya sistemi ve Firestore veritabanı entegre bir şekilde kullanılmaktadır.

## 2. Güncel Değişiklik Planı: PDF'ten Otomatik Kazanım Aktarma

Bu geliştirmenin amacı, öğretmenlerin bir PDF belgesinden sınav kazanımlarını otomatik olarak içe aktarmalarını sağlayarak manuel veri girişini ortadan kaldırmaktır.

*   **Özellik:** PDF'ten Kazanım Aktarma
*   **Konum:** Sınav Detayları Sayfası (`/dashboard/exams/[id]`)
*   **Arayüz:**
    *   Sayfaya "PDF'ten Kazanım Aktar" başlıklı yeni bir form eklenecek.
    *   Formda dosya yükleme, URL girme ve sayfa numarası belirtme alanları bulunacak.
    *   Mevcut sayfa tasarımına tam uyumlu, modern ve sade bir stil kullanılacak.
*   **İşlevsellik:**
    *   Kullanıcı bir PDF dosyası veya URL'si ile sayfa numarası belirterek "Aktar" butonuna tıklar.
    *   Yeni bir sunucu eylemi (`importKazanimsFromPdf`) tetiklenir.
    *   Bu eylem, `pdf-parse` kütüphanesini kullanarak belirtilen PDF sayfasındaki metin içeriğini okur.
    *   Metin içerisinden `F.X.X.X.X. Açıklama` formatındaki kazanım metinleri bir Regex deseni ile ayıklanır.
    *   Ayıklanan yeni kazanımlar, mevcut sınavın kazanım listesine eklenir.
    *   İşlem tamamlandığında sayfa yenilenerek güncel kazanım listesi gösterilir.

---

## 3. Tamamlanan Özellikler (Önceki Sürümler)

*   **Word Raporu Dışa Aktarma (v2.3):**
    *   Analiz sayfasında, tüm sınav verilerini (puan tabloları, analizler, özet notu ve **grafikler**) içeren kapsamlı bir `.docx` raporu oluşturma özelliği eklendi.
    *   Eski `docx` kütüphanesi sürümünün neden olduğu kritik `ImageRun` hataları, tip tanımlamalarının `@ts-ignore` ile aşılmasıyla çözüldü.

*   **Kimlik Doğrulama:** Güvenli e-posta/şifre ile kullanıcı girişi ve kaydı.
*   **Modernize Edilmiş Arayüz:** Proje genelinde Bootstrap 5 entegrasyonu.
*   **Global Sidebar Navigasyonu:** Tüm panel sayfalarında (`/dashboard` altında) kalıcı, çökebilir bir kenar çubuğu menüsü.
*   **Yeniden Yapılandırılmış Sınıf ve Öğrenci Yönetimi:** Kart tabanlı listeleme ve modal formlar.
*   **Gelişmiş Sınav Yönetimi:** Sınıf bazlı sınav oluşturma ve detaylı soru/kazanım yönetimi.
*   **Sunucu Tabanlı Çoklu Dosya Yükleme ve Silme**
*   **Kapsamlı Sınav Silme**
*   **İnteraktif Puan Analizi Modülü**

## 4. Uygulama Detayları ve Stil Rehberi

*   **Teknoloji:** Next.js 14+ (App Router), Firebase (Auth, Firestore), Bootstrap 5, `lucide-react`, `pdf-parse`.
*   **Tasarım Felsefesi:** Temiz, düzenli ve kullanıcıyı eyleme yönlendiren arayüz.
