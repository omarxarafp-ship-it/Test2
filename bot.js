import makeWASocket, { DisconnectReason, Browsers, jidDecode, jidNormalizedUser, useMultiFileAuthState, downloadMediaMessage } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import apkpure from './apkpure-search.js';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from 'pg';
const { Pool } = pkg;
import { request } from 'undici';
import axios from 'axios';
import sharp from 'sharp';
import AdmZip from 'adm-zip';
import config from './config.js';
import { processMessage, clearHistory, addContext, recordSuccessfulDownload, recordSuccessfulMediaDownload, recordSearchFailure, formatResultsWithGemini } from './gemini-brain.js';

const loadedPlugins = [];

async function loadPlugins() {
    const pluginsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'plugins');
    
    if (!fs.existsSync(pluginsDir)) {
        console.log('📁 مجلد plugins غير موجود');
        return;
    }
    
    const pluginFiles = fs.readdirSync(pluginsDir).filter(file => file.endsWith('.js'));
    
    for (const file of pluginFiles) {
        try {
            const pluginPath = path.join(pluginsDir, file);
            const plugin = await import(`file://${pluginPath}`);
            
            if (plugin.default && plugin.default.patterns && plugin.default.handler) {
                loadedPlugins.push(plugin.default);
                console.log(`✅ Plugin تحمّل: ${plugin.default.name || file}`);
            }
        } catch (error) {
            console.error(`❌ فشل تحميل plugin ${file}:`, error.message);
        }
    }
    
    console.log(`📦 تحمّلو ${loadedPlugins.length} plugins`);
}

function extractUrl(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/gi;
    const matches = text.match(urlRegex);
    const url = matches ? matches[0] : null;
    if (url) {
        console.log(`🔗 تم استخراج رابط: ${url}`);
    }
    return url;
}

function findMatchingPlugin(url) {
    console.log(`🔍 البحث عن plugin للرابط: ${url}`);
    for (const plugin of loadedPlugins) {
        for (const pattern of plugin.patterns) {
            if (pattern.test(url)) {
                console.log(`✅ تم العثور على plugin: ${plugin.name}`);
                return plugin;
            }
        }
    }
    console.log(`❌ لم يتم العثور على plugin للرابط`);
    return null;
}

async function handlePluginUrl(sock, remoteJid, url, msg, senderPhone) {
    console.log(`🔌 محاولة معالجة الرابط بواسطة plugin: ${url}`);
    
    const plugin = findMatchingPlugin(url);
    
    if (!plugin) {
        console.log(`⚠️ لا يوجد plugin مناسب للرابط: ${url}`);
        return false;
    }
    
    console.log(`🎯 Plugin سيعالج: ${plugin.name} - ${url}`);
    
    const utils = {
        poweredBy: config.developer.pluginBranding,
        react: async (sock, msg, emoji) => {
            try {
                await sock.sendMessage(remoteJid, { react: { text: emoji, key: msg.key } });
            } catch (e) {
                console.error(`❌ فشل إرسال تفاعل:`, e.message);
            }
        }
    };
    
    try {
        await plugin.handler(sock, remoteJid, url, msg, utils);
        console.log(`✅ تمت معالجة الرابط بنجاح بواسطة ${plugin.name}`);
        return true;
    } catch (error) {
        console.error(`❌ خطأ في plugin ${plugin.name}:`, error.message);
        console.error(error);
        return false;
    }
}

const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const suppressPatterns = [
    /Closing session/i,
    /Closing open session/i,
    /in favor of incoming/i,
    /prekey bundle/i,
    /SessionEntry/,
    /_chains:/,
    /registrationId:/,
    /currentRatchet:/,
    /ephemeralKeyPair:/,
    /lastRemoteEphemeralKey:/,
    /previousCounter:/,
    /rootKey:/,
    /indexInfo:/,
    /baseKey:/,
    /pendingPreKey:/,
    /signedKeyId:/,
    /preKeyId:/,
    /chainKey:/,
    /chainType:/,
    /messageKeys:/,
    /remoteIdentityKey:/,
    /<Buffer/,
    /Buffer </,
    /privKey:/,
    /pubKey:/,
    /closed:/,
    /used:/,
    /created:/,
    /baseKeyType:/,
    /Failed to decrypt message/,
    /Session error/,
    /Bad MAC/
];

const stringifyArg = (a) => {
    if (typeof a === 'string') return a;
    if (a === null || a === undefined) return '';
    if (a instanceof Error) return a.message || '';
    try {
        return JSON.stringify(a, (key, value) => {
            if (Buffer.isBuffer(value)) return '<Buffer>';
            return value;
        });
    } catch {
        return String(a);
    }
};

console.log = (...args) => {
    const message = args.map(stringifyArg).join(' ');
    if (!suppressPatterns.some(pattern => pattern.test(message))) {
        originalConsoleLog.apply(console, args);
    }
};

console.error = (...args) => {
    const message = args.map(stringifyArg).join(' ');
    if (!suppressPatterns.some(pattern => pattern.test(message))) {
        originalConsoleError.apply(console, args);
    }
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOWNLOADS_DIR = path.join(__dirname, 'downloads');

if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    console.log('📁 تخلق المجلد ديال التحميلات');
}

function cleanupOldDownloads() {
    try {
        const files = fs.readdirSync(DOWNLOADS_DIR);
        const now = Date.now();
        const maxAge = 30 * 60 * 1000;

        for (const file of files) {
            const filePath = path.join(DOWNLOADS_DIR, file);
            const stats = fs.statSync(filePath);
            if (now - stats.mtimeMs > maxAge) {
                fs.unlinkSync(filePath);
                console.log(`🗑️ تحيد ملف قديم: ${file}`);
            }
        }
    } catch (error) {
        console.error('غلطة فتنقية الملفات القديمة:', error.message);
    }
}

setInterval(cleanupOldDownloads, 10 * 60 * 1000);

function analyzeXapkContents(xapkBuffer) {
    try {
        const zip = new AdmZip(xapkBuffer);
        const entries = zip.getEntries();

        let apkFile = null;
        let obbFiles = [];
        let splitApks = [];

        for (const entry of entries) {
            const name = entry.entryName.toLowerCase();

            if (name.endsWith('.obb') && !entry.isDirectory) {
                obbFiles.push({
                    name: entry.entryName,
                    buffer: entry.getData(),
                    size: entry.header.size
                });
            } else if (name.endsWith('.apk') && !entry.isDirectory) {
                if (name === 'base.apk' || name.includes('base')) {
                    apkFile = {
                        name: entry.entryName,
                        buffer: entry.getData(),
                        size: entry.header.size
                    };
                } else if (name.includes('split') || name.includes('config')) {
                    splitApks.push({
                        name: entry.entryName,
                        buffer: entry.getData(),
                        size: entry.header.size
                    });
                } else if (!apkFile) {
                    apkFile = {
                        name: entry.entryName,
                        buffer: entry.getData(),
                        size: entry.header.size
                    };
                }
            }
        }

        const hasApkPlusObb = apkFile && obbFiles.length > 0;
        const hasSplitApks = splitApks.length > 0;

        console.log(`📦 تحليل XAPK: APK=${apkFile ? 'نعم' : 'لا'}, OBB=${obbFiles.length}, Split APKs=${splitApks.length}`);

        return {
            hasApkPlusObb,
            hasSplitApks,
            apkFile,
            obbFiles,
            splitApks
        };
    } catch (error) {
        console.error('❌ خطأ في تحليل XAPK:', error.message);
        return {
            hasApkPlusObb: false,
            hasSplitApks: false,
            apkFile: null,
            obbFiles: [],
            splitApks: []
        };
    }
}

function buildApkObbZip(appDetails, apkFile, obbFiles) {
    try {
        const zip = new AdmZip();

        let sanitizedName = appDetails.title
            .replace(/[<>:"/\\|?*]/g, '')
            .trim()
            .substring(0, 50);

        if (!sanitizedName || sanitizedName.trim() === '') {
            sanitizedName = appDetails.appId || 'app';
        }

        // إضافة ملف APK في الجذر
        const apkFileName = `${sanitizedName}.apk`;
        zip.addFile(apkFileName, apkFile.buffer);
        console.log(`📦 أضفت APK: ${apkFileName}`);

        // إضافة ملفات OBB في مجلد باسم الـ package
        for (const obbFile of obbFiles) {
            const originalObbName = path.basename(obbFile.name);
            const obbPath = `${appDetails.appId}/${originalObbName}`;
            zip.addFile(obbPath, obbFile.buffer);
            console.log(`📦 أضفت OBB: ${obbPath}`);
        }

        const zipBuffer = zip.toBuffer();
        const zipFileName = `${sanitizedName}_مع_OBB.zip`;

        console.log(`✅ تم إنشاء ZIP: ${zipFileName} (${formatFileSize(zipBuffer.length)})`);

        return {
            success: true,
            buffer: zipBuffer,
            fileName: zipFileName,
            size: zipBuffer.length
        };
    } catch (error) {
        console.error('❌ خطأ في إنشاء ZIP:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

const logger = pino({ 
    level: 'silent',
    serializers: {
        err: pino.stdSerializers.err
    }
});

function getZipObbTutorial(fileName, packageId) {
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

function getXapkTutorial(fileName) {
    const appName = fileName.replace(/\.(xapk|apk)$/i, '');
    return `
📦 *كيفاش تثبت ${appName}:*

1️⃣ افتح الملف ب *ZArchiver*
2️⃣ رجع للخلف اتلقى الملف لي نزلتي
ضغط عليه مطول
3️⃣ اختار "Install" أو "تثبيت"
4️⃣ تسنى شوية... ومبروووك! 🎉

💡 ماعندكش ZArchiver؟ كتب *zarchiver* وغادي نرسلو ليك`;
}

function getZArchiverTutorial(fileName) {
    return getXapkTutorial(fileName);
}

const ZARCHIVER_TUTORIAL_BASIC = `
📦 *كيفاش تثبت XAPK:*

1️⃣ افتح الملف ب *ZArchiver*
2️⃣ رجع للخلف اتلقى الملف لي نزلتي
ضغط عليه مطول
3️⃣ اختار "Install" أو "تثبيت"
4️⃣ تسنى شوية... ومبروووك! 🎉

💡 ماعندكش ZArchiver؟ كتب *zarchiver* وغادي نرسلو ليك`;

let pool = null;
let dbEnabled = false;

if (process.env.DATABASE_URL) {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
    });
}

const userSessions = new Map();
const requestQueue = new Map();
const blockedNumbers = new Set();
const vipUsers = new Set();
const hourlyMessageTracker = new Map();
const downloadMessageTracker = new Map();
const fastMessageTracker = new Map();
const groupMetadataCache = new Map();
const messageStore = new Map();
const lidToPhoneMap = new Map();

const DEVELOPER_PHONES = config.developer.phones;
const BOT_PROFILE_IMAGE_URL = config.bot.profileImageUrl;
const INSTAGRAM_URL = `تابعني على انستجرام:\n${config.developer.instagramUrl}`;
const POWERED_BY = config.developer.poweredBy;
const MAX_FILE_SIZE = config.bot.maxFileSize;
const ZARCHIVER_PACKAGE = config.bot.zarchiverPackage;
const VIP_PASSWORD = config.bot.vipPassword;

const USER_LIMITS = {
    authenticated: config.delays.authenticated,
    unauthenticated: config.delays.unauthenticated
};

const SPAM_LIMITS = config.limits.spam;

let botPresenceMode = 'unavailable'; // 'unavailable' or 'available'
let presenceInterval = null;
let keepAliveInterval = null;
let pairingCodeRequested = false;
let globalSock = null;
let botImageBuffer = null;
let xapkInstallerBuffer = null;
let xapkInstallerInfo = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY = 10000;

function getRandomDelay(min = 1000, max = 3000) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}


function getUserLimits(phone) {
    if (isDeveloper(phone)) {
        return USER_LIMITS.authenticated;
    }
    return USER_LIMITS.unauthenticated;
}

function getTypingDuration(textLength) {
    return 0;
}

async function humanDelay(phone = null) {
    let delay;
    if (phone) {
        const limits = getUserLimits(phone);
        delay = limits.messageDelay;
    } else {
        delay = USER_LIMITS.unauthenticated.messageDelay;
    }
    await new Promise(r => setTimeout(r, delay));
}

async function getCachedGroupMetadata(sock, jid) {
    if (groupMetadataCache.has(jid)) {
        const cached = groupMetadataCache.get(jid);
        if (Date.now() - cached.timestamp < 300000) {
            return cached.data;
        }
    }
    try {
        const metadata = await sock.groupMetadata(jid);
        groupMetadataCache.set(jid, { data: metadata, timestamp: Date.now() });
        return metadata;
    } catch (error) {
        console.error('مشكيل فجيبان ديال المجموعة:', error.message);
        return null;
    }
}

function storeMessage(key, message) {
    if (!key || !key.id) return;
    const storeKey = `${key.remoteJid}_${key.id}`;
    messageStore.set(storeKey, message);
    if (messageStore.size > 1000) {
        const keysToDelete = Array.from(messageStore.keys()).slice(0, 200);
        keysToDelete.forEach(k => messageStore.delete(k));
    }
}

function getStoredMessage(key) {
    if (!key || !key.id) return { conversation: '' };
    const storeKey = `${key.remoteJid}_${key.id}`;
    return messageStore.get(storeKey) || { conversation: '' };
}

async function initDatabase() {
    if (!process.env.DATABASE_URL) {
        console.log('⚠️  ما لقيتش DATABASE_URL - البوت خدام بلا قاعدة بيانات');
        dbEnabled = false;
        return;
    }
    try {
        console.log('🗄️  كنراجع قاعدة البيانات...');
        const client = await pool.connect();
        const schemaPath = path.join(__dirname, 'database', 'schema.sql');
        if (fs.existsSync(schemaPath)) {
            const schema = fs.readFileSync(schemaPath, 'utf8');
            await client.query(schema);
            console.log('✅ تأكدت من الجداول فقاعدة البيانات');
        }
        await client.query('SELECT 1');
        client.release();
        dbEnabled = true;
        console.log('✅ قاعدة البيانات تّصلات بنجاح!');
    } catch (error) {
        dbEnabled = false;
        console.error('❌ مشكل فتّاصل مع قاعدة البيانات:', error.message);
        console.log('⚠️  البوت خدام بلا قاعدة بيانات');
    }
}

async function simulateTyping(sock, remoteJid, textLength = 50) {
}

async function sendBotMessage(sock, remoteJid, content, originalMsg = null, options = {}) {
    let senderPhone = options.senderPhone || null;
    
    if (!senderPhone && originalMsg) {
        senderPhone = extractPhoneFromMessage(originalMsg);
    }
    
    const isSticker = content.sticker !== undefined;
    const isSearchResult = options.isSearchResult || false;
    const skipDelay = isSticker || isSearchResult || options.skipDelay;
    
    if (!skipDelay) {
        await humanDelay(senderPhone);
    }

    const messageContent = { ...content };

    if (options.forward) {
        messageContent.contextInfo = {
            ...(messageContent.contextInfo || {}),
            isForwarded: true,
            forwardingScore: 1
        };
    }

    const sendOptions = {};
    if (originalMsg) {
        sendOptions.quoted = originalMsg;
    }

    const sentMsg = await sock.sendMessage(remoteJid, messageContent, sendOptions);
    if (sentMsg && sentMsg.key) {
        storeMessage(sentMsg.key, sentMsg.message);
    }
    return sentMsg;
}

async function downloadBotProfileImage() {
    try {
        if (botImageBuffer) return botImageBuffer;
        console.log('📥 كننزّل صورة البروفايل من URL...');
        const { statusCode, body } = await request(BOT_PROFILE_IMAGE_URL, {
            method: 'GET',
            headersTimeout: 15000,
            bodyTimeout: 15000
        });
        if (statusCode !== 200) throw new Error(`HTTP ${statusCode}`);
        botImageBuffer = Buffer.from(await body.arrayBuffer());
        return botImageBuffer;
    } catch (error) {
        console.error('❌ مشكل فتحميل صورة البوت:', error.message);
        return null;
    }
}

async function downloadXapkInstaller() {
    try {
        if (xapkInstallerBuffer && xapkInstallerInfo) {
            return { buffer: xapkInstallerBuffer, info: xapkInstallerInfo };
        }

        console.log('📥 كننزّل المثبّت ديال XAPK (ZArchiver)...');
        const API_URL = process.env.API_URL || 'http://localhost:8000';

        const { statusCode, headers, body } = await request(`${API_URL}/download/${ZARCHIVER_PACKAGE}`, {
            method: 'GET',
            headersTimeout: 300000,
            bodyTimeout: 300000
        });

        if (statusCode !== 200) throw new Error(`HTTP ${statusCode}`);

        const fileType = headers['x-file-type'] || 'apk';
        const data = Buffer.from(await body.arrayBuffer());
        const fileSize = data.length;

        xapkInstallerBuffer = data;
        xapkInstallerInfo = {
            filename: `ZArchiver.${fileType}`,
            size: fileSize,
            fileType: fileType
        };

        console.log(`✅ تّحمل المثبّت: ${formatFileSize(fileSize)}`);
        return { buffer: xapkInstallerBuffer, info: xapkInstallerInfo };
    } catch (error) {
        console.error('❌ مشكل فتنزيل المثبّت ديال XAPK:', error.message);
        return null;
    }
}

async function setBotProfile(sock) {
    try {
        const imageBuffer = await downloadBotProfileImage();
        if (imageBuffer) {
            await sock.updateProfilePicture(sock.user.id, imageBuffer);
            console.log('✅ تتحدّث صورة البروفايل');
        }
    } catch (error) {
        console.error('⚠️ مشكل فتحديث صورة البروفايل:', error.message);
    }
}


async function getUserProfileInfo(sock, jid, senderPhone, userName) {
    const userInfo = {
        name: userName || 'مستخدم',
        phone: senderPhone,
        profilePic: null,
        status: null,
        about: null
    };

    try {
        try {
            const ppUrl = await sock.profilePictureUrl(jid, 'image');
            if (ppUrl) {
                const { statusCode, body } = await request(ppUrl, {
                    method: 'GET',
                    headersTimeout: 10000,
                    bodyTimeout: 10000
                });
                if (statusCode === 200) {
                    userInfo.profilePic = Buffer.from(await body.arrayBuffer());
                }
            }
        } catch (ppError) {
        }

        try {
            const status = await sock.fetchStatus(jid);
            if (status && status.status) {
                userInfo.status = status.status;
            }
        } catch (statusError) {
        }

    } catch (error) {
    }

    return userInfo;
}

function decodeJid(jid) {
    if (!jid) return null;
    try {
        const decoded = jidDecode(jid);
        return decoded;
    } catch (error) {
        return null;
    }
}

function isLidFormat(jid) {
    if (!jid) return false;
    return jid.endsWith('@lid') || jid.includes('@lid');
}

function getSenderPhone(remoteJid, participant, altJid = null) {
    let jid = remoteJid;
    if (remoteJid.endsWith('@g.us') && participant) {
        jid = participant;
    }

    const decoded = decodeJid(jid);
    if (!decoded) {
        return jid.replace('@s.whatsapp.net', '').replace(/@.*$/, '');
    }

    if (decoded.server === 'lid') {
        if (altJid) {
            const altDecoded = decodeJid(altJid);
            if (altDecoded && altDecoded.server === 's.whatsapp.net') {
                lidToPhoneMap.set(jid, altDecoded.user);
                return altDecoded.user;
            }
        }
        if (lidToPhoneMap.has(jid)) {
            return lidToPhoneMap.get(jid);
        }
        return decoded.user;
    }

    return decoded.user || jid.replace('@s.whatsapp.net', '').replace(/@.*$/, '');
}

function isValidPhoneNumber(phone) {
    if (!phone) return false;
    const cleaned = phone.replace(/\D/g, '');
    return cleaned.length >= 10 && cleaned.length <= 15 && /^\d+$/.test(cleaned);
}

function getUserId(remoteJid, participant) {
    if (remoteJid.endsWith('@g.us') && participant) {
        return participant;
    }
    return remoteJid;
}

function extractPhoneFromMessage(msg) {
    const remoteJid = msg.key?.remoteJid;
    const participant = msg.key?.participant;
    const remoteJidAlt = msg.key?.remoteJidAlt;
    const participantAlt = msg.key?.participantAlt;

    let altJid = null;
    if (remoteJid?.endsWith('@g.us') && participantAlt) {
        altJid = participantAlt;
    } else if (remoteJidAlt) {
        altJid = remoteJidAlt;
    }

    return getSenderPhone(remoteJid, participant, altJid);
}

function isDeveloper(phone) {
    const cleanPhone = phone.replace(/\D/g, '');
    return DEVELOPER_PHONES.some(devPhone => cleanPhone === devPhone || cleanPhone.endsWith(devPhone));
}

async function checkBlacklist(phone) {
    if (blockedNumbers.has(phone)) return true;
    if (!dbEnabled) return false;
    try {
        const result = await pool.query('SELECT * FROM blacklist WHERE phone_number = $1', [phone]);
        if (result.rows.length > 0) {
            blockedNumbers.add(phone);
            return true;
        }
        return false;
    } catch (error) {
        return false;
    }
}

async function blockUser(phone, reason, sock = null) {
    blockedNumbers.add(phone);
    console.log(`🚫 تبلوكى: ${phone} - السبب: ${reason}`);

    // Use Baileys to actually block the user on WhatsApp
    const socketToUse = sock || globalSock;
    if (socketToUse) {
        try {
            const jid = `${phone}@s.whatsapp.net`;
            await socketToUse.updateBlockStatus(jid, 'block');
            console.log(`✅ تبلوكى الرقم فواتساب: ${phone}`);
        } catch (blockError) {
            console.error('❌ مشكل فتبلوكى الرقم فواتساب:', blockError.message);
        }
    }

    if (!dbEnabled) return;
    try {
        await pool.query('INSERT INTO blacklist (phone_number, reason) VALUES ($1, $2) ON CONFLICT (phone_number) DO NOTHING', [phone, reason]);
    } catch (error) {
        console.error('خطأ فإضافة للبلوك ليست:', error);
    }
}

async function unblockUser(phone, sock = null) {
    blockedNumbers.delete(phone);
    console.log(`✅ تفتح البلوك: ${phone}`);

    // Use Baileys to actually unblock the user on WhatsApp
    const socketToUse = sock || globalSock;
    if (socketToUse) {
        try {
            const jid = `${phone}@s.whatsapp.net`;
            await socketToUse.updateBlockStatus(jid, 'unblock');
            console.log(`✅ تفتح البلوك فواتساب: ${phone}`);
        } catch (unblockError) {
            console.error('❌ مشكل فتفتح البلوك فواتساب:', unblockError.message);
        }
    }

    if (!dbEnabled) return true;
    try {
        await pool.query('DELETE FROM blacklist WHERE phone_number = $1', [phone]);
        return true;
    } catch (error) {
        return false;
    }
}

async function updateUserActivity(phone, userName) {
    if (!dbEnabled) return;
    if (!isValidPhoneNumber(phone)) {
        console.log(`⚠️  ما حفظتش رقم ما صالح: ${phone}`);
        return;
    }
    try {
        await pool.query(
            'INSERT INTO users (phone_number, username, last_activity) VALUES ($1, $2, NOW()) ON CONFLICT (phone_number) DO UPDATE SET last_activity = NOW(), username = $2',
            [phone, userName]
        );
    } catch (error) {}
}

function checkFastSpam(phone) {
    if (isDeveloper(phone)) return 'ok';
    if (vipUsers.has(phone)) return 'ok';
    
    const now = Date.now();
    const fastWindow = SPAM_LIMITS.fastMessageWindow || 10000;
    const fastLimit = SPAM_LIMITS.fastMessages || 5;
    
    let tracker = fastMessageTracker.get(phone);
    if (!tracker) {
        tracker = { messages: [] };
        fastMessageTracker.set(phone, tracker);
    }
    
    tracker.messages = tracker.messages.filter(t => now - t < fastWindow);
    tracker.messages.push(now);
    
    if (tracker.messages.length > fastLimit) {
        console.log(`🚨 سبيام سريع من ${phone}: ${tracker.messages.length} رسائل ف${fastWindow / 1000} ثواني`);
        return 'block';
    }
    
    if (tracker.messages.length >= fastLimit - 1) {
        return 'warning';
    }
    
    return 'ok';
}

function checkHourlySpam(phone) {
    if (isDeveloper(phone)) return 'ok';
    if (vipUsers.has(phone)) return 'ok';
    
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    let tracker = hourlyMessageTracker.get(phone);
    if (!tracker) {
        tracker = { messages: [] };
        hourlyMessageTracker.set(phone, tracker);
    }
    tracker.messages = tracker.messages.filter(t => now - t < oneHour);
    tracker.messages.push(now);
    
    const hourlyLimit = SPAM_LIMITS.messagesPerHour || 25;
    if (tracker.messages.length > hourlyLimit) {
        return 'block';
    }
    return 'ok';
}

function checkDownloadSpam(phone) {
    if (isDeveloper(phone)) return 'ok';
    if (vipUsers.has(phone)) return 'ok';
    let tracker = downloadMessageTracker.get(phone);
    if (!tracker) return 'ok';
    const limits = getUserLimits(phone);
    if (tracker.count >= limits.maxConcurrentDownloads) {
        return 'block';
    }
    tracker.count++;
    downloadMessageTracker.set(phone, tracker);
    return 'ok';
}

function startDownloadTracking(phone) {
    downloadMessageTracker.set(phone, { count: 0 });
}

function stopDownloadTracking(phone) {
    downloadMessageTracker.delete(phone);
}

async function logDownload(userPhone, appId, appName, fileType, fileSize) {
    if (!dbEnabled) return;
    if (!isValidPhoneNumber(userPhone)) return;
    try {
        await pool.query(
            'INSERT INTO downloads (user_phone, app_id, app_name, file_type, file_size) VALUES ($1, $2, $3, $4, $5)',
            [userPhone, appId, appName, fileType, fileSize]
        );
        await pool.query('UPDATE users SET total_downloads = total_downloads + 1 WHERE phone_number = $1', [userPhone]);
    } catch (error) {}
}

async function getStats() {
    if (!dbEnabled) return null;
    try {
        const usersResult = await pool.query('SELECT COUNT(*) as total FROM users');
        const downloadsResult = await pool.query('SELECT COUNT(*) as total, SUM(file_size) as total_size FROM downloads');
        const todayDownloads = await pool.query("SELECT COUNT(*) as total FROM downloads WHERE created_at >= CURRENT_DATE");
        const topApps = await pool.query('SELECT app_name, COUNT(*) as count FROM downloads GROUP BY app_name ORDER BY count DESC LIMIT 5');
        const blockedResult = await pool.query('SELECT COUNT(*) as total FROM blacklist');
        return {
            totalUsers: usersResult.rows[0].total,
            totalDownloads: downloadsResult.rows[0].total,
            totalSize: downloadsResult.rows[0].total_size || 0,
            todayDownloads: todayDownloads.rows[0].total,
            topApps: topApps.rows,
            blockedUsers: blockedResult.rows[0].total
        };
    } catch (error) {
        return null;
    }
}

async function broadcastMessage(sock, message) {
    if (!dbEnabled) return { success: 0, failed: 0 };
    try {
        const users = await pool.query('SELECT phone_number FROM users');
        let success = 0, failed = 0;
        for (const user of users.rows) {
            try {
                if (!isValidPhoneNumber(user.phone_number)) {
                    failed++;
                    continue;
                }
                const jid = `${user.phone_number}@s.whatsapp.net`;
                await sock.sendMessage(jid, { text: `📢 *مساج من المطور*\n\n${message}${POWERED_BY}` });
                success++;
                await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));
            } catch { failed++; }
        }
        return { success, failed };
    } catch (error) {
        return { success: 0, failed: 0 };
    }
}

async function getUserHistory(phone) {
    if (!dbEnabled) return [];
    try {
        const result = await pool.query('SELECT app_name, file_type, created_at FROM downloads WHERE user_phone = $1 ORDER BY created_at DESC LIMIT 10', [phone]);
        return result.rows;
    } catch (error) {
        return [];
    }
}

function formatFileSize(bytes) {
    if (bytes >= 1024 * 1024 * 1024) {
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    } else if (bytes >= 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    } else if (bytes >= 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${bytes} bytes`;
}

function formatAppInfo(appDetails, fileType, fileSize) {
    let typeLabel = fileType.toUpperCase();
    if (fileType === 'zip') {
        typeLabel = 'ZIP (APK + OBB)';
    }
    return `📱 *${appDetails.title}*

◄ النوع: ${typeLabel}
◄ الحجم: ${formatFileSize(fileSize)}
◄ التحميلات: ${appDetails.installs || 'ما معروفش'}`;
}

// قائمة المطورين الرسميين المعروفين
const VERIFIED_DEVELOPERS = [
    'google', 'meta', 'facebook', 'microsoft', 'apple', 'amazon', 'netflix', 'spotify',
    'garena', 'tencent', 'level infinite', 'supercell', 'king', 'rovio', 'ea', 'electronic arts',
    'ubisoft', 'activision', 'blizzard', 'epic games', 'riot games', 'mojang', 'nintendo',
    'samsung', 'huawei', 'xiaomi', 'oppo', 'vivo', 'oneplus', 'realme',
    'whatsapp', 'instagram', 'twitter', 'x corp', 'snapchat', 'snap inc', 'tiktok', 'bytedance',
    'telegram', 'discord', 'zoom', 'adobe', 'autodesk', 'oracle', 'ibm', 'intel',
    'krafton', 'pubg', 'mihoyo', 'hoyoverse', 'netease', 'lilith', 'yostar',
    'bandai', 'namco', 'konami', 'capcom', 'sega', 'square enix', 'sony',
    'paypal', 'visa', 'mastercard', 'samsung electronics', 'lg electronics',
    'vng', 'garena international', 'line', 'kakao', 'naver', 'baidu', 'alibaba'
];

function isVerifiedDeveloper(developer) {
    if (!developer) return false;
    const devLower = developer.toLowerCase();
    return VERIFIED_DEVELOPERS.some(verified => devLower.includes(verified));
}

function formatSearchResults(results) {
    const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
    let text = `🔍 *نّتـائج البحث*\n\n`;

    results.forEach((app, index) => {
        const emoji = numberEmojis[index] || `${index + 1}◄`;
        const verified = isVerifiedDeveloper(app.developer);
        const badge = verified ? ' ✓' : ' ✗';
        text += `${emoji} ◄ ${app.title}${badge}\n`;
    });

    text += `\n✓ رسمي | ✗ غير رسمي`;
    text += `\n📝 صيفط رقم التطبيق (1-${results.length})`;

    return text;
}

async function handleZArchiverDownload(sock, remoteJid, userId, senderPhone, msg, session) {
    session.isDownloading = true;
    startDownloadTracking(senderPhone);
    userSessions.set(userId, session);

    console.log(`✅ تنزيل ZArchiver (APK)`);

    await sock.sendMessage(remoteJid, { react: { text: '⏳', key: msg.key } });

    try {
        // جلب معلومات التطبيق من APKPure
        const appDetails = await apkpure.app({ appId: ZARCHIVER_PACKAGE });

        // إرسال الأيقونة كاستيكر
        if (appDetails.icon) {
            try {
                const { statusCode, body } = await request(appDetails.icon, {
                    method: 'GET',
                    headersTimeout: 10000,
                    bodyTimeout: 10000
                });
                if (statusCode === 200) {
                    const iconData = Buffer.from(await body.arrayBuffer());
                    const stickerBuffer = await sharp(iconData)
                        .resize(512, 512, {
                            fit: 'contain',
                            background: { r: 255, g: 255, b: 255, alpha: 0 }
                        })
                        .webp()
                        .toBuffer();
                    await sendBotMessage(sock, remoteJid, {
                        sticker: stickerBuffer
                    }, msg);
                }
            } catch (iconError) {
                console.log('⚠️ فشل إرسال الأيقونة:', iconError.message);
            }
        }

        await sock.sendMessage(remoteJid, { react: { text: '📥', key: msg.key } });

        // تنزيل ZArchiver كـ APK مباشرة (فرض APK وليس XAPK)
        const API_URL = process.env.API_URL || 'http://localhost:8000';

        console.log(`📥 كننزّل ZArchiver كـ APK...`);

        // استخدام endpoint مخصص يفرض APK
        const { statusCode, headers, body } = await request(`${API_URL}/download/${ZARCHIVER_PACKAGE}`, {
            method: 'GET',
            headersTimeout: 600000,
            bodyTimeout: 600000
        });

        if (statusCode !== 200) {
            throw new Error(`HTTP ${statusCode}`);
        }

        const chunks = [];
        for await (const chunk of body) {
            chunks.push(chunk);
        }

        const buffer = Buffer.concat(chunks);
        const fileSize = buffer.length;

        // فرض نوع الملف كـ APK
        const fileType = 'apk';
        const filename = `ZArchiver.${fileType}`;

        console.log(`✅ تّحمل ZArchiver: ${formatFileSize(fileSize)}`);

        if (buffer.length < 100000) {
            throw new Error('الملف المحمل صغير بزاف');
        }

        await sock.sendMessage(remoteJid, { react: { text: '✅', key: msg.key } });

        await logDownload(senderPhone, ZARCHIVER_PACKAGE, 'ZArchiver', fileType, fileSize);
        recordSuccessfulDownload(userId, 'ZArchiver', ZARCHIVER_PACKAGE, fileType, formatFileSize(fileSize));

        let caption = formatAppInfo(appDetails, fileType, fileSize);
        caption += `\n◄ اسم الملف: ${filename}`;
        caption += `\n\n💡 هذا تطبيق APK عادي، مايحتاجش ZArchiver باش تثبتو`;
        caption += POWERED_BY;

        await sendBotMessage(sock, remoteJid, {
            document: buffer,
            mimetype: 'application/vnd.android.package-archive',
            fileName: filename,
            caption: caption
        }, msg, { forward: true });

        await sendBotMessage(sock, remoteJid, { 
            text: ` تابعني ف انستاگرام:\n${INSTAGRAM_URL}${POWERED_BY}` 
        }, msg, { forward: true });

        session.state = 'waiting_for_search';
        session.isDownloading = false;
        session.searchResults = [];
        stopDownloadTracking(senderPhone);
        userSessions.set(userId, session);

    } catch (error) {
        console.error('❌ مشكل فتنزيل ZArchiver:', error);
        await sendBotMessage(sock, remoteJid, { 
            text: `❌ وقع مشكل فتنزيل ZArchiver. عاود المحاولة.${POWERED_BY}` 
        }, msg);
        session.state = 'waiting_for_search';
        session.isDownloading = false;
        session.searchResults = [];
        stopDownloadTracking(senderPhone);
        userSessions.set(userId, session);
    }
}

async function downloadAPKWithAxios(packageName, appTitle) {
    const API_URL = process.env.API_URL || 'http://localhost:8000';

    console.log(`📥 كننزّل باستعمال Axios (سريع)...`);

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            console.log(`   محاولة ${attempt + 1}/3...`);

            const startTime = Date.now();
            const response = await axios({
                method: 'GET',
                url: `${API_URL}/download/${packageName}`,
                responseType: 'arraybuffer',
                timeout: 600000,
                maxContentLength: MAX_FILE_SIZE,
                maxBodyLength: MAX_FILE_SIZE,
                onDownloadProgress: (progressEvent) => {
                    if (progressEvent.total) {
                        const progress = ((progressEvent.loaded / progressEvent.total) * 100).toFixed(0);
                        process.stdout.write(`\r   ⬇️  ${(progressEvent.loaded / 1024 / 1024).toFixed(1)}MB / ${(progressEvent.total / 1024 / 1024).toFixed(1)}MB (${progress}%)`);
                    } else {
                        process.stdout.write(`\r   ⬇️  ${(progressEvent.loaded / 1024 / 1024).toFixed(1)}MB تم تحميله...`);
                    }
                }
            });

            const buffer = Buffer.from(response.data);
            const fileSize = buffer.length;
            const fileType = response.headers['x-file-type'] || 'apk';
            const source = response.headers['x-source'] || 'apkpure';
            const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
            const speed = (fileSize / 1024 / 1024 / parseFloat(elapsedTime)).toFixed(2);

            const safeTitle = appTitle.replace(/[^\w\s\u0600-\u06FF-]/g, '').trim();
            const filename = `${safeTitle}.${fileType}`;

            console.log(`\n✅ تّحمل من ${source}: ${formatFileSize(fileSize)} | السرعة: ${speed} MB/s`);

            if (buffer.length > 100000) {
                return { buffer, filename, size: fileSize, fileType };
            }

            throw new Error('الملف المحمل صغير بزاف');

        } catch (error) {
            console.log(`\n   ❌ المحاولة ${attempt + 1} فشلات: ${error.message}`);
            if (error.message.includes('maxContentLength') || error.message.includes('FILE_TOO_LARGE')) {
                break;
            }
            if (attempt < 2) {
                await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
            }
        }
    }

    console.log(`📥 غادي نستعمل طريقة بديلة...`);
    return await downloadAPKStreamFallback(packageName, appTitle);
}

async function downloadAPKStreamFallback(packageName, appTitle) {
    return new Promise((resolve) => {
        const pythonScript = path.join(__dirname, 'scrap.py');
        const pythonProcess = spawn('python3', [pythonScript, packageName]);
        let output = '', error = '';
        pythonProcess.stdout.on('data', (data) => { output += data.toString(); });
        pythonProcess.stderr.on('data', (data) => { error += data.toString(); });
        pythonProcess.on('close', (code) => {
            if (code === 0 && output.trim()) {
                const filePath = output.trim();
                if (fs.existsSync(filePath)) {
                    const buffer = fs.readFileSync(filePath);
                    const filename = path.basename(filePath);
                    const fileSize = fs.statSync(filePath).size;
                    fs.unlinkSync(filePath);
                    const fileType = filename.toLowerCase().endsWith('.xapk') ? 'xapk' : 'apk';
                    const safeTitle = appTitle.replace(/[^\w\s\u0600-\u06FF-]/g, '').trim();
                    resolve({ buffer, filename: `${safeTitle}.${fileType}`, size: fileSize, fileType });
                } else {
                    resolve(null);
                }
            } else {
                resolve(null);
            }
        });
        pythonProcess.on('error', () => resolve(null));
    });
}

async function processRequest(sock, from, task) {
    let queue = requestQueue.get(from);
    if (!queue) {
        queue = { processing: false, tasks: [] };
        requestQueue.set(from, queue);
    }
    queue.tasks.push(task);
    if (queue.processing) return;
    queue.processing = true;
    while (queue.tasks.length > 0) {
        const currentTask = queue.tasks.shift();
        try { await currentTask(); } catch (error) { console.error('غلطة فمعالجة الطلب:', error); }
    }
    queue.processing = false;
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('session');

    const silentLogger = pino({ 
        level: 'silent',
        hooks: {
            logMethod(inputArgs, method) {
                return method.apply(this, inputArgs);
            }
        }
    });

    const sock = makeWASocket({
        auth: state,
        logger: silentLogger,
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        defaultQueryTimeoutMs: 120000,
        keepAliveIntervalMs: 30000,
        connectTimeoutMs: 60000,
        retryRequestDelayMs: 2000,
        emitOwnEvents: false,
        fireInitQueries: true,
        shouldSyncHistoryMessage: () => false,
        transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 3000 },
        patchMessageBeforeSending: (msg) => msg,
        cachedGroupMetadata: async (jid) => {
            const cached = groupMetadataCache.get(jid);
            if (cached && Date.now() - cached.timestamp < 300000) {
                return cached.data;
            }
            return null;
        },
        getMessage: async (key) => {
            return getStoredMessage(key);
        }
    });

    globalSock = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        for (const msg of messages) {
            if (msg.key && msg.message) {
                storeMessage(msg.key, msg.message);
            }
        }
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = (lastDisconnect?.error instanceof Boom) 
                ? lastDisconnect.error.output.statusCode : 500;

            let shouldReconnect = true;
            let reasonMsg = '';

            switch (statusCode) {
                case DisconnectReason.loggedOut:
                    shouldReconnect = false;
                    reasonMsg = 'تسجيل الخروج - امسح الجلسة وسكان QR من جديد';
                    break;
                case DisconnectReason.connectionClosed:
                    reasonMsg = 'الاتصال مسكر';
                    break;
                case DisconnectReason.connectionLost:
                    reasonMsg = 'ضاع الاتصال';
                    break;
                case DisconnectReason.connectionReplaced:
                    shouldReconnect = false;
                    reasonMsg = 'الاتصال تعوض بجهاز آخر';
                    break;
                case DisconnectReason.timedOut:
                    reasonMsg = 'انتهى الوقت';
                    break;
                case DisconnectReason.restartRequired:
                    reasonMsg = 'خاص إعادة التشغيل';
                    break;
                case 428:
                    reasonMsg = 'انتهت صلاحية الجلسة (24 ساعة)';
                    break;
                case 401:
                    shouldReconnect = false;
                    reasonMsg = 'غير مصرح - سكان QR من جديد';
                    break;
                case 403:
                    shouldReconnect = false;
                    reasonMsg = 'ممنوع - الحساب محظور';
                    break;
                case 515:
                    reasonMsg = 'خاص إعادة التشغيل';
                    break;
                case 405:
                    if (pairingCodeRequested) {
                        reasonMsg = 'كنتسنى كود الاقتران - عندك 3 دقائق';
                        shouldReconnect = false;
                        console.log('⏳ كنتسنى تدخل كود الاقتران...');
                        setTimeout(() => {
                            pairingCodeRequested = false;
                            connectToWhatsApp();
                        }, 180000);
                    } else {
                        reasonMsg = 'الجلسة فاسدة - غادي نمسح الجلسة ونعاود';
                        try {
                            const sessionDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'session');
                            if (fs.existsSync(sessionDir)) {
                                fs.rmSync(sessionDir, { recursive: true, force: true });
                                fs.mkdirSync(sessionDir, { recursive: true });
                                console.log('🗑️ مسحت الجلسة القديمة');
                            }
                        } catch (e) {
                            console.error('❌ مشكل فمسح الجلسة:', e.message);
                        }
                    }
                    break;
                default:
                    reasonMsg = `كود الخطأ: ${statusCode}`;
            }

            console.log(`❌ الاتصال تقطع - ${reasonMsg}`);

            if (keepAliveInterval) {
                clearInterval(keepAliveInterval);
                keepAliveInterval = null;
            }
            if (presenceInterval) {
                clearInterval(presenceInterval);
                presenceInterval = null;
            }

            if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(1.5, reconnectAttempts - 1), 60000);
                console.log(`⏳ محاولة ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} - نعاود من بعد ${Math.round(delay/1000)} ثانية...`);
                pairingCodeRequested = false;
                setTimeout(() => connectToWhatsApp(), delay);
            } else if (!shouldReconnect) {
                console.log('🛑 ماغاديش نعاود الاتصال - ' + reasonMsg);
                reconnectAttempts = 0;
            } else {
                console.log('🛑 وصلت للحد الأقصى ديال المحاولات. عاود تشغيل البوت يدوياً.');
                reconnectAttempts = 0;
            }
        } else if (connection === 'open') {
            reconnectAttempts = 0;
            console.log('✅ تّصلت بواتساب بنجاح!');
            console.log('🤖 بوت AppOmar واجد');
            console.log(`👨‍💻 نمرة المطور: ${DEVELOPER_PHONES.join(', ')}`);
            pairingCodeRequested = false;

            try { await sock.sendPresenceUpdate(botPresenceMode); } catch {}

            if (presenceInterval) clearInterval(presenceInterval);
            const presenceDelay = 45000 + Math.floor(Math.random() * 30000);
            presenceInterval = setInterval(async () => {
                try { await sock.sendPresenceUpdate(botPresenceMode); } catch {}
            }, presenceDelay);

            if (keepAliveInterval) clearInterval(keepAliveInterval);
            const keepAliveDelay = 60000 + Math.floor(Math.random() * 30000);
            keepAliveInterval = setInterval(async () => {
                try {
                    if (sock.user) {
                        await sock.query({tag: 'iq', attrs: {type: 'get', to: '@s.whatsapp.net'}, content: [{tag: 'ping', attrs: {}}]});
                    }
                } catch {}
            }, keepAliveDelay);

            await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));
            await setBotProfile(sock);
        } else if (connection === 'connecting') {
            console.log('🔗 كنحاول نتصل بواتساب...');
            if (!sock.authState.creds.registered && !pairingCodeRequested) {
                pairingCodeRequested = true;
                const phoneNumber = process.env.PHONE_NUMBER;
                if (!phoneNumber) {
                    console.log('⚠️  ماعنديش PHONE_NUMBER - ماغاديش نطلب كود الاقتران');
                    pairingCodeRequested = false;
                    return;
                }
                setTimeout(async () => {
                    try {
                        const code = await sock.requestPairingCode(phoneNumber);
                        console.log('\n📱 كود الاقتران ديالك:');
                        console.log(`        ${code}        \n`);
                        console.log('⏳ عندك 3 دقائق باش تدخل الكود فواتساب');
                        fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'pairing_code.txt'), JSON.stringify({ code, timestamp: Date.now() }));
                    } catch (error) {
                        console.error('❌ مشكل فطلب كود الاقتران:', error.message);
                        pairingCodeRequested = false;
                    }
                }, 3000);
            }
        }
    });

    sock.ev.on('call', async (callData) => {
        try {
            for (const call of callData) {
                if (call.status === 'offer') {
                    const callerPhone = getSenderPhone(call.from, null);
                    if (isDeveloper(callerPhone)) {
                        console.log(`📞 مكالمة من المطور - ما غاديش نبلوك`);
                        return;
                    }
                    console.log(`📞 مكالمة جاية من: ${callerPhone} - غادي نبلوك`);
                    try {
                        await sock.rejectCall(call.id, call.from);
                        await blockUser(callerPhone, 'بلوك أوتوماتيكي بسبب المكالمة', sock);
                        await sendBotMessage(sock, call.from, {
                            text: `⛔ *تحبست نهائياً*\n\nالمكالمات ممنوعة.\n\n${INSTAGRAM_URL}${POWERED_BY}`
                        });
                    } catch (error) {
                        console.error('❌ مشكل فرفض المكالمة:', error.message);
                    }
                }
            }
        } catch (error) {
            console.error('❌ خطأ في معالجة المكالمة:', error.message);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        try {
            const msg = messages[0];
            if (!msg.message) return;

            const messageType = Object.keys(msg.message)[0];
            const supportedTypes = ['conversation', 'extendedTextMessage', 'imageMessage', 'videoMessage', 'documentMessage'];
            if (!supportedTypes.includes(messageType)) return;

            const remoteJid = msg.key.remoteJid;
            const participant = msg.key.participant;
            const userId = getUserId(remoteJid, participant);
            const senderPhone = extractPhoneFromMessage(msg);
            
            let text = '';
            let mediaData = null;
            
            if (messageType === 'conversation') {
                text = msg.message.conversation || '';
            } else if (messageType === 'extendedTextMessage') {
                text = msg.message.extendedTextMessage?.text || '';
            } else if (messageType === 'imageMessage') {
                text = msg.message.imageMessage?.caption || '';
                try {
                    const buffer = await downloadMediaMessage(msg, 'buffer', {});
                    mediaData = {
                        base64: buffer.toString('base64'),
                        mimeType: msg.message.imageMessage.mimetype || 'image/jpeg'
                    };
                    console.log(`📸 تم تحميل صورة: ${mediaData.mimeType}, الحجم: ${buffer.length} bytes`);
                } catch (e) {
                    console.error('❌ فشل تحميل الصورة:', e.message);
                }
            } else if (messageType === 'videoMessage') {
                text = msg.message.videoMessage?.caption || '';
            } else if (messageType === 'documentMessage') {
                text = msg.message.documentMessage?.caption || '';
                const mimeType = msg.message.documentMessage?.mimetype || '';
                if (mimeType.startsWith('image/')) {
                    try {
                        const buffer = await downloadMediaMessage(msg, 'buffer', {});
                        mediaData = {
                            base64: buffer.toString('base64'),
                            mimeType: mimeType
                        };
                        console.log(`📄 تم تحميل صورة من document: ${mediaData.mimeType}, الحجم: ${buffer.length} bytes`);
                    } catch (e) {
                        console.error('❌ فشل تحميل الصورة من document:', e.message);
                    }
                }
            }
            
            text = text.trim();
            if (!text && !mediaData) return;

            const userName = msg.pushName || 'مستخدم';
            const isAdmin = isDeveloper(senderPhone);

            console.log(`📨 رسالة من: ${senderPhone} | مطور: ${isAdmin} | النص: ${text.substring(0, 50)}`);

            const isBlacklisted = await checkBlacklist(senderPhone);
            if (isBlacklisted && !isAdmin) return;

            let session = userSessions.get(userId);
            if (session && session.isDownloading && !isAdmin) {
                const downloadSpamStatus = checkDownloadSpam(senderPhone);
                if (downloadSpamStatus === 'block') {
                    stopDownloadTracking(senderPhone);
                    await blockUser(senderPhone, 'بلوك بسبب تجاوز حد التنزيلات السريعة (10)', sock);
                    await sendBotMessage(sock, remoteJid, { 
                        text: `⛔ *تحظرّت نهائياً*\n\n❌ تجاوزت الحد ديال التنزيلات المتزامنة\n📊 الحد: 10 تحميلات متتابعة\n\n💡 نصيحة: صيفط الطلب شوية بمسافة باش نتعامل معاه مزيان${POWERED_BY}`
                    }, msg);
                    return;
                }
                await sendBotMessage(sock, remoteJid, { 
                    text: `⏳ شوية صبر، غانرسل ليك التطبيق...${POWERED_BY}`
                }, msg);
                return;
            }

            if (!isAdmin) {
                const hourlyStatus = checkHourlySpam(senderPhone);
                if (hourlyStatus === 'block') {
                    await blockUser(senderPhone, 'بلوك بسبب تجاوز حد الرسائل (20/ساعة)', sock);
                    await sendBotMessage(sock, remoteJid, { 
                        text: `⛔ *تحظرّت نهائياً*\n\n❌ رسائل كثيرة فالساعة\n📊 الحد: 20 رسالة فالساعة\n\nإلى بغيتي توضح راسك، تاصل بالمطور${POWERED_BY}`
                    }, msg);
                    return;
                }
            }

            await updateUserActivity(senderPhone, userName);

            await processRequest(sock, userId, async () => {
                try {
                    await new Promise(r => setTimeout(r, 50));
                    await handleMessage(sock, remoteJid, userId, senderPhone, text, msg, userName, isAdmin, mediaData);
                } catch (error) {
                    console.error('❌ مشكل فمعالجة الرسالة:', error);
                    try {
                        await sendBotMessage(sock, remoteJid, { text: `❌ وقع مشكل. عاود المحاولة.${POWERED_BY}` }, msg);
                    } catch (e) {
                        console.error('❌ فشل إرسال رسالة الخطأ:', e.message);
                    }
                }
            });
        } catch (error) {
            console.error('❌ خطأ عام في معالجة الرسالة:', error.message);
        }
    });

    return sock;
}

async function handleMessage(sock, remoteJid, userId, senderPhone, text, msg, userName, isAdmin, mediaData = null) {
    let session = userSessions.get(userId);
    const isNewUser = !session;
    if (!session) {
        session = { state: 'idle', searchResults: [], isDownloading: false, lastListMessageKey: null, firstTime: true };
        userSessions.set(userId, session);
    }

    const lowerText = text.toLowerCase().trim();

    if (text === VIP_PASSWORD) {
        vipUsers.add(senderPhone);
        stopDownloadTracking(senderPhone);
        await sendBotMessage(sock, remoteJid, { 
            text: `🌟 *VIP تَفَعّل*

◄ تنزيلات بلا حدود
◄ سرعة مزيانة
◄ أولوية فالطلبات${POWERED_BY}`
        }, msg);
        return;
    }

    // التحقق من الروابط أولاً قبل أي شيء آخر
    const extractedUrl = extractUrl(text);
    if (extractedUrl) {
        const handled = await handlePluginUrl(sock, remoteJid, extractedUrl, msg, senderPhone);
        if (handled) {
            return;
        }
    }

    if (lowerText === 'zarchiver' || lowerText === 'زارشيفر') {
        session.state = 'waiting_for_selection';
        session.searchResults = [{ title: 'ZArchiver', appId: ZARCHIVER_PACKAGE, developer: 'ZDevs', score: 4.5, index: 1 }];
        userSessions.set(userId, session);

        await sendBotMessage(sock, remoteJid, { 
            text: `📦 كننزّل ZArchiver...${POWERED_BY}`
        }, msg);

        // تنزيل ZArchiver مباشرة كـ APK (وليس XAPK)
        await handleZArchiverDownload(sock, remoteJid, userId, senderPhone, msg, session);
        return;
    }

    if (isNewUser && session.firstTime) {
        session.firstTime = false;

        const userInfo = await getUserProfileInfo(sock, remoteJid, senderPhone, userName);

        const welcomeText = `*بوت AppOmar*

مرحبا ${userInfo.name}
النمرة: +${userInfo.phone}${userInfo.status ? `\nالحالة: ${userInfo.status}` : ''}

*الخدمات المتاحة:*

*تحميل التطبيقات:*
صيفط اسم التطبيق بالانجليزية وختار رقم من القائمة

*تحميل الفيديوهات:*
Facebook • Instagram • YouTube
TikTok • Twitter/X • Pinterest

*تحميل الملفات:*
Mediafire • Google Drive

*قواعد الحماية:*
• ماشي كثر من 20 رسالة فالساعة
• ماشي كثر من 3 تحميلات متتابعة
• المكالمات = بلوك أوتوماتيكي

💡 باش تحصل على تنزيلات لامحدودة تاصل بالمطور

${INSTAGRAM_URL}${POWERED_BY}`;

        // Send user profile picture if available
        if (userInfo.profilePic) {
            try {
                await sendBotMessage(sock, remoteJid, {
                    image: userInfo.profilePic,
                    caption: welcomeText
                }, msg);
            } catch (imgError) {
                await sendBotMessage(sock, remoteJid, { text: welcomeText }, msg);
            }
        } else {
            await sendBotMessage(sock, remoteJid, { text: welcomeText }, msg);
        }

        // Don't search on first message - just show welcome
        return;
    }

    if (isAdmin) {
        console.log(`🔧 أمر المطور: ${text}`);

        if (text === '/stats' || text.startsWith('/stats')) {
            const stats = await getStats();
            if (stats) {
                let statsMsg = `📊 *احصائيات البوت*

◄ المستخدمين: ${stats.totalUsers}
◄ التنزيلات: ${stats.totalDownloads}
◄ تنزيلات اليوم: ${stats.todayDownloads}
◄ الحجم الكلي: ${(stats.totalSize / (1024 * 1024 * 1024)).toFixed(2)} GB
◄ المحظورين: ${stats.blockedUsers}

🔥 *أكثر التطبيقات تنزيلاً:*`;
                stats.topApps.forEach((app, i) => { statsMsg += `\n${i + 1}◄ ${app.app_name} (${app.count})`; });
                statsMsg += POWERED_BY;
                await sendBotMessage(sock, remoteJid, { text: statsMsg }, msg);
            } else {
                await sendBotMessage(sock, remoteJid, { text: `❌ قاعدة البيانات مش موصولة${POWERED_BY}` }, msg);
            }
            return;
        }

        if (text.startsWith('/broadcast ')) {
            if (!dbEnabled) { 
                await sendBotMessage(sock, remoteJid, { text: `❌ قاعدة البيانات مش موصولة${POWERED_BY}` }, msg); 
                return; 
            }
            const message = text.replace('/broadcast ', '').trim();
            if (message) {
                await sendBotMessage(sock, remoteJid, { text: `📤 كنرسِل الرسالة...${POWERED_BY}` }, msg);
                const result = await broadcastMessage(sock, message);
                await sendBotMessage(sock, remoteJid, { text: `✅ تْرسلات\n\n✓ نجح: ${result.success}\n✗ فشل: ${result.failed}${POWERED_BY}` }, msg);
            }
            return;
        }

        if (text.startsWith('/unblock ')) {
            const numberToUnblock = text.replace('/unblock ', '').trim();
            const success = await unblockUser(numberToUnblock, sock);
            await sendBotMessage(sock, remoteJid, { text: success ? `✅ تحيّد البلوك على ${numberToUnblock}${POWERED_BY}` : `❌ ماقديتش  نحيد البلوك${POWERED_BY}` }, msg);
            return;
        }

        if (text.startsWith('/block ')) {
            const numberToBlock = text.replace('/block ', '').trim();
            await blockUser(numberToBlock, 'بلوك يدوي من المطور', sock);
            await sendBotMessage(sock, remoteJid, { text: `✅ تبلوكى ${numberToBlock}${POWERED_BY}` }, msg);
            return;
        }

        if (text === '/offline') {
            botPresenceMode = 'unavailable';
            try { 
                await sock.sendPresenceUpdate(botPresenceMode); 
                await sendBotMessage(sock, remoteJid, { text: `🔴 *البوت ولى Offline*\n\nدابا البوت مش متصل ظاهرياً${POWERED_BY}` }, msg);

                // Start periodic updates if not already running
                if (!presenceInterval) {
                    const presenceDelay = 50000 + Math.floor(Math.random() * 20000);
                    presenceInterval = setInterval(async () => {
                        try { await sock.sendPresenceUpdate('unavailable'); } catch {}
                    }, presenceDelay);
                }
            } catch (error) {
                await sendBotMessage(sock, remoteJid, { text: `❌ مشكل فتغيير الحالة${POWERED_BY}` }, msg);
            }
            return;
        }

        if (text === '/online') {
            botPresenceMode = 'available';
            try { 
                await sock.sendPresenceUpdate(botPresenceMode); 
                await sendBotMessage(sock, remoteJid, { text: `🟢 *البوت ولى Online*\n\nدابا البوت متصل${POWERED_BY}` }, msg);

                // Clear periodic updates
                if (presenceInterval) {
                    clearInterval(presenceInterval);
                    presenceInterval = null;
                }
            } catch (error) {
                await sendBotMessage(sock, remoteJid, { text: `❌ مشكل فتغيير الحالة${POWERED_BY}` }, msg);
            }
            return;
        }

        if (text === '/admin') {
            const adminHelp = `🔧 *أوامر المطور*

◄ /stats - احصائيات البوت
◄ /broadcast [رسالة] - ارسال لمجموعة
◄ /block [رقم] - بلوك
◄ /unblock [رقم] - رفع البلوك
◄ /offline - البوت يبان offline
◄ /online - البوت يبان online${POWERED_BY}`;
            await sendBotMessage(sock, remoteJid, { text: adminHelp }, msg);
            return;
        }
    }

    // Handle /cancel command to reset search state
    if (lowerText === '/cancel' || lowerText === 'الغاء' || lowerText === 'إلغاء') {
        if (session.lastListMessageKey) {
            try { await sock.sendMessage(remoteJid, { delete: session.lastListMessageKey }); } catch {}
            session.lastListMessageKey = null;
        }
        session.state = 'idle';
        session.searchResults = [];
        userSessions.set(userId, session);

        await sendBotMessage(sock, remoteJid, { 
            text: `تم إلغاء البحث. صيفط اسم التطبيق${POWERED_BY}`
        }, msg);
        return;
    }

    // Handle messages starting with "." - tell user to send app name only
    if (text.startsWith('.')) {
        await sendBotMessage(sock, remoteJid, { 
            text: `صيفط غير اسم التطبيق بلا أوامر
مثال اصاحبي : WhatsApp${POWERED_BY}`
        }, msg);
        return;
    }

    if (lowerText === '/help' || lowerText === 'مساعدة' || lowerText === 'help') {
        const helpText = `*المساعدة*

كيف كانخدم:
1. صيفط اسم التطبيق لي بغيتي
2. اختار رقم من القائمة 
3. تسنى حتى نصيفطلك التطبيق 

الأوامر:
/help /commands /history /ping /info /dev
zarchiver - باش تثبت XAPK

نصائح:
• قلب بالانجليزية
• XAPK خاصو ZArchiver${POWERED_BY}`;

        await sendBotMessage(sock, remoteJid, { text: helpText }, msg);
        return;
    }

    if (lowerText === '/commands' || lowerText === 'الاوامر' || lowerText === 'اوامر') {
        const commandsText = `*الأوامر*

/help • مساعدة
/commands • لائحة الأوامر
/history • السجل
/ping • اختبار البوت
/info • معلومات
/dev • المطور
/cancel • إلغاء البحث
zarchiver • تنزل  زارشيفر

أمثلة:
WhatsApp, Minecraft, Free Fire${POWERED_BY}`;

        await sendBotMessage(sock, remoteJid, { text: commandsText }, msg);
        return;
    }

    if (lowerText === '/ping' || lowerText === 'بينج') {
        const startTime = Date.now();
        await sendBotMessage(sock, remoteJid, { 
            text: `PONG! ${Date.now() - startTime}ms${POWERED_BY}`
        }, msg);
        return;
    }

    if (lowerText === '/info' || lowerText === 'معلومات') {
        const infoText = `*معلومات البوت*
AppOmar Bot v3.0
المصدر: APKPure
كيّساند APK و XAPK${POWERED_BY}`;
        await sendBotMessage(sock, remoteJid, { text: infoText }, msg);
        return;
    }

    if (lowerText === '/dev' || lowerText === 'المطور' || lowerText === 'تواصل') {
        await sendBotMessage(sock, remoteJid, { text: `${INSTAGRAM_URL}${POWERED_BY}` }, msg);
        return;
    }

    if (lowerText === '/history' || lowerText === 'سجلي' || lowerText === 'history') {
        const history = await getUserHistory(senderPhone);
        if (history.length === 0) {
            await sendBotMessage(sock, remoteJid, { 
                text: `📭 *ماعندك حتى سجل*

مازال مجبدتي حتى تطبيق 
صيفط اسم باش نبحثلك${POWERED_BY}`
            }, msg);
        } else {
            let historyText = `📜 *سجل التنزيلات ديالك*\n`;
            history.forEach((item, i) => {
                const date = new Date(item.created_at).toLocaleDateString('ar-EG');
                historyText += `\n${i + 1}◄ ${item.app_name} (${item.file_type.toUpperCase()})`;
            });
            historyText += POWERED_BY;
            await sendBotMessage(sock, remoteJid, { text: historyText }, msg);
        }
        return;
    }

    if (session.state === 'idle' || session.state === 'waiting_for_search') {
        await sock.sendMessage(remoteJid, { react: { text: '🤔', key: msg.key } });
        await sock.sendPresenceUpdate('composing', remoteJid);

        try {
            if (mediaData) {
                console.log(`🖼️ إرسال صورة إلى Gemini: ${mediaData.mimeType}, النص: "${text || '[بدون نص]'}"`);
            }
            const geminiResponse = await processMessage(userId, text, mediaData);
            console.log('🧠 Gemini Response:', JSON.stringify(geminiResponse));

            if (geminiResponse.action === 'search_app') {
                await sock.sendMessage(remoteJid, { react: { text: '🔍', key: msg.key } });
                session.state = 'waiting_for_search';
                userSessions.set(userId, session);
                
                const searchQuery = geminiResponse.query || text;
                console.log('🔎 كنبحث على:', searchQuery);
                const isPackageName = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i.test(searchQuery.trim());
                let results;
                try {
                    if (isPackageName) {
                        try {
                            const appDetails = await apkpure.app({ appId: searchQuery.trim() });
                            results = [appDetails];
                        } catch { 
                            results = await apkpure.search({ term: searchQuery, num: 10 }); 
                        }
                    } else {
                        results = await apkpure.search({ term: searchQuery, num: 10 });
                    }
                    console.log('📊 نتائج البحث:', results?.length || 0);
                } catch (searchError) {
                    console.error('❌ خطأ في البحث:', searchError.message);
                    await sendBotMessage(sock, remoteJid, { 
                        text: `وقع مشكل فالبحث. جرب مرة أخرى.${POWERED_BY}`
                    }, msg);
                    session.state = 'idle';
                    userSessions.set(userId, session);
                    return;
                }

                if (!results || results.length === 0) {
                    recordSearchFailure(userId, searchQuery);
                    await sendBotMessage(sock, remoteJid, { 
                        text: `ماعنديش نتائج على "${searchQuery}". جرب تكتب بالانجليزية${POWERED_BY}`
                    }, msg);
                    session.state = 'idle';
                    userSessions.set(userId, session);
                    return;
                }

                const cleanResults = results.map((app, idx) => ({
                    title: app.title,
                    appId: app.appId || app.id || app.packageName,
                    developer: app.developer || '',
                    score: app.score || 0,
                    icon: app.icon || null,
                    index: idx + 1
                }));

                session.searchResults = [...cleanResults];
                session.state = 'waiting_for_selection';

                const resultText = await formatResultsWithGemini(userId, searchQuery, cleanResults) + POWERED_BY;
                const sentMsg = await sendBotMessage(sock, remoteJid, { text: resultText }, msg, { skipDelay: true });
                session.lastListMessageKey = sentMsg?.key;
                userSessions.set(userId, session);
                console.log('✅ تصيفطت نتائج البحث');
                
                // حفظ نتائج البحث في ذاكرة المحادثة
                const appNames = cleanResults.map(app => `${app.index}. ${app.title} (${app.appId})`).join('\n');
                addContext(userId, `[نتائج البحث: ${searchQuery}]\n${appNames}`, 'search');

            } else if (geminiResponse.action === 'download_app') {
                await sock.sendMessage(remoteJid, { react: { text: '📥', key: msg.key } });
                let appId = geminiResponse.appId;
                let appName = geminiResponse.appName || appId;
                
                // دائماً نبحث في نتائج البحث أولاً (حتى لو الـ appId كيبان حقيقي)
                if (session.searchResults && session.searchResults.length > 0) {
                    // نشوف واش الـ appId موجود فنتائج البحث
                    const exactMatch = session.searchResults.find(app => app.appId === appId);
                    
                    if (exactMatch) {
                        // الـ appId صحيح ومطابق
                        appName = exactMatch.title;
                        console.log(`✅ appId مطابق تماماً: ${appId}`);
                    } else {
                        // نقلبو على تطابق بالاسم
                        const foundApp = session.searchResults.find(app => 
                            app.title.toLowerCase().includes(appId.toLowerCase()) ||
                            appId.toLowerCase().includes(app.title.toLowerCase()) ||
                            app.title.toLowerCase().includes((appName || '').toLowerCase())
                        );
                        if (foundApp) {
                            console.log(`🔄 تم تصحيح appId: ${appId} → ${foundApp.appId}`);
                            appId = foundApp.appId;
                            appName = foundApp.title;
                        } else {
                            // Gemini أعطى appId غير موجود في القائمة - نختار الأول أو الأحسن
                            console.log(`⚠️ appId "${appId}" غير موجود في نتائج البحث، نختار الأول`);
                            appId = session.searchResults[0].appId;
                            appName = session.searchResults[0].title;
                        }
                    }
                }
                
                await sendBotMessage(sock, remoteJid, { text: `كننزّل ليك ${appName}...${POWERED_BY}` }, msg);
                
                session.state = 'waiting_for_selection';
                session.searchResults = [{ title: appName, appId: appId, index: 1 }];
                userSessions.set(userId, session);
                await handleAppDownload(sock, remoteJid, userId, senderPhone, msg, appId, appName, session);

            } else if (geminiResponse.action === 'download_media') {
                const url = geminiResponse.url;
                const platform = geminiResponse.platform;
                
                await sendBotMessage(sock, remoteJid, { text: `كننزّل ليك الفيديو من ${platform}...${POWERED_BY}` }, msg);
                
                const handled = await handlePluginUrl(sock, remoteJid, url, msg, senderPhone);
                if (!handled) {
                    await sendBotMessage(sock, remoteJid, { text: `مقديتش نجيب الفيديو. جرب رابط آخر.${POWERED_BY}` }, msg);
                }

            } else if (geminiResponse.action === 'reply' || geminiResponse.action === 'analyze_image') {
                const message = geminiResponse.message || 'مفهمتش. عاود صيفط.';
                await sendBotMessage(sock, remoteJid, { text: `${message}${POWERED_BY}` }, msg);

            } else {
                await sendBotMessage(sock, remoteJid, { text: `كيفاش نقدر نعاونك؟${POWERED_BY}` }, msg);
            }

        } catch (error) {
            console.error('❌ مشكل فـ Gemini:', error);
            await sendBotMessage(sock, remoteJid, { text: `عذراً، وقع مشكل. عاود المحاولة.${POWERED_BY}` }, msg, { skipDelay: true });
        }

    } else if (session.state === 'waiting_for_selection') {
        const selection = parseInt(text.trim());
        const resultsCount = session.searchResults?.length || 0;

        if (isNaN(selection) || selection < 1 || selection > resultsCount) {
            // User entered text instead of a number - ask Gemini what they want
            // Delete the old list message
            if (session.lastListMessageKey) {
                try { await sock.sendMessage(remoteJid, { delete: session.lastListMessageKey }); } catch {}
                session.lastListMessageKey = null;
            }

            // حفظ نتائج البحث قبل المسح للاستخدام لاحقاً
            const previousSearchResults = [...(session.searchResults || [])];
            
            // Reset state and ask Gemini
            session.state = 'idle';
            session.searchResults = [];
            userSessions.set(userId, session);

            // Ask Gemini what the user wants
            await sock.sendMessage(remoteJid, { react: { text: '🤔', key: msg.key } });
            await sock.sendPresenceUpdate('composing', remoteJid);
            
            try {
                const geminiResponse = await processMessage(userId, text, mediaData);
                console.log('🧠 Gemini Response (from selection):', JSON.stringify(geminiResponse));

                if (geminiResponse.action === 'search_app') {
                    await sock.sendMessage(remoteJid, { react: { text: '🔍', key: msg.key } });
                    session.state = 'waiting_for_search';
                    userSessions.set(userId, session);
                    
                    const searchQuery = geminiResponse.query || text;
                    console.log('🔎 كنبحث على (selection):', searchQuery);
                    const isPackageName = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i.test(searchQuery.trim());
                    let results;
                    try {
                        if (isPackageName) {
                            try {
                                const appDetails = await apkpure.app({ appId: searchQuery.trim() });
                                results = [appDetails];
                            } catch { 
                                results = await apkpure.search({ term: searchQuery, num: 10 }); 
                            }
                        } else {
                            results = await apkpure.search({ term: searchQuery, num: 10 });
                        }
                        console.log('📊 نتائج البحث (selection):', results?.length || 0);
                    } catch (searchError) {
                        console.error('❌ خطأ في البحث (selection):', searchError.message);
                        await sendBotMessage(sock, remoteJid, { 
                            text: `وقع مشكل فالبحث. جرب مرة أخرى.${POWERED_BY}`
                        }, msg);
                        session.state = 'idle';
                        userSessions.set(userId, session);
                        return;
                    }

                    if (!results || results.length === 0) {
                        recordSearchFailure(userId, searchQuery);
                        await sendBotMessage(sock, remoteJid, { 
                            text: `ماعنديش نتائج على "${searchQuery}". جرب تكتب بالانجليزية${POWERED_BY}`
                        }, msg);
                        session.state = 'idle';
                        userSessions.set(userId, session);
                        return;
                    }

                    const cleanResults = results.map((app, idx) => ({
                        title: app.title,
                        appId: app.appId || app.id || app.packageName,
                        developer: app.developer || '',
                        score: app.score || 0,
                        icon: app.icon || null,
                        index: idx + 1
                    }));

                    session.searchResults = [...cleanResults];
                    session.state = 'waiting_for_selection';

                    const resultText = await formatResultsWithGemini(userId, searchQuery, cleanResults) + POWERED_BY;
                    const sentMsg = await sendBotMessage(sock, remoteJid, { text: resultText }, msg, { skipDelay: true });
                    session.lastListMessageKey = sentMsg?.key;
                    userSessions.set(userId, session);
                    console.log('✅ تصيفطت نتائج البحث (selection)');
                    
                    // حفظ نتائج البحث في ذاكرة المحادثة
                    const appNames = cleanResults.map(app => `${app.index}. ${app.title} (${app.appId})`).join('\n');
                    addContext(userId, `[نتائج البحث: ${searchQuery}]\n${appNames}`, 'search');
                    
                } else if (geminiResponse.action === 'download_app') {
                    await sock.sendMessage(remoteJid, { react: { text: '📥', key: msg.key } });
                    let appId = geminiResponse.appId;
                    let appName = geminiResponse.appName || appId;
                    
                    // دائماً نبحث في نتائج البحث أولاً (حتى لو الـ appId كيبان حقيقي)
                    if (previousSearchResults && previousSearchResults.length > 0) {
                        // نشوف واش الـ appId موجود فنتائج البحث
                        const exactMatch = previousSearchResults.find(app => app.appId === appId);
                        
                        if (exactMatch) {
                            // الـ appId صحيح ومطابق
                            appName = exactMatch.title;
                            console.log(`✅ appId مطابق تماماً: ${appId}`);
                        } else {
                            // نقلبو على تطابق بالاسم
                            const foundApp = previousSearchResults.find(app => 
                                app.title.toLowerCase().includes(appId.toLowerCase()) ||
                                appId.toLowerCase().includes(app.title.toLowerCase()) ||
                                app.title.toLowerCase().includes((appName || '').toLowerCase())
                            );
                            if (foundApp) {
                                console.log(`🔄 تم تصحيح appId: ${appId} → ${foundApp.appId}`);
                                appId = foundApp.appId;
                                appName = foundApp.title;
                            } else {
                                // Gemini أعطى appId غير موجود في القائمة - نختار الأول
                                console.log(`⚠️ appId "${appId}" غير موجود في نتائج البحث، نختار الأول`);
                                appId = previousSearchResults[0].appId;
                                appName = previousSearchResults[0].title;
                            }
                        }
                    }
                    
                    await sendBotMessage(sock, remoteJid, { text: `كننزّل ليك ${appName}...${POWERED_BY}` }, msg);
                    
                    session.state = 'waiting_for_selection';
                    session.searchResults = [{ title: appName, appId: appId, index: 1 }];
                    userSessions.set(userId, session);
                    await handleAppDownload(sock, remoteJid, userId, senderPhone, msg, appId, appName, session);
                    
                } else if (geminiResponse.action === 'download_media') {
                    const url = geminiResponse.url;
                    const platform = geminiResponse.platform;
                    
                    await sendBotMessage(sock, remoteJid, { text: `كننزّل ليك الفيديو من ${platform}...${POWERED_BY}` }, msg);
                    
                    const handled = await handlePluginUrl(sock, remoteJid, url, msg, senderPhone);
                    if (!handled) {
                        await sendBotMessage(sock, remoteJid, { text: `مقديتش نجيب الفيديو. جرب رابط آخر.${POWERED_BY}` }, msg);
                    }
                    
                } else if (geminiResponse.action === 'reply' || geminiResponse.action === 'analyze_image') {
                    const message = geminiResponse.message || 'مفهمتش. عاود صيفط.';
                    await sendBotMessage(sock, remoteJid, { text: `${message}${POWERED_BY}` }, msg);
                    
                } else {
                    await sendBotMessage(sock, remoteJid, { text: `كيفاش نقدر نعاونك؟${POWERED_BY}` }, msg);
                }
                
            } catch (error) {
                console.error('❌ مشكل فـ Gemini:', error);
                await sendBotMessage(sock, remoteJid, { text: `عذراً، وقع مشكل. عاود المحاولة.${POWERED_BY}` }, msg, { skipDelay: true });
            }
            return;
        }

        const selectedApp = session.searchResults[selection - 1];
        await handleAppDownload(sock, remoteJid, userId, senderPhone, msg, selectedApp.appId, selectedApp.title, session);
    }
}

async function handleAppDownload(sock, remoteJid, userId, senderPhone, msg, appId, appTitle, session) {
    // فحص إذا كان Minecraft الأصلي المدفوع
    if (appId === 'com.mojang.minecraftpe') {
        await sendBotMessage(sock, remoteJid, {
            text: `⚠️ *Minecraft الأصلي مدفوع*

❌ النسخة المدفوعة غير متوفرة للتحميل

💡 *جرب البديل المجاني:*
كتب: *minecraft trial*

أو ابحث عن نسخ معدلة مجانية${POWERED_BY}`
        }, msg);
        
        session.state = 'waiting_for_search';
        session.isDownloading = false;
        session.searchResults = [];
        userSessions.set(userId, session);
        return;
    }

    const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

    const selection = session.searchResults.findIndex(app => app.appId === appId) + 1;
    const emoji = numberEmojis[selection - 1] || '📱';
    await sock.sendMessage(remoteJid, { react: { text: emoji, key: msg.key } });

    if (session.lastListMessageKey) {
        try { await sock.sendMessage(remoteJid, { delete: session.lastListMessageKey }); } catch {}
        session.lastListMessageKey = null;
    }

    session.isDownloading = true;
    startDownloadTracking(senderPhone);
    userSessions.set(userId, session);

    console.log(`✅ تختار: ${appTitle} (${appId})`);

    if (!appId) {
        await sendBotMessage(sock, remoteJid, { text: `❌ مشكل فالتطبيق. ختار واحد آخر.${POWERED_BY}` }, msg);
        session.isDownloading = false;
        stopDownloadTracking(senderPhone);
        userSessions.set(userId, session);
        return;
    }

    await sock.sendMessage(remoteJid, { react: { text: '⏳', key: msg.key } });

    try {
        const appDetails = await apkpure.app({ appId: appId });
        
        // استخدم اسم التطبيق الحقيقي من appDetails
        const realAppTitle = appDetails.title || appTitle;

        if (appDetails.icon) {
            try {
                const { statusCode, body } = await request(appDetails.icon, {
                    method: 'GET',
                    headersTimeout: 10000,
                    bodyTimeout: 10000
                });
                if (statusCode === 200) {
                    const iconData = Buffer.from(await body.arrayBuffer());
                    const stickerBuffer = await sharp(iconData)
                        .resize(512, 512, {
                            fit: 'contain',
                            background: { r: 255, g: 255, b: 255, alpha: 0 }
                        })
                        .webp()
                        .toBuffer();
                    await sendBotMessage(sock, remoteJid, {
                        sticker: stickerBuffer
                    }, msg);
                }
            } catch (iconError) {
                console.log('⚠️ فشل نرسل الأيقونة كاستيكرز:', iconError.message);
            }
        }

        await sock.sendMessage(remoteJid, { react: { text: '📥', key: msg.key } });

        const apkStream = await downloadAPKWithAxios(appDetails.appId, realAppTitle);

        if (apkStream) {
            if (apkStream.size > MAX_FILE_SIZE) {
                await sock.sendMessage(remoteJid, { react: { text: '❌', key: msg.key } });
                await sendBotMessage(sock, remoteJid, { 
                    text: `❌ *حجم كبير بزاف*

◄ حجم التطبيق: ${formatFileSize(apkStream.size)}
◄ الحد: 2 GB

💡 جرب تطبيق  آخر${POWERED_BY}`
                }, msg);
                session.state = 'waiting_for_search';
                session.isDownloading = false;
                session.searchResults = [];
                stopDownloadTracking(senderPhone);
                userSessions.set(userId, session);
                return;
            }

            await sock.sendMessage(remoteJid, { react: { text: '✅', key: msg.key } });

            const isXapk = apkStream.fileType === 'xapk';
            await logDownload(senderPhone, appDetails.appId, realAppTitle, apkStream.fileType, apkStream.size);
            recordSuccessfulDownload(userId, realAppTitle, appDetails.appId, apkStream.fileType, formatFileSize(apkStream.size));

            if (isXapk) {
                let sanitizedName = realAppTitle
                    .replace(/[<>:"/\\|?*]/g, '')
                    .trim()
                    .substring(0, 50);

                if (!sanitizedName || sanitizedName.trim() === '') {
                    sanitizedName = appDetails.appId || 'app';
                }

                const xapkAnalysis = analyzeXapkContents(apkStream.buffer);

                if (xapkAnalysis.hasApkPlusObb && xapkAnalysis.apkFile && xapkAnalysis.obbFiles.length > 0) {
                    console.log(`📦 XAPK يحتوي على APK + OBB - سيتم إنشاء ZIP منظم`);

                    const zipResult = buildApkObbZip(appDetails, xapkAnalysis.apkFile, xapkAnalysis.obbFiles);

                    if (zipResult) {
                        let caption = formatAppInfo(appDetails, 'zip', zipResult.size);
                        caption += `\n◄ اسم الملف: ${zipResult.fileName}`;
                        caption += `\n\n${getZipObbTutorial(zipResult.fileName, appDetails.appId)}`;
                        caption += POWERED_BY;

                        await sendBotMessage(sock, remoteJid, {
                            document: zipResult.buffer,
                            mimetype: 'application/zip',
                            fileName: zipResult.fileName,
                            caption: caption
                        }, msg, { forward: true });
                    } else {
                        const xapkFileName = `${sanitizedName}.xapk`;
                        let caption = formatAppInfo(appDetails, 'xapk', apkStream.size);
                        caption += `\n◄ اسم الملف: ${xapkFileName}`;
                        caption += `\n\n${getXapkTutorial(xapkFileName)}`;
                        caption += POWERED_BY;

                        await sendBotMessage(sock, remoteJid, {
                            document: apkStream.buffer,
                            mimetype: 'application/octet-stream',
                            fileName: xapkFileName,
                            caption: caption
                        }, msg, { forward: true });
                    }
                } else {
                    console.log(`📦 XAPK بدون OBB - إرسال كـ XAPK مضغوط`);
                    const xapkFileName = `${sanitizedName}.xapk`;

                    let caption = formatAppInfo(appDetails, 'xapk', apkStream.size);
                    caption += `\n◄ اسم الملف: ${xapkFileName}`;
                    caption += `\n\n${getXapkTutorial(xapkFileName)}`;
                    caption += POWERED_BY;

                    await sendBotMessage(sock, remoteJid, {
                        document: apkStream.buffer,
                        mimetype: 'application/octet-stream',
                        fileName: xapkFileName,
                        caption: caption
                    }, msg, { forward: true });
                }

            } else {
                let caption = formatAppInfo(appDetails, apkStream.fileType, apkStream.size);
                caption += `\n◄ اسم الملف: ${apkStream.filename}`;
                caption += POWERED_BY;

                await sendBotMessage(sock, remoteJid, {
                    document: apkStream.buffer,
                    mimetype: 'application/vnd.android.package-archive',
                    fileName: apkStream.filename,
                    caption: caption
                }, msg, { forward: true });
            }

            await sendBotMessage(sock, remoteJid, { 
                text: `${INSTAGRAM_URL}${POWERED_BY}` 
            }, msg, { forward: true });

        } else {
            await sendBotMessage(sock, remoteJid, { text: `❌ ماقديتش  نحمل. جرب  تطبيق  آخر.${POWERED_BY}` }, msg);
        }

        session.state = 'waiting_for_search';
        session.isDownloading = false;
        session.searchResults = [];
        stopDownloadTracking(senderPhone);
        userSessions.set(userId, session);
    } catch (error) {
        console.error('❌ مشكل:', error);
        await sendBotMessage(sock, remoteJid, { text: `❌ وقع مشكل. عاود المحاولة.${POWERED_BY}` }, msg);
        session.state = 'waiting_for_search';
        session.isDownloading = false;
        session.searchResults = [];
        stopDownloadTracking(senderPhone);
        userSessions.set(userId, session);
    }
}

// Global error handlers to prevent session crashes
process.on('uncaughtException', (err) => {
    console.error('⚠️ Uncaught Exception (لم يتوقف البوت):', err.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection (لم يتوقف البوت):', reason);
});

console.log('🤖 بوت AppOmar المحترف');
console.log('🚀 كنطلق البوت...\n');

await initDatabase();
await downloadBotProfileImage();
await loadPlugins();

connectToWhatsApp().catch(err => {
    console.error('❌ مشكل خطير:', err);
    process.exit(1);
});
