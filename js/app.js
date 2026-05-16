// WaniKani Progress Tracker - Core Logic
// This file contains the core business logic that can be tested independently

// Constants
const STORAGE_KEYS = {
  TOKEN: 'wk_api_token',
  ASSIGNMENTS: 'wk_assignments',
  SUBJECTS: 'wk_subjects',
  LAST_UPDATED: 'wk_last_updated',
  COMPLETION_PERCENTAGE: 'wk_completion_percentage'
};

const SRS_STAGES = {
  0: { name: 'Lesson', class: 'apprentice' },
  1: { name: 'Apprentice 1', class: 'apprentice' },
  2: { name: 'Apprentice 2', class: 'apprentice' },
  3: { name: 'Apprentice 3', class: 'apprentice' },
  4: { name: 'Apprentice 4', class: 'apprentice' },
  5: { name: 'Guru 1', class: 'guru' },
  6: { name: 'Guru 2', class: 'guru' },
  7: { name: 'Master', class: 'master' },
  8: { name: 'Enlightened', class: 'enlightened' },
  9: { name: 'Burned', class: 'burned' }
};

const SRS_LEVEL_NAMES = {
  apprentice: 'Apprentice',
  guru: 'Guru',
  master: 'Master',
  enlightened: 'Enlightened',
  burned: 'Burned'
};

// Storage Functions
function createStorage(storageBackend = localStorage) {
  return {
    save(key, value) {
      try {
        storageBackend.setItem(key, JSON.stringify(value));
        return true;
      } catch (error) {
        if (error.name === 'QuotaExceededError' || error.code === 22) {
          console.error(`Storage quota exceeded for key: ${key}`);
          if (key === STORAGE_KEYS.SUBJECTS) {
            console.log('Clearing old subject cache and retrying...');
            storageBackend.removeItem(STORAGE_KEYS.SUBJECTS);
            try {
              storageBackend.setItem(key, JSON.stringify(value));
              return true;
            } catch (retryError) {
              console.error('Still exceeded quota after clearing cache');
            }
          }
        }
        throw error;
      }
    },

    load(key) {
      try {
        const value = storageBackend.getItem(key);
        return value ? JSON.parse(value) : null;
      } catch (error) {
        console.error(`Error loading from storage: ${key}`, error);
        return null;
      }
    },

    clear() {
      Object.values(STORAGE_KEYS).forEach(key => storageBackend.removeItem(key));
    }
  };
}

// Extract only the minimal data we need from a subject to save storage space
function minifySubject(subject) {
  return {
    id: subject.id,
    object: subject.object,
    characters: subject.data.characters || null,
    slug: subject.data.slug,
    meaning: subject.data.meanings?.[0]?.meaning || ''
  };
}

// Compare assignments to find leveled up and leveled down items
function compareAssignments(oldAssignments, newAssignments) {
  const oldMap = {};
  oldAssignments.forEach(a => {
    oldMap[a.data.subject_id] = a.data.srs_stage;
  });

  const leveledUp = [];
  const leveledDown = [];

  newAssignments.forEach(assignment => {
    const subjectId = assignment.data.subject_id;
    const newStage = assignment.data.srs_stage;
    const oldStage = oldMap[subjectId];

    if (oldStage !== undefined) {
      if (newStage > oldStage) {
        leveledUp.push({
          subjectId,
          oldStage,
          newStage
        });
      } else if (newStage < oldStage) {
        leveledDown.push({
          subjectId,
          oldStage,
          newStage
        });
      }
    }
  });

  return { leveledUp, leveledDown };
}

// Group leveled up items by SRS stage
function groupByStage(leveledUp) {
  const grouped = {};
  leveledUp.forEach(item => {
    const stageClass = SRS_STAGES[item.newStage]?.class || 'apprentice';
    if (!grouped[stageClass]) {
      grouped[stageClass] = [];
    }
    grouped[stageClass].push(item);
  });
  return grouped;
}

// Get subject display data (supports both minified and legacy formats)
function getSubjectDisplayData(subject) {
  if (!subject) {
    return null;
  }
  return {
    character: subject.characters || subject.data?.characters || subject.slug || subject.data?.slug || '?',
    slug: subject.slug || subject.data?.slug,
    meaning: subject.meaning || subject.data?.meanings?.[0]?.meaning || '',
    type: subject.object
  };
}

// Returns a font-size value that keeps multi-character vocabulary text from
// overflowing the narrow card (80px min-width, 20px padding = ~60px content).
function getVocabCharFontSize(character) {
  const len = character.length;
  if (len <= 3) {
    return '1.2rem';
  }
  if (len === 4) {
    return '0.9rem';
  }
  if (len === 5) {
    return '0.75rem';
  }
  return '0.65rem';
}

// Generate WaniKani URL for a subject based on its display data
function getWaniKaniUrl(displayData) {
  if (!displayData || !displayData.type) {
    return null;
  }

  const type = displayData.type;

  if (type === 'radical') {
    // Radicals use the slug in the URL
    return `https://www.wanikani.com/radicals/${encodeURIComponent(displayData.slug)}`;
  } else if (type === 'kanji') {
    return `https://www.wanikani.com/kanji/${encodeURIComponent(displayData.character)}`;
  } else if (type === 'vocabulary') {
    return `https://www.wanikani.com/vocabulary/${encodeURIComponent(displayData.character)}`;
  }

  return null;
}

// Calculate SRS stage counts by item type from assignments
function calculateSrsCounts(assignments, subjects) {
  const counts = {
    apprentice: { radical: 0, kanji: 0, vocabulary: 0, total: 0 },
    guru: { radical: 0, kanji: 0, vocabulary: 0, total: 0 },
    master: { radical: 0, kanji: 0, vocabulary: 0, total: 0 },
    enlightened: { radical: 0, kanji: 0, vocabulary: 0, total: 0 },
    burned: { radical: 0, kanji: 0, vocabulary: 0, total: 0 }
  };

  assignments.forEach(assignment => {
    const stage = assignment.data.srs_stage;
    const subjectId = assignment.data.subject_id;
    const subject = subjects[subjectId];

    // Get the stage class (apprentice, guru, master, enlightened, burned)
    const stageClass = SRS_STAGES[stage]?.class;
    if (!stageClass || !counts[stageClass]) {
      return;
    }

    // Get item type from subject if available, otherwise from assignment
    const itemType = subject?.object || assignment.data?.subject_type;
    if (itemType && counts[stageClass][itemType] !== undefined) {
      counts[stageClass][itemType]++;
      counts[stageClass].total++;
    }
  });

  return counts;
}

// Calculate level-up deltas per stage and item type
function calculateLevelUpDeltas(leveledUp, subjects) {
  const deltas = {
    apprentice: { radical: 0, kanji: 0, vocabulary: 0, total: 0 },
    guru: { radical: 0, kanji: 0, vocabulary: 0, total: 0 },
    master: { radical: 0, kanji: 0, vocabulary: 0, total: 0 },
    enlightened: { radical: 0, kanji: 0, vocabulary: 0, total: 0 },
    burned: { radical: 0, kanji: 0, vocabulary: 0, total: 0 }
  };

  leveledUp.forEach(item => {
    const stageClass = SRS_STAGES[item.newStage]?.class;
    if (!stageClass || !deltas[stageClass]) {
      return;
    }

    const subject = subjects[item.subjectId];
    const itemType = subject?.object;
    if (itemType && deltas[stageClass][itemType] !== undefined) {
      deltas[stageClass][itemType]++;
      deltas[stageClass].total++;
    }
  });

  return deltas;
}

// Maximum SRS stage (burned)
const MAX_SRS_STAGE = 9;

// Total number of items in WaniKani (radicals + kanji + vocabulary across all 60 levels)
// This ensures percentage reflects progress through entire WaniKani curriculum, not just started items
const TOTAL_WANIKANI_ITEMS = 9138;

// Calculate total completion percentage
// Each item level-up is one "part". Total = sum of all SRS stages / (total WaniKani items × max stage)
// Rounded to 2 decimal places so ~10 level-ups show a visible change
function calculateCompletionPercentage(assignments) {
  if (!assignments || assignments.length === 0) {
    return 0;
  }

  const maxParts = TOTAL_WANIKANI_ITEMS * MAX_SRS_STAGE;

  const currentParts = assignments.reduce((sum, assignment) => {
    return sum + (assignment.data?.srs_stage || 0);
  }, 0);

  const percentage = (currentParts / maxParts) * 100;

  // Round to 2 decimal places
  return Math.round(percentage * 100) / 100;
}

// Sort items by started_at date (oldest to newest)
function sortByStartedAt(items, assignmentMap) {
  return [...items].sort((a, b) => {
    const aStarted = assignmentMap[a.subjectId]?.started_at;
    const bStarted = assignmentMap[b.subjectId]?.started_at;

    // Items without started_at go to the end
    if (!aStarted && !bStarted) {
      return 0;
    }
    if (!aStarted) {
      return 1;
    }
    if (!bStarted) {
      return -1;
    }

    return new Date(aStarted) - new Date(bStarted);
  });
}

// Format elapsed time between two dates in a human-readable way
function formatElapsedTime(startDate, endDate = new Date()) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffMs = end - start;

  if (diffMs < 0) {
    return '';
  }

  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (years > 0) {
    const remainingMonths = Math.floor((days % 365) / 30);
    if (remainingMonths > 0) {
      return `${years}y ${remainingMonths}mo`;
    }
    return `${years}y`;
  }

  if (months > 0) {
    const remainingDays = days % 30;
    if (remainingDays > 0) {
      return `${months}mo ${remainingDays}d`;
    }
    return `${months}mo`;
  }

  if (days > 0) {
    return `${days}d`;
  }

  return 'today';
}

// API Functions
async function fetchWithAuth(url, token) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}

async function fetchAllPages(endpoint, token) {
  let allData = [];
  let nextUrl = `https://api.wanikani.com/v2/${endpoint}`;

  while (nextUrl) {
    const data = await fetchWithAuth(nextUrl, token);
    allData = allData.concat(data.data);
    nextUrl = data.pages?.next_url || null;
  }

  return allData;
}

async function fetchAssignments(token, onProgress) {
  let allAssignments = [];
  let nextUrl = 'https://api.wanikani.com/v2/assignments';
  let page = 0;

  while (nextUrl) {
    const data = await fetchWithAuth(nextUrl, token);
    allAssignments = allAssignments.concat(data.data);
    nextUrl = data.pages?.next_url || null;
    page++;

    const totalPages = Math.ceil(data.total_count / data.pages.per_page);
    if (onProgress) {
      onProgress(page, totalPages);
    }
  }

  return allAssignments;
}

async function fetchSubjects(token, subjectIds, onProgress) {
  const subjects = {};
  const chunks = [];

  for (let i = 0; i < subjectIds.length; i += 1000) {
    chunks.push(subjectIds.slice(i, i + 1000));
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const url = `https://api.wanikani.com/v2/subjects?ids=${chunk.join(',')}`;
    const data = await fetchWithAuth(url, token);

    data.data.forEach(subject => {
      subjects[subject.id] = minifySubject(subject);
    });

    if (onProgress) {
      onProgress(i + 1, chunks.length);
    }
  }

  return subjects;
}

async function validateToken(token) {
  try {
    const response = await fetch('https://api.wanikani.com/v2/user', {
      headers: { Authorization: `Bearer ${token}` }
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}

// Export for both browser (global) and Node.js/Jest (CommonJS)
const WaniKaniTracker = {
  STORAGE_KEYS,
  SRS_STAGES,
  SRS_LEVEL_NAMES,
  MAX_SRS_STAGE,
  createStorage,
  minifySubject,
  compareAssignments,
  groupByStage,
  getSubjectDisplayData,
  getVocabCharFontSize,
  getWaniKaniUrl,
  calculateSrsCounts,
  calculateLevelUpDeltas,
  calculateCompletionPercentage,
  sortByStartedAt,
  formatElapsedTime,
  fetchWithAuth,
  fetchAllPages,
  fetchAssignments,
  fetchSubjects,
  validateToken
};

// Browser global
if (typeof window !== 'undefined') {
  window.WaniKaniTracker = WaniKaniTracker;
}

// CommonJS for Node.js/Jest
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WaniKaniTracker;
}
