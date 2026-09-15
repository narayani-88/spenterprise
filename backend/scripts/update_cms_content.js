/**
 * Update Existing CMS Content Script
 * 
 * This script updates the existing CMS content in the database with the new values.
 * Run: node scripts/update_cms_content.js
 */
const pool = require('../db');

async function updateCMSContent() {
  const client = await pool.connect();
  try {
    console.log('🔄 Updating existing CMS content...');
    
    await client.query('BEGIN');
    
    const updates = [
      ['hero_subheadline', 'Explore premium residential plots with Book Mera Plot. Discover thoughtfully selected properties in promising locations, with transparent pricing, clear documentation, and reliable support to help you make confident property decisions.'],
      ['about_company_name', 'Book Mera Plot'],
      ['about_description', 'Book Mera Plot is a trusted real estate company dedicated to making property ownership simple, transparent, and accessible across India. We offer carefully selected residential plots and property opportunities in promising locations, helping individuals and families make confident real estate decisions. With a focus on clear documentation, transparent pricing, quality developments, and reliable customer support, we aim to make every property investment secure and rewarding.'],
      ['about_mission', 'Discover premium plots in promising locations with transparent pricing, clear documentation, and trusted real estate support.'],
      ['contact_phone', '88666 96326'],
      ['contact_address', '5th floor, Blue Stone Building, Near - Indriya Jwellers, Ghode Doud Road Surat Gujarat'],
      ['feature_1_title', 'Premium Plot Selection'],
      ['feature_1_desc', 'Explore carefully selected residential plots in promising locations that match your needs and budget.'],
      ['feature_2_title', 'Transparent Pricing'],
      ['feature_2_desc', 'Get clear property pricing and applicable charges upfront for a simple and transparent buying experience.'],
      ['feature_3_title', 'Verified Property Details'],
      ['feature_3_desc', 'Access essential plot information, project details, and available documentation before making your decision.'],
      ['feature_4_title', 'Secure Buying Assistance'],
      ['feature_4_desc', 'Get dedicated support throughout your property journey, from plot selection and booking to documentation and ownership.']
    ];

    for (const [key, value] of updates) {
      await client.query(
        `UPDATE cms_content SET value = $1, updated_at = NOW() WHERE key = $2`,
        [value, key]
      );
      console.log(`✅ Updated: ${key}`);
    }

    await client.query('COMMIT');
    
    console.log('\n🎉 CMS content updated successfully!');
    console.log('📢 Refresh your website to see the changes');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Update failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

updateCMSContent().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});