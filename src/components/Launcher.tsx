import React, { useState, useEffect } from 'react';
import { ToggleLeft, ToggleRight, Search, Zap, Calendar, ArrowRight, ArrowLeft, MoreHorizontal, Globe, Clock, ChevronRight, Settings, RefreshCw, Eye, Ghost } from 'lucide-react';
import icon from "./icon.png";
import mainui from "../UI_comp/mainui.png";
import calender from "../UI_comp/calender.png";
import ConnectCalendarButton from './ui/ConnectCalendarButton';

interface Meeting {
    id: string;
    title: string;
    date: string;
    duration: string;
    summary: string;
}

interface LauncherProps {
    onStartMeeting: () => void;
    onOpenSettings: () => void;
}

const Launcher: React.FC<LauncherProps> = ({ onStartMeeting, onOpenSettings }) => {
    const [meetings, setMeetings] = useState<Meeting[]>([]);
    const [isDetectable, setIsDetectable] = useState(true);

    useEffect(() => {
        console.log("Launcher mounted");
        if (window.electronAPI && window.electronAPI.getRecentMeetings) {
            window.electronAPI.getRecentMeetings().then(setMeetings).catch(err => console.error("Failed to fetch meetings:", err));
        } else {
            console.error("electronAPI or getRecentMeetings is missing");
        }
    }, []);

    if (!window.electronAPI) {
        return <div className="text-white p-10">Error: Electron API not initialized. Check preload script.</div>;
    }

    const toggleDetectable = () => {
        const newState = !isDetectable;
        setIsDetectable(newState);
        window.electronAPI?.setUndetectable(!newState);
    };

    // Group meetings by date headers (Mock logic for visual match)
    // In real app, we'd process dates. For now, hardcode structure to match screenshot visuals if data permits,
    // or just render list clearly. User screenshot shows: "Today", "Wed, Jan 21", "Tue, Jan 20"

    return (
        <div className="h-full w-full flex flex-col bg-[#050505] text-white font-sans overflow-hidden selection:bg-blue-500/30">
            {/* 1. Header */}
            {/* 1. Header - Mac-style Traffic Lights area + Back Arrow + Search + Profile */}
            {/* 1. Header - Clean Mac-style Top Bar */}
            <header className="h-[40px] shrink-0 flex items-center justify-between pl-0 pr-4 drag-region select-none bg-[#121212] border-b border-white/5">
                {/* Left: Spacing for Traffic Lights + Back Arrow */}
                <div className="flex items-center gap-0 no-drag">
                    <div className="w-[70px]" /> {/* Traffic Light Spacer (14+12+8+12+8+12+4 = ~70 to align button start) */}

                    <button className="text-slate-500 hover:text-white transition-colors p-1 rounded-md hover:bg-white/10">
                        <ArrowLeft size={16} />
                    </button>
                </div>

                {/* Center: Search Bar (Pill Shaped) */}
                <div className="flex-1 max-w-[340px] mx-4 no-drag">
                    <div className="relative group">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <Search size={13} className="text-slate-500 group-focus-within:text-slate-300 transition-colors" />
                        </div>
                        <input
                            type="text"
                            className="block w-full pl-9 pr-3 py-1 bg-[#1A1A1A] border border-white/5 rounded-full text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-white/10 focus:bg-[#202020] transition-all"
                            placeholder="Search or ask anything..."
                        />
                    </div>
                </div>

                {/* Right: Settings Gear Only */}
                <div className="flex items-center gap-3 no-drag pr-2">
                    <button
                        onClick={onOpenSettings}
                        className="p-2 text-slate-500 hover:text-white transition-colors rounded-full hover:bg-white/10"
                        title="Settings"
                    >
                        <Settings size={18} />
                    </button>
                </div>
            </header>

            {/* Main Area - Fixed Top, Scrollable Bottom */}
            <main className="flex-1 flex flex-col overflow-hidden">

                {/* TOP SECTION: Grey Background (Fixed) */}
                <section className="bg-[#151515] px-8 pt-6 pb-8 border-b border-white/5 shrink-0">
                    <div className="max-w-4xl mx-auto space-y-6">
                        {/* 1.5. Hero Header (Title + Controls + CTA) */}
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <h1 className="text-3xl font-celeb font-medium text-slate-200 tracking-wide drop-shadow-sm">My Natively</h1>

                                {/* Refresh Button */}
                                <button className="p-2 text-slate-500 hover:text-white hover:bg-white/10 rounded-full transition-colors">
                                    <RefreshCw size={18} />
                                </button>

                                {/* Detectable Toggle Pill */}
                                <div className="flex items-center gap-3 bg-[#1A1A1A] border border-white/10 rounded-full px-3 py-1.5 min-w-[140px]">
                                    {isDetectable ? (
                                        <Ghost
                                            size={14}
                                            strokeWidth={2}
                                            className="text-slate-500 transition-colors"
                                        />
                                    ) : (
                                        <svg
                                            width="14"
                                            height="14"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            className="transition-colors"
                                        >
                                            <path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z" fill="white" stroke="white" />
                                            <path d="M9 10h.01" stroke="black" strokeWidth="2.5" />
                                            <path d="M15 10h.01" stroke="black" strokeWidth="2.5" />
                                        </svg>
                                    )}
                                    <span className={`text-xs font-medium flex-1 transition-colors ${isDetectable ? 'text-slate-300' : 'text-white'}`}>
                                        {isDetectable ? "Detectable" : "Undetectable"}
                                    </span>
                                    <div
                                        className={`w-8 h-4 rounded-full relative cursor-pointer transition-colors ${!isDetectable ? 'bg-white' : 'bg-slate-700'}`}
                                        onClick={toggleDetectable}
                                    >
                                        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-black transition-all ${!isDetectable ? 'left-[18px]' : 'left-0.5'}`} />
                                    </div>
                                </div>
                            </div>

                            {/* Start Natively CTA Pill */}
                            <button
                                onClick={onStartMeeting}
                                className="
                                    group relative overflow-hidden
                                    bg-gradient-to-b from-sky-400 via-sky-500 to-blue-600
                                    text-white
                                    pl-5 pr-6 py-2.5
                                    rounded-full
                                    font-celeb font-medium tracking-normal
                                    shadow-[inset_0_1px_1px_rgba(255,255,255,0.7),inset_0_-1px_2px_rgba(0,0,0,0.1),0_2px_10px_rgba(14,165,233,0.4),0_0_0_1px_rgba(255,255,255,0.15)]
                                    hover:shadow-[inset_0_1px_2px_rgba(255,255,255,0.8),inset_0_-1px_3px_rgba(0,0,0,0.15),0_6px_16px_rgba(14,165,233,0.6),0_0_0_1px_rgba(255,255,255,0.25)]
                                    hover:brightness-110
                                    hover:scale-[1.01]
                                    active:scale-[0.99]
                                    transition-all duration-500 ease-out
                                    flex items-center gap-3
                                    backdrop-blur-xl
                                "
                            >
                                {/* Top Highlight Band (Curved, Diffused, Floating Light) */}
                                <div className="absolute inset-x-3 top-0 h-[40%] bg-gradient-to-b from-white/40 to-transparent blur-[2px] rounded-b-lg opacity-80 pointer-events-none" />

                                {/* Internal "suspended light" glow */}
                                <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />

                                <img src={icon} alt="Logo" className="w-[18px] h-[18px] object-contain brightness-0 invert drop-shadow-[0_1px_2px_rgba(0,0,0,0.1)] opacity-90" />
                                <span className="drop-shadow-[0_1px_1px_rgba(0,0,0,0.1)] -translate-y-[0.5px] text-[18px]">Start Natively</span>
                            </button>
                        </div>

                        {/* 2. Hero Section */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 h-[198px]">
                            {/* Left Main Card */}
                            <div className="md:col-span-2 relative group rounded-xl overflow-hidden border border-white/10 bg-[#050505]">
                                {/* Backdrop Image */}
                                <div className="absolute inset-0">
                                    <img src={mainui} alt="" className="w-full h-full object-cover opacity-100 transition-opacity duration-500" />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
                                </div>

                                {/* Background Accent (Optional additional tint) */}
                                <div className="absolute inset-0 bg-blue-600/5 mix-blend-overlay opacity-50" />

                                {/* Content */}
                                <div className="absolute inset-0 p-6 flex flex-col justify-between z-10">
                                    <div className="max-w-md">
                                        <h2 className="text-xl font-bold text-white mb-2 tracking-tight">Start Natively and get notes.</h2>
                                        <p className="text-xs text-slate-300 leading-relaxed opacity-90">Natively takes notes without a meeting bot, provides real-time AI assistance, and automatically generates notes and follow-up emails.</p>
                                    </div>

                                    <button onClick={onStartMeeting} className="w-fit bg-white/10 hover:bg-white/20 border border-white/10 backdrop-blur-sm text-white px-4 py-2 rounded-xl text-xs font-medium transition-all flex items-center gap-2 group-hover:pl-5 group-hover:pr-3">
                                        Join demo meeting
                                        <ArrowRight size={12} className="opacity-0 -ml-2 group-hover:ml-0 group-hover:opacity-100 transition-all" />
                                    </button>
                                </div>
                            </div>

                            {/* Right Secondary Card */}
                            <div className="md:col-span-1 rounded-xl overflow-hidden border border-white/10 bg-[#151515] relative group flex flex-col items-center pt-6 text-center">
                                {/* Backdrop Image */}
                                <div className="absolute inset-0">
                                    <img src={calender} alt="" className="w-full h-full object-cover opacity-100 transition-opacity duration-500 translate-x-1 translate-y-[-2px] scale-110" />
                                </div>

                                {/* Content Layer (z-10) */}
                                <div className="relative z-10 w-full flex flex-col items-center">
                                    <h3 className="text-[19px] leading-tight mb-4">
                                        <span className="block font-semibold text-[#F4F6FA]">Link your calendar to</span>
                                        <span className="block font-medium text-[#C9CFDA] text-[0.95em]">see upcoming events</span>
                                    </h3>

                                    <ConnectCalendarButton className="-translate-x-0.5" />
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* BOTTOM SECTION: Black Background (Scrollable) */}
                <section className="bg-black px-8 py-8 flex-1 overflow-y-auto">
                    <div className="max-w-5xl mx-auto space-y-8">

                        {/* Group: Today (Mock) */}
                        <section>
                            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 pl-2">Today</h3>
                            <div className="rounded-2xl border border-white/5 overflow-hidden">
                                {/* Row 1 */}
                                {meetings.slice(0, 1).map(m => (
                                    <div key={m.id} className="group flex items-center justify-between p-4 bg-transparent hover:bg-[#1A1A1A] transition-colors cursor-default border-b border-white/5 last:border-0 h-[64px]">
                                        <div className="font-medium text-slate-200 group-hover:text-white px-2">{m.title}</div>
                                        <div className="flex items-center gap-4 text-xs text-slate-500 font-mono px-2">
                                            <span className="bg-[#1A1A1A] group-hover:bg-[#252525] px-2 py-1 rounded border border-white/5">{m.duration}</span>
                                            <span className="opacity-70">7:30am</span>
                                            <MoreHorizontal size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </div>
                                    </div>
                                ))}
                                {meetings.length === 0 && <div className="p-4 text-sm text-slate-500 pl-6">No meetings today</div>}
                            </div>
                        </section>

                        {/* Group: Wed, Jan 21 (Mock) */}
                        <section>
                            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 pl-2">Wed, Jan 21</h3>
                            <div className="rounded-2xl border border-white/5 overflow-hidden flex flex-col">
                                {['Casual Conversation with AI', 'Untitled session'].map((title, i) => (
                                    <div key={i} className={`group flex items-center justify-between p-4 bg-transparent hover:bg-[#1A1A1A] transition-colors cursor-default border-white/5 h-[64px] ${i === 2 ? 'bg-[#151515] hover:bg-[#1A1A1A]' : ''} ${i !== 1 ? 'border-b' : ''}`}>
                                        <div className="font-medium text-slate-200 group-hover:text-white px-2">{title}</div>
                                        <div className="flex items-center gap-4 text-xs text-slate-500 font-mono px-2">
                                            <span className="bg-[#1A1A1A] group-hover:bg-[#252525] px-2 py-1 rounded border border-white/5">2:21</span>
                                            <span className="opacity-70">4:32am</span>
                                            <MoreHorizontal size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>

                        {/* Group: Tue, Jan 20 (Mock) */}
                        <section>
                            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 pl-2">Tue, Jan 20</h3>
                            <div className="rounded-2xl border border-white/5 overflow-hidden">
                                <div className="group flex items-center justify-between p-4 bg-transparent hover:bg-[#1A1A1A] transition-colors cursor-default h-[64px]">
                                    <div className="font-medium text-slate-200 group-hover:text-white px-2">Internship Live External Quantities</div>
                                    <div className="flex items-center gap-4 text-xs text-slate-500 font-mono px-2">
                                        <span className="bg-[#1A1A1A] group-hover:bg-[#252525] px-2 py-1 rounded border border-white/5">41:03</span>
                                        <span className="opacity-70">2:58pm</span>
                                        <MoreHorizontal size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </div>
                                </div>
                            </div>
                        </section>

                    </div>
                </section>
            </main>
        </div>
    );
};

export default Launcher;
