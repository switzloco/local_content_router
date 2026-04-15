// local.js — Store locally on-device (never leaves the browser)

const STORE_KEY = 'lcr_local_notes';

export default {
  id: 'local',
  name: 'Keep on Device',
  icon: '🔒',
  defaultCategories: ['health', 'finance'],

  async route(text, segment) {
    const notes = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    notes.push({
      id: Date.now(),
      text,
      category: segment.category,
      summary: segment.summary,
      pii: segment.pii,
      created: new Date().toISOString(),
    });
    localStorage.setItem(STORE_KEY, JSON.stringify(notes));
    return {
      success: true,
      message: `Saved on device (${notes.length} local note${notes.length === 1 ? '' : 's'} total)`,
    };
  },

  /** Utility: retrieve all locally stored notes */
  getNotes() {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
  },

  /** Utility: clear all local notes */
  clearNotes() {
    localStorage.removeItem(STORE_KEY);
  },
};
