"""
Cloudflare Bypass Solutions
استخدام curl-cffi أو undetected-chromedriver للتجاوز المباشر
"""

import asyncio
import time
from typing import List, Dict, Any
from urllib.parse import quote
from bs4 import BeautifulSoup

try:
    from curl_cffi import requests as cf_requests
    HAS_CURL_CFFI = True
except ImportError:
    HAS_CURL_CFFI = False

try:
    import undetected_chromedriver as uc
    HAS_UC = True
except ImportError:
    HAS_UC = False


class CloudflareBypass:
    """
    استراتيجيات متعددة لتجاوز Cloudflare بدون تأخيرات
    """
    
    @staticmethod
    def search_with_curl_cffi(query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """
        استخدام curl-cffi - أسرع طريقة بدون تأخيرات
        curl-cffi يحاكي TLS fingerprint من Chrome
        """
        if not HAS_CURL_CFFI:
            return []
        
        try:
            search_url = f"https://apkpure.com/search?q={quote(query)}"
            print(f"[curl-cffi] 🚀 البحث عن: {query}")
            
            # curl-cffi يتجاوز Cloudflare تلقائياً
            response = cf_requests.get(
                search_url,
                impersonate="chrome120",  # محاكاة Chrome 120
                timeout=15,
                headers={
                    'Accept-Language': 'en-US,en;q=0.9',
                }
            )
            
            if response.status_code == 200:
                print(f"[curl-cffi] ✅ نجح بدون Cloudflare!")
                return CloudflareBypass._parse_results(response.text, limit)
            
            print(f"[curl-cffi] ⚠️ Status: {response.status_code}")
            return []
            
        except Exception as e:
            print(f"[curl-cffi] ❌ خطأ: {str(e)[:50]}")
            return []
    
    @staticmethod
    def search_with_undetected_chrome(query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """
        استخدام undetected-chromedriver - Chrome automation بدون detection
        """
        if not HAS_UC:
            return []
        
        try:
            print(f"[undetected-chrome] 🤖 تشغيل Chrome الحقيقي...")
            
            # خيارات لتجنب الكشف
            options = uc.ChromeOptions()
            options.add_argument("--no-sandbox")
            options.add_argument("--disable-dev-shm-usage")
            options.add_argument("--disable-gpu")
            options.add_argument("--start-maximized")
            options.add_argument("--disable-extensions")
            
            driver = uc.Chrome(options=options, version_main=None)
            
            search_url = f"https://apkpure.com/search?q={quote(query)}"
            driver.get(search_url)
            
            # انتظر تحميل الصفحة
            time.sleep(2)
            
            html = driver.page_source
            driver.quit()
            
            print(f"[undetected-chrome] ✅ تم تحميل الصفحة!")
            return CloudflareBypass._parse_results(html, limit)
            
        except Exception as e:
            print(f"[undetected-chrome] ❌ خطأ: {str(e)[:50]}")
            return []
    
    @staticmethod
    def search_with_google_play_api(query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """
        استخدام Google Play API - بدون Cloudflare تماماً
        بديل سريع وموثوق
        """
        try:
            from google_play_scraper import search, Sort
            
            print(f"[Google Play] 🎮 البحث عن: {query}")
            
            results = search(
                query,
                lang="en",
                country="us",
                sort=Sort.RATING,
                n_hits=limit
            )
            
            apps = []
            for app in results:
                apps.append({
                    'title': app.get('title', ''),
                    'appId': app.get('appId', ''),
                    'developer': app.get('developer', ''),
                    'score': float(app.get('score', 0)),
                    'icon': app.get('icon', ''),
                })
            
            print(f"[Google Play] ✅ وجدنا {len(apps)} تطبيقات!")
            return apps
            
        except Exception as e:
            print(f"[Google Play] ⚠️ {str(e)[:50]}")
            return []
    
    @staticmethod
    def _parse_results(html: str, limit: int) -> List[Dict[str, Any]]:
        """
        تحليل HTML واستخراج النتائج
        """
        try:
            soup = BeautifulSoup(html, 'html.parser')
            results = []
            seen = set()
            
            for link in soup.find_all('a', href=True):
                if len(results) >= limit:
                    break
                
                href = link.get('href', '').lower()
                
                # تخطي الروابط غير المهمة
                if not href.startswith('/app/') or any(x in href for x in ['/search', '/developer', '/category']):
                    continue
                
                package = href.split('/')[2] if len(href.split('/')) > 2 else None
                if not package or package in seen:
                    continue
                
                seen.add(package)
                
                # استخراج المعلومات
                title = link.get_text(strip=True)
                if not title or len(title) > 100:
                    continue
                
                results.append({
                    'title': title,
                    'appId': package,
                    'developer': 'Unknown',
                    'score': 0,
                    'icon': None,
                })
            
            return results
        except Exception as e:
            print(f"[Parse] ❌ {str(e)}")
            return []


async def search_apk_advanced(query: str, limit: int = 10) -> List[Dict[str, Any]]:
    """
    محاولة جميع الطرق حتى النجاح
    """
    print(f"\n{'='*50}")
    print(f"🔍 البحث المتقدم عن: {query}")
    print(f"{'='*50}\n")
    
    # 1. جرب curl-cffi أولاً (الأسرع)
    print("⏳ محاولة 1: curl-cffi (الأسرع)...")
    results = CloudflareBypass.search_with_curl_cffi(query, limit)
    if results:
        return results
    
    # 2. جرب Google Play API
    print("\n⏳ محاولة 2: Google Play API...")
    results = CloudflareBypass.search_with_google_play_api(query, limit)
    if results:
        return results
    
    # 3. جرب undetected-chromedriver (الأبطأ لكن الأقوى)
    print("\n⏳ محاولة 3: undetected-chromedriver...")
    results = CloudflareBypass.search_with_undetected_chrome(query, limit)
    if results:
        return results
    
    print("\n❌ فشلت جميع الطرق")
    return []


if __name__ == "__main__":
    # اختبار
    import sys
    query = sys.argv[1] if len(sys.argv) > 1 else "whatsapp"
    
    results = asyncio.run(search_apk_advanced(query))
    print(f"\n📊 النتائج: {len(results)} تطبيقات")
    for i, app in enumerate(results[:5], 1):
        print(f"{i}. {app['title']}")
