import { saveAs } from 'file-saver';
import {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    Table,
    TableRow,
    TableCell,
    WidthType,
    AlignmentType,
    VerticalAlign,
    ImageRun,
    IStylesOptions,
} from 'docx';

const base64ToUint8Array = (base64: string): Uint8Array | null => {
    try {
        const binaryString = window.atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    } catch (error) {
        console.error("Base64 çözme hatası:", error);
        return null;
    }
};

export const exportReportToWord = async (reportData: any, chartImages: { [key: string]: string }) => {
    if (!reportData) {
        alert("Dışa aktarılacak veri bulunamadı!");
        return;
    }

    const { exam, classInfo, studentResults, questionAnalysis, kazanimAnalysis, summaryNote } = reportData;

    const createChartParagraph = (base64Image: string, width: number, height: number) => {
        if (!base64Image || base64Image.indexOf(',') === -1) {
            return new Paragraph({ text: "Geçersiz veya eksik grafik verisi.", style: "aside" });
        }

        const imageDataString = base64Image.split(',')[1];
        const imageBytes = base64ToUint8Array(imageDataString);

        if (!imageBytes) {
            return new Paragraph({ text: "Grafik işlenirken bir hata oluştu.", style: "aside" });
        }

        // @ts-ignore - Projedeki eski docx sürümünün tip tanımlamaları hatalı olduğu için bu satırı yoksay.
        const image = new ImageRun({
            data: imageBytes,
            transformation: { 
                width: width,
                height: height,
            },
        });

        return new Paragraph({
            children: [image],
            alignment: AlignmentType.CENTER,
        });
    };

    const styles: IStylesOptions = {
        default: {
            document: { run: { size: "11pt", font: "Calibri" }, paragraph: { spacing: { after: 120 } } },
            heading1: { run: { size: "18pt", bold: true, color: "2E74B5" }, paragraph: { spacing: { before: 240, after: 120 }, alignment: AlignmentType.CENTER } },
            heading2: { run: { size: "14pt", bold: true, color: "2E74B5" }, paragraph: { spacing: { before: 360, after: 120 } } },
            heading3: { run: { size: "12pt", bold: true, color: "4F81BD" }, paragraph: { spacing: { before: 240, after: 120 } } },
        },
        paragraphStyles: [
            { id: "summary", name: "Summary", basedOn: "Normal", run: { italics: true, color: "595959" }, paragraph: { alignment: AlignmentType.CENTER, spacing: { after: 240 } } },
            { id: "aside", name: "Aside", basedOn: "Normal", run: { color: "808080", italics: true }, paragraph: { alignment: AlignmentType.CENTER, spacing: { after: 240 } } },
        ],
    };

    const tableHeaderText = (text: string) => new Paragraph({ children: [new TextRun({ text, bold: true, color: "FFFFFF" })], alignment: AlignmentType.CENTER });
    
    const getStatusRun = (status: string) => {
      let color = "000000";
      if (status === 'Başarılı') color = "28a745";
      if (status === 'Başarısız') color = "dc3545";
      if (status === 'Girmedi') color = "6c757d";
      return new TextRun({ text: status, color, bold: true });
    }

    const studentTableRows = [
        new TableRow({
            children: [
                new TableCell({ children: [tableHeaderText("Öğrenci Adı")], shading: { fill: "4F81BD" }, verticalAlign: VerticalAlign.CENTER }),
                new TableCell({ children: [tableHeaderText("Toplam Puan")], shading: { fill: "4F81BD" }, verticalAlign: VerticalAlign.CENTER }),
                new TableCell({ children: [tableHeaderText("Durum")], shading: { fill: "4F81BD" }, verticalAlign: VerticalAlign.CENTER }),
            ],
            tableHeader: true,
        }),
        ...studentResults.map((s: any) => new TableRow({
            children: [
                new TableCell({ children: [new Paragraph(`${s.name} (${s.studentNumber})`)], verticalAlign: VerticalAlign.CENTER }),
                new TableCell({ children: [new Paragraph({ text: s.totalScore !== null ? String(s.totalScore) : '-', alignment: AlignmentType.CENTER })], verticalAlign: VerticalAlign.CENTER }),
                new TableCell({ children: [new Paragraph({ children: [getStatusRun(s.status)], alignment: AlignmentType.CENTER })], verticalAlign: VerticalAlign.CENTER }),
            ]
        }))
    ];

    const questionAnalysisTableRows = [
        new TableRow({
            children: [
                new TableCell({ children: [tableHeaderText("Soru No")], shading: { fill: "4F81BD" }, verticalAlign: VerticalAlign.CENTER }),
                new TableCell({ children: [tableHeaderText("Başarı %")], shading: { fill: "4F81BD" }, verticalAlign: VerticalAlign.CENTER }),
            ],
            tableHeader: true,
        }),
        ...questionAnalysis.map((q: any) => new TableRow({
            children: [
                new TableCell({ children: [new Paragraph({ text: String(q.questionNumber), alignment: AlignmentType.CENTER })], verticalAlign: VerticalAlign.CENTER }),
                new TableCell({ children: [new Paragraph({ text: `${q.successPercentage.toFixed(1)}%`, alignment: AlignmentType.CENTER })], verticalAlign: VerticalAlign.CENTER }),
            ]
        }))
    ];

    const kazanimAnalysisTableRows = kazanimAnalysis.length > 0 ? [
        new TableRow({
            children: [
                new TableCell({ children: [tableHeaderText("Kazanım")], shading: { fill: "4F81BD" }, verticalAlign: VerticalAlign.CENTER }),
                new TableCell({ children: [tableHeaderText("Başarı %")], shading: { fill: "4F81BD" }, verticalAlign: VerticalAlign.CENTER }),
            ],
            tableHeader: true,
        }),
        ...kazanimAnalysis.map((k: any) => new TableRow({
            children: [
                new TableCell({ children: [new Paragraph(k.kazanim)], verticalAlign: VerticalAlign.CENTER }),
                new TableCell({ children: [new Paragraph({ text: `${k.successPercentage.toFixed(1)}%`, alignment: AlignmentType.CENTER })], verticalAlign: VerticalAlign.CENTER }),
            ]
        }))
    ] : [];

    const doc = new Document({
        styles,
        sections: [{
            children: [
                new Paragraph({ text: exam.title, heading: HeadingLevel.HEADING_1 }),
                new Paragraph({ text: `${classInfo.name} Sınıfı Analiz Raporu`, style: "summary" }),
                new Paragraph({ text: "Genel Değerlendirme", heading: HeadingLevel.HEADING_2 }),
                new Paragraph(summaryNote || ""),
                new Paragraph({ text: "Öğrenci Sonuçları", heading: HeadingLevel.HEADING_2 }),
                new Table({ rows: studentTableRows, width: { size: 100, type: WidthType.PERCENTAGE } }),
                new Paragraph({ text: "Analizler", heading: HeadingLevel.HEADING_2 }),
                new Paragraph({ text: "Soru Bazında Başarı", heading: HeadingLevel.HEADING_3 }),
                new Table({ rows: questionAnalysisTableRows, width: { size: 50, type: WidthType.PERCENTAGE } }),
                new Paragraph({}),
                 ...(kazanimAnalysisTableRows.length > 0 ? [
                    new Paragraph({ text: "Kazanım Bazında Başarı", heading: HeadingLevel.HEADING_3 }),
                    new Table({ rows: kazanimAnalysisTableRows, width: { size: 100, type: WidthType.PERCENTAGE } }),
                ] : []),
                new Paragraph({ text: "Grafikler", heading: HeadingLevel.HEADING_2 }),
                createChartParagraph(chartImages.studentScores, 550, 300),
                new Paragraph({ text: "Öğrenci Puan Dağılımı Grafiği", style: "aside" }),
                new Paragraph({}),
                createChartParagraph(chartImages.questionSuccess, 550, 400),
                new Paragraph({ text: "Soru Başarı Grafiği (Yüzdesel)", style: "aside" }),
                ...(kazanimAnalysis && kazanimAnalysis.length > 0 ? [
                    new Paragraph({}),
                    createChartParagraph(chartImages.kazanimSuccess, 550, 400),
                    new Paragraph({ text: "Kazanım Başarı Grafiği (Yüzdesel)", style: "aside" }),
                ] : []),
            ],
        }],
    });
    
    try {
        const blob = await Packer.toBlob(doc);
        const fileName = `${classInfo.name}_${exam.title}_Raporu.docx`.replace(/[^a-zA-Z0-9_.-]/g, '-');
        saveAs(blob, fileName);
    } catch(e) {
        console.error("Word dosyası oluşturma/indirme hatası:", e);
        alert("Word raporu oluşturulurken beklenmedik bir hata meydana geldi. Lütfen tarayıcı konsolunu kontrol edin.");
    }
};