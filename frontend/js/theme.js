/**
 * Book Mera Plot — Global Dynamic Theme & Branding Loader
 * Connects CMS theme settings (Primary Navy, Accent Gold, Green, Warm White, Text, etc.)
 * directly to CSS custom variables in real-time.
 */

(function () {
  // Enforce HTTPS on live domains so Authorization headers are never stripped by protocol redirects
  if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    window.location.replace(window.location.href.replace('http:', 'https:'));
    return;
  }

  const DEFAULT_THEME = {
    theme_primary: '#0B1F3A',
    theme_secondary: '#164A7A',
    theme_accent: '#D9A441',
    theme_success: '#2E8B57',
    theme_bg: '#F8F7F3',
    theme_cards: '#FFFFFF',
    theme_text: '#1F2933',
    theme_muted: '#64748B',
    theme_inactive: '#DC3545',
    site_name: 'Book Mera Plot',
    site_domain: 'bookmeraplot.com'
  };

  // Convert hex to rgb string for rgba() usage in CSS
  function hexToRgb(hex) {
    if (!hex || typeof hex !== 'string') return '11, 31, 58';
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const num = parseInt(hex, 16);
    if (isNaN(num)) return '11, 31, 58';
    return `${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}`;
  }

  function applyTheme(data) {
    if (!data) return;
    const root = document.documentElement;

    const primary = data.theme_primary || DEFAULT_THEME.theme_primary;
    const secondary = data.theme_secondary || DEFAULT_THEME.theme_secondary;
    const gold = data.theme_accent || DEFAULT_THEME.theme_accent;
    const green = data.theme_success || DEFAULT_THEME.theme_success;
    const bg = data.theme_bg || DEFAULT_THEME.theme_bg;
    const cards = data.theme_cards || DEFAULT_THEME.theme_cards;
    const textPrimary = data.theme_text || DEFAULT_THEME.theme_text;
    const textMuted = data.theme_muted || DEFAULT_THEME.theme_muted;
    const red = data.theme_inactive || DEFAULT_THEME.theme_inactive;

    // Set core variables
    root.style.setProperty('--navy-primary', primary);
    root.style.setProperty('--navy-secondary', secondary);
    root.style.setProperty('--gold', gold);
    root.style.setProperty('--gold-accent', gold);
    root.style.setProperty('--green', green);
    root.style.setProperty('--green-accent', green);
    root.style.setProperty('--bg-primary', bg);
    root.style.setProperty('--bg-card', cards);
    root.style.setProperty('--text-primary', textPrimary);
    root.style.setProperty('--text-secondary', textMuted);
    root.style.setProperty('--text-muted', textMuted);
    root.style.setProperty('--red', red);
    root.style.setProperty('--red-accent', red);

    // RGB helpers for translucent overlays
    root.style.setProperty('--navy-primary-rgb', hexToRgb(primary));
    root.style.setProperty('--navy-secondary-rgb', hexToRgb(secondary));
    root.style.setProperty('--gold-rgb', hexToRgb(gold));
    root.style.setProperty('--green-rgb', hexToRgb(green));

    // Dynamic brand text injection
    const siteName = data.site_name || 'Book Mera Plot';
    const siteDomain = data.site_domain || 'bookmeraplot.com';
    document.querySelectorAll('.cms-brand-name:not([data-static-brand])').forEach(el => { el.textContent = siteName; });
    document.querySelectorAll('.cms-brand-tagline:not([data-static-brand])').forEach(el => { el.textContent = siteDomain; });
    const copyright = data.footer_copyright || `© 2026 ${siteName} (${siteDomain}). All rights reserved.`;
    document.querySelectorAll('.cms-copyright, #cms-footer-copyright').forEach(el => { el.textContent = copyright; });

    // Dynamic Hero Banner Image update
    if (data.hero_banner_image) {
      const banner = document.getElementById('cms-hero-banner');
      if (banner) {
        banner.style.backgroundImage = `url('${data.hero_banner_image}')`;
      }
    }

    // Dynamic Logo update
    if (data.site_logo_url) {
      document.querySelectorAll('.brand-logo-img, .login-logo img, .sidebar-brand img').forEach(img => {
        img.src = data.site_logo_url;
      });
    }
  }

  window.applyCMSTheme = applyTheme;

  // Apply immediately from cache if available to prevent flash
  try {
    const cached = localStorage.getItem('bmp_cms_theme');
    if (cached) applyTheme(JSON.parse(cached));
  } catch (e) {}

  // Fetch live CMS content & update
  async function fetchLiveTheme() {
    try {
      const res = await fetch('/api/cms/content');
      if (!res.ok) return;
      const data = await res.json();
      applyTheme(data);
      try {
        localStorage.setItem('bmp_cms_theme', JSON.stringify(data));
      } catch (e) {}
    } catch (err) {
      console.warn('Theme loader: Using default styling', err.message);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fetchLiveTheme);
  } else {
    fetchLiveTheme();
  }
})();
