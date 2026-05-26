import React from 'react';
import { Terminal, Code2, Info, Home } from 'lucide-react';

export default function Navbar({ currentPage, setCurrentPage }) {
  const navItems = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'review', label: 'Syntax Analyzer', icon: Code2 },
    { id: 'about', label: 'About App', icon: Info },
  ];

  return (
    <header className="sticky top-0 w-full h-16 border-b border-slate-900 bg-slate-950/60 backdrop-blur-md z-50">
      <div className="max-w-7xl mx-auto h-full px-6 flex items-center justify-between">
        {/* LOGO */}
        <div 
          onClick={() => setCurrentPage('home')}
          className="flex items-center gap-2 cursor-pointer select-none group"
        >
          <div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center group-hover:border-blue-500 transition-colors">
            <Terminal className="w-4 h-4 text-blue-400 drop-shadow-[0_0_6px_rgba(59,130,246,0.6)]" />
          </div>
          <span className="font-mono text-sm font-bold tracking-widest text-slate-200">
            AEGIS<span className="text-blue-400 font-extrabold">SYNTAX</span>
          </span>
        </div>

        {/* NAVIGATION LINKS */}
        <nav className="flex items-center gap-1 sm:gap-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentPage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setCurrentPage(item.id)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer ${
                  isActive 
                    ? 'bg-blue-950/40 border border-blue-800/80 text-blue-300 shadow-[0_0_12px_rgba(59,130,246,0.15)]' 
                    : 'bg-transparent border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-blue-400' : ''}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
