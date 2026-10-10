import React from 'react';
import { View } from '../types';

interface SidebarProps {
  activeView: View;
  onViewChange: (view: View) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeView, onViewChange }) => {
  const primaryNav: { id: View; label: string; icon: string }[] = [
    { id: 'builder', label: 'Target Builder', icon: 'person_search' },
    { id: 'lists', label: 'Lead Lists', icon: 'list_alt' },
    { id: 'home', label: 'Intelligence Home', icon: 'dashboard_customize' },
    { id: 'contacts', label: 'Database', icon: 'hub' },
    { id: 'clients', label: 'Clients', icon: 'handshake' },
    { id: 'campaigns', label: 'Campaigns', icon: 'target' },
  ];

  return (
    <aside className="w-64 border-r border-[#1c1c1f] bg-[#09090b] flex flex-col shrink-0">
      <div className="px-6 py-10">
        <div className="flex items-center gap-3 mb-10 group cursor-pointer" onClick={() => onViewChange('home')}>
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/20">
            <span className="material-symbols-outlined text-white text-xl">insights</span>
          </div>
          <span className="font-bold text-lg tracking-tighter text-white uppercase italic">Lumina</span>
        </div>

        <nav className="space-y-1">
          {primaryNav.map((item) => (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={`w-full flex items-center gap-4 px-4 py-2.5 text-[13px] rounded-xl transition-all duration-200 group ${
                activeView === item.id 
                  ? 'bg-indigo-600/10 text-indigo-400 font-semibold' 
                  : 'text-[#71717a] hover:text-white hover:bg-[#18181b]'
              }`}
            >
              <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </div>

      <div className="mt-auto px-6 py-6 border-t border-[#1c1c1f] space-y-1">
        <button 
          onClick={() => onViewChange('import')}
          className={`w-full flex items-center gap-4 px-4 py-3 text-[13px] rounded-xl transition-all ${
            activeView === 'import' ? 'bg-[#18181b] text-white font-semibold' : 'text-[#71717a] hover:text-white hover:bg-[#18181b]'
          }`}
        >
          <span className="material-symbols-outlined text-[20px]">publish</span>
          <span>Import</span>
        </button>
        <button 
          onClick={() => onViewChange('settings')}
          className={`w-full flex items-center gap-4 px-4 py-3 text-[13px] rounded-xl transition-all ${
            activeView === 'settings' ? 'bg-[#18181b] text-white font-semibold' : 'text-[#71717a] hover:text-white hover:bg-[#18181b]'
          }`}
        >
          <span className="material-symbols-outlined text-[20px]">settings</span>
          <span>Rules / Admin</span>
        </button>
      </div>
    </aside>
  );
};
