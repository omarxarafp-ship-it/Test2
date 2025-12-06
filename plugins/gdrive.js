import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import os from "os";

export default {
    name: 'Google Drive Downloader',
    patterns: [
        /drive\.google\.com/i,
        /drive\.usercontent\.google\.com/i
    ],
    
    async handler(sock, remoteJid, url, msg, utils) {
        try {
            await utils.react(sock, msg, '⏳');
            
            const result = await downloadFromGDrive(url);
            
            if (result.error) {
                throw new Error(result.message || 'فشل في جلب الملف');
            }

            await utils.react(sock, msg, '📥');

            const caption = `📄 ${result.fileName}
📊 ${result.fileSize}

${utils.poweredBy}`;

            if (result.filePath) {
                await sock.sendMessage(remoteJid, {
                    document: fs.readFileSync(result.filePath),
                    fileName: result.fileName,
                    mimetype: result.mimetype || 'application/octet-stream',
                    caption: caption
                }, { quoted: msg });
                
                try { fs.unlinkSync(result.filePath); } catch (e) {}
            } else {
                await sock.sendMessage(remoteJid, {
                    document: { url: result.downloadUrl },
                    fileName: result.fileName,
                    mimetype: result.mimetype || 'application/octet-stream',
                    caption: caption
                }, { quoted: msg });
            }

            await utils.react(sock, msg, '✅');
            return true;
        } catch (error) {
            console.error('GDrive Error:', error.message);
            await utils.react(sock, msg, '❌');
            await sock.sendMessage(remoteJid, {
                text: `❌ فشل تحميل ملف Google Drive\n\n${error.message}\n${utils.poweredBy}`
            }, { quoted: msg });
            return false;
        }
    }
};

async function downloadFromGDrive(url) {
    try {
        const cleanUrl = url.replace(/&amp;/g, '&');
        
        let fileId = null;
        const patterns = [
            /\/d\/([a-zA-Z0-9_-]+)/,
            /id=([a-zA-Z0-9_-]+)/,
            /folders\/([a-zA-Z0-9_-]+)/
        ];
        
        for (const pattern of patterns) {
            const match = cleanUrl.match(pattern);
            if (match) {
                fileId = match[1];
                break;
            }
        }
        
        if (!fileId) {
            return { error: true, message: 'لم يتم العثور على ID الملف' };
        }
        
        console.log(`[GDrive] File ID: ${fileId}`);
        
        const fileInfo = await getFileInfo(fileId);
        console.log(`[GDrive] File: ${fileInfo.fileName}, Size: ${fileInfo.fileSize}`);
        
        const downloadResult = await downloadFileWithVerification(fileId, fileInfo.fileName);
        
        if (downloadResult.error) {
            return downloadResult;
        }
        
        if (downloadResult.downloadUrl) {
            console.log(`[GDrive] Returning direct URL for large file`);
            return {
                downloadUrl: downloadResult.downloadUrl,
                fileName: fileInfo.fileName,
                fileSize: fileInfo.fileSize,
                mimetype: getMimeType(fileInfo.fileName)
            };
        }
        
        console.log(`[GDrive] File downloaded successfully: ${downloadResult.filePath}`);
        
        return {
            filePath: downloadResult.filePath,
            fileName: fileInfo.fileName,
            fileSize: fileInfo.fileSize,
            mimetype: getMimeType(fileInfo.fileName)
        };
        
    } catch (error) {
        console.error('[GDrive] Error:', error);
        return { error: true, message: error.message };
    }
}

async function getFileInfo(fileId) {
    let fileName = 'google_drive_file';
    let fileSize = 'غير معروف';
    
    try {
        const infoUrl = `https://drive.google.com/file/d/${fileId}/view`;
        const response = await fetch(infoUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        });
        
        const html = await response.text();
        
        const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
                          html.match(/"title":"([^"]+)"/) ||
                          html.match(/<title>([^<]+)<\/title>/i);
        
        if (titleMatch) {
            fileName = titleMatch[1]
                .replace(' - Google Drive', '')
                .replace(/&#(\d+);/g, (m, c) => String.fromCharCode(c))
                .trim();
        }
        
        const sizeMatch = html.match(/\((\d+(?:[.,]\d+)?\s*(?:KB|MB|GB|TB|bytes?))\)/i) ||
                         html.match(/"sizeBytes":"(\d+)"/);
        
        if (sizeMatch) {
            if (sizeMatch[1].match(/^\d+$/)) {
                fileSize = formatSize(parseInt(sizeMatch[1]));
            } else {
                fileSize = sizeMatch[1];
            }
        }
    } catch (e) {
        console.error('[GDrive] Info error:', e.message);
    }
    
    return { fileName, fileSize };
}

async function downloadFileWithVerification(fileId, fileName) {
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `gdrive_${Date.now()}_${fileName}`);
    const cookies = [];
    
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': 'https://drive.google.com/',
        'Connection': 'keep-alive'
    };
    
    try {
        console.log(`[GDrive] Starting download for file ID: ${fileId}`);
        
        const initialUrl = `https://drive.google.com/uc?id=${fileId}&export=download`;
        const response1 = await fetch(initialUrl, {
            headers,
            redirect: 'manual'
        });
        
        const setCookies1 = response1.headers.raw()['set-cookie'];
        if (setCookies1) {
            setCookies1.forEach(cookie => {
                const match = cookie.match(/^([^=]+)=([^;]+)/);
                if (match) cookies.push(`${match[1]}=${match[2]}`);
            });
        }
        
        if (response1.status === 302 || response1.status === 303) {
            const location = response1.headers.get('location');
            if (location && !location.includes('accounts.google.com') && !location.includes('ServiceLogin')) {
                console.log('[GDrive] Got direct redirect');
                const verified = await verifyDownloadUrl(location, cookies.join('; '));
                if (verified.isValid) {
                    return { downloadUrl: location };
                }
            }
        }
        
        const html = await response1.text();
        
        const formInputs = {};
        const inputMatches = html.matchAll(/<input[^>]+name="([^"]+)"[^>]+value="([^"]*)"/g);
        for (const m of inputMatches) {
            formInputs[m[1]] = m[2];
        }
        const inputMatches2 = html.matchAll(/<input[^>]+value="([^"]*)"[^>]+name="([^"]+)"/g);
        for (const m of inputMatches2) {
            formInputs[m[2]] = m[1];
        }
        
        console.log(`[GDrive] Form inputs found:`, Object.keys(formInputs));
        
        const downloadUrls = [];
        
        if (Object.keys(formInputs).length > 0) {
            const formAction = html.match(/action="([^"]+)"/);
            let baseUrl = 'https://drive.usercontent.google.com/download';
            if (formAction) {
                baseUrl = formAction[1].replace(/&amp;/g, '&');
                if (!baseUrl.startsWith('http')) {
                    baseUrl = `https://drive.usercontent.google.com${baseUrl}`;
                }
            }
            
            const params = new URLSearchParams();
            for (const [key, value] of Object.entries(formInputs)) {
                params.append(key, value);
            }
            downloadUrls.push(`${baseUrl}?${params.toString()}`);
        }
        
        let confirmToken = formInputs['confirm'] || null;
        let uuid = formInputs['uuid'] || null;
        let authuser = formInputs['authuser'] || '0';
        
        if (!confirmToken) {
            const confirmPatterns = [
                /confirm=([a-zA-Z0-9_-]+)/,
                /name="confirm"\s+value="([^"]+)"/,
                /"confirm":"([^"]+)"/
            ];
            for (const pattern of confirmPatterns) {
                const match = html.match(pattern);
                if (match) {
                    confirmToken = match[1];
                    break;
                }
            }
        }
        
        if (!uuid) {
            const uuidPatterns = [
                /name="uuid"\s+value="([^"]+)"/,
                /"uuid":"([^"]+)"/,
                /uuid=([a-f0-9-]+)/i
            ];
            for (const pattern of uuidPatterns) {
                const match = html.match(pattern);
                if (match) {
                    uuid = match[1];
                    break;
                }
            }
        }
        
        console.log(`[GDrive] Extracted - Confirm: ${confirmToken}, UUID: ${uuid}`);
        
        if (confirmToken || uuid) {
            let url1 = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&authuser=${authuser}`;
            if (confirmToken) url1 += `&confirm=${confirmToken}`;
            if (uuid) url1 += `&uuid=${uuid}`;
            downloadUrls.push(url1);
        }
        
        downloadUrls.push(`https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`);
        downloadUrls.push(`https://drive.google.com/uc?export=download&confirm=t&id=${fileId}`);
        
        for (const downloadUrl of downloadUrls) {
            console.log(`[GDrive] Trying URL: ${downloadUrl.substring(0, 100)}...`);
            
            const verified = await verifyDownloadUrl(downloadUrl, cookies.join('; '));
            if (verified.isValid) {
                const urlToUse = verified.finalUrl || downloadUrl;
                
                if (verified.isLargeFile) {
                    console.log(`[GDrive] Large file detected (${verified.contentLength} bytes), returning direct URL`);
                    return { downloadUrl: urlToUse };
                }
                
                if (verified.sizeUnknown) {
                    console.log(`[GDrive] Size unknown, attempting download to determine...`);
                    const result = await downloadSmallFile(urlToUse, tempFilePath, cookies.join('; '));
                    if (!result.error) {
                        const LARGE_FILE_THRESHOLD = 50 * 1024 * 1024;
                        if (result.size > LARGE_FILE_THRESHOLD) {
                            console.log(`[GDrive] Downloaded file is large (${result.size} bytes), returning direct URL instead`);
                            try { fs.unlinkSync(tempFilePath); } catch (e) {}
                            return { downloadUrl: urlToUse };
                        }
                        return result;
                    }
                } else {
                    const result = await downloadSmallFile(urlToUse, tempFilePath, cookies.join('; '));
                    if (!result.error) {
                        return result;
                    }
                }
            }
            console.log(`[GDrive] URL failed: ${verified.error || 'Unknown error'}`);
        }
        
        return { error: true, message: 'فشل في تحميل الملف بعد جميع المحاولات - الملف قد يكون محمي أو غير متاح' };
        
    } catch (error) {
        console.error('[GDrive] Download error:', error);
        try { fs.unlinkSync(tempFilePath); } catch (e) {}
        return { error: true, message: error.message };
    }
}

async function verifyDownloadUrl(url, cookieHeader, recursionDepth = 0) {
    if (recursionDepth > 3) {
        return { isValid: false, error: 'تجاوز الحد الأقصى للمحاولات' };
    }
    
    try {
        let contentType = '';
        let contentDisposition = '';
        let contentLength = 0;
        let finalUrl = url;
        
        const headResponse = await fetch(url, {
            method: 'HEAD',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Cookie': cookieHeader || '',
                'Referer': 'https://drive.google.com/'
            },
            redirect: 'follow'
        });
        
        contentType = headResponse.headers.get('content-type') || '';
        contentDisposition = headResponse.headers.get('content-disposition') || '';
        const clHeader = headResponse.headers.get('content-length');
        contentLength = clHeader ? parseInt(clHeader) : 0;
        finalUrl = headResponse.url;
        
        console.log(`[GDrive] Verify HEAD - Status: ${headResponse.status}, Type: ${contentType}, Size: ${contentLength}, Disposition: ${contentDisposition}`);
        
        const needsGetFallback = contentLength === 0 || 
                                  (contentType.includes('text/html') && !contentDisposition.includes('attachment'));
        
        if (needsGetFallback) {
            console.log(`[GDrive] HEAD incomplete, trying GET to verify...`);
            const getResponse = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Cookie': cookieHeader || '',
                    'Referer': 'https://drive.google.com/'
                },
                redirect: 'follow'
            });
            
            contentType = getResponse.headers.get('content-type') || '';
            contentDisposition = getResponse.headers.get('content-disposition') || '';
            const getCl = getResponse.headers.get('content-length');
            if (getCl) contentLength = parseInt(getCl);
            finalUrl = getResponse.url;
            
            if (contentType.includes('text/html') && !contentDisposition.includes('attachment')) {
                const html = await getResponse.text();
                
                if (html.includes('accounts.google.com') || html.includes('ServiceLogin')) {
                    return { isValid: false, error: 'الملف يتطلب تسجيل الدخول' };
                }
                
                if (html.includes('virus scan') || html.includes("Google Drive can't scan") || html.includes('download-form')) {
                    const formInputs = {};
                    const inputMatches = html.matchAll(/<input[^>]+name="([^"]+)"[^>]+value="([^"]*)"/g);
                    for (const m of inputMatches) {
                        formInputs[m[1]] = m[2];
                    }
                    const inputMatches2 = html.matchAll(/<input[^>]+value="([^"]*)"[^>]+name="([^"]+)"/g);
                    for (const m of inputMatches2) {
                        formInputs[m[2]] = m[1];
                    }
                    
                    if (Object.keys(formInputs).length > 0) {
                        const formAction = html.match(/action="([^"]+)"/);
                        let baseUrl = 'https://drive.usercontent.google.com/download';
                        if (formAction) {
                            baseUrl = formAction[1].replace(/&amp;/g, '&');
                            if (!baseUrl.startsWith('http')) {
                                baseUrl = `https://drive.usercontent.google.com${baseUrl}`;
                            }
                        }
                        
                        const params = new URLSearchParams();
                        for (const [key, value] of Object.entries(formInputs)) {
                            params.append(key, value);
                        }
                        const newUrl = `${baseUrl}?${params.toString()}`;
                        
                        console.log(`[GDrive] Extracted form URL from warning page (depth: ${recursionDepth})`);
                        return await verifyDownloadUrl(newUrl, cookieHeader, recursionDepth + 1);
                    }
                }
                
                return { isValid: false, error: 'حصلنا على صفحة HTML' };
            }
            
            console.log(`[GDrive] Verify GET - Type: ${contentType}, Size: ${contentLength}, Disposition: ${contentDisposition}`);
        }
        
        const LARGE_FILE_THRESHOLD = 50 * 1024 * 1024;
        const isLargeFile = contentLength > 0 && contentLength > LARGE_FILE_THRESHOLD;
        const sizeUnknown = contentLength === 0;
        
        return { 
            isValid: true, 
            isLargeFile,
            sizeUnknown,
            contentLength,
            finalUrl
        };
        
    } catch (error) {
        return { isValid: false, error: error.message };
    }
}

async function downloadSmallFile(url, filePath, cookieHeader) {
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Cookie': cookieHeader || '',
                'Referer': 'https://drive.google.com/'
            },
            redirect: 'follow'
        });
        
        const contentType = response.headers.get('content-type') || '';
        const contentDisposition = response.headers.get('content-disposition') || '';
        
        if (contentType.includes('text/html') && !contentDisposition.includes('attachment')) {
            return { error: true, message: 'حصلنا على صفحة HTML بدلاً من الملف' };
        }
        
        const buffer = await response.buffer();
        
        if (buffer.length < 1000) {
            const preview = buffer.toString('utf8', 0, Math.min(500, buffer.length));
            if (preview.includes('<!DOCTYPE') || preview.includes('<html') || preview.includes('<HTML')) {
                return { error: true, message: 'الملف المحمل هو صفحة HTML' };
            }
        }
        
        fs.writeFileSync(filePath, buffer);
        console.log(`[GDrive] File saved: ${filePath} (${buffer.length} bytes)`);
        
        return { filePath, size: buffer.length };
        
    } catch (error) {
        return { error: true, message: error.message };
    }
}

function formatSize(bytes) {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(2) + " " + sizes[i];
}

function getMimeType(fileName) {
    const ext = fileName.split('.').pop()?.toLowerCase();
    const mimeTypes = {
        'pdf': 'application/pdf',
        'doc': 'application/msword',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'zip': 'application/zip',
        'rar': 'application/x-rar-compressed',
        '7z': 'application/x-7z-compressed',
        'mp3': 'audio/mpeg',
        'mp4': 'video/mp4',
        'mkv': 'video/x-matroska',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'apk': 'application/vnd.android.package-archive',
        'exe': 'application/x-msdownload'
    };
    return mimeTypes[ext] || 'application/octet-stream';
}
