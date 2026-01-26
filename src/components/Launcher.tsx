import React, { useState, useEffect } from 'react';
import { ToggleLeft, ToggleRight, Search, Zap, Calendar, ArrowRight, ArrowLeft, MoreHorizontal, Globe, Clock, ChevronRight, Settings, RefreshCw, Eye, EyeOff, Ghost, Plus, Mail, Link, ChevronDown } from 'lucide-react';
import icon from "./icon.png";
import mainui from "../UI_comp/mainui.png";
import calender from "../UI_comp/calender.png";
import ConnectCalendarButton from './ui/ConnectCalendarButton';
import MeetingDetails from './MeetingDetails';
import { motion, AnimatePresence } from 'framer-motion';

interface Meeting {
    id: string;
    title: string;
    date: string;
    duration: string;
    summary: string;
    detailedSummary?: {
        actionItems: string[];
        keyPoints: string[];
    };
    transcript?: Array<{
        speaker: string;
        text: string;
        timestamp: number;
    }>;
    usage?: Array<{
        type: 'assist' | 'followup' | 'chat' | 'followup_questions';
        timestamp: number;
        question?: string;
        answer?: string;
        items?: string[];
    }>;
    active?: boolean; // UI state
    time?: string; // Optional for compatibility
}

interface LauncherProps {
    onStartMeeting: () => void;
    onOpenSettings: () => void;
}

// Helper to format date groups
const getGroupLabel = (dateStr: string) => {
    if (dateStr === "Today") return "Today"; // Backward compatibility

    const date = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const checkDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (checkDate.getTime() === today.getTime()) return "Today";
    if (checkDate.getTime() === yesterday.getTime()) return "Yesterday";

    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

// Helper to format time (e.g. 3:14pm)
const formatTime = (dateStr: string) => {
    if (dateStr === "Today") return "Just now"; // Legacy
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
};

const Launcher: React.FC<LauncherProps> = ({ onStartMeeting, onOpenSettings }) => {
    const [meetings, setMeetings] = useState<Meeting[]>([]);
    const [isDetectable, setIsDetectable] = useState(true);
    const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);

    useEffect(() => {
        console.log("Launcher mounted");
        // Seed demo data if needed (safe to call always)
        if (window.electronAPI && window.electronAPI.invoke) {
            window.electronAPI.invoke('seed-demo').catch(err => console.error("Failed to seed demo:", err));
        }

        const fetchMeetings = () => {
            if (window.electronAPI && window.electronAPI.getRecentMeetings) {
                window.electronAPI.getRecentMeetings().then(setMeetings).catch(err => console.error("Failed to fetch meetings:", err));
            }
        };

        fetchMeetings();

        // Listen for background updates (e.g. after meeting processing finishes)
        const removeListener = window.electronAPI.on('meetings-updated', () => {
            console.log("Received meetings-updated event");
            fetchMeetings();
        });

        return () => {
            if (removeListener) removeListener();
        };
    }, []);

    if (!window.electronAPI) {
        return <div className="text-white p-10">Error: Electron API not initialized. Check preload script.</div>;
    }

    const toggleDetectable = () => {
        const newState = !isDetectable;
        setIsDetectable(newState);
        window.electronAPI?.setUndetectable(!newState);
    };

    // Group meetings
    const groupedMeetings = meetings.reduce((acc, meeting) => {
        const label = getGroupLabel(meeting.date);
        if (!acc[label]) acc[label] = [];
        acc[label].push(meeting);
        return acc;
    }, {} as Record<string, Meeting[]>);

    // Group order (Today, Yesterday, then others sorted new to old is implicit via API return order ideally, 
    // but JS object key order isn't guaranteed. We can use a Map or just known keys.)
    // Simple sort for keys:
    const sortedGroups = Object.keys(groupedMeetings).sort((a, b) => {
        if (a === 'Today') return -1;
        if (b === 'Today') return 1;
        if (a === 'Yesterday') return -1;
        if (b === 'Yesterday') return 1;
        // Approximation for others: parse date
        return new Date(b).getTime() - new Date(a).getTime();
    });


    return (
        <AnimatePresence mode="wait">
            {selectedMeeting ? (
                <MeetingDetails key="details" meeting={selectedMeeting} onBack={() => setSelectedMeeting(null)} />
            ) : (
                <motion.div
                    key="launcher"
                    className="h-full w-full flex flex-col bg-bg-primary text-text-primary font-sans overflow-hidden selection:bg-accent-secondary/30"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0 }}
                >
                    {/* 1. Header */}
                    <header className="h-[40px] shrink-0 flex items-center justify-between pl-0 pr-4 drag-region select-none bg-[#121212] border-b border-white/5">
                        {/* Left: Spacing for Traffic Lights + Back Arrow */}
                        <div className="flex items-center gap-0 no-drag">
                            <div className="w-[70px]" /> {/* Traffic Light Spacer */}
                            <button className="text-slate-500 hover:text-white transition-all duration-300 p-1 hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.5)] flex items-center justify-center mb-1">
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

                        {/* Right: Actions */}
                        <div className="flex items-center gap-3 no-drag">
                            <button
                                onClick={onOpenSettings}
                                className="p-2 text-slate-500 hover:text-white transition-all duration-300 hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]"
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
                                        <h1 className="text-3xl font-celeb-light font-medium text-slate-200 tracking-wide drop-shadow-sm">My Natively</h1>

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
                                    px-6 py-3
                                    rounded-full
                                    font-celeb font-medium tracking-normal
                                    shadow-[inset_0_1px_1px_rgba(255,255,255,0.7),inset_0_-1px_2px_rgba(0,0,0,0.1),0_2px_10px_rgba(14,165,233,0.4),0_0_0_1px_rgba(255,255,255,0.15)]
                                    hover:shadow-[inset_0_1px_2px_rgba(255,255,255,0.8),inset_0_-1px_3px_rgba(0,0,0,0.15),0_6px_16px_rgba(14,165,233,0.6),0_0_0_1px_rgba(255,255,255,0.25)]
                                    hover:brightness-110
                                    hover:scale-[1.01]
                                    active:scale-[0.99]
                                    transition-all duration-500 ease-out
                                        onClick={startMeeting}
                                        className="group relative overflow-hidden p-6 rounded-2xl bg-bg-elevated border border-border-muted hover:border-accent-primary/50 transition-all duration-300 text-left shadow-sm hover:shadow-md"
                                    >
                                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                            <Mic size={80} className="text-accent-primary" />
                                        </div>
                                        <div className="relative z-10">
                                            <div className="w-12 h-12 rounded-xl bg-accent-primary/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                                                <Mic size={24} className="text-accent-primary" />
                                            </div>
                                            <h3 className="text-lg font-semibold text-text-primary mb-1">Start Recording</h3>
                                            <p className="text-sm text-text-tertiary">Capture audio & screen context</p>
                                        </div>
                                    </button>

                                    <button className="group relative overflow-hidden p-6 rounded-2xl bg-bg-elevated border border-border-muted hover:border-purple-500/50 transition-all duration-300 text-left shadow-sm hover:shadow-md">
                                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                            <Sparkles size={80} className="text-purple-500" />
                                        </div>
                                        <div className="relative z-10">
                                            <div className="w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                                                <Sparkles size={24} className="text-purple-500" />
                                            </div>
                                            <h3 className="text-lg font-semibold text-text-primary mb-1">AI Insights</h3>
                                            <p className="text-sm text-text-tertiary">Review previous analysis</p>
                                        </div>
                                    </button>
                                </div>

                                {/* Recent Meetings List */}
                                <div className="pt-6">
                                    <div className="flex items-center justify-between mb-4 px-1">
                                        <h2 className="text-sm font-semibold text-text-tertiary uppercase tracking-wider">Recent Sessions</h2>
                                        <button className="text-xs text-accent-primary hover:text-accent-secondary font-medium transition-colors">View All</button>
                                    </div>

                                    <div className="space-y-2">
                                        {meetings.length === 0 ? (
                                            <div className="p-8 text-center border border-dashed border-border-muted rounded-2xl bg-bg-surface/50">
                                                <div className="w-12 h-12 bg-bg-elevated rounded-full flex items-center justify-center mx-auto mb-3">
                                                    <Archive size={20} className="text-text-quaternary" />
                                                </div>
                                                <p className="text-text-tertiary text-sm">No recent meetings found</p>
                                            </div>
                                        ) : (
                                            meetings.map((m, i) => (
                                                <motion.div
                                                    key={m.id}
                                                    initial={{ opacity: 0, y: 10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    transition={{ delay: 0.1 * i }}
                                                    className="group flex items-center justify-between p-4 bg-bg-surface hover:bg-bg-elevated transition-colors cursor-pointer border-b border-border-subtle last:border-0 h-[64px] rounded-lg hover:shadow-sm"
                                                    onClick={() => setSelectedMeeting(m)}
                                                >
                                                    <div className={`font-medium text-[15px] max-w-[60%] truncate ${m.title === 'Processing...' ? 'text-accent-tertiary italic animate-pulse' : (m.title.includes('Demo') ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary')}`}>
                                                        {m.title}
                                                    </div>
                                                    <div className="flex items-center gap-4">
                                                        {m.title === 'Processing...' ? (
                                                            <div className="flex items-center gap-2">
                                                                <RefreshCw size={12} className="animate-spin text-accent-primary" />
                                                                <span className="text-xs text-accent-primary font-medium">Finalizing...</span>
                                                            </div>
                                                        ) : (
                                                            <>
                                                                <span className="bg-bg-highlight text-text-tertiary text-xs px-2 py-0.5 rounded-[4px] font-medium min-w-[40px] text-center">
                                                                    {m.duration.replace('min', '').trim()}
                                                                </span>
                                                                <span className="text-xs text-text-quaternary font-medium min-w-[60px] text-right">
                                                                    {formatTime(m.date)}
                                                                </span>
                                                            </>
                                                        )}
                                                    </div>
                                                </motion.div>
                        </section>
                    </main>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default Launcher;
