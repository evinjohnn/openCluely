
import { app, shell, net } from 'electron';
import http from 'http';
import fs from 'fs';
import path from 'path';

// --- CONFIGURATION ---
// User must provide these in Settings or via Environment variables
// For dev, we can use placeholders or load from a config file.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'PLACEHOLDER_CLIENT_ID';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'PLACEHOLDER_CLIENT_SECRET';
const REDIRECT_URI = 'http://localhost:3000/callback'; // Fixed port for simplicity in MVP

interface TokenData {
    access_token: string;
    refresh_token?: string;
    expiry_date?: number;
}

export class CalendarService {
    private tokens: TokenData | null = null;
    private tokenPath: string;

    constructor() {
        // Securely store tokens in userData
        this.tokenPath = path.join(app.getPath('userData'), 'calendar_tokens.json');
        this.loadTokens();
    }

    private loadTokens() {
        try {
            if (fs.existsSync(this.tokenPath)) {
                this.tokens = JSON.parse(fs.readFileSync(this.tokenPath, 'utf8'));
            }
        } catch (e) {
            console.error('Failed to load calendar tokens', e);
        }
    }

    private saveTokens(tokens: TokenData) {
        this.tokens = tokens;
        fs.writeFileSync(this.tokenPath, JSON.stringify(tokens), 'utf8');
    }

    public async connect(): Promise<boolean> {
        return new Promise((resolve, reject) => {
            if (GOOGLE_CLIENT_ID.startsWith('PLACEHOLDER')) {
                console.error("Google Client ID not set");
                // Simulate connection for UI testing if in dev mode
                if (process.env.NODE_ENV === 'development') {
                    this.saveTokens({ access_token: 'mock_token', expiry_date: Date.now() + 3600000 });
                    setTimeout(() => resolve(true), 1000);
                    return;
                }
                reject(new Error("Missing Google Client ID"));
                return;
            }

            const server = http.createServer(async (req, res) => {
                if (req.url?.startsWith('/callback')) {
                    const urlParams = new URL(req.url, `http://localhost:3000`);
                    const code = urlParams.searchParams.get('code');

                    if (code) {
                        res.end('Authentication successful! You can close this window.');
                        server.close();

                        try {
                            const tokens = await this.exchangeCodeForToken(code);
                            this.saveTokens(tokens);
                            resolve(true);
                        } catch (err) {
                            reject(err);
                        }
                    } else {
                        res.end('Authentication failed.');
                        server.close();
                        reject(new Error("No code received"));
                    }
                }
            });

            server.listen(3000, () => {
                const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=https://www.googleapis.com/auth/calendar.readonly email&access_type=offline&prompt=consent`;
                shell.openExternal(authUrl);
            });

            server.on('error', (err) => {
                server.close();
                reject(err);
            });
        });
    }

    public disconnect() {
        this.tokens = null;
        if (fs.existsSync(this.tokenPath)) {
            fs.unlinkSync(this.tokenPath);
        }
    }

    private async exchangeCodeForToken(code: string): Promise<TokenData> {
        const body = new URLSearchParams({
            code,
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            redirect_uri: REDIRECT_URI,
            grant_type: 'authorization_code'
        });

        const response = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            body: body,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (!response.ok) throw new Error('Token exchange failed');
        return response.json() as Promise<TokenData>;
    }

    // MVP: Just mock the fetch event for verify step if in dev and no tokens
    public async getUpcomingMeetings(): Promise<any[]> {
        if (!this.tokens) {
            // Mock data for UI development if not connected
            // Or return empty
            return [];
        }

        // Check expiry and refresh if needed (omitted for MVP brevity, but critical for prod)

        const now = new Date();
        const timeMin = now.toISOString();
        const timeMax = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

        try {
            if (this.tokens.access_token === 'mock_token') {
                // Return fake events
                return [{
                    id: 'mock_1',
                    summary: 'Team Sync',
                    start: { dateTime: new Date(now.getTime() + 15 * 60000).toISOString() }, // in 15 mins
                    end: { dateTime: new Date(now.getTime() + 45 * 60000).toISOString() },
                    htmlLink: 'https://meet.google.com/abc-defg-hij'
                }];
            }

            const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`, {
                headers: {
                    'Authorization': `Bearer ${this.tokens.access_token}`
                }
            });

            if (!response.ok) {
                if (response.status === 401) {
                    this.disconnect(); // easy way out for now
                    throw new Error("Auth expired");
                }
                return [];
            }

            const data = await response.json();
            return (data.items || [])
                .filter((e: any) => {
                    // Filter logic
                    const start = new Date(e.start.dateTime || e.start.date);
                    const end = new Date(e.end.dateTime || e.end.date);
                    const durationMs = end.getTime() - start.getTime();
                    const isAllDay = !e.start.dateTime; // Simple check for all-day

                    return durationMs >= 5 * 60000 && !isAllDay;
                })
                .map((e: any) => ({
                    id: e.id,
                    title: e.summary,
                    startTime: e.start.dateTime,
                    endTime: e.end.dateTime,
                    link: e.htmlLink,
                    source: 'calendar'
                }));

        } catch (e) {
            console.error("Failed to fetch calendar", e);
            return [];
        }
    }

    public getStatus() {
        return {
            connected: !!this.tokens,
            email: 'user@example.com' // TODO: Fetch from UserInfo endpoint
        };
    }
}
