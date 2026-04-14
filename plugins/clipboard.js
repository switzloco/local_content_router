// clipboard.js — Copy to clipboard route

export default {
  id: 'clipboard',
  name: 'Clipboard',
  icon: '📋',
  defaultCategories: ['other'],

  async route(text) {
    try {
      await navigator.clipboard.writeText(text);
      return { success: true, message: 'Copied to clipboard' };
    } catch {
      // Fallback for older browsers / non-HTTPS
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return { success: true, message: 'Copied to clipboard' };
    }
  },
};
