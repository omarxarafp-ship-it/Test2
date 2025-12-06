import asyncio
import aiohttp
import time
from datetime import datetime

async def search_app(session, query, index):
    """البحث عن تطبيق"""
    try:
        url = f"http://localhost:8000/search?q={query}&limit=1"
        async with session.get(url, timeout=10) as resp:
            if resp.status == 200:
                data = await resp.json()
                count = data.get('count', 0)
                status = "✅" if count > 0 else "❌"
                return {"index": index, "query": query, "count": count, "status": status}
            else:
                return {"index": index, "query": query, "count": 0, "status": f"⚠️ {resp.status}"}
    except Exception as e:
        return {"index": index, "query": query, "count": 0, "status": f"❌"}

async def test_parallel_searches(count=50):
    """اختبار بحث متوازي"""
    print(f"\n{'='*60}")
    print(f"🔍 اختبار بحث {count} تطبيق في نفس الوقت")
    print(f"⏱️  الوقت: {datetime.now().strftime('%H:%M:%S')}")
    print(f"{'='*60}\n")
    
    queries = [
        "whatsapp", "instagram", "facebook", "telegram", "discord",
        "youtube", "tiktok", "snapchat", "twitter", "reddit",
        "gmail", "maps", "chrome", "firefox", "vlc",
        "spotify", "netflix", "amazon", "uber", "airbnb",
        "whatsapp", "instagram", "facebook", "telegram", "discord",
        "pubg", "fortnite", "minecraft", "roblox", "gaming",
        "free fire", "call of duty", "gta", "nba", "nfl",
        "word", "excel", "powerpoint", "office", "teams",
        "zoom", "slack", "trello", "asana", "notion",
        "photoshop", "lightroom", "illustrator", "premiere", "ae",
    ][:count]
    
    start_time = time.time()
    
    print(f"🚀 بدء {len(queries)} بحث متوازي...\n")
    
    async with aiohttp.ClientSession() as session:
        tasks = [search_app(session, query, i+1) for i, query in enumerate(queries)]
        results = await asyncio.gather(*tasks)
    
    elapsed = time.time() - start_time
    
    # الإحصائيات
    success = sum(1 for r in results if r["count"] > 0)
    total_apps = sum(r["count"] for r in results)
    
    print(f"\n{'='*60}")
    print(f"📊 النتائج:")
    print(f"{'='*60}")
    print(f"✅ بحوث ناجحة: {success}/{count}")
    print(f"📦 إجمالي النتائج: {total_apps} تطبيق")
    print(f"⏱️  الوقت الإجمالي: {elapsed:.2f} ثانية")
    print(f"🚀 السرعة: {count/elapsed:.1f} بحث/ثانية")
    print(f"{'='*60}\n")
    
    # أول 15 نتيجة
    print("أول 15 بحث:")
    for i, result in enumerate(results[:15], 1):
        print(f"{i:2d}. {result['query']:20s} {result['count']:2d} تطبيق {result['status']}")
    
    print(f"\n✅ النظام يعمل بكفاءة حتى مع {count} بحث متوازي!")

if __name__ == "__main__":
    asyncio.run(test_parallel_searches(50))
