import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { TargetBuilder } from './views/TargetBuilder';
import { Imports } from './views/Imports';
import { Lists } from './views/Lists';
import { Settings } from './views/Settings';
import { IntelligenceHome } from './views/IntelligenceHome';
import { Database } from './views/Database';
import { ClientWorkspace } from './views/ClientWorkspace';
import { Campaigns } from './views/Campaigns';
import { ErrorBoundary } from './components/ErrorBoundary';
import { View } from './types';
import { SessionGate } from './components/Session';

const ROUTES: View[] = [
  'builder',
  'home',
  'lists',
  'contacts',
  'clients',
  'campaigns',
  'import',
  'settings',
];

function viewFromHash(hash: string): View {
  const candidate = hash.replace(/^#/, '') as View;
  return ROUTES.includes(candidate) ? candidate : 'builder';
}

export default function App() {
  const [currentView, setCurrentView] = useState<View>(() => viewFromHash(window.location.hash));
  const navigate = (view: View) => { setCurrentView(view); window.history.replaceState(null,'',`#${view}`); };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        navigate('builder');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const renderView = () => {
    switch (currentView) {
      case 'builder': return <TargetBuilder onOpenLists={() => navigate('lists')} />;
      case 'home': return <IntelligenceHome onNavigate={navigate} />;
      case 'lists': return <Lists />;
      case 'contacts': return <Database />;
      case 'clients': return <ClientWorkspace onNavigate={navigate} />;
      case 'campaigns': return <Campaigns />;
      case 'import': return <Imports onOpenLists={() => navigate('lists')} />;
      case 'settings': return <Settings />;
      default: return <div className="py-24 max-w-xl space-y-4"><h1 className="text-2xl font-bold text-white">This section is not available in the Gate 1 release</h1><p className="text-sm text-[#71717a]">Search, Saved Searches, Lead Lists, and Imports are connected to the backend. This section still needs its own integration and verification.</p><button className="px-6 py-3 bg-indigo-600 rounded-xl text-white" onClick={()=>navigate('builder')}>Open Target Builder</button></div>;
    }
  };

  return (
    <div className={`lumina-shell lumina-view-${currentView} flex h-screen bg-[#09090b] text-[#e2e2e2] font-sans overflow-hidden selection:bg-indigo-500/30`}>
      <Sidebar activeView={currentView} onViewChange={navigate} />
      
      <main className="lumina-main flex-1 flex flex-col min-w-0 relative">
        <div className="lumina-scroll flex-1 overflow-auto">
          <div className="lumina-workspace max-w-[1400px] mx-auto px-8 py-10">
            <ErrorBoundary key={currentView} name={currentView}>
              <SessionGate>{renderView()}</SessionGate>
            </ErrorBoundary>
          </div>
        </div>

      </main>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap');
        
        :root { font-family: 'Inter', sans-serif; }
        .font-mono { font-family: 'JetBrains Mono', monospace; }
        .tabular-nums { font-variant-numeric: tabular-nums; }
        
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #27272a; border-radius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: #3f3f46; }
        
        .animate-in { animation: animate-in 0.3s ease-out; }
        @keyframes animate-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
