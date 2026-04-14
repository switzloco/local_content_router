// keep.js — Route to Google Keep

export default {
  id: 'keep',
  name: 'Google Keep',
  icon: '📝',
  defaultCategories: ['education'],

  async route(text, segment) {
    // Try native share first (mobile — Keep is a share target)
    if (navigator.share) {
      try {
        await navigator.share({
          title: segment.summary || 'Note from Local Router',
          text,
        });
        return { success: true, message: 'Shared via system share sheet' };
      } catch (err) {
        if (err.name === 'AbortError') {
          return { success: false, message: 'Share cancelled' };
        }
      }
    }

    // Desktop: open Keep and copy text
    window.open('https://keep.google.com/', '_blank');
    try { await navigator.clipboard.writeText(text); } catch { /* ok */ }
    return { success: true, message: 'Opened Keep — text copied to clipboard for pasting' };
  },
};
