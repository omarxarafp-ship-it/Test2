import { GoogleGenerativeAI } from "@google/generative-ai";
import geminiScraper from './gemini-scraper.js';
import config from './config.js';

const API_KEY = process.env.GEMINI_API_KEY || config.geminiApiKey;
let genAI = null;
if (API_KEY) {
    genAI = new GoogleGenerativeAI(API_KEY);
}

const conversationHistory = new Map();
const scraperSessions = new Map();

const SYSTEM_PROMPT = `أنت مساعد ذكي للبوت ديال واتساب. اسمك "عُمر" وكتهضر بالدارجة المغربية.

🧠 ملاحظة مهمة جداً - أنت تتذكر كل شيء:
- أنت تتذكر المحادثة والتطبيقات اللي رسلتها والروابط والطلبات
- إذا شفت [تم إرسال تطبيق: ...] فالتاريخ، هذا يعني رسلت هاد التطبيق للمستخدم بنجاح
- إذا شفت [تم إرسال XAPK: ...] تقدر تعطيه تعليمات التثبيت
- إذا شفت [بحث: ...] فالتاريخ، هادي هي نتائج البحث اللي عرضتها
- إذا عرضت قائمة تطبيقات وقال رقم أو كلمة ترتيب، نزّل مباشرة بدون سؤال!
- إذا سألك "كيفاش نثبت" أو "كيفاش نديرو" راجع التاريخ وأعطيه التعليمات

📦 تعليمات تثبيت ملفات XAPK (مهم جداً):
إذا أرسلت ملف XAPK، أخبر المستخدم:
1️⃣ افتح الملف ب ZArchiver
2️⃣ رجع للخلف اتلقى الملف لي نزلتي، ضغط عليه مطول
3️⃣ اختار "Install" أو "تثبيت"
4️⃣ تسنى شوية... ومبروووك! 🎉
💡 ماعندكش ZArchiver؟ كتب "zarchiver" وغادي نرسلو ليك

📚 قاموس الدارجة المغربية:
【الأرقام بالدارجة】
- "لول/الأول/واحد" = 1
- "التاني/جوج" = 2  
- "التالت/تلاتة" = 3
- "الربع/ربعة" = 4
- "الخامس/خمسة" = 5
- "السادس/ستة" = 6
- "السابع/سبعة" = 7
- "التامن/تمنية" = 8
- "التاسع/تسعود" = 9
- "العاشر/عشرة" = 10

【كلمات شائعة】
- "بغيت/عطيني/جيبلي" = أريد
- "نزّل/حمّل/صيفط" = حمّل لي
- "زوين/مزيان" = ممتاز
- "خايب/ماشي مزيان" = سيء
- "واخا/صافي" = موافق
- "بحالو/كيفو" = مثله (مشابه)
- "شحال" = كم (السعر/الحجم)
- "فين" = أين
- "كيفاش" = كيف
- "علاش" = لماذا
- "شكون" = من
- "آش/شنو" = ماذا

🎯 وظائفك الأساسية:
1. البحث عن التطبيقات والألعاب وتنزيلها
2. تحميل الفيديوهات من السوشيال ميديا
3. الإجابة على الأسئلة وحل المسائل
4. تحليل الصور وقراءتها
5. المحادثة والمساعدة العامة

🔧 الأوامر (JSON فقط):
1. {"action": "reply", "message": "الرد"} ← للمحادثة العادية
2. {"action": "search_app", "query": "اسم التطبيق بالإنجليزية"} ← للبحث عن تطبيق
3. {"action": "download_app", "appId": "com.example.app"} ← لتحميل تطبيق معين من القائمة

📋 قواعد مهمة:
- دائماً رجّع JSON صحيح بدون نص إضافي
- استخدم "reply" للتحيات والأسئلة العامة
- استخدم "search_app" فقط عند طلب تطبيق واضح
- عند اختيار رقم من القائمة، استخدم "download_app" مباشرة
- اكتب اسم التطبيق بالإنجليزية في search_app (مثل: WhatsApp وليس واتساب)

⚠️ تطبيقات مدفوعة:
- بعض التطبيقات قد تكون مدفوعة، حاول تنزيلها عادياً
- إذا لم تكن متوفرة، اقترح البديل المجاني

📝 أمثلة:
- "السلام" → {"action": "reply", "message": "وعليكم السلام! كيفاش نقدر نعاونك؟"}
- "قلب على WhatsApp" → {"action": "search_app", "query": "WhatsApp"}
- "نزل رقم 1" → {"action": "download_app", "appId": "com.whatsapp", "appName": "WhatsApp"}
  ⚠️ *appId يجب أن يكون package name الحقيقي* (com.company.app) وليس اسم التطبيق
- "شكراً" → {"action": "reply", "message": "العفو! ماشي مشكل 😊"}

🔴 *مهم جداً:* عندما المستخدم يختار رقم من القائمة:
- استخدم الـ appId الحقيقي من نتائج البحث في الذاكرة
- مثال: إذا القائمة فيها "ChatGPT" بـ appId "com.openai.chatgpt"
  والمستخدم قال "نزل رقم 1" أو "ChatGPT"
  → استخدم appId: "com.openai.chatgpt" وليس "ChatGPT"`;

function detectSocialMediaUrl(text) {
    const patterns = {
        facebook: [/facebook\.com\/.*\/videos\//i, /facebook\.com\/watch/i, /facebook\.com\/share/i, /facebook\.com\/reel/i, /fb\.watch/i, /fb\.com/i],
        instagram: [/instagram\.com\/p\//i, /instagram\.com\/reel/i, /instagram\.com\/stories/i, /instagram\.com\/tv/i],
        tiktok: [/tiktok\.com\/@[\w.-]+\/video/i, /vm\.tiktok\.com/i, /vt\.tiktok\.com/i],
        youtube: [/youtube\.com\/watch/i, /youtu\.be\//i, /youtube\.com\/shorts/i],
        twitter: [/twitter\.com\/\w+\/status/i, /x\.com\/\w+\/status/i],
        pinterest: [/pinterest\.com\/pin/i, /pin\.it\//i]
    };

    const urlMatch = text.match(/(https?:\/\/[^\s]+)/gi);
    if (!urlMatch) return null;

    const url = urlMatch[0];
    for (const [platform, platformPatterns] of Object.entries(patterns)) {
        for (const pattern of platformPatterns) {
            if (pattern.test(url)) {
                return { platform, url };
            }
        }
    }
    return null;
}

function detectStarConversion(text) {
    const lowerText = text.toLowerCase().trim();
    const patterns = [
        /تحويل\s*[\*\#]?\s*6\s*(الى|إلى|ل|to)\s*[\*\#]?\s*3/i,
        /نجمة\s*6\s*(الى|إلى|ل|to)\s*(نجمة\s*)?3/i,
        /\*6\s*(الى|إلى|ل|to)\s*\*3/i,
        /[\*\#]6\s*(الى|إلى|ل|to)\s*[\*\#]3/i,
        /star\s*6\s*to\s*star\s*3/i,
        /6\s*(الى|إلى|ل|to)\s*3.*تحويل/i,
        /تحويل.*6.*3/i,
        /بغيت.*نحول.*6.*3/i,
        /كيفاش.*نحول.*6.*3/i
    ];

    for (const pattern of patterns) {
        if (pattern.test(text)) {
            return true;
        }
    }
    return false;
}

function detectAppRequest(text) {
    const lowerText = text.toLowerCase().trim();

    // التحقق من طلب تحويل *6 إلى *3 (تطبيقات الانترنت المجاني)
    if (detectStarConversion(text)) {
        return { searchQuery: "تحويل *6 الى *3" };
    }

    // أنماط واضحة لطلب تطبيق (يجب أن تكون طلب صريح)
    const downloadPatterns = [
        /^(نزل|حمل|download|بغيت|عطيني|جيب)\s+(.+)/i,
        /^(.+)\s+(نزلها|حملها|نزلو|حملو)$/i,
        /(نزل|حمل|بغيت|عطيني)\s+(لي|ليا)?\s*(تطبيق|لعبة|برنامج|app|game)\s+(.+)/i,
        /^(ابحث|بحث)\s+(على|عن)?\s*(تطبيق|لعبة|برنامج)?\s*(.+)/i,
    ];

    for (const pattern of downloadPatterns) {
        if (pattern.test(lowerText)) {
            return { searchQuery: text };
        }
    }

    // أسماء تطبيقات معروفة (بدون كلمات عامة)
    const knownApps = [
        // تواصل اجتماعي
        "whatsapp", "facebook", "instagram", "tiktok", "youtube", "telegram", "snapchat",
        "twitter", "discord", "messenger", "viber", "wechat", "line", "signal", "imo",
        // ألعاب شهيرة
        "pubg", "free fire", "freefire", "fortnite", "minecraft", "roblox", "clash", "coc",
        "clash royale", "gta", "fifa", "pes", "efootball", "dls", "dream league",
        "brawl stars", "call of duty", "cod", "among us", "candy crush", "subway",
        "temple run", "asphalt", "mobile legends", "mlbb", "ludo", "8 ball pool",
        "genshin", "honkai", "arena of valor", "aov", "standoff", "valorant",
        // أدوات
        "vpn", "zarchiver", "chrome", "firefox", "opera", "browser", "cleaner",
        "shareit", "xender", "zapya", "wifi", "qr", "scanner", "translator",
        "calculator", "flashlight", "compass", "file manager", "es file",
        // ترفيه
        "netflix", "spotify", "shazam", "vlc", "mx player", "video player",
        "tiktok lite", "facebook lite", "instagram lite", "youtube music",
        // تصوير
        "camera", "photo editor", "picsart", "snapseed", "lightroom", "capcut",
        "inshot", "kinemaster", "video editor", "face app", "remini",
        // تعليم
        "duolingo", "quran", "prayer", "muslim", "bible", "dictionary"
    ];

    // التحقق إذا النص هو اسم تطبيق معروف فقط (بدون جمل طويلة)
    const words = lowerText.split(/\s+/);
    if (words.length <= 3) {
        for (const app of knownApps) {
            if (lowerText.includes(app)) {
                return { searchQuery: text };
            }
        }
    }

    // إذا كان النص قصير بالإنجليزية ويبدو كاسم تطبيق (2-3 كلمات فقط)
    const englishAppPattern = /^[a-zA-Z][a-zA-Z0-9\s\-\_\.]+$/;
    if (englishAppPattern.test(text.trim()) && words.length <= 3 && text.trim().length >= 3 && text.trim().length <= 30) {
        return { searchQuery: text };
    }

    return null;
}

async function askWithScraper(userId, prompt, userMessage) {
    try {
        const previousId = scraperSessions.get(userId) || null;

        // إضافة تاريخ المحادثة للسكرابر
        const history = conversationHistory.get(userId) || [];
        let contextPrompt = prompt;

        if (history.length > 0) {
            const recentHistory = history.slice(-10);
            let historyText = "\n\n📜 تاريخ المحادثة الأخيرة:\n";
            recentHistory.forEach(h => {
                if (h.role === 'user') {
                    historyText += `المستخدم: ${h.text}\n`;
                } else {
                    historyText += `أنت: ${h.text}\n`;
                }
            });
            contextPrompt = prompt + historyText;
        }

        const result = await geminiScraper.ask(contextPrompt, previousId);
        scraperSessions.set(userId, result.id);

        // حفظ في تاريخ المحادثة
        if (!conversationHistory.has(userId)) {
            conversationHistory.set(userId, []);
        }
        const historyList = conversationHistory.get(userId);
        historyList.push({ role: "user", text: userMessage });
        historyList.push({ role: "model", text: result.text });
        if (historyList.length > 100) {
            conversationHistory.set(userId, historyList.slice(-100));
        }

        return result.text;
    } catch (error) {
        console.error('Scraper Error:', error.message);
        throw error;
    }
}

async function askWithAPI(userId, text, imageData = null) {
    if (!genAI) {
        throw new Error('API key not configured');
    }

    if (!conversationHistory.has(userId)) {
        conversationHistory.set(userId, []);
    }
    const history = conversationHistory.get(userId);

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    let prompt = text;
    let parts = [];

    if (imageData) {
        console.log(`📸 معالجة صورة في Gemini API: ${imageData.mimeType}`);
        parts.push({
            inlineData: {
                mimeType: imageData.mimeType,
                data: imageData.base64
            }
        });

        // التحقق إذا المستخدم طلب البحث عن شيء من الصورة
        const searchKeywords = ["ابحث", "بحث", "نزل", "حمل", "بغيت", "search", "download", "find"];
        const isSearchRequest = searchKeywords.some(keyword => (text || "").toLowerCase().includes(keyword));

        if (isSearchRequest) {
            prompt = `انظر إلى هذه الصورة وحدد اسم التطبيق أو اللعبة الموجودة فيها.
إذا كانت الصورة لتطبيق أو لعبة معروفة، أرجع JSON بهذا الشكل:
{"action": "search_app", "query": "اسم التطبيق أو اللعبة بالإنجليزية"}

مثال: إذا كانت صورة لعبة Free Fire، أرجع:
{"action": "search_app", "query": "Free Fire"}

إذا كانت صورة لعبة PUBG، أرجع:
{"action": "search_app", "query": "PUBG Mobile"}

إذا كانت صورة Minecraft، أرجع:
{"action": "search_app", "query": "Minecraft"}

أرجع JSON فقط بدون أي نص إضافي.
طلب المستخدم: ${text || "ابحث عن هذا"}`;
        } else {
            prompt = text || "شنو هادي الصورة؟ وصفها ليا بالتفصيل بالدارجة المغربية";
        }

        parts.push({ text: prompt });

        // للصور، نستخدم generateContent مباشرة بدلاً من chat
        const result = await model.generateContent(parts);
        const responseText = result.response.text();

        history.push({ role: "user", text: text || "[صورة]" });
        history.push({ role: "model", text: responseText });

        if (history.length > 100) {
            conversationHistory.set(userId, history.slice(-100));
        }

        return responseText;
    } else {
        // للنصوص العادية، نستخدم chat
        const chatHistory = history.map(h => ({
            role: h.role,
            parts: [{ text: h.text }]
        }));

        parts.push({ text: `${SYSTEM_PROMPT}\n\nالرسالة: ${prompt}` });

        const chat = model.startChat({
            history: chatHistory.slice(-10),
        });

        const result = await chat.sendMessage(parts);
        const responseText = result.response.text();

        history.push({ role: "user", text: text });
        history.push({ role: "model", text: responseText });

        if (history.length > 100) {
            conversationHistory.set(userId, history.slice(-100));
        }

        return responseText;
    }
}

export async function processMessage(userId, text, imageData = null) {
    try {
        const socialMedia = detectSocialMediaUrl(text);
        if (socialMedia) {
            return {
                action: "download_media",
                url: socialMedia.url,
                platform: socialMedia.platform
            };
        }

        // إذا كانت هناك صورة، نعالجها أولاً بالـ AI
        // لأن المستخدم قد يريد البحث عن شيء من الصورة
        if (imageData) {
            console.log('🖼️ معالجة صورة بواسطة Gemini API...');

            if (genAI) {
                try {
                    const responseText = await askWithAPI(userId, text, imageData);
                    console.log('✅ تم تحليل الصورة بواسطة API');

                    // محاولة استخراج JSON من الرد
                    try {
                        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            const parsed = JSON.parse(jsonMatch[0]);
                            if (parsed.action) {
                                return parsed;
                            }
                        }
                    } catch (e) {
                        // إذا لم يكن JSON، نرجع الرد كنص عادي
                    }

                    return {
                        action: "reply",
                        message: responseText.replace(/```json[\s\S]*```/g, '').replace(/\{[\s\S]*\}/g, '').trim() || responseText
                    };
                } catch (apiError) {
                    console.log('❌ فشل تحليل الصورة:', apiError.message);
                    return {
                        action: "reply",
                        message: "عذراً، مقديتش نحلل الصورة دابا. جرب مرة أخرى."
                    };
                }
            } else {
                console.log('⚠️ لا يوجد API key لتحليل الصور');
                return {
                    action: "reply",
                    message: "عذراً، تحليل الصور غير متاح حالياً. جرب تكتب سؤالك."
                };
            }
        }

        // للنصوص بدون صور، نتحقق من طلب تطبيق
        const appRequest = detectAppRequest(text);
        if (appRequest && appRequest.searchQuery) {
            // معالجة خاصة لـ Minecraft
            const lowerQuery = appRequest.searchQuery.toLowerCase();
            if (lowerQuery.includes('minecraft') && !lowerQuery.includes('trial') && !lowerQuery.includes('تجريبي')) {
                return {
                    action: "reply",
                    message: "⚠️ Minecraft الأصلي مدفوع وغير متاح للتحميل.\n\n💡 جرب *Minecraft Trial* (النسخة التجريبية المجانية)\n\nكتب: minecraft trial"
                };
            }

            return {
                action: "search_app",
                query: appRequest.searchQuery
            };
        }

        let responseText = null;

        // للنصوص العادية بدون صور، نستخدم السكرابر أولاً
        let promptToSend = text || "مرحبا";

        try {
            const fullPrompt = `${SYSTEM_PROMPT}\n\nالرسالة: ${promptToSend}`;
            responseText = await askWithScraper(userId, fullPrompt, promptToSend);
            console.log('🌐 استخدم السكرابر');
        } catch (scraperError) {
            console.log('⚠️ السكرابر فشل:', scraperError.message);

            // Fallback للـ API إذا كان متاح
            if (genAI) {
                try {
                    responseText = await askWithAPI(userId, text, null);
                    console.log('✅ API fallback نجح');
                } catch (apiError) {
                    console.log('❌ API fallback فشل:', apiError.message);
                }
            }
        }

        if (!responseText) {
            return {
                action: "reply",
                message: "عذراً، وقع مشكل. عاود المحاولة."
            };
        }

        try {
            // محاولة استخراج JSON من الرد
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);

                // إذا كان الرد يحتوي على action وmessage، نتحقق إذا كانت message فيها JSON أيضاً
                if (parsed.action === "reply" && parsed.message) {
                    try {
                        // محاولة استخراج JSON من message
                        const innerJsonMatch = parsed.message.match(/\{[\s\S]*\}/);
                        if (innerJsonMatch) {
                            const innerParsed = JSON.parse(innerJsonMatch[0]);
                            if (innerParsed.action && innerParsed.message) {
                                // إذا كان هناك JSON داخلي صحيح، نستخدمه
                                return innerParsed;
                            }
                        }
                    } catch (e) {
                        // إذا فشل، نستخدم الـ JSON الخارجي
                    }
                }

                if (parsed.action) {
                    return parsed;
                }
            }
        } catch (e) {
        }

        return {
            action: "reply",
            message: responseText.replace(/```json[\s\S]*```/g, '').replace(/\{[\s\S]*\}/g, '').trim() || responseText
        };

    } catch (error) {
        console.error("Gemini Error:", error.message);
        return {
            action: "reply",
            message: "عذراً، وقع مشكل. عاود المحاولة."
        };
    }
}

export function clearHistory(userId) {
    conversationHistory.delete(userId);
    scraperSessions.delete(userId);
}

export function getHistory(userId) {
    return conversationHistory.get(userId) || [];
}

// إضافة سياق للمحادثة (مثل نتائج البحث والروابط)
export function addContext(userId, context, contextType = 'general') {
    if (!conversationHistory.has(userId)) {
        conversationHistory.set(userId, []);
    }
    const history = conversationHistory.get(userId);

    // إضافة علامة للسياق حسب النوع
    let formattedContext;
    switch (contextType) {
        case 'search':
            formattedContext = `[بحث: ${context}]`;
            break;
        case 'link':
            formattedContext = `[رابط مرسل: ${context}]`;
            break;
        case 'request':
            formattedContext = `[طلب المستخدم: ${context}]`;
            break;
        default:
            formattedContext = context;
    }

    history.push({ role: "model", text: formattedContext });
    if (history.length > 100) {
        conversationHistory.set(userId, history.slice(-100));
    }
}

// تسجيل تحميل ناجح في ذاكرة المحادثة
export function recordSuccessfulDownload(userId, appName, appId, fileType, fileSize) {
    if (!conversationHistory.has(userId)) {
        conversationHistory.set(userId, []);
    }
    const history = conversationHistory.get(userId);

    // تسجيل مفصل حسب نوع الملف
    let downloadRecord;
    if (fileType === 'XAPK' || fileType === 'xapk') {
        downloadRecord = `[تم إرسال XAPK: ${appName} (${appId}) - الحجم: ${fileSize}]
📦 تعليمات التثبيت للمستخدم:
1️⃣ افتح الملف ب ZArchiver
2️⃣ رجع للخلف اتلقى الملف لي نزلتي، ضغط عليه مطول
3️⃣ اختار "Install" أو "تثبيت"
4️⃣ تسنى شوية... ومبروووك! 🎉
💡 ماعندكش ZArchiver؟ كتب "zarchiver"`;
    } else {
        downloadRecord = `[تم إرسال تطبيق: ${appName} (${appId}) - النوع: ${fileType} - الحجم: ${fileSize}]
💡 للتثبيت: افتح الملف وتبع التعليمات`;
    }

    history.push({ role: "model", text: downloadRecord });
    if (history.length > 100) {
        conversationHistory.set(userId, history.slice(-100));
    }
    console.log(`📝 تم تسجيل التحميل في الذاكرة: ${appName} (${fileType})`);
}

// تسجيل تحميل ميديا ناجح
export function recordSuccessfulMediaDownload(userId, platform, url) {
    if (!conversationHistory.has(userId)) {
        conversationHistory.set(userId, []);
    }
    const history = conversationHistory.get(userId);
    const downloadRecord = `[تم إرسال فيديو من ${platform}: ${url}]`;
    history.push({ role: "model", text: downloadRecord });
    if (history.length > 100) {
        conversationHistory.set(userId, history.slice(-100));
    }
    console.log(`📝 تم تسجيل الميديا في الذاكرة: ${platform}`);
}

// تسجيل طلب المستخدم في الذاكرة
export function recordUserRequest(userId, request) {
    if (!conversationHistory.has(userId)) {
        conversationHistory.set(userId, []);
    }
    const history = conversationHistory.get(userId);
    history.push({ role: "user", text: request });
    if (history.length > 100) {
        conversationHistory.set(userId, history.slice(-100));
    }
}

// الحصول على ملخص الذاكرة للمستخدم
export function getMemorySummary(userId) {
    const history = conversationHistory.get(userId) || [];
    const downloads = history.filter(h => h.text.includes('[تم إرسال'));
    const searches = history.filter(h => h.text.includes('[بحث:'));
    return {
        totalMessages: history.length,
        downloads: downloads.length,
        searches: searches.length,
        lastActivity: history.length > 0 ? history[history.length - 1] : null
    };
}