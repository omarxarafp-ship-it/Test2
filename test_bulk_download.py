import asyncio
import aiohttp
import time
from datetime import datetime

async def download_app(session, app_id, index):
    """تنزيل تطبيق واحد"""
    try:
        # محاكاة طلب تنزيل
        url = f"http://localhost:8000/download/{app_id}"
        async with session.get(url, timeout=5) as resp:
            if resp.status == 200:
                return {"index": index, "status": "✅ نجح", "appId": app_id}
            else:
                return {"index": index, "status": "⚠️ خطأ", "appId": app_id}
    except Exception as e:
        return {"index": index, "status": f"❌ {str(e)[:20]}", "appId": app_id}

async def test_bulk_downloads(count=100):
    """اختبار تنزيل متعدد"""
    print(f"\n🚀 اختبار تنزيل {count} تطبيق في نفس الوقت...")
    print(f"⏱️ الوقت: {datetime.now().strftime('%H:%M:%S')}\n")
    
    # قائمة تطبيقات للاختبار
    apps = [
        "com.whatsapp", "com.instagram.android", "com.facebook.katana",
        "com.viber.voip", "com.telegram", "com.snapchat", "com.tiktok.android",
        "com.twitter.android", "com.discord", "com.reddit.frontpage",
    ] * 10  # كرر 10 مرات للوصول إلى 100 تطبيق
    apps = apps[:count]
    
    start_time = time.time()
    
    async with aiohttp.ClientSession() as session:
        tasks = [download_app(session, app, i+1) for i, app in enumerate(apps)]
        results = await asyncio.gather(*tasks)
    
    elapsed = time.time() - start_time
    
    # إحصائيات
    success = sum(1 for r in results if "✅" in r["status"])
    failed = sum(1 for r in results if "❌" in r["status"])
    warning = sum(1 for r in results if "⚠️" in r["status"])
    
    print(f"\n{'='*50}")
    print(f"📊 النتائج:")
    print(f"{'='*50}")
    print(f"✅ نجح: {success}/{count}")
    print(f"⚠️ تحذير: {warning}/{count}")
    print(f"❌ فشل: {failed}/{count}")
    print(f"⏱️ الوقت الإجمالي: {elapsed:.2f} ثانية")
    print(f"🚀 السرعة: {count/elapsed:.1f} تطبيق/ثانية")
    print(f"{'='*50}\n")
    
    # اعرض أول 10 نتائج
    print("أول 10 نتائج:")
    for i, result in enumerate(results[:10], 1):
        print(f"{i:3d}. [{result['index']:3d}] {result['appId']:30s} {result['status']}")

if __name__ == "__main__":
    asyncio.run(test_bulk_downloads(100))
