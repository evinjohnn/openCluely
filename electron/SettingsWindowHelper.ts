import { BrowserWindow, screen } from "electron"
import path from "node:path"

const isDev = process.env.NODE_ENV === "development"

const startUrl = isDev
    ? "http://localhost:5173"
    : `file://${path.join(__dirname, "../dist/index.html")}`

export class SettingsWindowHelper {
    private settingsWindow: BrowserWindow | null = null
    private advancedWindow: BrowserWindow | null = null

    // Store offsets relative to main window
    private offsetX: number = 0
    private offsetY: number = 0

    constructor() { }

    public toggleWindow(x?: number, y?: number): void {
        const mainWindow = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w !== this.settingsWindow && w !== this.advancedWindow);
        if (mainWindow && x !== undefined && y !== undefined) {
            const bounds = mainWindow.getBounds();
            this.offsetX = x - bounds.x;
            this.offsetY = y - (bounds.y + bounds.height);
        }

        if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
            if (this.settingsWindow.isVisible()) {
                this.settingsWindow.hide()
            } else {
                this.showWindow(x, y)
            }
        } else {
            this.createWindow(x, y)
        }
    }

    public showWindow(x?: number, y?: number): void {
        if (!this.settingsWindow || this.settingsWindow.isDestroyed()) {
            this.createWindow(x, y)
            return
        }

        if (x !== undefined && y !== undefined) {
            this.settingsWindow.setPosition(Math.round(x), Math.round(y))
        }

        // Ensure fully visible on screen
        this.ensureVisibleOnScreen();
        this.settingsWindow.show()
        this.settingsWindow.focus()
        this.emitVisibilityChange(true);
    }

    public reposition(mainBounds: Electron.Rectangle): void {
        if (!this.settingsWindow || !this.settingsWindow.isVisible() || this.settingsWindow.isDestroyed()) return;

        const newX = mainBounds.x + this.offsetX;
        const newY = mainBounds.y + mainBounds.height + this.offsetY;

        this.settingsWindow.setPosition(Math.round(newX), Math.round(newY));

        // Also update advanced window if visible
        if (this.advancedWindow && this.advancedWindow.isVisible()) {
            const { width } = this.settingsWindow.getBounds();
            this.advancedWindow.setPosition(Math.round(newX + width + 10), Math.round(newY));
        }
    }

    public closeWindow(): void {
        if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
            this.settingsWindow.hide()
            this.emitVisibilityChange(false);
        }
        this.closeAdvancedWindow();
    }

    public toggleAdvancedWindow(): void {
        if (this.advancedWindow && !this.advancedWindow.isDestroyed()) {
            if (this.advancedWindow.isVisible()) {
                this.advancedWindow.hide();
            } else {
                this.showAdvancedWindow();
            }
        } else {
            this.createAdvancedWindow();
        }
    }

    public showAdvancedWindow(): void {
        if (!this.settingsWindow || !this.settingsWindow.isVisible()) return;

        if (!this.advancedWindow || this.advancedWindow.isDestroyed()) {
            this.createAdvancedWindow();
            return;
        }

        const { x, y, width } = this.settingsWindow.getBounds();
        this.advancedWindow.setPosition(x + width + 10, y);
        this.advancedWindow.show();
        this.advancedWindow.focus();
    }

    public closeAdvancedWindow(): void {
        if (this.advancedWindow && !this.advancedWindow.isDestroyed()) {
            this.advancedWindow.hide();
        }
    }

    private emitVisibilityChange(isVisible: boolean): void {
        const mainWindow = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w !== this.settingsWindow && w !== this.advancedWindow);
        if (mainWindow) {
            mainWindow.webContents.send('settings-visibility-changed', isVisible);
        }
    }

    private createWindow(x?: number, y?: number): void {
        const windowSettings: Electron.BrowserWindowConstructorOptions = {
            width: 280, // Increased for shadow padding
            height: 280,
            frame: false,
            transparent: true,
            resizable: false,
            fullscreenable: false,
            hasShadow: false,
            alwaysOnTop: true,
            show: false,
            skipTaskbar: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: true,
                preload: path.join(__dirname, "preload.js")
            }
        }

        if (x !== undefined && y !== undefined) {
            windowSettings.x = Math.round(x)
            windowSettings.y = Math.round(y)
        }

        this.settingsWindow = new BrowserWindow(windowSettings)
        console.log(`[SettingsWindowHelper] Creating Settings Window with Content Protection: ${this.contentProtection}`);
        this.settingsWindow.setContentProtection(this.contentProtection);

        // Load with query param
        const settingsUrl = isDev
            ? `${startUrl}?window=settings`
            : `${startUrl}?window=settings` // file url also works with search params in modern Electron

        this.settingsWindow.loadURL(settingsUrl)

        this.settingsWindow.once('ready-to-show', () => {
            this.settingsWindow?.show()
        })

        // Hide on blur instead of close, to keep state? 
        // Or just let user close it. 
        // User asked for "independent window", maybe sticky?
        // Let's keep it simple: clicks outside close it if we want "popover" behavior.
        // For now, let it stay open until toggled or ESC.
        this.settingsWindow.on('blur', () => {
            // Check if focus moved to advanced window
            if (this.advancedWindow && this.advancedWindow.isFocused()) return;
            this.closeWindow();
        })


    }

    private createAdvancedWindow(): void {
        if (!this.settingsWindow) return; // Must have main settings first relative positioning

        const { x, y, width } = this.settingsWindow.getBounds();

        this.advancedWindow = new BrowserWindow({
            width: 320, // Slightly wider for inputs
            height: 400,
            x: x + width + 10,
            y: y,
            frame: false,
            transparent: true,
            resizable: false,
            fullscreenable: false,
            hasShadow: false,
            alwaysOnTop: true,
            show: false,
            skipTaskbar: true,
            parent: this.settingsWindow, // Make it a child of settings? Or independent? Independent is safer for now.
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: true,
                preload: path.join(__dirname, "preload.js")
            }
        });

        const advancedUrl = isDev
            ? `${startUrl}?window=advanced`
            : `${startUrl}?window=advanced`

        this.advancedWindow.loadURL(advancedUrl);

        this.advancedWindow.once('ready-to-show', () => {
            this.advancedWindow?.show();
        });
    }

    private ensureVisibleOnScreen() {
        if (!this.settingsWindow) return;
        const { x, y, width, height } = this.settingsWindow.getBounds();
        const display = screen.getDisplayNearestPoint({ x, y });
        const bounds = display.workArea;

        let newX = x;
        let newY = y;

        if (x + width > bounds.x + bounds.width) {
            newX = bounds.x + bounds.width - width;
        }
        if (y + height > bounds.y + bounds.height) {
            newY = bounds.y + bounds.height - height;
        }

        this.settingsWindow.setPosition(newX, newY);
    }
    private contentProtection: boolean = true; // Track state

    public setContentProtection(enable: boolean): void {
        console.log(`[SettingsWindowHelper] Setting content protection to: ${enable}`);
        this.contentProtection = enable;

        if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
            this.settingsWindow.setContentProtection(enable);
        }

        if (this.advancedWindow && !this.advancedWindow.isDestroyed()) {
            this.advancedWindow.setContentProtection(enable);
        }
    }
}
