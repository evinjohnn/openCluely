import React, { useState, useEffect } from 'react';
import {
    X, Mic, Speaker, Monitor, Keyboard, User, LifeBuoy, LogOut,
    Command, ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
    AppWindow, Camera, RotateCcw, Eye, Layout, MessageSquare, Crop,
    ChevronDown, Check, BadgeCheck, Power, Palette
} from 'lucide-react';
import { useTheme } from './ThemeContext';

interface CustomSelectProps {
    label: string;
    icon: React.ReactNode;
    value: string;
    options: MediaDeviceInfo[];
    onChange: (value: string) => void;
    placeholder?: string;
}

const CustomSelect: React.FC<CustomSelectProps> = ({ label, icon, value, options, onChange, placeholder = "Select device" }) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = React.useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const selectedLabel = options.find(o => o.deviceId === value)?.label || placeholder;

    return (
        <div className="bg-[#262626] rounded-xl p-4 border border-white/5" ref={containerRef}>
            <div className="flex items-center gap-2 mb-3">
                <span className="text-gray-400">{icon}</span>
                <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</label>
            </div>

            <div className="relative">
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white flex items-center justify-between hover:bg-black/70 transition-colors"
                >
                    <span className="truncate pr-4">{selectedLabel}</span>
                    <ChevronDown size={14} className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                {isOpen && (
                    <div className="absolute top-full left-0 w-full mt-1 bg-[#262626] border border-white/10 rounded-lg shadow-xl z-50 max-h-48 overflow-y-auto animated fadeIn">
                        <div className="p-1 space-y-0.5">
                            {options.map((device) => (
                                <button
                                    key={device.deviceId}
                                    onClick={() => {
                                        onChange(device.deviceId);
                                        setIsOpen(false);
                                    }}
                                    className={`w-full text-left px-3 py-2 text-sm rounded-md flex items-center justify-between group transition-colors ${value === device.deviceId ? 'bg-white/10 text-white' : 'text-gray-300 hover:bg-white/5 hover:text-white'}`}
                                >
                                    <span className="truncate">{device.label || `Device ${device.deviceId.slice(0, 5)}...`}</span>
                                    {value === device.deviceId && <Check size={14} className="text-blue-400" />}
                                </button>
                            ))}
                            {options.length === 0 && (
                                <div className="px-3 py-2 text-sm text-gray-500 italic">No devices found</div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

interface SettingsOverlayProps {
    isOpen: boolean;
    onClose: () => void;
}

const SettingsOverlay: React.FC<SettingsOverlayProps> = ({ isOpen, onClose }) => {
    const { theme, setTheme } = useTheme();
    const [activeTab, setActiveTab] = useState('general');
    const [isUndetectable, setIsUndetectable] = useState(false);
    const [openOnLogin, setOpenOnLogin] = useState(false);

    // Audio Settings
    const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
    const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
    const [selectedInput, setSelectedInput] = useState('');
    const [selectedOutput, setSelectedOutput] = useState('');
    const [micLevel, setMicLevel] = useState(0);

    const [apiKey, setApiKey] = useState('');
    const [serviceAccountPath, setServiceAccountPath] = useState('');

    const audioContextRef = React.useRef<AudioContext | null>(null);
    const analyserRef = React.useRef<AnalyserNode | null>(null);
    const sourceRef = React.useRef<MediaStreamAudioSourceNode | null>(null);
    const rafRef = React.useRef<number | null>(null);

    const handleSelectServiceAccount = async () => {
        try {
            const result = await window.electronAPI.selectServiceAccount();
            if (result.success && result.path) {
                setServiceAccountPath(result.path);
            }
        } catch (error) {
            console.error("Failed to select service account:", error);
        }
    };

    useEffect(() => {
        if (isOpen) {
            // Load detectable status
            if (window.electronAPI?.getUndetectable) {
                window.electronAPI.getUndetectable().then(setIsUndetectable);
            }
            if (window.electronAPI?.getOpenAtLogin) {
                window.electronAPI.getOpenAtLogin().then(setOpenOnLogin);
            }

            // Load settings
            window.navigator.mediaDevices.enumerateDevices().then(devices => {
                const inputs = devices.filter(d => d.kind === 'audioinput');
                const outputs = devices.filter(d => d.kind === 'audiooutput');

                setInputDevices(inputs);
                setOutputDevices(outputs);

                // Set initial selected devices if not already set
                if (inputs.length > 0 && !selectedInput) setSelectedInput(inputs[0].deviceId);
                if (outputs.length > 0 && !selectedOutput) setSelectedOutput(outputs[0].deviceId);
            });
        }
    }, [isOpen, selectedInput, selectedOutput]); // Re-run if isOpen changes, or if selected devices are cleared

    // Effect for real-time audio level monitoring
    useEffect(() => {
        if (isOpen && activeTab === 'audio') {
            let mounted = true;

            const startAudio = async () => {
                try {
                    // Cleanup previous audio context if it exists
                    if (audioContextRef.current) {
                        audioContextRef.current.close();
                    }

                    const stream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            deviceId: selectedInput ? { exact: selectedInput } : undefined
                        }
                    });

                    if (!mounted) return;

                    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
                    const analyser = audioContext.createAnalyser();
                    const source = audioContext.createMediaStreamSource(stream);

                    analyser.fftSize = 256;
                    source.connect(analyser);

                    audioContextRef.current = audioContext;
                    analyserRef.current = analyser;
                    sourceRef.current = source;

                    const dataArray = new Uint8Array(analyser.frequencyBinCount);
                    let smoothLevel = 0;

                    const updateLevel = () => {
                        if (!mounted || !analyserRef.current) return;
                        // Use Time Domain Data for accurate volume (waveform) instead of frequency
                        analyserRef.current.getByteTimeDomainData(dataArray);

                        let sum = 0;
                        for (let i = 0; i < dataArray.length; i++) {
                            // Convert 0-255 to -1 to 1 range
                            const value = (dataArray[i] - 128) / 128;
                            sum += value * value;
                        }

                        // Calculate RMS
                        const rms = Math.sqrt(sum / dataArray.length);

                        // Convert to simpler 0-100 range with some boost
                        // RMS is usually very small (0.01 - 0.5 for normal speech)
                        // Logarithmic scaling feels more natural for volume
                        const db = 20 * Math.log10(rms);
                        // Approximate mapping: -60dB (silence) to 0dB (max) -> 0 to 100
                        const targetLevel = Math.max(0, Math.min(100, (db + 60) * 2));

                        // Apply smoothing
                        if (targetLevel > smoothLevel) {
                            smoothLevel = smoothLevel * 0.7 + targetLevel * 0.3; // Fast attack
                        } else {
                            smoothLevel = smoothLevel * 0.95 + targetLevel * 0.05; // Slow decay
                        }

                        setMicLevel(smoothLevel);

                        rafRef.current = requestAnimationFrame(updateLevel);
                    };

                    updateLevel();
                } catch (error) {
                    console.error("Error accessing microphone:", error);
                    setMicLevel(0); // Reset level on error
                }
            };

            startAudio();

            return () => {
                mounted = false;
                if (rafRef.current) cancelAnimationFrame(rafRef.current);
                if (sourceRef.current) sourceRef.current.disconnect();
                if (audioContextRef.current) {
                    audioContextRef.current.close();
                    audioContextRef.current = null;
                }
                setMicLevel(0); // Reset mic level on cleanup
            };
        } else {
            // Cleanup when closing tab or overlay
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            if (audioContextRef.current) {
                audioContextRef.current.close();
                audioContextRef.current = null;
            }
            setMicLevel(0);
        }
    }, [isOpen, activeTab, selectedInput]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-8 animated fadeIn">
            <div className="bg-[#121212] w-full max-w-4xl h-[80vh] rounded-2xl border border-white/10 shadow-2xl flex overflow-hidden">
                {/* Sidebar */}
                <div className="w-64 bg-[#111111] flex flex-col border-r border-white/5">
                    <div className="p-6">
                        <h2 className="font-semibold text-gray-400 text-xs uppercase tracking-wider mb-4">Settings</h2>
                        <nav className="space-y-1">
                            <button
                                onClick={() => setActiveTab('general')}
                                className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${activeTab === 'general' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-gray-300 hover:bg-white/5'}`}
                            >
                                <Monitor size={16} /> General
                            </button>
                            <button
                                onClick={() => setActiveTab('audio')}
                                className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${activeTab === 'audio' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-gray-300 hover:bg-white/5'}`}
                            >
                                <Mic size={16} /> Audio
                            </button>
                            <button
                                onClick={() => setActiveTab('keybinds')}
                                className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${activeTab === 'keybinds' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-gray-300 hover:bg-white/5'}`}
                            >
                                <Keyboard size={16} /> Keybinds
                            </button>
                            <button
                                onClick={() => setActiveTab('profile')}
                                className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${activeTab === 'profile' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-gray-300 hover:bg-white/5'}`}
                            >
                                <User size={16} /> Profile
                            </button>
                        </nav>
                    </div>

                    <div className="mt-auto p-6 border-t border-white/5">
                        <button className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-3">
                            <LogOut size={16} /> Sign out
                        </button>
                        <button onClick={onClose} className="mt-2 w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-gray-400 hover:bg-white/5 transition-colors flex items-center gap-3">
                            <X size={16} /> Close
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto bg-[#1c1c1c] p-8">
                    {activeTab === 'general' && (
                        <div className="space-y-8 animated fadeIn">
                            <div className="bg-[#262626] rounded-xl p-5 border border-white/5 flex items-center justify-between">
                                <div className="flex flex-col gap-1">
                                    <div className="flex items-center gap-2">
                                        <Eye size={18} className="text-white" />
                                        <h3 className="text-base font-bold text-white">Detectable</h3>
                                    </div>
                                    <p className="text-xs text-gray-400">
                                        Cluely is currently {isUndetectable ? 'undetectable' : 'detectable'} by screen-sharing. <button className="text-blue-400 hover:underline">Supported apps here</button>
                                    </p>
                                </div>
                                <div
                                    onClick={() => {
                                        const newState = !isUndetectable;
                                        setIsUndetectable(newState);
                                        window.electronAPI?.setUndetectable(newState);
                                    }}
                                    className={`w-11 h-6 rounded-full relative cursor-pointer transition-colors ${isUndetectable ? 'bg-white/20' : 'bg-black/50'}`}
                                >
                                    <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${isUndetectable ? 'translate-x-5' : 'translate-x-0'}`} />
                                </div>
                            </div>

                            <div className="pt-2">
                                <h3 className="text-sm font-bold text-white mb-1">General settings</h3>
                                <p className="text-xs text-gray-500 mb-4">Customize how Cluely works for you</p>

                                <div className="space-y-4">
                                    {/* Open at Login */}
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 bg-[#262626] rounded-lg border border-white/5 flex items-center justify-center text-gray-400">
                                                <Power size={20} />
                                            </div>
                                            <div>
                                                <h3 className="text-sm font-bold text-white">Open Cluely when you log in</h3>
                                                <p className="text-xs text-gray-400 mt-0.5">Cluely will open automatically when you log in to your computer</p>
                                            </div>
                                        </div>
                                        <div
                                            onClick={() => {
                                                const newState = !openOnLogin;
                                                setOpenOnLogin(newState);
                                                window.electronAPI?.setOpenAtLogin(newState);
                                            }}
                                            className={`w-11 h-6 rounded-full relative cursor-pointer transition-colors ${!openOnLogin ? 'bg-white/10' : 'bg-white'}`}
                                        >
                                            <div className={`absolute top-1 left-1 w-4 h-4 rounded-full transition-transform ${!openOnLogin ? 'translate-x-0 bg-white' : 'translate-x-5 bg-black'}`} />
                                        </div>
                                    </div>

                                    {/* Theme (Mock) */}
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 bg-[#262626] rounded-lg border border-white/5 flex items-center justify-center text-gray-400">
                                                <Palette size={20} />
                                            </div>
                                            <div>
                                                <h3 className="text-sm font-bold text-white">Theme</h3>
                                                <p className="text-xs text-gray-400 mt-0.5">Customize how Cluely looks on your device</p>
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            {(['system', 'dark', 'light'] as const).map((t) => (
                                                <button
                                                    key={t}
                                                    onClick={() => setTheme(t)}
                                                    className={`
                                                        px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalized
                                                        ${theme === t
                                                            ? 'bg-white text-black'
                                                            : 'bg-[#262626] text-gray-400 hover:text-white hover:bg-white/5 border border-white/10'}
                                                    `}
                                                >
                                                    {t.charAt(0).toUpperCase() + t.slice(1)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Version */}
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 bg-[#262626] rounded-lg border border-white/5 flex items-center justify-center text-gray-400">
                                                <BadgeCheck size={20} />
                                            </div>
                                            <div>
                                                <h3 className="text-sm font-bold text-white">Version</h3>
                                                <p className="text-xs text-gray-400 mt-0.5">You are currently using Cluely version 1.0.0</p>
                                            </div>
                                        </div>
                                        <button className="bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors">
                                            Check for updates
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="h-px bg-white/5" />

                            <div>
                                <h3 className="text-sm font-bold text-white mb-4">Advanced API</h3>
                                <div className="space-y-4">
                                    <div className="bg-[#262626] rounded-xl p-5 border border-white/5">
                                        <label className="block text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Gemini API Key</label>
                                        <div className="flex gap-3">
                                            <input
                                                type="password"
                                                value={apiKey}
                                                onChange={(e) => setApiKey(e.target.value)}
                                                placeholder="AIzaSy..."
                                                className="flex-1 bg-black/50 border border-white/10 rounded-lg px-4 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500 transition-colors"
                                            />
                                            <button className="bg-white/10 hover:bg-white/20 text-white px-5 py-2.5 rounded-lg text-xs font-medium transition-colors">
                                                Save
                                            </button>
                                        </div>
                                    </div>

                                    <div className="bg-[#262626] rounded-xl p-5 border border-white/5">
                                        <label className="block text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Google Cloud Service Account JSON</label>
                                        <div className="flex gap-3">
                                            <div className="flex-1 bg-black/50 border border-white/10 rounded-lg px-4 py-2.5 text-xs text-gray-400 truncate flex items-center">
                                                {serviceAccountPath || "No file selected"}
                                            </div>
                                            <button
                                                onClick={handleSelectServiceAccount}
                                                className="bg-white/10 hover:bg-white/20 text-white px-5 py-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap"
                                            >
                                                Select File
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                    {activeTab === 'keybinds' && (
                        <div className="space-y-5 animated fadeIn select-text h-full flex flex-col justify-center">
                            <div>
                                <h3 className="text-base font-bold text-white mb-1">Keyboard shortcuts</h3>
                                <p className="text-xs text-gray-400">Cluely works with these easy to remember commands.</p>
                            </div>

                            <div className="grid gap-6">
                                {/* General Category */}
                                <div>
                                    <h4 className="text-sm font-bold text-white mb-3">General</h4>
                                    <div className="space-y-1">
                                        {[
                                            { label: 'Toggle Visibility', keys: ['⌘', 'B'], icon: <Eye size={14} /> },
                                            { label: 'Show/Center Natively', keys: ['⌘', '⇧', 'Space'], icon: <Layout size={14} /> },
                                            { label: 'Process Screenshots', keys: ['⌘', 'Enter'], icon: <MessageSquare size={14} /> },
                                            { label: 'Reset / Cancel', keys: ['⌘', 'R'], icon: <RotateCcw size={14} /> },
                                            { label: 'Take Screenshot', keys: ['⌘', 'H'], icon: <Camera size={14} /> },
                                            { label: 'Selective Screenshot', keys: ['⌘', '⇧', 'H'], icon: <Crop size={14} /> },
                                        ].map((item, i) => (
                                            <div key={i} className="flex items-center justify-between py-1.5 group">
                                                <div className="flex items-center gap-3">
                                                    <span className="text-gray-400 group-hover:text-white transition-colors">{item.icon}</span>
                                                    <span className="text-sm text-gray-300 font-medium group-hover:text-white transition-colors">{item.label}</span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    {item.keys.map((k, j) => (
                                                        <span key={j} className="bg-[#262626] text-gray-300 px-2 py-1 rounded-md text-xs font-sans min-w-[24px] text-center shadow-sm border border-white/5">
                                                            {k}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Window Category */}
                                <div>
                                    <h4 className="text-sm font-bold text-white mb-3">Window</h4>
                                    <div className="space-y-1">
                                        {[
                                            { label: 'Move Window Up', keys: ['⌘', '↑'], icon: <ArrowUp size={14} /> },
                                            { label: 'Move Window Down', keys: ['⌘', '↓'], icon: <ArrowDown size={14} /> },
                                            { label: 'Move Window Left', keys: ['⌘', '←'], icon: <ArrowLeft size={14} /> },
                                            { label: 'Move Window Right', keys: ['⌘', '→'], icon: <ArrowRight size={14} /> }
                                        ].map((item, i) => (
                                            <div key={i} className="flex items-center justify-between py-1.5 group">
                                                <div className="flex items-center gap-3">
                                                    <span className="text-gray-400 group-hover:text-white transition-colors">{item.icon}</span>
                                                    <span className="text-sm text-gray-300 font-medium group-hover:text-white transition-colors">{item.label}</span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    {item.keys.map((k, j) => (
                                                        <span key={j} className="bg-[#262626] text-gray-300 px-2 py-1 rounded-md text-xs font-sans min-w-[24px] text-center shadow-sm border border-white/5">
                                                            {k}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'audio' && (
                        <div className="space-y-6 animated fadeIn">
                            <div>
                                <h3 className="text-lg font-medium text-white mb-4">Audio Configuration</h3>
                                <div className="space-y-4">
                                    <CustomSelect
                                        label="Input Device"
                                        icon={<Mic size={16} />}
                                        value={selectedInput}
                                        options={inputDevices}
                                        onChange={setSelectedInput}
                                        placeholder="Default Microphone"
                                    />

                                    <div>
                                        <div className="flex justify-between text-xs text-gray-400 mb-2 px-1">
                                            <span>Input Level</span>
                                        </div>
                                        <div className="h-1.5 bg-[#262626] rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-green-500 transition-all duration-100 ease-out"
                                                style={{ width: `${micLevel}%` }}
                                            />
                                        </div>
                                    </div>

                                    <div className="h-px bg-white/5 my-4" />

                                    <CustomSelect
                                        label="Output Device"
                                        icon={<Speaker size={16} />}
                                        value={selectedOutput}
                                        options={outputDevices}
                                        onChange={setSelectedOutput}
                                        placeholder="Default Speakers"
                                    />

                                    <div className="flex justify-end">
                                        <button
                                            onClick={() => {
                                                const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3'); // Simple test sound
                                                // Try to set sinkId if supported
                                                if (selectedOutput && (audio as any).setSinkId) {
                                                    (audio as any).setSinkId(selectedOutput)
                                                        .catch((e: any) => console.error("Error setting sink", e));
                                                }
                                                audio.play().catch(e => console.error("Error playing test sound", e));
                                            }}
                                            className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-md transition-colors flex items-center gap-2"
                                        >
                                            <Speaker size={12} /> Test Sound
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SettingsOverlay;
