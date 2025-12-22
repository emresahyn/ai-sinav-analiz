import XlsxPopulate from 'xlsx-populate';

// --- Yardımcı Fonksiyonlar ---

// Satır yüksekliğini ve hücre birleştirmeyi ayarlar, metni ortalar ve stil uygular
const createStyledHeader = (sheet: any, row: number, text: string, style: object) => {
    sheet.cell(`A${row}`).value(text).style(style);
    sheet.range(`A${row}:I${row}`).merged(true);
    sheet.row(row).height(30);
};

// --- Ana Dışa Aktarma Fonksiyonu ---

export const exportReportToExcel = async (reportData: any, chartImages: { [key: string]: string }) => {
    if (!reportData) {
        alert("Dışa aktarılacak veri bulunamadı!");
        return;
    }

    const { exam, classInfo, stats, studentResults, questionAnalysis, kazanimAnalysis, summaryNote } = reportData;

    try {
        // Yeni bir çalışma kitabı oluştur
        const workbook = await XlsxPopulate.fromBlankAsync();
        const sheet = workbook.sheet(0).name("Analiz Raporu");

        // --- Stil Tanımlamaları ---
        const titleStyle = { fontFamily: 'Arial', fontSize: 18, bold: true, horizontalAlignment: 'center', verticalAlignment: 'center' };
        const subtitleStyle = { fontFamily: 'Arial', fontSize: 14, italic: true, horizontalAlignment: 'center', verticalAlignment: 'center' };
        const sectionHeaderStyle = { fontFamily: 'Arial', fontSize: 12, bold: true, fill: '4F81BD', fontColor: 'FFFFFF', verticalAlignment: 'center' };
        const tableHeaderStyle = { fontFamily: 'Arial', fontSize: 10, bold: true, fill: 'D9D9D9', border: true };
        const cellStyle = { border: true, verticalAlignment: 'center' };
        const centerCellStyle = { ...cellStyle, horizontalAlignment: 'center' };

        let currentRow = 1;

        // --- Başlık Bölümü ---
        createStyledHeader(sheet, currentRow, `${exam.title} - Analiz Raporu`, titleStyle);
        currentRow += 1;
        createStyledHeader(sheet, currentRow, `${classInfo.name} Sınıfı`, subtitleStyle);
        currentRow += 2; // Boşluk

        // --- Özet ve İstatistikler ---
        sheet.cell(`A${currentRow}`).value("Genel Bakış ve Özet").style(sectionHeaderStyle);
        sheet.range(`A${currentRow}:I${currentRow}`).merged(true);
        currentRow += 1;
        sheet.cell(`A${currentRow}`).value(summaryNote).style({ wrapText: true });
        sheet.range(`A${currentRow}:I${currentRow+1}`).merged(true);
        currentRow += 3;

        sheet.cell(`A${currentRow}`).value("Genel İstatistikler").style(sectionHeaderStyle);
        sheet.range(`A${currentRow}:D${currentRow}`).merged(true);
        currentRow += 1;
        sheet.cell(`A${currentRow}`).value([["Kayıtlı Öğrenci", stats.totalStudents], ["Sınava Giren", stats.participatingStudents], ["Başarılı Öğrenci", stats.successfulStudents], ["Genel Başarı", `%${stats.overallSuccessPercentage.toFixed(1)}`]]);
        sheet.range(`A${currentRow}:B${currentRow+3}`).style({ border: true });
        currentRow += 5;
        
        // --- Öğrenci Sonuçları Tablosu ---
        sheet.cell(`A${currentRow}`).value("Öğrenci Sonuçları").style(sectionHeaderStyle);
        sheet.range(`A${currentRow}:D${currentRow}`).merged(true);
        currentRow += 1;
        const studentHeaders = ["Öğrenci Adı", "Öğrenci No", "Toplam Puan", "Durum"];
        sheet.row(currentRow).cell(1).value([studentHeaders]).style(tableHeaderStyle);
        studentResults.forEach((s: any) => {
            currentRow += 1;
            sheet.row(currentRow).cell(1).value([s.name, s.studentNumber, s.totalScore, s.status]);
        });
        sheet.range(`A${currentRow-studentResults.length}:D${currentRow}`).style(cellStyle);
        sheet.range(`C${currentRow-studentResults.length}:D${currentRow}`).style({ horizontalAlignment: 'center' });
        currentRow += 2;

        // --- Analiz Tabloları (Yan Yana) ---
        const analysisRowStart = currentRow;
        sheet.cell(`A${analysisRowStart}`).value("Soru Bazında Analiz").style(sectionHeaderStyle);
        sheet.range(`A${analysisRowStart}:C${analysisRowStart}`).merged(true);
        sheet.cell(`E${analysisRowStart}`).value("Kazanım Bazında Analiz").style(sectionHeaderStyle);
        sheet.range(`E${analysisRowStart}:G${analysisRowStart}`).merged(true);
        currentRow += 1;

        // Soru Analiz Tablosu
        sheet.row(currentRow).cell(1).value([["Soru No", "Ort. Puan", "Başarı %"]]).style(tableHeaderStyle);
        let questionRow = currentRow;
        questionAnalysis.forEach((q: any) => {
            questionRow += 1;
            sheet.row(questionRow).cell(1).value([q.questionNumber, q.averageScore, q.successPercentage]);
        });

        // Kazanım Analiz Tablosu
        sheet.row(currentRow).cell(5).value([["Kazanım", "Başarı %"]]).style(tableHeaderStyle);
        let kazanimRow = currentRow;
        kazanimAnalysis.forEach((k: any) => {
            kazanimRow += 1;
            sheet.row(kazanimRow).cell(5).value([k.kazanim, k.successPercentage]);
        });
        
        const maxRow = Math.max(questionRow, kazanimRow);
        sheet.range(`A${currentRow}:${sheet.cell(maxRow, 3).address()}`).style(cellStyle);
        sheet.range(`E${currentRow}:${sheet.cell(maxRow, 7).address()}`).style(cellStyle);
        currentRow = maxRow + 2;

        // --- GRAFİKLER ---
        const addChart = (title: string, chartId: string, height: number) => {
            if (chartImages[chartId]) {
                sheet.cell(`A${currentRow}`).value(title).style(sectionHeaderStyle);
                sheet.range(`A${currentRow}:I${currentRow}`).merged(true);
                currentRow += 1;
                const imageData = chartImages[chartId].split(',')[1];
                sheet.addImage(imageData, {
                    type: 'base64',
                    anchor: {
                        type: 'twoCellAnchor',
                        from: { col: 1, row: currentRow },
                        to: { col: 8, row: currentRow + height }
                    }
                });
                currentRow += height + 1;
            }
        };
        
        addChart('Öğrenci Puan Dağılımı', 'studentScores', 20); // height: ~400px
        addChart('Soru Başarı Grafiği', 'questionSuccess', 15); // height: ~300px
        addChart('Kazanım Başarı Grafiği', 'kazanimSuccess', 15); // height: ~300px

        // --- Sütun Genişliklerini Ayarla ---
        sheet.column('A').width(25); // Öğrenci Adı / Analizler
        sheet.column('B').width(15); // Öğrenci No / Ort. Puan
        sheet.column('C').width(15); // Toplam Puan / Başarı %
        sheet.column('D').width(12); // Durum
        sheet.column('E').width(30); // Kazanım Adı
        sheet.column('F').width(15); // Kazanım Başarı %
        sheet.column('G').width(15);

        // --- Dosyayı Oluştur ve İndir ---
        const blob = await workbook.outputAsync();
        const fileName = `${classInfo.name}_${exam.title}_Raporu.xlsx`.replace(/[^a-zA-Z0-9_.-]/g, '-');
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

    } catch (error) {
        console.error("Excel raporu oluşturulurken bir hata oluştu:", error);
        alert("Excel raporu oluşturulurken beklenmedik bir hata oluştu.");
    }
};