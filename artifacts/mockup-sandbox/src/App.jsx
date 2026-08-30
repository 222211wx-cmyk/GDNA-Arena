import { useState } from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';

// K1: ديوان الادوات
function RoyalToolsDrawer() {
  const [open, setOpen] = useState(false);
  const tools = ["😀 الرموز","👔 شوميزي","📷 عدسة","🎤 صوت","📁 ملف","🖼️ معرض","📄 وثيقة","👤 بطاقة"]
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="text-[24px] text-gray-400">+</button>
      {open && <div className="absolute bottom-[70px] bg-[#1a1a1a] rounded-[20px] p-4 grid-cols-4 gap-4 z-50">
        {tools.map(t => <div key={t} className="text-center text-[12px]">{t}</div>)}
      </div>}
    </div>
  )
}

// K2: قائمة ديوان الملك
function RoyalMenu() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="text-[20px] text-[#D4AF37]">⋮</button>
      {open && <div className="absolute top-[50px] right-0 bg-[#1a1a1a] w-[240px] rounded-[12px] p-2 z-50">
        {["كتيبة جديدة","قبيلة جديدة","بلاغ جديد"].map(i => <div key={i} className="p-2 hover:bg-[#D4AF37] hover:text-black rounded">{i}</div>)}
      </div>}
    </div>
  )
}

// K3: الشريط التحتاني
function BottomNav({ active }) {
  const nav = useNavigate();
  const tabs = [["/","💬","ظبيش"],["/decree","📜","البلاغ"],["/tribes","👑","القبائل"],["/calls","⚔️","مجلس الحرب"],["/profile","👤","هويتي"]]
  return (
    <nav className="fixed bottom-0 w-full h-[72px] bg-[#0a0a0a] flex justify-around items-center border-t border-[#1a1a1a]">
      {tabs.map(([p,i,n]) => <button key={p} onClick={() => nav(p)} className={active===p?'text-[#D4AF37]':'text-gray-400'}><div className="text-[26px]">{i}</div><div className="text-[12px]">{n}</div></button>)}
    </nav>
  )
}

// K4: صفحة ظبيش الرئيسية
function ArenaHome() {
  const nav = useNavigate();
  return <div className="bg-[#0a0a0a] h-screen text-white pb-[72px]">
    <header className="h-[60px] flex justify-between items-center px-4"><h1 className="text-[22px] text-[#D4AF37]">ظبيش</h1><RoyalMenu/></header>
    <div className="p-4"><div onClick={() => nav('/chat/1')} className="p-3 bg-[#1a1a1a] rounded cursor-pointer">Rachid Ait Mnssour</div></div>
    <BottomNav active="/"/>
  </div>
}

// K5: صفحة المحادثة
function ChatPage() {
  const nav = useNavigate();
  return <div className="bg-[#0a0a0a] h-screen text-white flex-col">
    <header className="h-[60px] flex items-center px-4 gap-3 bg-[#1a1a1a]"><button onClick={() => nav('/')} className="text-[24px] text-[#D4AF37]">←</button><p>Rachid</p></header>
    <div className="flex-1 p-4"></div>
    <div className="h-[64px] bg-[#1a1a1a] flex items-center px-3 gap-2"><RoyalToolsDrawer/><input placeholder="مراسلة ظبيش..." className="flex-1 h-[44px] bg-[#0a0a0a] rounded-[22px] px-4"/><button className="w-[48px] h-[48px] bg-[#D4AF37] rounded-full">🎤</button></div>
  </div>
}

// K6: صفحة البلاغ الملكي
function RoyalDecreePage() {return <div className="bg-[#0a0a0a] h-screen text-white pb-[72px]"><header className="h-[60px] flex items-center px-4"><h1 className="text-[#D4AF37]">البلاغ الملكي</h1></header><BottomNav active="/decree"/></div>}

// K7: صفحة القبائل
function TribesPage() {return <div className="bg-[#0a0a0a] h-screen text-white pb-[72px]"><header className="h-[60px] flex items-center px-4"><h1 className="text-[#D4AF37]">القبائل</h1></header><BottomNav active="/tribes"/></div>}

// K8: صفحة مجلس الحرب
function WarCouncilPage() {return <div className="bg-[#0a0a0a] h-screen text-white pb-[72px]"><header className="h-[60px] flex items-center px-4"><h1 className="text-[#D4AF37]">مجلس الحرب</h1></header><BottomNav active="/calls"/></div>}

// K9: الربط
export default function App() {
  return <BrowserRouter basename={import.meta.env.BASE_URL}>
    <Routes>
      <Route path="/" element={<ArenaHome />} />
      <Route path="/chat/:id" element={<ChatPage />} />
      <Route path="/decree" element={<RoyalDecreePage />} />
      <Route path="/tribes" element={<TribesPage />} />
      <Route path="/calls" element={<WarCouncilPage />} />
    </Routes>
  </BrowserRouter>
}