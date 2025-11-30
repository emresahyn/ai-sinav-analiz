
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Loader2, LogIn } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // Başarılı girişten sonra AuthProvider yönlendirmeyi otomatik yapacak
    } catch (error: any) {
      setError('Giriş başarısız. Lütfen e-postanızı ve şifrenizi kontrol edin.');
      setLoading(false);
    }
  };

  return (
    <div className="bg-light d-flex align-items-center justify-content-center vh-100">
      <div className="container">
        <div className="row justify-content-center">
          <div className="col-12 col-md-8 col-lg-6 col-xl-5">
            <div className="card border-0 shadow-lg">
              <div className="card-body p-4 p-md-5">
                <div className="text-center mb-4">
                  <h1 className="h3 fw-bold">Hoş Geldiniz!</h1>
                  <p className="text-muted">Devam etmek için giriş yapın.</p>
                </div>

                <form onSubmit={handleLogin}>
                    {error && <div className="alert alert-danger p-2 small mb-3">{error}</div>}

                    <div className="form-floating mb-3">
                        <input
                        type="email"
                        className="form-control"
                        id="email"
                        placeholder="E-posta Adresiniz"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        />
                        <label htmlFor="email">E-posta Adresiniz</label>
                    </div>

                    <div className="form-floating mb-3">
                        <input
                        type="password"
                        className="form-control"
                        id="password"
                        placeholder="Şifreniz"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        />
                        <label htmlFor="password">Şifreniz</label>
                    </div>

                    <div className="d-flex justify-content-end mb-3">
                        <Link href="/forgot-password" className="text-decoration-none small">Şifremi Unuttum?</Link>
                    </div>

                    <div className="d-grid">
                        <button type="submit" disabled={loading} className="btn btn-primary btn-lg">
                            {loading ? <Loader2 className="animate-spin me-2" /> : <LogIn className="me-2"/>}
                            Giriş Yap
                        </button>
                    </div>
                </form>

                <div className="text-center mt-4">
                    <p className="text-muted small">
                        Hesabınız yok mu? <Link href="/signup" className="text-decoration-none">Hemen Kayıt Olun</Link>
                    </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
