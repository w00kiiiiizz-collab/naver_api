'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useRouter } from 'next/navigation';
import { Lock, Mail, BarChart3, AlertCircle, ArrowRight } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [naverApiKey, setNaverApiKey] = useState('');
  const [naverSecretKey, setNaverSecretKey] = useState('');
  const [naverCustomerId, setNaverCustomerId] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Check if session already exists, if so redirect to home
  useEffect(() => {
    async function checkUser() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        router.push('/');
      }
    }
    checkUser();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      if (isSignUp) {
        // Sign Up user
        const { data, error: signUpErr } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
            data: {
              naver_api_key: naverApiKey,
              naver_secret_key: naverSecretKey,
              naver_customer_id: naverCustomerId,
            }
          },
        });

        if (signUpErr) throw signUpErr;

        if (data.user && data.session === null) {
          setMessage('회원가입 확인 메일이 발송되었습니다. 메일함을 확인해 주세요!');
        } else {
          setMessage('회원가입이 완료되었습니다. 로그인해 주세요!');
          setIsSignUp(false);
        }
      } else {
        // Login user
        const { error: loginErr } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (loginErr) throw loginErr;
        router.push('/');
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || '인증 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-900 flex items-center justify-center p-4 antialiased text-neutral-100 font-sans">
      {/* Background glow effects */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none animate-pulse"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none animate-pulse"></div>

      <div className="w-full max-w-md bg-neutral-950/80 border border-neutral-850 rounded-2xl shadow-2xl p-8 backdrop-blur-md relative z-10">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/20 mb-4">
            <BarChart3 className="text-white" size={24} />
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">NAV AD PERFORMANCE</h2>
          <p className="text-neutral-500 text-xs mt-1">네이버 광고 성과 분석 대시보드</p>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2.5 p-3 bg-red-950/20 border border-red-900/30 rounded-xl text-red-400 text-xs">
            <AlertCircle className="flex-shrink-0 mt-0.5" size={14} />
            <span>{error}</span>
          </div>
        )}

        {message && (
          <div className="mb-4 flex items-start gap-2.5 p-3 bg-blue-950/20 border border-blue-900/30 rounded-xl text-blue-400 text-xs">
            <AlertCircle className="flex-shrink-0 mt-0.5" size={14} />
            <span>{message}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] uppercase font-bold text-neutral-400 mb-1.5 tracking-wider">이메일 주소</label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-500" size={14} />
              <input
                type="email"
                required
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-neutral-900 border border-neutral-800 focus:border-blue-500 rounded-xl text-xs outline-none transition-all text-neutral-200"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase font-bold text-neutral-400 mb-1.5 tracking-wider">비밀번호</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-500" size={14} />
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-neutral-900 border border-neutral-800 focus:border-blue-500 rounded-xl text-xs outline-none transition-all text-neutral-200"
              />
            </div>
          </div>

          {isSignUp && (
            <>
              <div>
                <label className="block text-[10px] uppercase font-bold text-neutral-400 mb-1.5 tracking-wider">네이버 API Key</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-500" size={14} />
                  <input
                    type="text"
                    required
                    placeholder="0100000000..."
                    value={naverApiKey}
                    onChange={(e) => setNaverApiKey(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-neutral-900 border border-neutral-800 focus:border-blue-500 rounded-xl text-xs outline-none transition-all text-neutral-200"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-neutral-400 mb-1.5 tracking-wider">네이버 Secret Key</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-500" size={14} />
                  <input
                    type="password"
                    required
                    placeholder="AQAAAAB..."
                    value={naverSecretKey}
                    onChange={(e) => setNaverSecretKey(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-neutral-900 border border-neutral-800 focus:border-blue-500 rounded-xl text-xs outline-none transition-all text-neutral-200"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-neutral-400 mb-1.5 tracking-wider">네이버 광고주 ID (Customer ID)</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-500" size={14} />
                  <input
                    type="text"
                    required
                    placeholder="1234567"
                    value={naverCustomerId}
                    onChange={(e) => setNaverCustomerId(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-neutral-900 border border-neutral-800 focus:border-blue-500 rounded-xl text-xs outline-none transition-all text-neutral-200"
                  />
                </div>
              </div>
            </>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold rounded-xl shadow-lg transition-all text-xs cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            {loading ? '처리 중...' : isSignUp ? '회원가입' : '로그인'}
            {!loading && <ArrowRight size={14} />}
          </button>
        </form>

        <div className="mt-6 pt-6 border-t border-neutral-900/60 text-center">
          <button
            onClick={() => {
              setIsSignUp(!isSignUp);
              setError(null);
              setMessage(null);
            }}
            className="text-[11px] text-neutral-400 hover:text-white transition-colors cursor-pointer"
          >
            {isSignUp ? '이미 계정이 있으신가요? 로그인하기' : '새로운 계정이 필요하신가요? 회원가입하기'}
          </button>
        </div>
      </div>
    </div>
  );
}
