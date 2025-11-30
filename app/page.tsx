
import Link from 'next/link';
import { ArrowRight, BarChart, Users, Zap } from 'lucide-react';

export default function HomePage() {
  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center bg-gray-50 text-gray-800"
    >
      <div className="container mx-auto flex flex-col items-center justify-center space-y-12 px-4 py-24 text-center">
        
        <div className="flex items-center justify-center space-x-4 mb-4">
            <div className="p-3 bg-blue-500/10 rounded-full">
                 <Zap className="h-8 w-8 text-blue-600" />
            </div>
            <div className="p-3 bg-green-500/10 rounded-full">
                <BarChart className="h-8 w-8 text-green-600" />
            </div>
             <div className="p-3 bg-purple-500/10 rounded-full">
                <Users className="h-8 w-8 text-purple-600" />
            </div>
        </div>

        <h1 className="text-5xl font-extrabold tracking-tight sm:text-7xl bg-clip-text bg-gradient-to-r from-gray-900 to-gray-600">
          Yapay Zeka Destekli Sınav Analizi
        </h1>

        <p className="max-w-3xl text-lg text-gray-600 sm:text-xl">
          Öğrenci sınavlarını zahmetsizce analiz edin, performanslarına ilişkin derinlemesine içgörüler kazanın ve yapay zekanın gücüyle öğrenme eksikliklerini anında tespit edin.
        </p>

        <Link href="/dashboard" className="group inline-flex items-center justify-center rounded-full bg-blue-600 px-10 py-4 text-lg font-bold shadow-lg transition-transform duration-300 hover:scale-105 hover:bg-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/50">
            Kontrol Paneline Git
            <ArrowRight className="ml-3 h-6 w-6 transition-transform duration-300 group-hover:translate-x-2" />
        </Link>

        <div className="mt-16 grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-12">
            <div className="flex flex-col items-center space-y-3">
                <div className="p-3 bg-white border border-gray-200 rounded-full shadow-sm">
                    <Zap className="h-7 w-7 text-blue-500"/>
                </div>
                <h3 className="text-xl font-semibold text-gray-900">Anında Analiz</h3>
                <p className="text-gray-500 text-center max-w-xs">
                    Sınav sonuçlarını yükleyin ve saniyeler içinde detaylı raporlar alın.
                </p>
            </div>
            <div className="flex flex-col items-center space-y-3">
                 <div className="p-3 bg-white border border-gray-200 rounded-full shadow-sm">
                    <BarChart className="h-7 w-7 text-green-500"/>
                </div>
                <h3 className="text-xl font-semibold text-gray-900">Görsel Raporlar</h3>
                <p className="text-gray-500 text-center max-w-xs">
                    Anlaşılır grafikler ve tablolar ile öğrenci performansını anında kavrayın.
                </p>
            </div>
            <div className="flex flex-col items-center space-y-3">
                 <div className="p-3 bg-white border border-gray-200 rounded-full shadow-sm">
                    <Users className="h-7 w-7 text-purple-500"/>
                </div>
                <h3 className="text-xl font-semibold text-gray-900">Öğrenci Odaklı</h3>
                 <p className="text-gray-500 text-center max-w-xs">
                    Her bir öğrencinin güçlü ve zayıf yönlerini bireysel olarak takip edin.
                </p>
            </div>
        </div>

      </div>
    </main>
  );
}
