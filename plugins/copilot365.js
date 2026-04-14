// copilot365.js — Route to Microsoft Copilot 365

export default {
  id: 'copilot365',
  name: 'Copilot 365',
  icon: '📘',
  defaultCategories: ['work'],

  async route(text, segment) {
    // Try native share API first (best on mobile)
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Work note: ${segment.summary || ''}`,
          text,
        });
        return { success: true, message: 'Shared via system share sheet' };
      } catch (err) {
        if (err.name === 'AbortError') {
          return { success: false, message: 'Share cancelled' };
        }
        // Fall through to URL approach
      }
    }

    // Desktop fallback: open Copilot with the text pre-filled
    const encoded = encodeURIComponent(text);
    window.open(`https://copilot.microsoft.com/?q=${encoded}`, '_blank');
    return { success: true, message: 'Opened in Microsoft Copilot' };
  },
};
