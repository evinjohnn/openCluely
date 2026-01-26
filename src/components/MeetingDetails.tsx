import React, { useState } from 'react';
import { ArrowLeft, Search, Mail, Link, ChevronDown, Play, ArrowUp, Copy, Check, MoreHorizontal, Settings } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const formatTime = (ms: number) => {
    const date = new Date(ms);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).toLowerCase();
};

const formatDuration = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes}:${Number(seconds) < 10 ? '0' : ''}${seconds}`;
};

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
}

interface MeetingDetailsProps {
    meeting: Meeting;
    onBack: () => void;
}

const MeetingDetails: React.FC<MeetingDetailsProps> = ({ meeting, onBack }) => {
    const [activeTab, setActiveTab] = useState<'summary' | 'transcript' | 'usage'>('summary');

    return (
        <motion.div
            className="h-full w-full flex flex-col bg-bg-primary text-text-primary font-sans overflow-hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0 }}
        >
            {/* Header - Matching Launcher.tsx */}
            <header className="h-[40px] shrink-0 flex items-center justify-between pl-0 pr-4 drag-region select-none bg-[#121212] border-b border-white/5">
                {/* Left: Spacing for Traffic Lights + Back Arrow */}
                <div className="flex items-center gap-0 no-drag">
                    <div className="w-[70px]" /> {/* Traffic Light Spacer */}
                    <button
                        onClick={onBack}
                        className="text-slate-500 hover:text-white transition-all duration-300 p-1 hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.5)] flex items-center justify-center"
                    >
                        <ArrowLeft size={16} />
                    </button>
                </div>

                {/* Center: Search Bar */}
                <div className="flex-1 max-w-[400px] mx-4 no-drag">
                    <div className="relative group">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <Search size={13} className="text-slate-500 group-focus-within:text-slate-300 transition-colors" />
                        </div>
                        <input
                            type="text"
                            className="block w-full pl-9 pr-3 py-1.5 bg-[#121212] border border-white/5 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-white/10 focus:bg-[#1A1A1A] transition-all"
                            placeholder="Search or ask anything..."
                        />
                        <div className="absolute inset-y-0 right-0 pr-2 flex items-center pointer-events-none">
                            <span className="text-[10px] text-slate-600 border border-white/10 px-1 rounded">⌘K</span>
                        </div>
                    </div>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-3 no-drag">
                    <button
                        className="p-2 text-slate-500 hover:text-white transition-all duration-300 hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]"
                        title="Settings"
                    >
                        <Settings size={18} />
                    </button>
                </div>
            </header>

            {/* Main Content */}
            <main className="flex-1 overflow-y-auto custom-scrollbar">
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1, duration: 0.3 }}
                    className="max-w-4xl mx-auto px-8 py-8"
                >
                    {/* Meta Info & Actions Row */}
                    <div className="flex items-start justify-between mb-6">
                        <div>
                            {/* Date formatting could be improved to use meeting.date if it's an ISO string */}
                            <div className="text-xs text-slate-500 font-medium mb-1">
                                {new Date(meeting.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                            </div>
                            <h1 className="text-3xl font-bold text-slate-100 tracking-tight">{meeting.title}</h1>
                        </div>

                        {/* Moved Actions: Follow-up & Share */}
                        <div className="flex items-center gap-2 mt-1">
                            <button className="flex items-center gap-2 px-3 py-1.5 bg-[#1A1A1A] hover:bg-[#252525] border border-white/10 rounded-md text-xs font-medium text-slate-200 transition-colors">
                                <Mail size={14} />
                                Follow-up email
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 ml-1"></span>
                            </button>
                            <button className="flex items-center gap-2 px-3 py-1.5 bg-[#1A1A1A] hover:bg-[#252525] border border-white/10 rounded-md text-xs font-medium text-slate-200 transition-colors">
                                <Link size={14} />
                                Share
                                <ChevronDown size={12} className="text-slate-500" />
                            </button>
                        </div>
                    </div>

                    {/* Tabs */}
                    <div className="flex items-center gap-1 mb-8 border-b border-white/5 pb-0">
                        {['summary', 'transcript', 'usage'].map((tab) => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab as any)}
                                className={`
                                    px-4 py-2 text-xs font-medium rounded-t-lg transition-colors relative
                                    ${activeTab === tab ? 'text-white bg-[#1A1A1A]' : 'text-slate-500 hover:text-slate-300'}
                                `}
                            >
                                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                                {activeTab === tab && (
                                    <motion.div
                                        layoutId="activeTabIndicator"
                                        className="absolute bottom-0 left-0 right-0 h-px bg-blue-500"
                                    />
                                )}
                            </button>
                        ))}
                    </div>

                    {/* Tab Content */}
                    <div className="space-y-8">
                        {/* Using standard divs for content, framer motion for layout */}
                        {activeTab === 'summary' && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                {/* Action Items */}
                                <section className="mb-8">
                                    <div className="flex items-center justify-between mb-4">
                                        <h2 className="text-lg font-semibold text-slate-200">Action Items</h2>
                                        <button className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors">
                                            <Copy size={12} />
                                            Copy full summary
                                        </button>
                                    </div>
                                    <ul className="space-y-3">
                                        {meeting.detailedSummary?.actionItems?.length ? meeting.detailedSummary.actionItems.map((item, i) => (
                                            <li key={i} className="flex items-start gap-3 group">
                                                <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-slate-600 group-hover:bg-blue-500 transition-colors" />
                                                <p className="text-sm text-slate-300 leading-relaxed">{item}</p>
                                            </li>
                                        )) : <p className="text-slate-500 text-sm">No action items generated.</p>}
                                    </ul>
                                </section>

                                {/* Key Points */}
                                <section>
                                    <h2 className="text-lg font-semibold text-slate-200 mb-4">Key Points</h2>
                                    <ul className="space-y-3">
                                        {meeting.detailedSummary?.keyPoints?.length ? meeting.detailedSummary.keyPoints.map((item, i) => (
                                            <li key={i} className="flex items-start gap-3 group">
                                                <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-slate-600 group-hover:bg-purple-500 transition-colors" />
                                                <p className="text-sm text-slate-300 leading-relaxed">{item}</p>
                                            </li>
                                        )) : <p className="text-slate-500 text-sm">No key points generated.</p>}
                                    </ul>
                                </section>
                            </motion.div>
                        )}

                        {activeTab === 'transcript' && (
                            <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                <div className="flex items-center justify-end mb-6">
                                    <button className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors">
                                        <Copy size={12} />
                                        Copy full transcript
                                    </button>
                                </div>
                                <div className="space-y-6">
                                    {meeting.transcript?.map((entry, i) => (
                                        <div key={i} className="group">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-xs font-semibold text-slate-300">{entry.speaker === 'user' ? 'Me' : 'Them'}</span>
                                                <span className="text-xs text-slate-500 font-mono">{entry.timestamp ? formatTime(entry.timestamp) : '0:00'}</span>
                                            </div>
                                            <p className="text-slate-300 text-[15px] leading-relaxed group-hover:text-white transition-colors">{entry.text}</p>
                                        </div>
                                    ))}
                                    {!meeting.transcript?.length && <p className="text-slate-500">No transcript available.</p>}
                                </div>
                            </motion.section>
                        )}

                        {activeTab === 'usage' && (
                            <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8 pb-10">
                                {meeting.usage?.map((interaction, i) => (
                                    <div key={i} className="space-y-4">
                                        {/* User Question */}
                                        {interaction.question && (
                                            <div className="flex justify-end">
                                                <div className="bg-[#0A84FF] text-white px-5 py-2.5 rounded-2xl rounded-tr-sm max-w-[80%] text-[15px] font-medium leading-relaxed shadow-sm">
                                                    {interaction.question}
                                                </div>
                                            </div>
                                        )}

                                        {/* AI Answer */}
                                        {interaction.answer && (
                                            <div className="flex items-start gap-4">
                                                <div className="mt-1 w-6 h-6 rounded-full bg-[#1A1A1A] flex items-center justify-center border border-white/10 shrink-0">
                                                    <div className="w-3 h-3 text-slate-400">
                                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="text-[11px] text-slate-500 mb-1.5 font-medium">{formatTime(interaction.timestamp)}</div>
                                                    <p className="text-slate-300 text-[15px] leading-relaxed whitespace-pre-wrap">{interaction.answer}</p>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                                {!meeting.usage?.length && <p className="text-slate-500">No usage history.</p>}
                            </motion.section>
                        )}
                    </div>
                </motion.div>
            </main>

            {/* Footer */}
            <footer className="shrink-0 px-8 py-6 border-t border-white/5 bg-[#050505] flex items-center justify-center gap-4">
                <button className="flex items-center gap-2 px-4 py-2 bg-[#1A1A1A] hover:bg-[#252525] border border-white/10 rounded-full text-sm font-medium text-slate-200 transition-colors">
                    <Play size={14} fill="currentColor" />
                    Resume Session
                </button>

                <div className="flex-1 max-w-xl relative">
                    <input
                        type="text"
                        placeholder="Ask about this meeting..."
                        className="w-full pl-5 pr-10 py-2.5 bg-[#121212] border border-white/10 rounded-full text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-white/20 transition-all"
                    />
                    <button className="absolute right-1.5 top-1.5 p-1.5 bg-[#1A1A1A] hover:bg-white/10 rounded-full text-slate-400 transition-colors">
                        <ArrowUp size={14} />
                    </button>
                </div>
            </footer>
        </motion.div>
    );
};

export default MeetingDetails;
