/**
 * Test Live CMS Content
 * This script checks what CMS content is currently being served
 */
const pool = require('../db');

async function testLiveCMS() {
  try {
    console.log('🔍 Testing live CMS content from database...');
    
    const result = await pool.query(`
      SELECT key, value, updated_at 
      FROM cms_content 
      WHERE key IN ('hero_subheadline', 'about_company_name', 'feature_1_title', 'contact_phone')
      ORDER BY key
    `);
    
    console.log('\n📊 Current Database Content:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    result.rows.forEach(row => {
      const displayValue = row.value.length > 80 ? row.value.substring(0, 80) + '...' : row.value;
      console.log(`🔑 ${row.key}:`);
      console.log(`   ${displayValue}`);
      console.log(`   🕐 Updated: ${row.updated_at}`);
      console.log('');
    });
    
    console.log('✅ Database check complete');
    console.log('📢 If these values match the new content, the issue is CDN/browser caching');
    
  } catch (err) {
    console.error('❌ Database check failed:', err.message);
  } finally {
    await pool.end();
  }
}

testLiveCMS();