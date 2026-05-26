import React, { useState } from 'react';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import Review from './pages/Review';
import About from './pages/About';

export default function App() {
  // Simple state-based router - 100% resilient and beginner-friendly!
  const [currentPage, setCurrentPage] = useState('home');

  const renderPage = () => {
    switch (currentPage) {
      case 'home':
        return <Home navigate={setCurrentPage} />;
      case 'review':
        return <Review />;
      case 'about':
        return <About />;
      default:
        return <Home navigate={setCurrentPage} />;
    }
  };

  return (
    <div className="relative min-h-screen bg-[#020617] text-slate-100 bg-dot-dsa overflow-x-hidden flex flex-col justify-between">
      {/* Background glowing nodes */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] glow-spot-blue rounded-full pointer-events-none opacity-20" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] glow-spot-cyan rounded-full pointer-events-none opacity-15" />

      {/* GLOBAL NAVBAR */}
      <Navbar currentPage={currentPage} setCurrentPage={setCurrentPage} />

      {/* CURRENT PAGE PAYLOAD */}
      <main className="flex-1 w-full max-w-7xl mx-auto py-6">
        {renderPage()}
      </main>
    </div>
  );
}
