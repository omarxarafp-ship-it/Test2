/**
 * AppOmar WhatsApp Bot - Configuration File
 * تعديل هذا الملف لتغيير إعدادات البوت
 */

const config = {
    // مفتاح API
    geminiApiKey: 'AIzaSyBndjJTNgeyN2Ithg5Oue4NKEL4EaSE7H0',
    
    // معلومات المطور
    developer: {
        phones: ['212718938088', '234905250308102'],
        instagramUrl: 'https://www.instagram.com/omarxarafp',
        poweredBy: '\n\n> © من طرف AppOmar',
        pluginBranding: `\n\n*تابعني على انستجرام*\ninstagram.com/omarxarafp\n\n> © من طرف AppOmar`
    },

    // إعدادات البوت
    bot: {
        profileImageUrl: 'https://i.ibb.co/fYXc7sQx/Screenshot-2025-12-03-16-15-57-737-com-android-chrome-edit.jpg',
        vipPassword: 'Omar',
        presenceMode: 'unavailable',
        maxFileSize: 2 * 1024 * 1024 * 1024,
        zarchiverPackage: 'ru.zdevs.zarchiver'
    },

    // حدود السبيام والحماية
    limits: {
        spam: {
            fastMessages: 5,
            fastMessageWindow: 10000,
            messagesPerHour: 25,
            maxConcurrentDownloads: 3
        },
        downloads: {
            maxConcurrentDownloads: 3,
            downloadSpamThreshold: 10
        }
    },

    // تأخيرات الرسائل
    delays: {
        authenticated: {
            messageDelay: 0,
            maxConcurrentDownloads: 10,
            messagesPerHour: 50
        },
        unauthenticated: {
            messageDelay: 0,
            maxConcurrentDownloads: 3,
            messagesPerHour: 25
        }
    },

    // إعدادات إعادة الاتصال
    connection: {
        maxReconnectAttempts: 5,
        baseReconnectDelay: 10000,
        keepAliveInterval: 55000,
        connectTimeout: 60000,
        queryTimeout: 120000
    },

    // إعدادات API
    api: {
        baseUrl: process.env.API_URL || 'http://localhost:8000',
        headersTimeout: 600000,
        bodyTimeout: 600000,
        maxRetries: 3
    },

    // إعدادات البحث
    search: {
        maxResults: 8,
        sources: {
            googlePlay: true,
            apkPure: true
        },
        preferGooglePlay: true
    },

    // رسائل البوت بالدارجة
    messages: {
        welcome: (userInfo, cfg) => `*بوت AppOmar المتعدد الوظائف*

مرحبا بيك آ ${userInfo.name}
النمرة ديالك: +${userInfo.phone}${userInfo.status ? `\nالحالة: ${userInfo.status}` : ''}

🎯 *وظائف البوت:*

📱 *تحميل التطبيقات (APK/XAPK):*
◄ صيفط اسم التطبيق بالإنجليزية
◄ اختار من القائمة
◄ استقبل الملف مباشرة

📥 *تحميل من المنصات:*
◄ 🎬 *YouTube* - فيديوهات وقصيرة
◄ 📸 *Instagram* - صور وفيديوهات وريلز
◄ 📘 *Facebook* - فيديوهات وريلز
◄ 🎵 *TikTok* - فيديوهات
◄ 🐦 *Twitter/X* - فيديوهات وتغريدات
◄ 📌 *Pinterest* - صور وفيديوهات
◄ 📁 *Google Drive* - ملفات مباشرة
◄ 🔥 *Mediafire* - روابط تحميل

💡 *كيفاش تستعمل البوت:*

للتطبيقات:
1️⃣ صيفط اسم التطبيق (WhatsApp, Minecraft...)
2️⃣ اختار الرقم من اللائحة
3️⃣ استقبل الملف

للمنصات:
◄ صيفط الرابط مباشرة
◄ البوت يحمل ويرسل ليك تلقائياً

🔧 *أوامر مفيدة:*
/help - المساعدة
/commands - الأوامر
/history - سجل التحميلات
zarchiver - تنزيل مثبت XAPK

⚠️ *قوانين الاستعمال:*
◄ ماكثرش من 25 ميساج فالساعة
◄ ماديرش كثر من 3 تحميلات متتابعة
◄ المكالمات = بلوك أوتوماتيكي
◄ السبيام = بلوك نهائي

🌟 *VIP Access:*
باش تحصل على تحميلات لامحدودة، تواصل مع المطور وخد كود VIP`,

        vipActivated: `🌟 *VIP تفعّل*

◄ تحميلات بلا حدود
◄ سرعة زوينة
◄ أولوية فالطلبات`,

        downloading: (appTitle) => `📥 *كنحمّل ${appTitle}...*

⏳ تسنى شوية، غادي نرسل ليك الرابط`,

        downloadComplete: (appTitle, fileSize, fileType) => `✅ *${appTitle}*

📦 الحجم: ${fileSize}
📄 النوع: ${fileType.toUpperCase()}`,

        searchResults: (query, count) => `🔍 *نتائج البحث: "${query}"*

لقيت ${count} تطبيق(ات)
ختار رقم التطبيق:`,

        noResults: (query) => `❌ ما لقيتش "${query}"

💡 نصائح:
• تأكد من الكتابة صحيحة
• جرّب اسم آخر
• كتب الاسم بالإنجليزية`,

        waitingDownload: `⏳ صبر شوية، غادي نرسل ليك التطبيق...`,

        spamWarning: `⚠️ *تحذير*

كتكتب بزاف ديال الميساجات بسرعة
صبر شوية باش نجاوبك`,

        blockedSpam: `⛔ *تحظرّت*

❌ رسائل كثيرة فالساعة
📊 الحد: 25 ميساج فالساعة

إذا بغيت توضح، تواصل مع المطور`,

        blockedDownloadSpam: `⛔ *تحظرّت*

❌ تجاوزت الحد ديال التحميلات
📊 الحد: 10 تحميلات متتابعة

💡 نصيحة: صيفط الطلبات بشوية بشوية`,

        blockedCall: `⛔ *تحظرّت*

❌ المكالمات ممنوعة

باش تتواصل مع المطور:`,

        blockedFastSpam: `⛔ *تحظرّت نهائياً*

❌ رسائل سريعة بزاف
📊 الحد: 5 رسائل ف10 ثواني

السبيام ممنوع!`,

        error: `❌ وقع مشكل. عاود المحاولة.`,

        fileTooLarge: (size) => `❌ الملف كبير بزاف: ${size}

⚠️ واتساب ما كيقبلش ملفات أكبر من 2GB`,

        zarchiverDownloading: `📦 كننزّل ZArchiver...`,

        xapkTutorial: (fileName) => {
            const appName = fileName.replace(/\.(xapk|apk)$/i, '');
            return `
📦 *كيفاش تثبت ${appName}:*

1️⃣ افتح الملف ب *ZArchiver*
2️⃣ رجع للخلف اتلقى الملف لي نزلتي
ضغط عليه مطول
3️⃣ اختار "Install" أو "تثبيت"
4️⃣ تسنى شوية... ومبروووك! 🎉

💡 ماعندكش ZArchiver؟ كتب *zarchiver* وغادي نرسلو ليك`;
        },

        zipObbTutorial: (fileName, packageId) => {
            const appName = fileName.replace(/\.(zip|xapk|apk)$/i, '');
            return `
📦 *كيفاش تثبت ${appName}:*

1️⃣ افتح الملف ب *ZArchiver*
2️⃣ غادي تلقى:
   • ملف APK ديال التطبيق
   • مجلد فيه ملفات OBB

3️⃣ *ثبت APK أولاً:*
   - ضغط مطول على ملف APK
   - اختار "Install" أو "تثبيت"

4️⃣ *نقل ملفات OBB:*
   - انسخ المجلد ب اسم  ${packageId}
   - ضغط مطول على ملف ${packageId}
   - اختار "نسخ" أو "Copy"
   - روح لـ: Android/obb/ 
   - لصق الملف هنا

5️⃣ افتح التطبيق ومبروووك! 🎉

💡 ماعندكش ZArchiver؟ كتب *zarchiver* وغادي نرسلو ليك`;
        }
    },

    // تنظيف الملفات
    cleanup: {
        maxFileAge: 30 * 60 * 1000,
        cleanupInterval: 10 * 60 * 1000
    },

    // الكاش
    cache: {
        groupMetadataTimeout: 300000,
        messageStoreLimit: 1000
    }
};

export default config;
