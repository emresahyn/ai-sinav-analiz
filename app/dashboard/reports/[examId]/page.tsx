import ReportClientPage from './client';

// Sunucu Bileşeni: URL'den parametreyi alır ve istemciye aktarır.
export default function ReportPage({ params }: { params: { examId: string } }) {
  // URL'den gelen 'examId' parametresini alır ve ReportClientPage bileşenine prop olarak geçer.
  return <ReportClientPage examId={params.examId} />;
}
