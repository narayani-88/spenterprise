const pool = require('../db');

async function run() {
  console.log('⚠️  WARNING: This migration script now PRESERVES existing CMS content.');
  console.log('🔒 Custom CMS changes will NOT be overwritten.');
  console.log('📦 If you need to restore from backup, run: npm run cms:restore\n');
  
  const updates = [
    ['site_name', 'Book Mera Plot'],
    ['site_domain', 'book mera plot .com'],
    ['about_company_name', 'Book Mera Plot'],
    ['company_tagline', 'Book Your Dream Plot with Confidence'],
    ['footer_copyright', '© 2026 Book Mera Plot (bookmeraplot.com). All rights reserved.'],
    ['contact_email', 'invest@bookmeraplot.com'],
    ['contact_address', '5th floor, Blue Stone Building, Near - Indriya Jwellers, Ghode Doud Road Surat Gujarat'],
    ['contact_phone', '88666 96326'],
    ['hero_headline', 'Find, Invest & Book Your Dream Plot'],
    ['hero_subheadline', 'Explore premium residential plots with Book Mera Plot. Discover thoughtfully selected properties in promising locations, with transparent pricing, clear documentation, and reliable support to help you make confident property decisions.'],
    ['hero_banner_image', 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1920&q=80'],
    ['hero_badge_text', "🌟 India's #1 Verified Plot Investment Portal"],
    ['hero_cta_primary', 'Explore Prime Plots'],
    ['hero_cta_primary_link', '/properties.html'],
    ['hero_cta_secondary', 'Portal Login'],
    ['hero_cta_secondary_link', '/login.html'],
    ['banner_search_enabled', 'true'],
    ['about_description', 'Book Mera Plot is a trusted real estate company dedicated to making property ownership simple, transparent, and accessible across India. We offer carefully selected residential plots and property opportunities in promising locations, helping individuals and families make confident real estate decisions. With a focus on clear documentation, transparent pricing, quality developments, and reliable customer support, we aim to make every property investment secure and rewarding.'],
    ['about_mission', 'Discover premium plots in promising locations with transparent pricing, clear documentation, and trusted real estate support.'],
    ['feature_1_title', 'Premium Plot Selection'],
    ['feature_1_desc', 'Explore carefully selected residential plots in promising locations that match your needs and budget.'],
    ['feature_2_title', 'Transparent Pricing'],
    ['feature_2_desc', 'Get clear property pricing and applicable charges upfront for a simple and transparent buying experience.'],
    ['feature_3_title', 'Verified Property Details'],
    ['feature_3_desc', 'Access essential plot information, project details, and available documentation before making your decision.'],
    ['feature_4_title', 'Secure Buying Assistance'],
    ['feature_4_desc', 'Get dedicated support throughout your property journey, from plot selection and booking to documentation and ownership.'],
    ['theme_primary', '#0B1F3A'],
    ['theme_secondary', '#164A7A'],
    ['theme_accent', '#D9A441'],
    ['theme_success', '#2E8B57'],
    ['theme_bg', '#F8F7F3'],
    ['theme_cards', '#FFFFFF'],
    ['theme_text', '#1F2933'],
    ['theme_muted', '#64748B'],
    ['theme_inactive', '#DC3545']
  ];

  for (const [k, v] of updates) {
    await pool.query(
      `INSERT INTO cms_content (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO NOTHING`,  // Preserve existing custom content
      [k, v]
    );
  }
  console.log('✅ CMS database successfully updated with Book Mera Plot branding & Navy/Gold/Green theme defaults!');
  process.exit(0);
}

run().catch(e => {
  console.error('Migration error:', e);
  process.exit(1);
});
