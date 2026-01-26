import React, { createContext, useContext, useEffect, useState } from 'react';

type ThemePreference = 'dark' | 'light' | 'system';
type EffectiveTheme = 'dark' | 'light';

interface ThemeContextType {
    theme: ThemePreference;
    setTheme: (theme: ThemePreference) => void;
    effectiveTheme: EffectiveTheme;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // Default to 'dark' to match current source of truth
    const [theme, setThemeState] = useState<ThemePreference>('dark');
    const [effectiveTheme, setEffectiveTheme] = useState<EffectiveTheme>('dark');

    // 1. Initialize from Backend
    useEffect(() => {
        if (window.electronAPI && window.electronAPI.getTheme) {
            window.electronAPI.getTheme().then((savedTheme: any) => {
                if (savedTheme) {
                    setThemeState(savedTheme);
                }
            });
        }
    }, []);

    // 2. Listen for Effective Theme Changes (from System or Manual)
    useEffect(() => {
        // Apply to DOM
        const applyTheme = (eff: EffectiveTheme) => {
            const root = document.documentElement;
            if (eff === 'light') {
                root.setAttribute('data-theme', 'light');
            } else {
                root.removeAttribute('data-theme'); // Default is dark
            }
        };

        // If we have API support, listen to it
        if (window.electronAPI && window.electronAPI.onThemeUpdate) {
            // Backend sends us the resolved effective theme based on our preference + system status
            const removeListener = window.electronAPI.onThemeUpdate((newEffectiveTheme: EffectiveTheme) => {
                setEffectiveTheme(newEffectiveTheme);
                applyTheme(newEffectiveTheme);
            });
            return () => removeListener();
        } else {
            // Fallback for development / no-backend (Manual only)
            // If system, we'd need window.matchMedia here, but backend should handle "System" logic ideally.
            // For now, if no backend, just map directly 
            const eff = theme === 'system'
                ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
                : theme;

            setEffectiveTheme(eff);
            applyTheme(eff);
        }
    }, [theme]);

    // 3. Set Theme Handler
    const setTheme = (newTheme: ThemePreference) => {
        setThemeState(newTheme);
        if (window.electronAPI && window.electronAPI.setTheme) {
            window.electronAPI.setTheme(newTheme);
        }
    };

    return (
        <ThemeContext.Provider value={{ theme, setTheme, effectiveTheme }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
};
