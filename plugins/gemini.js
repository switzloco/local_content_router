// gemini.js — Route to Google Gemini

export default {
  id: 'gemini',
  name: 'Google Gemini',
  icon: '✨',
  defaultCategories: ['personal'],

  async route(text, segment) {
    // Try native share first (mobile)
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Note: ${segment.summary || ''}`,
          text,
        });
        return { success: true, message: 'Shared via system share sheet' };
      } catch (err) {
        if (err.name === 'AbortError') {
          return { success: false, message: 'Share cancelled' };
        }
      }
    }

    // Desktop: open Gemini
    window.open('https://gemini.google.com/app', '_blank');
    // Also copy to clipboard so user can paste
    try { await navigator.clipboard.writeText(text); } catch { /* ok */ }
    return { success: true, message: 'Opened Gemini — text copied to clipboard for pasting' };
  },
};
