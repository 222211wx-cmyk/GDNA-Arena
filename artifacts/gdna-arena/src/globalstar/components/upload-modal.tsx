import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Upload, Video, Music, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

interface UploadModalProps {
  open: boolean;
  onClose: () => void;
  onUploaded?: () => void;
}

const CATEGORIES = [
  { value: 'sport',     label: 'الرياضة', icon: '⚽' },
  { value: 'press',     label: 'الصحافة', icon: '📰' },
  { value: 'art',       label: 'الفن',    icon: '🎨' },
  { value: 'knowledge', label: 'المعرفة', icon: '📚' },
];

type Status = 'idle' | 'uploading' | 'success' | 'error';

export function UploadModal({ open, onClose, onUploaded }: UploadModalProps) {
  const [title, setTitle] = useState('');
  const [uploaderName, setUploaderName] = useState(() => localStorage.getItem('empire_citizen_name') ?? '');
  const [category, setCategory] = useState('sport');
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [progress, setProgress] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

  const reset = () => {
    setTitle(''); setFile(null); setStatus('idle'); setErrorMsg(''); setProgress(0);
  };

  const handleClose = () => { reset(); onClose(); };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('video/') && !f.type.startsWith('audio/')) {
      setErrorMsg('الرجاء اختيار ملف فيديو MP4 أو صوت MP3'); return;
    }
    if (f.size > 500 * 1024 * 1024) {
      setErrorMsg('حجم الملف أكبر من 500 ميغابايت'); return;
    }
    setErrorMsg('');
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
  };

  const handleSubmit = async () => {
    if (!file) { setErrorMsg('اختر ملفاً أولاً'); return; }
    if (!title.trim()) { setErrorMsg('أدخل عنوان المحتوى'); return; }
    if (!uploaderName.trim()) { setErrorMsg('أدخل اسمك كمواطن في الإمبراطورية'); return; }

    localStorage.setItem('empire_citizen_name', uploaderName.trim());

    setStatus('uploading');
    setProgress(0);
    setErrorMsg('');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', title.trim());
    formData.append('uploaderName', uploaderName.trim());
    formData.append('category', category);

    try {
      // Simulate progress with XHR for progress tracking
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${BASE}/api/gs/uploads`);
        xhr.withCredentials = true;
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 90));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) { setProgress(100); resolve(); }
          else { reject(new Error(`Server error ${xhr.status}`)); }
        };
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(formData);
      });

      setStatus('success');
      onUploaded?.();
      setTimeout(() => { handleClose(); }, 2500);
    } catch (err) {
      setStatus('error');
      setErrorMsg('فشل الرفع. تحقق من اتصالك وحاول مجدداً.');
    }
  };

  const isVideo = file?.type.startsWith('video/') ?? true;
  const fileSizeMB = file ? (file.size / 1024 / 1024).toFixed(1) : null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="upload-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.92)' }}
          onClick={handleClose}
        >
          <motion.div
            initial={{ scale: 0.88, y: 24 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.88, y: 24 }}
            transition={{ type: 'spring', stiffness: 280, damping: 26 }}
            className="relative w-full max-w-md rounded-2xl overflow-hidden"
            style={{
              background: '#0a0800',
              border: '2px solid #FFD700',
              boxShadow: '0 0 80px rgba(255,215,0,0.25), 0 8px 64px rgba(0,0,0,0.9)',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Gold bar */}
            <div style={{ height: 4, background: 'linear-gradient(90deg, #FFD700, #FFA500, #FFD700)' }} />

            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: 'rgba(255,215,0,0.12)', border: '1px solid rgba(255,215,0,0.3)' }}
                >
                  <Upload className="w-5 h-5" style={{ color: '#FFD700' }} />
                </div>
                <div dir="rtl">
                  <p className="font-black text-white text-base">رفع محتوى سيادي</p>
                  <p className="text-xs" style={{ color: 'rgba(255,215,0,0.5)' }}>EMPIRE ETERNAL · GDNA SERVERS</p>
                </div>
              </div>
              <button onClick={handleClose} className="text-white/40 hover:text-white transition-colors p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div style={{ height: 1, background: 'rgba(255,215,0,0.12)', margin: '0 20px' }} />

            {/* Success state */}
            {status === 'success' ? (
              <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300 }}>
                  <CheckCircle className="w-16 h-16 mb-4" style={{ color: '#FFD700' }} />
                </motion.div>
                <p className="font-black text-white text-xl mb-2">تم الرفع بنجاح!</p>
                <p className="text-sm" style={{ color: 'rgba(255,215,0,0.6)' }}>
                  محتواك الآن جزء من الإمبراطورية
                </p>
              </div>
            ) : (
              <div className="p-5 space-y-4" dir="rtl">

                {/* File picker */}
                <div>
                  <label className="block text-xs font-bold mb-2" style={{ color: 'rgba(255,215,0,0.7)' }}>
                    الملف · MP4 أو MP3 (حتى 500 ميغابايت)
                  </label>
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={status === 'uploading'}
                    className="w-full rounded-xl py-4 flex flex-col items-center gap-2 transition-all hover:opacity-80 disabled:opacity-40"
                    style={{ border: '2px dashed rgba(255,215,0,0.35)', background: 'rgba(255,215,0,0.04)' }}
                  >
                    {file ? (
                      <>
                        <div className="flex items-center gap-2">
                          {isVideo
                            ? <Video className="w-6 h-6" style={{ color: '#FFD700' }} />
                            : <Music className="w-6 h-6" style={{ color: '#FFD700' }} />}
                          <span className="font-bold text-sm text-white truncate max-w-[200px]">{file.name}</span>
                        </div>
                        <span className="text-xs" style={{ color: 'rgba(255,215,0,0.5)' }}>
                          {isVideo ? 'فيديو' : 'صوت'} · {fileSizeMB} MB
                        </span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-8 h-8" style={{ color: 'rgba(255,215,0,0.4)' }} />
                        <span className="text-sm" style={{ color: 'rgba(255,215,0,0.5)' }}>انقر لاختيار الملف</span>
                      </>
                    )}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="video/mp4,video/*,audio/mp3,audio/mpeg,audio/*"
                    className="hidden"
                    onChange={handleFile}
                  />
                </div>

                {/* Title */}
                <div>
                  <label className="block text-xs font-bold mb-1.5" style={{ color: 'rgba(255,215,0,0.7)' }}>
                    عنوان المحتوى
                  </label>
                  <input
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    disabled={status === 'uploading'}
                    placeholder="أدخل عنواناً واضحاً..."
                    className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none transition-all disabled:opacity-40"
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,215,0,0.25)',
                    }}
                  />
                </div>

                {/* Uploader name */}
                <div>
                  <label className="block text-xs font-bold mb-1.5" style={{ color: 'rgba(255,215,0,0.7)' }}>
                    اسمك (هويتك في الإمبراطورية)
                  </label>
                  <input
                    value={uploaderName}
                    onChange={e => setUploaderName(e.target.value)}
                    disabled={status === 'uploading'}
                    placeholder="مثال: أبو الفتح الإمبراطوري"
                    className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none transition-all disabled:opacity-40"
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,215,0,0.25)',
                    }}
                  />
                </div>

                {/* Category */}
                <div>
                  <label className="block text-xs font-bold mb-1.5" style={{ color: 'rgba(255,215,0,0.7)' }}>
                    التصنيف
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {CATEGORIES.map(c => (
                      <button
                        key={c.value}
                        onClick={() => setCategory(c.value)}
                        disabled={status === 'uploading'}
                        className="rounded-xl py-2 text-center transition-all hover:opacity-80 disabled:opacity-40"
                        style={category === c.value
                          ? { background: '#FFD700', color: '#000' }
                          : { background: 'rgba(255,215,0,0.06)', border: '1px solid rgba(255,215,0,0.2)', color: 'rgba(255,215,0,0.7)' }
                        }
                      >
                        <div className="text-lg">{c.icon}</div>
                        <div className="text-xs font-bold">{c.label}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Error */}
                {errorMsg && (
                  <div className="flex items-center gap-2 rounded-xl px-4 py-3"
                    style={{ background: 'rgba(255,50,50,0.1)', border: '1px solid rgba(255,50,50,0.3)' }}>
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                    <p className="text-sm text-red-400">{errorMsg}</p>
                  </div>
                )}

                {/* Progress */}
                {status === 'uploading' && (
                  <div>
                    <div className="flex justify-between text-xs mb-1.5" style={{ color: 'rgba(255,215,0,0.6)' }}>
                      <span>جارٍ الرفع...</span>
                      <span>{progress}%</span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,215,0,0.1)' }}>
                      <motion.div
                        className="h-full rounded-full"
                        style={{ background: 'linear-gradient(90deg, #FFD700, #FFA500)' }}
                        animate={{ width: `${progress}%` }}
                        transition={{ duration: 0.3 }}
                      />
                    </div>
                  </div>
                )}

                {/* Submit */}
                <button
                  onClick={handleSubmit}
                  disabled={status === 'uploading' || !file}
                  className="w-full rounded-xl py-3.5 font-black text-black text-base transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-40 flex items-center justify-center gap-2"
                  style={{ background: '#FFD700' }}
                >
                  {status === 'uploading' ? (
                    <><Loader2 className="w-5 h-5 animate-spin" /> جارٍ الرفع...</>
                  ) : (
                    <><Upload className="w-5 h-5" /> رفع المحتوى</>
                  )}
                </button>

                <p className="text-center text-xs" style={{ color: 'rgba(255,215,0,0.3)' }}>
                  كل 100 مشاهدة = 1 عملة ذهبية · أرباحك تُحسب تلقائياً
                </p>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
