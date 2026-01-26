import React, { useState, useEffect } from 'react';
import { X, Mic, Speaker, Monitor, Keyboard, User, LifeBuoy, LogOut } from 'lucide-react';

interface SettingsOverlayProps {
    isOpen: boolean;
    onClose: () => void;
}

const SettingsOverlay: React.FC<SettingsOverlayProps> = ({ isOpen, onClose }) => {
    const [activeTab, setActiveTab] = useState('general');
    const [isDetectable, setIsDetectable] = useState(true);
    const [openOnLogin, setOpenOnLogin] = useState(false);

    // Audio Settings
    const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
    const [selectedInput, setSelectedInput] = useState('');
    const [micLevel, setMicLevel] = useState(0);

    const [apiKey, setApiKey] = useState('');

    useEffect(() => {
        if (isOpen) {
            // Load settings
            window.navigator.mediaDevices.enumerateDevices().then(devices => {
                const inputs = devices.filter(d => d.kind === 'audioinput');
                setInputDevices(inputs);
                if (inputs.length > 0) setSelectedInput(inputs[0].deviceId);
            });

            // Simulating level check
            const interval = setInterval(() => {
                setMicLevel(Math.random() * 100);
            }, 100);
            return () => clearInterval(interval);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-8 animated fadeIn">
            <div className="bg-[#121212] w-full max-w-4xl h-[80vh] rounded-2xl border border-white/10 shadow-2xl flex overflow-hidden">
                {/* Sidebar */}
                <div className="w-64 bg-[#0a0a0a] flex flex-col border-r border-white/5">
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
                                <Mic size={16} /> Audio & Video
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
                <div className="flex-1 overflow-y-auto bg-[#121212] p-8">
                    {activeTab === 'general' && (
                        <div className="space-y-8 animated fadeIn">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-lg font-medium text-white">Detectable Mode</h3>
                                    <p className="text-sm text-gray-400 mt-1">Hide Cluely from screen sharing tools like Zoom and Teams.</p>
                                </div>
                                <div
                                    onClick={() => {
                                        const newState = !isDetectable;
                                        setIsDetectable(newState);
                                        window.electronAPI?.setUndetectable(!newState);
                                    }}
                                    className={`w-12 h-6 rounded-full relative cursor-pointer transition-colors ${isDetectable ? 'bg-white/10' : 'bg-green-600'}`}
                                >
                                    <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${isDetectable ? 'translate-x-0' : 'translate-x-6'}`} />
                                </div>
                            </div>

                            <div className="h-px bg-white/5" />

                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-lg font-medium text-white">Open at Login</h3>
                                    <p className="text-sm text-gray-400 mt-1">Automatically launch Cluely when you start your computer.</p>
                                </div>
                                <div
                                    onClick={() => setOpenOnLogin(!openOnLogin)}
                                    className={`w-12 h-6 rounded-full relative cursor-pointer transition-colors ${!openOnLogin ? 'bg-white/10' : 'bg-blue-600'}`}
                                >
                                    <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${!openOnLogin ? 'translate-x-0' : 'translate-x-6'}`} />
                                </div>
                            </div>

                            <div className="h-px bg-white/5" />

                            <div>
                                <h3 className="text-lg font-medium text-white mb-4">API Configuration</h3>
                                <div className="bg-[#1a1a1a] rounded-xl p-4 border border-white/5">
                                    <label className="block text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Gemini API Key</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="password"
                                            value={apiKey}
                                            onChange={(e) => setApiKey(e.target.value)}
                                            placeholder="AIzaSy..."
                                            className="flex-1 bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
                                        />
                                        <button className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                                            Save
                                        </button>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-2">Required for intelligence features.</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'audio' && (
                        <div className="space-y-8 animated fadeIn">
                            <div>
                                <h3 className="text-lg font-medium text-white mb-4">Microphone</h3>
                                <div className="bg-[#1a1a1a] rounded-xl p-4 border border-white/5">
                                    <label className="block text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Input Device</label>
                                    <select
                                        value={selectedInput}
                                        onChange={(e) => setSelectedInput(e.target.value)}
                                        className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors appearance-none"
                                    >
                                        {inputDevices.map(device => (
                                            <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
                                        ))}
                                        {inputDevices.length === 0 && <option>Default Microphone</option>}
                                    </select>

                                    <div className="mt-6">
                                        <div className="flex justify-between text-xs text-gray-400 mb-2">
                                            <span>Input Level</span>
                                            <span>{Math.round(micLevel)}%</span>
                                        </div>
                                        <div className="h-2 bg-black/50 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-green-500 transition-all duration-100 ease-out"
                                                style={{ width: `${micLevel}%` }}
                                            />
                                        </div>
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
