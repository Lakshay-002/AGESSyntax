import React from 'react';
import { motion } from 'framer-motion';
import { Terminal, Shield, BookOpen, Layers, Cpu, Code2 } from 'lucide-react';

export default function About() {
  const containerVariants = {
    hidden: { opacity: 0, y: 15 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5, staggerChildren: 0.1 } }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 10 },
    visible: { opacity: 1, y: 0 }
  };

  return (
    <div className="max-w-4xl mx-auto py-8 px-6 space-y-8 animate-fadeIn">
      {/* HEADER */}
      <div>
        <h2 className="text-xl font-bold font-mono text-slate-100 flex items-center gap-2">
          <Terminal className="w-5 h-5 text-blue-400" />
          ABOUT THE PLATFORM
        </h2>
        <p className="text-slate-400 text-xs mt-1 font-mono">
          Architectural specs and student review guides.
        </p>
      </div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="space-y-8"
      >
        {/* DESIGN INTENT */}
        <motion.div variants={itemVariants} className="glass-card border-slate-900 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2.5 border-b border-slate-900 pb-3">
            <BookOpen className="w-4 h-4 text-blue-400" />
            <h3 className="font-mono text-xs font-bold text-slate-200 uppercase tracking-widest">
              Educational Intent
            </h3>
          </div>
          <p className="text-slate-400 text-xs leading-relaxed font-sans">
            AegisDSA is designed to be the ultimate companion for students preparing for tech interviews and competitive coding contests. Instead of just showing standard solutions, the scanner highlights **algorithmic inefficiencies**, **Big-O calculations**, and **interview traps** in a highly visual dashboard. The codebase is kept extremely clear, modular, and dependency-light so any student can explain and defend it in university reviews.
          </p>
        </motion.div>

        {/* TECH STACK DETAIL */}
        <motion.div variants={itemVariants} className="glass-card border-slate-900 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2.5 border-b border-slate-900 pb-3">
            <Layers className="w-4 h-4 text-blue-400" />
            <h3 className="font-mono text-xs font-bold text-slate-200 uppercase tracking-widest">
              Tech Stack Specifications
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1 font-mono text-xs">
            <div className="p-4 bg-slate-950/80 border border-slate-900 rounded-xl space-y-2">
              <span className="text-blue-400 font-bold block uppercase text-[10px]">Frontend Core</span>
              <ul className="space-y-1.5 text-slate-450 text-[11px]">
                <li>• React.js (Component-driven SPA)</li>
                <li>• Vite Bundler (Lightning fast dev hot-reloads)</li>
                <li>• Tailwind CSS v4 (Obsidian glass aesthetics)</li>
                <li>• Framer Motion (State transition animations)</li>
                <li>• Monaco Editor (Syntax highlighted text inputs)</li>
              </ul>
            </div>

            <div className="p-4 bg-slate-950/80 border border-slate-900 rounded-xl space-y-2">
              <span className="text-blue-400 font-bold block uppercase text-[10px]">Backend Core</span>
              <ul className="space-y-1.5 text-slate-450 text-[11px]">
                <li>• Node.js runtime environment</li>
                <li>• Express.js router framework</li>
                <li>• CORS & Dotenv integrations</li>
                <li>• Google Gemini AI SDK REST controllers</li>
                <li>• Auto-Sandbox offline fallbacks</li>
              </ul>
            </div>
          </div>
        </motion.div>

        {/* DSA FOCUS MATRIX */}
        <motion.div variants={itemVariants} className="glass-card border-slate-900 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2.5 border-b border-slate-900 pb-3">
            <Cpu className="w-4 h-4 text-blue-400" />
            <h3 className="font-mono text-xs font-bold text-slate-200 uppercase tracking-widest">
              Target Auditing Parameters
            </h3>
          </div>

          <p className="text-slate-400 text-xs leading-relaxed">
            The platform provides structured feedback specifically mapped to competitive programming contests (CodeChef) and interviews:
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-mono text-[10px] pt-1">
            <div className="p-3 bg-slate-950/60 border border-slate-900 rounded-xl">
              <span className="text-rose-400 font-bold block mb-1">LOGIC DEFECTS</span>
              Tracks indices overlaps, recursive base case omissions, off-by-one loops, and null references.
            </div>
            <div className="p-3 bg-slate-950/60 border border-slate-900 rounded-xl">
              <span className="text-amber-400 font-bold block mb-1">BIG-O EXPLAINERS</span>
              Differentiates time vs space costs, mapping mathematical linear/exponential curves.
            </div>
            <div className="p-3 bg-slate-950/60 border border-slate-900 rounded-xl">
              <span className="text-emerald-400 font-bold block mb-1">OPTIMIZED CODE</span>
              Generates beautifully refactored solutions containing clean inline comments explaining data structures.
            </div>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
