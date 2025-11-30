
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Loader2, UserPlus } from 'lucide-react';

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError('Şifre en az 6 karakter uzunluğunda olmalıdır.');
      return;
    }
    setLoading(true);
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      // Başarılı kayıt sonrası AuthProvider yönlendirmeyi otomatik yapacak
    } catch (error: any) {
      if (error.code === 'auth/email-already-in-use') {
        setError('Bu e-posta adresi ile zaten bir hesap mevcut.');
      } else {
        setError('Kayıt işlemi başarısız oldu. Lütfen bilgileri kontrol edip tekrar deneyin.');
      }
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
                  <h1 className="h3 fw-bold">Hesap Oluşturun</h1>
                  <p className="text-muted">Sisteme erişim için bilgilerinizi girin.</p>
                </div>

                <form onSubmit={handleSignup}>
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
                        <label htmlFor="password">Şifreniz (en az 6 karakter)</label>
                    </div>

                    <div className="d-grid">
                        <button type="submit" disabled={loading} className="btn btn-primary btn-lg">
                            {loading ? <Loader2 className="animate-spin me-2" /> : <UserPlus className="me-2"/>}
                            Kayıt Ol
                        </button>
                    </div>
                </form>

                <div className="text-center mt-4">
                    <p className="text-muted small">
                        Zaten bir hesabınız var mı? <Link href="/login" className="text-decoration-none">Giriş Yapın</Link>
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
