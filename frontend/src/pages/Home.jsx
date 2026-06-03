import React from 'react';
import { motion } from 'framer-motion';
import { 
  Code2, 
  Zap, 
  ShieldAlert, 
  HelpCircle, 
  TrendingUp, 
  ArrowRight, 
  Play,
  Terminal,
  Sparkles
} from 'lucide-react';

export default function Home({ navigate }) {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.15 }
    }
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: { y: 0, opacity: 1, transition: { duration: 0.5, ease: 'easeOut' } }
  };

  return (
    <div className="relative min-h-[calc(100vh-4rem)] flex flex-col justify-between py-12 px-6">
      {/* Background gradients */}
      <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-96 h-96 glow-spot-blue rounded-full pointer-events-none opacity-40" />
      <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-96 h-96 glow-spot-cyan rounded-full pointer-events-none opacity-30" />

      {/* HERO SECTION */}
      <motion.div 
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="max-w-4xl mx-auto text-center space-y-6 z-10"
      >
        <motion.div 
          variants={itemVariants}
          className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-blue-950/40 border border-blue-900/40 rounded-full text-xs font-mono text-blue-400"
        >
          <Terminal className="w-3.5 h-3.5 animate-pulse text-blue-400" />
          AI-POWERED BEGINNER SYNTAX & QUALITY SHIELD
        </motion.div>

        <motion.h1 
          variants={itemVariants}
          className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-b from-white via-slate-100 to-blue-400 leading-tight"
        >
          Validate Syntax & Detect Beginner Coding Flaws.
        </motion.h1>

        <motion.p 
          variants={itemVariants}
          className="text-slate-400 text-sm sm:text-base md:text-lg max-w-2xl mx-auto leading-relaxed font-sans"
        >
          Submit your Java, Python, or JavaScript coding practice snippets. Instantly audit compilation errors, missing semicolons, unmatched brackets, and keyword spelling typos, explained simply by your virtual coding mentor.
        </motion.p>

        <motion.div 
          variants={itemVariants}
          className="pt-6 flex flex-col sm:flex-row gap-4 justify-center items-center"
        >
          <button 
            onClick={() => navigate('review')}
            className="flex items-center gap-2 px-8 py-4 bg-blue-500 hover:bg-blue-400 text-slate-950 rounded-xl font-mono text-sm font-bold shadow-[0_0_20px_rgba(59,130,246,0.35)] hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
          >
            Start Code Review
            <ArrowRight className="w-4 h-4" />
          </button>
          <button 
            onClick={() => navigate('about')}
            className="flex items-center gap-2 px-8 py-4 bg-slate-950 hover:bg-slate-900 border border-slate-800 text-slate-300 rounded-xl font-mono text-sm transition-all cursor-pointer"
          >
            Examine App Structure
          </button>
        </motion.div>
      </motion.div>

      {/* CORE FEATURES GRID */}
      <motion.div 
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.6 }}
        className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mt-16 md:mt-24 z-10 w-full"
      >
        <div className="glass-card border-slate-900 rounded-2xl p-6 hover:border-slate-800 transition-colors group">
          <div className="w-10 h-10 bg-slate-950 border border-slate-900 rounded-xl flex items-center justify-center mb-4 group-hover:border-blue-500/50 transition-colors">
            <Terminal className="w-5 h-5 text-blue-400" />
          </div>
          <h3 className="text-sm font-mono font-bold text-slate-200 mb-1.5 uppercase">Syntax Checkers</h3>
          <p className="text-slate-450 text-[11px] leading-relaxed font-sans">
            Runs local Node VM and Python AST syntax engines to catch compile errors instantly.
          </p>
        </div>

        <div className="glass-card border-slate-900 rounded-2xl p-6 hover:border-slate-800 transition-colors group">
          <div className="w-10 h-10 bg-slate-950 border border-slate-900 rounded-xl flex items-center justify-center mb-4 group-hover:border-blue-500/50 transition-colors">
            <ShieldAlert className="w-5 h-5 text-rose-400" />
          </div>
          <h3 className="text-sm font-mono font-bold text-slate-200 mb-1.5 uppercase">Line Highlights</h3>
          <p className="text-slate-450 text-[11px] leading-relaxed font-sans">
            Automatically highlights syntactically incorrect lines in red inside the Monaco Editor.
          </p>
        </div>

        <div className="glass-card border-slate-900 rounded-2xl p-6 hover:border-slate-800 transition-colors group">
          <div className="w-10 h-10 bg-slate-950 border border-slate-900 rounded-xl flex items-center justify-center mb-4 group-hover:border-blue-500/50 transition-colors">
            <Sparkles className="w-5 h-5 text-amber-400" />
          </div>
          <h3 className="text-sm font-mono font-bold text-slate-200 mb-1.5 uppercase">Mentor Explains</h3>
          <p className="text-slate-450 text-[11px] leading-relaxed font-sans">
            Translates cryptic terminal compiler exceptions into simple, encouraging mentor notes.
          </p>
        </div>

        <div className="glass-card border-slate-900 rounded-2xl p-6 hover:border-slate-800 transition-colors group">
          <div className="w-10 h-10 bg-slate-950 border border-slate-900 rounded-xl flex items-center justify-center mb-4 group-hover:border-blue-500/50 transition-colors">
            <Code2 className="w-5 h-5 text-emerald-400" />
          </div>
          <h3 className="text-sm font-mono font-bold text-slate-200 mb-1.5 uppercase">Corrected Syntax</h3>
          <p className="text-slate-450 text-[11px] leading-relaxed font-sans">
            Emits beautifully formatted, fully corrected codeblocks ready for copy-to-clipboard.
          </p>
        </div>
      </motion.div>

      {/* FOOTER */}
      <footer className="w-full text-center text-[10px] font-mono text-slate-650 mt-16 md:mt-24">
        © {new Date().getFullYear()} AegisSyntax Engine. Sandboxed educational framework.
      </footer>
    </div>
  );
}
