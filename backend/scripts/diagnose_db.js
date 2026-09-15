/**
 * Database Connection Diagnostic
 * This script shows which database the update script is connecting to
 */
const pool = require('../db');

async function diagnoseDB() {
  try {
    console.log('🔍 Diagnosing database connection...');
    
    // Get database connection info
    const dbInfo = await pool.query(`
      SELECT 
        current_database() as database_name,
        current_user as user,
        inet_server_addr() as server_ip,
        inet_server_port() as server_port
    `);
    
    console.log('\n📊 Database Connection Info:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🗄️  Database: ${dbInfo.rows[0].database_name}`);
    console.log(`👤 User: ${dbInfo.rows[0].user}`);
    console.log(`🌐 Server IP: ${dbInfo.rows[0].server_ip}`);
    console.log(`🔌 Port: ${dbInfo.rows[0].server_port}`);
    
    // Check current CMS content
    const cmsCheck = await pool.query(`
      SELECT key, value FROM cms_content 
      WHERE key IN ('about_company_name', 'contact_phone')
    `);
    
    console.log('\n📝 Current CMS Content in This Database:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    cmsCheck.rows.forEach(row => {
      console.log(`🔑 ${row.key}: ${row.value}`);
    });
    
    console.log('\n🔍 Compare this with your live website content');
    console.log('📢 If they don\'t match, your script is updating a different database');
    
  } catch (err) {
    console.error('❌ Diagnostic failed:', err.message);
  } finally {
    await pool.end();
  }
}

diagnoseDB();