/**
 * CMS Backup & Restore Script
 * 
 * Usage:
 *   node scripts/backup_cms.js backup    - Creates a backup of current CMS content
 *   node scripts/backup_cms.js restore   - Restores CMS content from backup
 *   node scripts/backup_cms.js status    - Shows backup status
 */
const pool = require('../db');
const fs = require('fs');
const path = require('path');

const BACKUP_DIR = path.join(__dirname, '../../cms-backups');
const BACKUP_FILE = path.join(BACKUP_DIR, 'cms-content-backup.json');

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

async function backupCMS() {
  const client = await pool.connect();
  try {
    console.log('📦 Creating CMS content backup...');
    
    const result = await client.query('SELECT key, value, updated_at FROM cms_content ORDER BY key');
    const cmsData = {};
    result.rows.forEach(row => {
      cmsData[row.key] = {
        value: row.value,
        updated_at: row.updated_at
      };
    });
    
    const backup = {
      timestamp: new Date().toISOString(),
      version: '1.0',
      data: cmsData
    };
    
    fs.writeFileSync(BACKUP_FILE, JSON.stringify(backup, null, 2));
    
    console.log(`✅ CMS backup created successfully!`);
    console.log(`📁 Location: ${BACKUP_FILE}`);
    console.log(`📊 Total keys backed up: ${Object.keys(cmsData).length}`);
    console.log(`⏰ Backup time: ${backup.timestamp}`);
  } catch (err) {
    console.error('❌ Backup failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

async function restoreCMS() {
  const client = await pool.connect();
  try {
    if (!fs.existsSync(BACKUP_FILE)) {
      console.error('❌ No backup file found at:', BACKUP_FILE);
      console.log('💡 Run "node scripts/backup_cms.js backup" first to create a backup');
      process.exit(1);
    }
    
    console.log('🔄 Restoring CMS content from backup...');
    
    const backupContent = fs.readFileSync(BACKUP_FILE, 'utf8');
    const backup = JSON.parse(backupContent);
    
    console.log(`📅 Backup from: ${backup.timestamp}`);
    console.log(`📊 Keys to restore: ${Object.keys(backup.data).length}`);
    
    await client.query('BEGIN');
    
    for (const [key, item] of Object.entries(backup.data)) {
      await client.query(
        `INSERT INTO cms_content (key, value, updated_at) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3`,
        [key, item.value, item.updated_at || new Date()]
      );
    }
    
    await client.query('COMMIT');
    
    console.log('✅ CMS content restored successfully!');
    console.log('🎉 Your custom content has been restored from backup');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Restore failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

async function showStatus() {
  try {
    console.log('📊 CMS Backup Status\n');
    
    if (fs.existsSync(BACKUP_FILE)) {
      const backupContent = fs.readFileSync(BACKUP_FILE, 'utf8');
      const backup = JSON.parse(backupContent);
      const stats = fs.statSync(BACKUP_FILE);
      
      console.log('✅ Backup exists:');
      console.log(`📁 Location: ${BACKUP_FILE}`);
      console.log(`📅 Created: ${backup.timestamp}`);
      console.log(`📊 Keys: ${Object.keys(backup.data).length}`);
      console.log(`💾 Size: ${(stats.size / 1024).toFixed(2)} KB`);
      console.log(`🕐 Last modified: ${stats.mtime.toISOString()}`);
    } else {
      console.log('❌ No backup found');
      console.log('💡 Run "node scripts/backup_cms.js backup" to create one');
    }
    
    console.log('\n📊 Current CMS Database:');
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT COUNT(*) as count FROM cms_content');
      console.log(`🔢 Total keys in database: ${result.rows[0].count}`);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('❌ Status check failed:', err.message);
  }
}

// Main execution
const command = process.argv[2];

if (command === 'backup') {
  backupCMS().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
  });
} else if (command === 'restore') {
  restoreCMS().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
  });
} else if (command === 'status') {
  showStatus().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
  });
} else {
  console.log('CMS Backup & Restore Tool');
  console.log('Usage:');
  console.log('  node scripts/backup_cms.js backup    - Create backup of current CMS content');
  console.log('  node scripts/backup_cms.js restore   - Restore CMS content from backup');
  console.log('  node scripts/backup_cms.js status    - Show backup status');
  process.exit(1);
}