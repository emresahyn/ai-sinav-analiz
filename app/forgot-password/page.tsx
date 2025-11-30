
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/app/context/AuthContext';
import { Mail, Loader2, CheckCircle } from 'lucide-react';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const { sendPasswordResetEmail } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await sendPasswordResetEmail(email);
      setSent(true);
    } catch (err: any) {
      setError(err.message || 'Şifre sıfırlama maili gönderilemedi. Lütfen tekrar deneyin.');
    }
    setLoading(false);
  };

  return (
    <div className="bg-light d-flex align-items-center justify-content-center vh-100">
      <div className="container">
        <div className="row justify-content-center">
          <div className="col-12 col-md-8 col-lg-6 col-xl-5">
            <div className="card border-0 shadow-lg">
              <div className="card-body p-4 p-md-5">
                <div className="text-center mb-4">
                  <h1 className="h3 fw-bold">Şifremi Unuttum</h1>
                  <p className="text-muted">Sıfırlama bağlantısı göndereceğimiz e-posta adresinizi girin.</p>
                </div>

                {sent ? (
                  <div className="text-center p-4 bg-light-success rounded">
                    <CheckCircle className="text-success mx-auto mb-3" size={48} />
                    <h4 className="fw-bold">E-posta Gönderildi!</h4>
                    <p className="text-muted">Lütfen gelen kutunuzu kontrol edin ve şifrenizi sıfırlamak için talimatları izleyin.</p>
                    <Link href="/login" className="btn btn-primary mt-3">Giriş Yap Sayfasına Dön</Link>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit}>
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

                    {error && <div className="alert alert-danger p-2 small">{error}</div>}

                    <div className="d-grid">
                      <button type="submit" className="btn btn-primary btn-lg" disabled={loading}>
                        {loading ? <Loader2 className="animate-spin me-2" /> : <Mail className="me-2" />} 
                        Sıfırlama Linki Gönder
                      </button>
                    </div>
                  </form>
                )}

                {!sent && (
                  <div className="text-center mt-4">
                    <Link href="/login" className="text-decoration-none">Giriş yapmaya geri dön</Link>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
