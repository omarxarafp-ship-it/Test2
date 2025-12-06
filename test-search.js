import apkpureSearch from './apkpure-search.js';
import { askGemini } from './gemini-scraper.js';

async function testFreeFire() {
    console.log('🔍 جاري البحث عن فري فاير...\n');
    
    try {
        // البحث عن فري فاير
        const results = await apkpureSearch.search({ term: 'فري فاير', num: 5 });
        
        if (results && results.length > 0) {
            console.log(`✅ تم العثور على ${results.length} نتيجة:\n`);
            results.forEach((app, index) => {
                console.log(`${index + 1}. ${app.title || app.appId}`);
                console.log(`   Developer: ${app.developer || 'Unknown'}`);
                console.log(`   Score: ${app.score || 'N/A'}\n`);
            });
        } else {
            console.log('⚠️ لم يتم العثور على نتائج');
        }
        
    } catch (error) {
        console.error('❌ خطأ في البحث:', error.message);
    }
}

async function testGeminiSearch() {
    console.log('\n🤖 جاري طلب معلومات من Gemini عن فري فاير...\n');
    
    try {
        const prompt = 'أخبرني عن لعبة Free Fire باختصار';
        const response = await askGemini('test-user', prompt);
        
        console.log('📝 رد Gemini:\n');
        console.log(response);
        
    } catch (error) {
        console.error('❌ خطأ في Gemini:', error.message);
    }
}

async function main() {
    await testFreeFire();
    // await testGeminiSearch(); // تم تعليقها لأن Gemini قد تحتاج إلى تكوين إضافي
}

main().catch(console.error);
