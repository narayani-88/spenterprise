const pool = require('../db');

async function run() {
  const updates = [
    ['site_name', 'Book Mera Plot'],
    ['site_domain', 'book mera plot .com'],
    ['about_company_name', 'Book Mera Plot Pvt. Ltd.'],
    ['company_tagline', 'Book Your Dream Plot with Confidence'],
    ['footer_copyright', '© 2026 Book Mera Plot (bookmeraplot.com). All rights reserved.'],
    ['contact_email', 'invest@bookmeraplot.com'],
    ['contact_address', 'Book Mera Plot Corporate Hub, Suite 402, BKC, Mumbai, Maharashtra - 400051'],
    ['hero_headline', 'Find, Invest & Book Your Dream Plot'],
    ['hero_subheadline', "Join India's premier plot networking portal. Purchase high-yield plot shares, earn daily pair matching commissions, referral bonuses, and luxury milestone rewards."],
    ['hero_banner_image', 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1920&q=80'],
    ['hero_badge_text', "🌟 India's #1 Verified Plot Investment Portal"],
    ['hero_cta_primary', 'Explore Prime Plots'],
    ['hero_cta_primary_link', '/properties.html'],
    ['hero_cta_secondary', 'Portal Login'],
    ['hero_cta_secondary_link', '/login.html'],
    ['banner_search_enabled', 'true'],
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
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
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
