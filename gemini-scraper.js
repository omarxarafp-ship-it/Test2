import fetch from 'node-fetch';

const geminiScraper = {
    cookie: null,
    lastCookieTime: 0,
    COOKIE_TTL: 30 * 60 * 1000,

    getNewCookie: async function () {
        try {
            const r = await fetch("https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=maGuAc&source-path=%2F&bl=boq_assistant-bard-web-server_20250814.06_p1&f.sid=-7816331052118000090&hl=en-US&_reqid=173780&rt=c", {
                "headers": {
                    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
                },
                "body": "f.req=%5B%5B%5B%22maGuAc%22%2C%22%5B0%5D%22%2Cnull%2C%22generic%22%5D%5D%5D&",
                "method": "POST",
                "timeout": 15000
            });
            const cookieHeader = r.headers.get('set-cookie');
            if (!cookieHeader) throw new Error('Could not get cookie');
            this.cookie = cookieHeader.split(';')[0];
            this.lastCookieTime = Date.now();
            console.log('🍪 تجدد الكوكي بنجاح');
            return this.cookie;
        } catch (error) {
            console.error('❌ فشل الحصول على كوكي:', error.message);
            throw error;
        }
    },

    getCookie: async function () {
        if (this.cookie && (Date.now() - this.lastCookieTime) < this.COOKIE_TTL) {
            return this.cookie;
        }
        return await this.getNewCookie();
    },

    ask: async function (prompt, previousId = null, retries = 2) {
        if (typeof prompt !== "string" || !prompt?.trim()?.length) {
            throw new Error('Invalid prompt');
        }

        let resumeArray = null;
        let cookie = null;

        if (previousId) {
            try {
                const s = Buffer.from(previousId, 'base64').toString('utf-8');
                const j = JSON.parse(s);
                resumeArray = j.newResumeArray;
                cookie = j.cookie;
            } catch (e) {
                previousId = null;
            }
        }

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const headers = {
                    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
                    "x-goog-ext-525001261-jspb": "[1,null,null,null,\"9ec249fc9ad08861\",null,null,null,[4]]",
                    "cookie": cookie || await this.getCookie(),
                    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                };

                const b = [[prompt], ["en-US"], resumeArray];
                const a = [null, JSON.stringify(b)];
                const obj = { "f.req": JSON.stringify(a) };
                const body = new URLSearchParams(obj);

                const response = await fetch(`https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=boq_assistant-bard-web-server_20250729.06_p0&f.sid=4206607810970164620&hl=en-US&_reqid=2813378&rt=c`, {
                    headers,
                    body,
                    method: 'POST'
                });

                if (!response.ok) {
                    if (response.status === 429 || response.status === 401) {
                        this.cookie = null;
                        if (attempt < retries) {
                            console.log(`⚠️ إعادة المحاولة ${attempt + 1}/${retries}...`);
                            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                            continue;
                        }
                    }
                    throw new Error(`HTTP ${response.status}`);
                }

                const data = await response.text();
                const match = data.matchAll(/^\d+\n(.+?)\n/gm);
                const chunks = Array.from(match, m => m[1]);
                
                let text, newResumeArray;
                let found = false;

                for (const chunk of chunks.reverse()) {
                    try {
                        const realArray = JSON.parse(chunk);
                        const parse1 = JSON.parse(realArray[0][2]);

                        if (parse1 && parse1[4] && parse1[4][0] && parse1[4][0][1] && typeof parse1[4][0][1][0] === 'string') {
                            newResumeArray = [...parse1[1], parse1[4][0][0]];
                            text = parse1[4][0][1][0].replace(/\*\*(.+?)\*\*/g, `*$1*`);
                            found = true;
                            break;
                        }
                    } catch (e) {
                    }
                }

                if (!found) {
                    throw new Error("Could not parse response");
                }

                const id = Buffer.from(JSON.stringify({ newResumeArray, cookie: headers.cookie })).toString('base64');
                return { text, id };

            } catch (error) {
                if (attempt === retries) {
                    throw error;
                }
                this.cookie = null;
                await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
            }
        }
    }
};

const userSessions = new Map();

export async function askGemini(userId, prompt) {
    const previousId = userSessions.get(userId) || null;
    const result = await geminiScraper.ask(prompt, previousId);
    userSessions.set(userId, result.id);
    return result.text;
}

export function resetSession(userId) {
    userSessions.delete(userId);
}

export function resetAllSessions() {
    userSessions.clear();
}

export default geminiScraper;
