import AnalysisClientPage from './client';

// Bu artık bir Sunucu Bileşeni (Server Component)
// Görevi, URL'den parametreyi okuyup istemci bileşenine aktarmaktır.
export default function Page({ params }: { params: { id: string } }) {
  // URL'den gelen 'id' parametresini alır ve AnalysisClientPage bileşenine prop olarak geçer.
  return <AnalysisClientPage id={params.id} />;
}
