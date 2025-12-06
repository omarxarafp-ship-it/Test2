#!/usr/bin/env python3
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import time
import os
import subprocess
from typing import Optional, Dict, Any, List
import uvicorn
import sys
from contextlib import asynccontextmanager
from datetime import datetime
import aiohttp
import re
import cloudscraper
from bs4 import BeautifulSoup
from urllib.parse import quote, urljoin

DOWNLOADS_DIR = os.path.join(os.path.dirname(__file__), 'app_cache')
os.makedirs(DOWNLOADS_DIR, exist_ok=True)

APKEEP_PATH = os.path.join(os.path.dirname(__file__), 'apkeep')

async def download_with_aria2(url: str, output_path: str, filename: str) -> Optional[str]:
    """Download file using aria2c with multiple connections for speed"""
    try:
        print(f"[aria2] Downloading with 16 connections...", file=sys.stderr)
        start_time = time.time()
        
        result = subprocess.run(
            [
                'aria2c',
                '-x', '16',
                '-s', '16', 
                '-k', '1M',
                '--max-connection-per-server=16',
                '--min-split-size=1M',
                '--file-allocation=none',
                '--continue=true',
                '-d', output_path,
                '-o', filename,
                '--timeout=120',
                '--connect-timeout=30',
                url
            ],
            capture_output=True,
            text=True,
            timeout=300
        )
        
        elapsed = time.time() - start_time
        file_path = os.path.join(output_path, filename)
        
        if os.path.exists(file_path) and os.path.getsize(file_path) > 100000:
            size_mb = os.path.getsize(file_path) / (1024 * 1024)
            print(f"[aria2] Downloaded: {size_mb:.1f} MB in {elapsed:.1f}s", file=sys.stderr)
            return file_path
        
        print(f"[aria2] Failed: {result.stderr}", file=sys.stderr)
        return None
        
    except subprocess.TimeoutExpired:
        print(f"[aria2] Timeout", file=sys.stderr)
        return None
    except Exception as e:
        print(f"[aria2] Error: {e}", file=sys.stderr)
        return None

import zipfile
import io

def detect_real_file_type(file_path: str) -> str:
    """Detect actual file type by inspecting ZIP contents"""
    try:
        with zipfile.ZipFile(file_path, 'r') as zf:
            names = zf.namelist()
            names_lower = [n.lower() for n in names]
            
            if 'manifest.json' in names_lower:
                print(f"[Type Detect] Found manifest.json - this is XAPK", file=sys.stderr)
                return 'xapk'
            
            has_apk = any(n.endswith('.apk') for n in names_lower)
            has_obb = any('.obb' in n for n in names_lower)
            
            if has_apk or has_obb:
                print(f"[Type Detect] Found APK/OBB inside - this is XAPK", file=sys.stderr)
                return 'xapk'
            
            if 'androidmanifest.xml' in names_lower:
                print(f"[Type Detect] Found AndroidManifest.xml at root - this is APK", file=sys.stderr)
                return 'apk'
            
            if 'classes.dex' in names_lower or 'resources.arsc' in names_lower:
                print(f"[Type Detect] Found APK structure - this is APK", file=sys.stderr)
                return 'apk'
            
            print(f"[Type Detect] Unknown structure, files: {names[:5]}", file=sys.stderr)
            return 'apk'
            
    except zipfile.BadZipFile:
        print(f"[Type Detect] Not a valid ZIP file", file=sys.stderr)
        return 'apk'
    except Exception as e:
        print(f"[Type Detect] Error: {e}", file=sys.stderr)
        return 'apk'

async def download_from_apkpure(package_name: str, output_dir: str) -> Optional[str]:
    """Download from APKPure and detect real file type from content"""
    try:
        temp_filename = f"{package_name}.tmp"
        download_url = f"https://d.apkpure.com/b/XAPK/{package_name}?version=latest"
        
        print(f"[APKPure] Downloading {package_name}...", file=sys.stderr)
        result = await download_with_aria2(download_url, output_dir, temp_filename)
        
        if not result or not os.path.exists(result) or os.path.getsize(result) < 100000:
            download_url = f"https://d.apkpure.com/b/APK/{package_name}?version=latest"
            print(f"[APKPure] XAPK failed, trying APK endpoint...", file=sys.stderr)
            result = await download_with_aria2(download_url, output_dir, temp_filename)
        
        if not result or not os.path.exists(result) or os.path.getsize(result) < 100000:
            print(f"[APKPure] Download failed for {package_name}", file=sys.stderr)
            return None
        
        real_type = detect_real_file_type(result)
        final_filename = f"{package_name}.{real_type}"
        final_path = os.path.join(output_dir, final_filename)
        
        if result != final_path:
            os.rename(result, final_path)
            print(f"[APKPure] Renamed to: {final_filename}", file=sys.stderr)
        
        return final_path
        
    except Exception as e:
        print(f"[APKPure] Error: {e}", file=sys.stderr)
        return None

not_found_cache: Dict[str, float] = {}
NOT_FOUND_CACHE_TTL = 3600

file_cache: Dict[str, Dict[str, Any]] = {}
download_locks: Dict[str, asyncio.Lock] = {}
pending_deletions: Dict[str, asyncio.Task] = {}

stats = {
    "total_requests": 0,
    "downloads": 0,
    "not_found": 0,
    "cache_hits": 0
}

def get_download_lock(package_name: str) -> asyncio.Lock:
    if package_name not in download_locks:
        download_locks[package_name] = asyncio.Lock()
    return download_locks[package_name]

async def schedule_file_deletion(file_path: str, delay: int = 60):
    await asyncio.sleep(delay)
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
            print(f"[Cleanup] Deleted: {os.path.basename(file_path)}", file=sys.stderr)
    except Exception as e:
        print(f"[Cleanup Error] {file_path}: {e}", file=sys.stderr)

def cleanup_old_files():
    try:
        now = time.time()
        max_age = 300
        for filename in os.listdir(DOWNLOADS_DIR):
            file_path = os.path.join(DOWNLOADS_DIR, filename)
            if os.path.isfile(file_path):
                file_age = now - os.path.getmtime(file_path)
                if file_age > max_age:
                    os.remove(file_path)
                    print(f"[Cleanup] Removed old file: {filename}", file=sys.stderr)
    except Exception as e:
        print(f"[Cleanup Error] {e}", file=sys.stderr)

async def periodic_cleanup():
    while True:
        await asyncio.sleep(60)
        cleanup_old_files()

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[Server] Starting with apkeep...", file=sys.stderr)
    asyncio.create_task(periodic_cleanup())
    yield
    print("[Server] Shutting down...", file=sys.stderr)

app = FastAPI(title="APK Download API (apkeep)", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def download_with_apkeep(package_name: str, output_dir: str) -> Optional[str]:
    try:
        print(f"[apkeep] Downloading {package_name}...", file=sys.stderr)
        start_time = time.time()
        
        result = subprocess.run(
            [APKEEP_PATH, "-a", package_name, output_dir],
            capture_output=True,
            text=True,
            timeout=300
        )
        
        elapsed = time.time() - start_time
        
        if "downloaded successfully" in result.stdout.lower():
            for ext in ['.xapk', '.apk', '.apks']:
                file_path = os.path.join(output_dir, f"{package_name}{ext}")
                if os.path.exists(file_path):
                    size_mb = os.path.getsize(file_path) / (1024 * 1024)
                    print(f"[apkeep] Downloaded {package_name}: {size_mb:.1f} MB in {elapsed:.1f}s", file=sys.stderr)
                    return file_path
        
        if "could not get download url" in result.stdout.lower() or "skipping" in result.stdout.lower():
            print(f"[apkeep] App not found: {package_name}", file=sys.stderr)
            return None
            
        print(f"[apkeep] Failed: {result.stdout} {result.stderr}", file=sys.stderr)
        return None
        
    except subprocess.TimeoutExpired:
        print(f"[apkeep] Timeout for {package_name}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"[apkeep] Error: {e}", file=sys.stderr)
        return None

@app.get("/")
async def root():
    return {
        "status": "running",
        "engine": "apkeep",
        "stats": stats
    }

@app.get("/download/{package_name}")
async def download_apk(package_name: str, background_tasks: BackgroundTasks):
    stats["total_requests"] += 1
    now = time.time()
    
    if package_name in not_found_cache:
        if now - not_found_cache[package_name] < NOT_FOUND_CACHE_TTL:
            print(f"[Cache] {package_name} is cached as not found", file=sys.stderr)
            stats["cache_hits"] += 1
            raise HTTPException(status_code=404, detail=f"App {package_name} not found (cached)")
        else:
            del not_found_cache[package_name]
    
    lock = get_download_lock(package_name)
    
    async with lock:
        for ext in ['.xapk', '.apk', '.apks']:
            cached_path = os.path.join(DOWNLOADS_DIR, f"{package_name}{ext}")
            if os.path.exists(cached_path):
                file_size = os.path.getsize(cached_path)
                if file_size > 100000:
                    print(f"[Cache] Serving cached file: {package_name}", file=sys.stderr)
                    stats["cache_hits"] += 1
                    file_type = ext[1:]
                    return FileResponse(
                        path=cached_path,
                        filename=f"{package_name}{ext}",
                        media_type="application/octet-stream",
                        headers={
                            "X-Source": "cache",
                            "X-File-Type": file_type,
                            "X-File-Size": str(file_size),
                            "Cache-Control": "no-cache"
                        }
                    )
        
        file_path = None
        source = None
        
        print(f"[Download] Trying APKPure+aria2 for {package_name}...", file=sys.stderr)
        file_path = await download_from_apkpure(package_name, DOWNLOADS_DIR)
        if file_path:
            source = "aria2+apkpure"
        
        if not file_path:
            print(f"[Download] Falling back to apkeep for {package_name}...", file=sys.stderr)
            loop = asyncio.get_event_loop()
            file_path = await loop.run_in_executor(
                None,
                download_with_apkeep,
                package_name,
                DOWNLOADS_DIR
            )
            if file_path:
                source = "apkeep"
        
        if not file_path or not os.path.exists(file_path):
            not_found_cache[package_name] = time.time()
            stats["not_found"] += 1
            print(f"[Not Found] {package_name} added to cache for 1 hour", file=sys.stderr)
            raise HTTPException(status_code=404, detail=f"App {package_name} not found")
        
        file_size = os.path.getsize(file_path)
        file_type = os.path.splitext(file_path)[1][1:]
        stats["downloads"] += 1
        
        deletion_task = asyncio.create_task(schedule_file_deletion(file_path, 60))
        pending_deletions[package_name] = deletion_task
        
        print(f"[Success] {package_name} downloaded via {source}: {file_size/(1024*1024):.1f} MB", file=sys.stderr)
        
        return FileResponse(
            path=file_path,
            filename=os.path.basename(file_path),
            media_type="application/octet-stream",
            headers={
                "X-Source": source,
                "X-File-Type": file_type,
                "X-File-Size": str(file_size),
                "Cache-Control": "no-cache"
            }
        )

@app.get("/info/{package_name}")
async def get_info(package_name: str):
    if package_name in not_found_cache:
        now = time.time()
        if now - not_found_cache[package_name] < NOT_FOUND_CACHE_TTL:
            raise HTTPException(status_code=404, detail=f"App {package_name} not found (cached)")
    
    return {
        "package_name": package_name,
        "source": "apkeep",
        "status": "available"
    }

def search_apkpure(query: str, limit: int = 10) -> List[Dict[str, Any]]:
    """Search APKPure with improved headers and retry logic"""
    try:
        import time
        search_url = f"https://apkpure.com/search?q={quote(query)}"
        print(f"[Search] Searching APKPure: {query}", file=sys.stderr)
        
        headers_list = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
        ]
        
        for attempt, user_agent in enumerate(headers_list):
            try:
                headers = {
                    'User-Agent': user_agent,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'DNT': '1',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                    'Referer': 'https://apkpure.com/',
                }
                
                if attempt > 0:
                    time.sleep(2 * attempt)
                    
                scraper = cloudscraper.create_scraper()
                response = scraper.get(search_url, timeout=25, headers=headers)
                
                if response.status_code == 200:
                    print(f"[Search] Success with user-agent #{attempt + 1}", file=sys.stderr)
                    break
                elif response.status_code == 403:
                    print(f"[Search] Got 403 with attempt {attempt + 1}, trying next...", file=sys.stderr)
                    continue
                else:
                    print(f"[Search] APKPure returned {response.status_code} on attempt {attempt + 1}", file=sys.stderr)
                    continue
                    
            except Exception as e:
                print(f"[Search] Attempt {attempt + 1} failed: {str(e)}", file=sys.stderr)
                if attempt < len(headers_list) - 1:
                    continue
                else:
                    raise
        
        if response.status_code != 200:
            print(f"[Search] All attempts failed, last status: {response.status_code}", file=sys.stderr)
            return []
        
        soup = BeautifulSoup(response.text, 'html.parser')
        results = []
        seen_packages = set()
        
        skip_patterns = ['search?', 'developer/', 'topic/', 'category/', 'group/', 'tag/',
                        '/download', '/versions', '/similar', 'windows-app/', 'iphone-app/', 'mac-app/',
                        '/about', '/contact', '/privacy', 'howto/', 'chrome.google.com', 
                        'play.google.com', '/ar/', '/de/', '/es/', '/fr/', '/pt/', '/ru/', '/ja/', '/ko/', '/zh/',
                        'premium', 'chrome/webstore']
        
        bad_titles = ['apkpure', 'windows app', 'iphone app', 'install now', 'search apk',
                     'aipure', 'tvonic', 'more', 'see all', 'add apk', 'chrome extension',
                     'download apk', 'install apk', 'get it on', 'remove ads', 'premium']
        
        print(f"[Search] Page loaded, parsing...", file=sys.stderr)
        
        all_links = soup.find_all('a', href=True)
        print(f"[Search] Found {len(all_links)} total links", file=sys.stderr)
        
        for link in all_links:
            if len(results) >= limit:
                break
                
            href = link.get('href', '')
            if not href:
                continue
            
            href_lower = href.lower()
            if any(skip in href_lower for skip in skip_patterns):
                continue
            
            package_match = re.search(r'apkpure\.com/([^/]+)/([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)(?:/|$)', href, re.IGNORECASE)
            if not package_match:
                url_path = href.replace('https://apkpure.com', '').replace('http://apkpure.com', '')
                package_match = re.search(r'^/([^/]+)/([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)(?:/|$)', url_path, re.IGNORECASE)
            
            if not package_match:
                continue
            
            app_slug = package_match.group(1) if package_match.lastindex >= 1 else ''
            package_id = package_match.group(2).lower() if package_match.lastindex >= 2 else package_match.group(1).lower()
            
            if package_id in seen_packages:
                continue
            if len(package_id) < 5 or package_id.count('.') < 1:
                continue
            
            parent = link.parent
            grandparent = parent.parent if parent else None
            context = grandparent if grandparent else (parent if parent else link)
            
            title = None
            developer = 'Unknown'
            
            if app_slug:
                title = app_slug.replace('-', ' ').title()
            
            title_text = link.get_text(separator='\n', strip=True) if hasattr(link, 'get_text') else ''
            if title_text:
                lines = [l.strip() for l in title_text.split('\n') if l.strip()]
                if len(lines) >= 1:
                    first_line = lines[0]
                    if first_line and len(first_line) >= 2 and len(first_line) <= 60:
                        if not any(bad.lower() in first_line.lower() for bad in bad_titles):
                            title = first_line
                    if len(lines) >= 2:
                        potential_dev = lines[1]
                        if potential_dev and len(potential_dev) < 50:
                            if not any(x in potential_dev.lower() for x in ['download', 'install', 'apk', 'version', 'xapk']):
                                if not re.match(r'^[0-9.]+$', potential_dev):
                                    developer = potential_dev
            
            if not title:
                title = package_id
            
            title = re.sub(r'\s+', ' ', title).strip()
            title = re.split(r'[0-9]+\.[0-9]+|Download|Install|APK|XAPK', title)[0].strip()
            
            if not title or len(title) < 2:
                continue
            
            if any(bad.lower() in title.lower() for bad in bad_titles):
                continue
            
            words = title.split()
            if len(words) > 8:
                title = ' '.join(words[:8])
            
            icon = None
            for ctx in [link, parent, grandparent, context]:
                if ctx:
                    img = ctx.find('img') if hasattr(ctx, 'find') else None
                    if img:
                        icon = img.get('src') or img.get('data-src') or img.get('data-original')
                        if icon:
                            break
            
            if icon and isinstance(icon, str):
                if icon.startswith('//'):
                    icon = f"https:{icon}"
                elif icon.startswith('/'):
                    icon = f"https://apkpure.com{icon}"
            
            seen_packages.add(package_id)
            results.append({
                'title': title,
                'appId': package_id,
                'developer': developer,
                'icon': icon,
                'score': 0
            })
        
        print(f"[Search] Found {len(results)} results for '{query}'", file=sys.stderr)
        return results
        
    except Exception as e:
        print(f"[Search] Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return []

@app.get("/search")
async def search_apps(q: str, limit: int = 10):
    """Search for apps on APKPure"""
    if not q or len(q) < 1:
        raise HTTPException(status_code=400, detail="Query parameter 'q' is required")
    
    loop = asyncio.get_event_loop()
    results = await loop.run_in_executor(None, search_apkpure, q, min(limit, 20))
    
    return {
        "query": q,
        "count": len(results),
        "results": results
    }

@app.get("/app/{package_name}")
async def get_app_details(package_name: str):
    """Get app details from APKPure"""
    loop = asyncio.get_event_loop()
    results = await loop.run_in_executor(None, search_apkpure, package_name, 5)
    
    exact_match = next((r for r in results if r['appId'] == package_name), None)
    
    if exact_match:
        return exact_match
    
    if results:
        return {
            'title': results[0]['title'],
            'appId': package_name,
            'developer': results[0]['developer'],
            'icon': results[0]['icon'],
            'score': 0
        }
    
    return {
        'title': package_name,
        'appId': package_name,
        'developer': 'Unknown',
        'icon': None,
        'score': 0
    }

@app.get("/not-found-cache")
async def get_not_found_cache():
    now = time.time()
    result = {}
    for pkg, timestamp in not_found_cache.items():
        remaining = NOT_FOUND_CACHE_TTL - (now - timestamp)
        if remaining > 0:
            result[pkg] = {
                "cached_at": datetime.fromtimestamp(timestamp).isoformat(),
                "expires_in_minutes": round(remaining / 60, 1)
            }
    return {"not_found_apps": result, "count": len(result)}

@app.delete("/not-found-cache/{package_name}")
async def remove_from_not_found_cache(package_name: str):
    if package_name in not_found_cache:
        del not_found_cache[package_name]
        return {"status": "removed", "package": package_name}
    return {"status": "not_in_cache", "package": package_name}

@app.delete("/cache")
async def clear_cache():
    global not_found_cache, file_cache
    
    for task in pending_deletions.values():
        task.cancel()
    pending_deletions.clear()
    
    for filename in os.listdir(DOWNLOADS_DIR):
        try:
            os.remove(os.path.join(DOWNLOADS_DIR, filename))
        except:
            pass
    
    not_found_cache = {}
    file_cache = {}
    
    return {"status": "cache_cleared"}

@app.get("/stats")
async def get_stats():
    return {
        "stats": stats,
        "cached_not_found": len(not_found_cache),
        "downloads_dir_size": sum(
            os.path.getsize(os.path.join(DOWNLOADS_DIR, f))
            for f in os.listdir(DOWNLOADS_DIR)
            if os.path.isfile(os.path.join(DOWNLOADS_DIR, f))
        ) / (1024 * 1024)
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
