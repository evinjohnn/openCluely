import { nativeTheme, app, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

export type ThemePreference = 'dark' | 'light' | 'system';
export type EffectiveTheme = 'dark' | 'light';

export class ThemeManager {
    private preference: ThemePreference = 'dark'; // Default
    private configPath: string;

    constructor() {
        this.configPath = path.join(app.getPath('userData'), 'theme-config.json');
        this.loadConfig();

        // Apply initial preference
        nativeTheme.themeSource = this.preference;

        // Listen for system changes (only fires if themeSource is 'system')
        nativeTheme.on('updated', () => {
            this.broadcastThemeUpdate();
        });
    }

    private loadConfig() {
        try {
            if (fs.existsSync(this.configPath)) {
                const data = fs.readFileSync(this.configPath, 'utf-8');
                const config = JSON.parse(data);
                if (config.theme && ['dark', 'light', 'system'].includes(config.theme)) {
                    this.preference = config.theme as ThemePreference;
                }
            }
        } catch (e) {
            console.error('[ThemeManager] Failed to load config', e);
        }
    }

    private saveConfig() {
        try {
            fs.writeFileSync(this.configPath, JSON.stringify({ theme: this.preference }), 'utf-8');
        } catch (e) {
            console.error('[ThemeManager] Failed to save config', e);
        }
    }

    public setTheme(theme: ThemePreference) {
        console.log(`[ThemeManager] Setting theme to: ${theme}`);
        this.preference = theme;
        try {
            nativeTheme.themeSource = theme;
        } catch (e) {
            console.error("Error setting nativeTheme.themeSource", e);
        }
        this.saveConfig();
        this.broadcastThemeUpdate();
    }

    public getTheme(): ThemePreference {
        return this.preference;
    }

    public getEffectiveTheme(): EffectiveTheme {
        return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
    }

    private broadcastThemeUpdate() {
        const effective = this.getEffectiveTheme();
        console.log(`[ThemeManager] Broadcasting effective theme: ${effective}`);
        BrowserWindow.getAllWindows().forEach(win => {
            if (!win.isDestroyed()) {
                win.webContents.send('theme-updated', effective);
            }
        });
    }
}
