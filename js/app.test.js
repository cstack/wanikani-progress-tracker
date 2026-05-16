const {
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
  formatElapsedTime
} = require('./app');

describe('WaniKani Progress Tracker Core Logic', () => {
  describe('Constants', () => {
    test('STORAGE_KEYS should have required keys', () => {
      expect(STORAGE_KEYS).toHaveProperty('TOKEN');
      expect(STORAGE_KEYS).toHaveProperty('ASSIGNMENTS');
      expect(STORAGE_KEYS).toHaveProperty('SUBJECTS');
      expect(STORAGE_KEYS).toHaveProperty('LAST_UPDATED');
      expect(STORAGE_KEYS).toHaveProperty('COMPLETION_PERCENTAGE');
    });

    test('MAX_SRS_STAGE should be 9 (burned)', () => {
      expect(MAX_SRS_STAGE).toBe(9);
    });

    test('SRS_STAGES should have all stages 0-9', () => {
      for (let i = 0; i <= 9; i++) {
        expect(SRS_STAGES[i]).toBeDefined();
        expect(SRS_STAGES[i]).toHaveProperty('name');
        expect(SRS_STAGES[i]).toHaveProperty('class');
      }
    });

    test('SRS_LEVEL_NAMES should have all level names', () => {
      expect(SRS_LEVEL_NAMES).toEqual({
        apprentice: 'Apprentice',
        guru: 'Guru',
        master: 'Master',
        enlightened: 'Enlightened',
        burned: 'Burned'
      });
    });
  });

  describe('createStorage', () => {
    let mockStorage;

    beforeEach(() => {
      mockStorage = {
        data: {},
        setItem(key, value) {
          this.data[key] = value;
        },
        getItem(key) {
          return this.data[key] || null;
        },
        removeItem(key) {
          delete this.data[key];
        }
      };
    });

    test('should save and load data correctly', () => {
      const storage = createStorage(mockStorage);
      const testData = { foo: 'bar', num: 123 };

      storage.save('test_key', testData);
      const loaded = storage.load('test_key');

      expect(loaded).toEqual(testData);
    });

    test('should return null for non-existent key', () => {
      const storage = createStorage(mockStorage);
      const result = storage.load('nonexistent');

      expect(result).toBeNull();
    });

    test('should clear all storage keys', () => {
      const storage = createStorage(mockStorage);

      storage.save(STORAGE_KEYS.TOKEN, 'test-token');
      storage.save(STORAGE_KEYS.ASSIGNMENTS, []);
      storage.save(STORAGE_KEYS.SUBJECTS, {});
      storage.save(STORAGE_KEYS.LAST_UPDATED, 'date');

      storage.clear();

      expect(storage.load(STORAGE_KEYS.TOKEN)).toBeNull();
      expect(storage.load(STORAGE_KEYS.ASSIGNMENTS)).toBeNull();
      expect(storage.load(STORAGE_KEYS.SUBJECTS)).toBeNull();
      expect(storage.load(STORAGE_KEYS.LAST_UPDATED)).toBeNull();
    });

    test('should handle invalid JSON gracefully', () => {
      mockStorage.data['bad_key'] = 'not valid json {';
      const storage = createStorage(mockStorage);

      const result = storage.load('bad_key');
      expect(result).toBeNull();
    });

    test('should handle quota exceeded error for subjects', () => {
      let callCount = 0;
      const quotaStorage = {
        data: {},
        setItem(key, value) {
          callCount++;
          if (callCount === 1 && key === STORAGE_KEYS.SUBJECTS) {
            const error = new Error('QuotaExceededError');
            error.name = 'QuotaExceededError';
            throw error;
          }
          this.data[key] = value;
        },
        getItem(key) {
          return this.data[key] || null;
        },
        removeItem(key) {
          delete this.data[key];
        }
      };

      const storage = createStorage(quotaStorage);
      storage.save(STORAGE_KEYS.SUBJECTS, { test: 'data' });

      expect(quotaStorage.data[STORAGE_KEYS.SUBJECTS]).toBe('{"test":"data"}');
    });
  });

  describe('minifySubject', () => {
    test('should extract minimal data from kanji subject', () => {
      const fullSubject = {
        id: 123,
        object: 'kanji',
        data: {
          characters: '日',
          slug: '日',
          meanings: [{ meaning: 'sun', primary: true }],
          readings: [{ reading: 'にち' }],
          component_subject_ids: [1, 2, 3]
        }
      };

      const result = minifySubject(fullSubject);

      expect(result).toEqual({
        id: 123,
        object: 'kanji',
        characters: '日',
        slug: '日',
        meaning: 'sun'
      });
    });

    test('should use slug for radicals without characters', () => {
      const radical = {
        id: 456,
        object: 'radical',
        data: {
          characters: null,
          slug: 'ground',
          meanings: [{ meaning: 'Ground', primary: true }]
        }
      };

      const result = minifySubject(radical);

      expect(result).toEqual({
        id: 456,
        object: 'radical',
        characters: null,
        slug: 'ground',
        meaning: 'Ground'
      });
    });

    test('should handle missing data gracefully', () => {
      const incomplete = {
        id: 789,
        object: 'vocabulary',
        data: {}
      };

      const result = minifySubject(incomplete);

      expect(result).toEqual({
        id: 789,
        object: 'vocabulary',
        characters: null,
        slug: undefined,
        meaning: ''
      });
    });
  });

  describe('compareAssignments', () => {
    test('should detect leveled up items', () => {
      const oldAssignments = [
        { data: { subject_id: 1, srs_stage: 4 } },
        { data: { subject_id: 2, srs_stage: 5 } },
        { data: { subject_id: 3, srs_stage: 7 } }
      ];

      const newAssignments = [
        { data: { subject_id: 1, srs_stage: 5 } }, // leveled up 4 -> 5
        { data: { subject_id: 2, srs_stage: 5 } }, // no change
        { data: { subject_id: 3, srs_stage: 9 } }  // leveled up 7 -> 9
      ];

      const result = compareAssignments(oldAssignments, newAssignments);

      expect(result.leveledUp).toHaveLength(2);
      expect(result.leveledUp).toContainEqual({
        subjectId: 1,
        oldStage: 4,
        newStage: 5
      });
      expect(result.leveledUp).toContainEqual({
        subjectId: 3,
        oldStage: 7,
        newStage: 9
      });
      expect(result.leveledDown).toHaveLength(0);
    });

    test('should detect items that went down in stage', () => {
      const oldAssignments = [
        { data: { subject_id: 1, srs_stage: 5 } },
        { data: { subject_id: 2, srs_stage: 7 } }
      ];

      const newAssignments = [
        { data: { subject_id: 1, srs_stage: 4 } }, // went down 5 -> 4
        { data: { subject_id: 2, srs_stage: 5 } }  // went down 7 -> 5
      ];

      const result = compareAssignments(oldAssignments, newAssignments);

      expect(result.leveledUp).toHaveLength(0);
      expect(result.leveledDown).toHaveLength(2);
      expect(result.leveledDown).toContainEqual({
        subjectId: 1,
        oldStage: 5,
        newStage: 4
      });
      expect(result.leveledDown).toContainEqual({
        subjectId: 2,
        oldStage: 7,
        newStage: 5
      });
    });

    test('should separate leveled up and leveled down items', () => {
      const oldAssignments = [
        { data: { subject_id: 1, srs_stage: 4 } },
        { data: { subject_id: 2, srs_stage: 6 } },
        { data: { subject_id: 3, srs_stage: 5 } }
      ];

      const newAssignments = [
        { data: { subject_id: 1, srs_stage: 5 } }, // leveled up 4 -> 5
        { data: { subject_id: 2, srs_stage: 4 } }, // went down 6 -> 4
        { data: { subject_id: 3, srs_stage: 5 } }  // no change
      ];

      const result = compareAssignments(oldAssignments, newAssignments);

      expect(result.leveledUp).toHaveLength(1);
      expect(result.leveledUp[0].subjectId).toBe(1);
      expect(result.leveledDown).toHaveLength(1);
      expect(result.leveledDown[0].subjectId).toBe(2);
    });

    test('should not include new items', () => {
      const oldAssignments = [];

      const newAssignments = [
        { data: { subject_id: 1, srs_stage: 1 } } // new item
      ];

      const result = compareAssignments(oldAssignments, newAssignments);

      expect(result.leveledUp).toHaveLength(0);
      expect(result.leveledDown).toHaveLength(0);
    });

    test('should handle empty arrays', () => {
      const result = compareAssignments([], []);
      expect(result.leveledUp).toHaveLength(0);
      expect(result.leveledDown).toHaveLength(0);
    });
  });

  describe('groupByStage', () => {
    test('should group items by SRS stage class', () => {
      const leveledUp = [
        { subjectId: 1, oldStage: 4, newStage: 5 },  // guru
        { subjectId: 2, oldStage: 5, newStage: 6 },  // guru
        { subjectId: 3, oldStage: 6, newStage: 7 },  // master
        { subjectId: 4, oldStage: 8, newStage: 9 }   // burned
      ];

      const result = groupByStage(leveledUp);

      expect(result.guru).toHaveLength(2);
      expect(result.master).toHaveLength(1);
      expect(result.burned).toHaveLength(1);
      expect(result.apprentice).toBeUndefined();
    });

    test('should handle empty array', () => {
      const result = groupByStage([]);
      expect(result).toEqual({});
    });

    test('should default to apprentice for unknown stages', () => {
      const leveledUp = [
        { subjectId: 1, oldStage: 0, newStage: 99 } // unknown stage
      ];

      const result = groupByStage(leveledUp);

      expect(result.apprentice).toHaveLength(1);
    });
  });

  describe('getSubjectDisplayData', () => {
    test('should handle minified format', () => {
      const minified = {
        id: 123,
        object: 'kanji',
        characters: '日',
        slug: '日',
        meaning: 'sun'
      };

      const result = getSubjectDisplayData(minified);

      expect(result).toEqual({
        character: '日',
        slug: '日',
        meaning: 'sun',
        type: 'kanji'
      });
    });

    test('should handle legacy full format', () => {
      const legacy = {
        id: 123,
        object: 'kanji',
        data: {
          characters: '日',
          slug: '日',
          meanings: [{ meaning: 'sun' }]
        }
      };

      const result = getSubjectDisplayData(legacy);

      expect(result).toEqual({
        character: '日',
        slug: '日',
        meaning: 'sun',
        type: 'kanji'
      });
    });

    test('should return null for null subject', () => {
      expect(getSubjectDisplayData(null)).toBeNull();
      expect(getSubjectDisplayData(undefined)).toBeNull();
    });

    test('should use slug fallback for radicals', () => {
      const radical = {
        id: 456,
        object: 'radical',
        slug: 'ground',
        data: {
          slug: 'ground',
          meanings: [{ meaning: 'Ground' }]
        }
      };

      const result = getSubjectDisplayData(radical);

      expect(result.character).toBe('ground');
      expect(result.slug).toBe('ground');
    });
  });

  describe('getWaniKaniUrl', () => {
    test('should generate URL for kanji', () => {
      const displayData = {
        character: '日',
        slug: '日',
        meaning: 'sun',
        type: 'kanji'
      };

      const result = getWaniKaniUrl(displayData);

      expect(result).toBe('https://www.wanikani.com/kanji/%E6%97%A5');
    });

    test('should generate URL for vocabulary', () => {
      const displayData = {
        character: '誠',
        slug: '誠',
        meaning: 'sincerity',
        type: 'vocabulary'
      };

      const result = getWaniKaniUrl(displayData);

      expect(result).toBe('https://www.wanikani.com/vocabulary/%E8%AA%A0');
    });

    test('should generate URL for radical using slug', () => {
      const displayData = {
        character: 'barb',
        slug: 'barb',
        meaning: 'Barb',
        type: 'radical'
      };

      const result = getWaniKaniUrl(displayData);

      expect(result).toBe('https://www.wanikani.com/radicals/barb');
    });

    test('should return null for null displayData', () => {
      expect(getWaniKaniUrl(null)).toBeNull();
      expect(getWaniKaniUrl(undefined)).toBeNull();
    });

    test('should return null for missing type', () => {
      const displayData = {
        character: '日',
        meaning: 'sun'
      };

      expect(getWaniKaniUrl(displayData)).toBeNull();
    });

    test('should handle URL encoding for special characters', () => {
      const displayData = {
        character: '日本語',
        slug: '日本語',
        meaning: 'Japanese language',
        type: 'vocabulary'
      };

      const result = getWaniKaniUrl(displayData);

      expect(result).toBe('https://www.wanikani.com/vocabulary/%E6%97%A5%E6%9C%AC%E8%AA%9E');
    });
  });
  describe('getVocabCharFontSize', () => {
    test('should return 1.2rem for 1-3 characters', () => {
      expect(getVocabCharFontSize('ス')).toBe('1.2rem');
      expect(getVocabCharFontSize('スキ')).toBe('1.2rem');
      expect(getVocabCharFontSize('スキマ')).toBe('1.2rem');
    });

    test('should return 0.9rem for 4 characters', () => {
      expect(getVocabCharFontSize('ホッチキ')).toBe('0.9rem');
    });

    test('should return 0.75rem for 5 characters', () => {
      expect(getVocabCharFontSize('ホッチキス')).toBe('0.75rem');
    });

    test('should return 0.65rem for 6+ characters', () => {
      expect(getVocabCharFontSize('ホッチキスス')).toBe('0.65rem');
      expect(getVocabCharFontSize('ホッチキスススス')).toBe('0.65rem');
    });
  });

  describe('calculateSrsCounts', () => {
    test('should count items by SRS stage and item type', () => {
      const assignments = [
        { data: { subject_id: 1, srs_stage: 1 } },  // apprentice
        { data: { subject_id: 2, srs_stage: 2 } },  // apprentice
        { data: { subject_id: 3, srs_stage: 5 } },  // guru
        { data: { subject_id: 4, srs_stage: 7 } },  // master
        { data: { subject_id: 5, srs_stage: 9 } }   // burned
      ];

      const subjects = {
        1: { id: 1, object: 'radical', characters: 'a', meaning: 'A' },
        2: { id: 2, object: 'kanji', characters: '日', meaning: 'sun' },
        3: { id: 3, object: 'kanji', characters: '月', meaning: 'moon' },
        4: { id: 4, object: 'vocabulary', characters: '日本', meaning: 'japan' },
        5: { id: 5, object: 'kanji', characters: '本', meaning: 'book' }
      };

      const result = calculateSrsCounts(assignments, subjects);

      expect(result.apprentice.radical).toBe(1);
      expect(result.apprentice.kanji).toBe(1);
      expect(result.apprentice.total).toBe(2);
      expect(result.guru.kanji).toBe(1);
      expect(result.guru.total).toBe(1);
      expect(result.master.vocabulary).toBe(1);
      expect(result.master.total).toBe(1);
      expect(result.burned.kanji).toBe(1);
      expect(result.burned.total).toBe(1);
    });

    test('should handle empty assignments', () => {
      const result = calculateSrsCounts([], {});

      expect(result.apprentice.total).toBe(0);
      expect(result.guru.total).toBe(0);
      expect(result.master.total).toBe(0);
      expect(result.enlightened.total).toBe(0);
      expect(result.burned.total).toBe(0);
    });

    test('should handle assignments without matching subjects', () => {
      const assignments = [
        { data: { subject_id: 1, srs_stage: 5, subject_type: 'kanji' } }
      ];

      const result = calculateSrsCounts(assignments, {});

      // Should use subject_type fallback when subject not found
      expect(result.guru.kanji).toBe(1);
      expect(result.guru.total).toBe(1);
    });
  });

  describe('calculateLevelUpDeltas', () => {
    test('should calculate deltas per stage and item type', () => {
      const leveledUp = [
        { subjectId: 1, oldStage: 4, newStage: 5 },  // to guru
        { subjectId: 2, oldStage: 4, newStage: 5 },  // to guru
        { subjectId: 3, oldStage: 6, newStage: 7 },  // to master
        { subjectId: 4, oldStage: 8, newStage: 9 }   // to burned
      ];

      const subjects = {
        1: { id: 1, object: 'radical', characters: 'a', meaning: 'A' },
        2: { id: 2, object: 'kanji', characters: '日', meaning: 'sun' },
        3: { id: 3, object: 'vocabulary', characters: '日本', meaning: 'japan' },
        4: { id: 4, object: 'kanji', characters: '本', meaning: 'book' }
      };

      const result = calculateLevelUpDeltas(leveledUp, subjects);

      expect(result.guru.radical).toBe(1);
      expect(result.guru.kanji).toBe(1);
      expect(result.guru.total).toBe(2);
      expect(result.master.vocabulary).toBe(1);
      expect(result.master.total).toBe(1);
      expect(result.burned.kanji).toBe(1);
      expect(result.burned.total).toBe(1);
      expect(result.apprentice.total).toBe(0);
      expect(result.enlightened.total).toBe(0);
    });

    test('should handle empty leveledUp array', () => {
      const result = calculateLevelUpDeltas([], {});

      expect(result.apprentice.total).toBe(0);
      expect(result.guru.total).toBe(0);
      expect(result.master.total).toBe(0);
      expect(result.enlightened.total).toBe(0);
      expect(result.burned.total).toBe(0);
    });

    test('should handle missing subjects gracefully', () => {
      const leveledUp = [
        { subjectId: 1, oldStage: 4, newStage: 5 },
        { subjectId: 2, oldStage: 4, newStage: 5 }
      ];

      const subjects = {
        1: { id: 1, object: 'kanji', characters: '日', meaning: 'sun' }
        // subject 2 is missing
      };

      const result = calculateLevelUpDeltas(leveledUp, subjects);

      // Only count the one with a subject
      expect(result.guru.kanji).toBe(1);
      expect(result.guru.total).toBe(1);
    });
  });

  describe('calculateCompletionPercentage', () => {
    // Total WaniKani items = 9138, max stage = 9
    // Max parts = 9138 × 9 = 82242

    test('should calculate percentage based on total WaniKani items', () => {
      // All 9138 items at stage 9 (burned) = 82242 parts
      // 82242/82242 = 100%
      const assignments = Array.from({ length: 9138 }, (_, i) => ({
        data: { subject_id: i, srs_stage: 9 }
      }));

      const result = calculateCompletionPercentage(assignments);
      expect(result).toBe(100);
    });

    test('should return 0 for empty assignments', () => {
      expect(calculateCompletionPercentage([])).toBe(0);
      expect(calculateCompletionPercentage(null)).toBe(0);
      expect(calculateCompletionPercentage(undefined)).toBe(0);
    });

    test('should return 0 when all items are at stage 0', () => {
      const assignments = [
        { data: { subject_id: 1, srs_stage: 0 } },
        { data: { subject_id: 2, srs_stage: 0 } }
      ];

      const result = calculateCompletionPercentage(assignments);
      expect(result).toBe(0);
    });

    test('should calculate partial completion against total items', () => {
      // User at ~level 47 with most items burned (realistic scenario)
      // ~7000 items started, average stage ~8.5
      // 7000 × 8.5 = 59500 parts / 82242 max ≈ 72.35%
      const assignments = Array.from({ length: 7000 }, (_, i) => ({
        data: { subject_id: i, srs_stage: i % 2 === 0 ? 9 : 8 }  // alternating 8 and 9
      }));

      const result = calculateCompletionPercentage(assignments);
      // 7000 items × 8.5 avg = 59500 / 82242 = 72.35%
      expect(result).toBeCloseTo(72.35, 1);
    });

    test('should round to 2 decimal places', () => {
      // 1000 items at stage 5 = 5000 parts
      // 5000 / 82242 = 6.0799...%
      const assignments = Array.from({ length: 1000 }, (_, i) => ({
        data: { subject_id: i, srs_stage: 5 }
      }));

      const result = calculateCompletionPercentage(assignments);
      expect(result).toBe(6.08);
    });

    test('should handle items with missing srs_stage', () => {
      // 1000 items at stage 9, 1000 missing = 9000 parts
      // 9000 / 82242 ≈ 10.94%
      const assignments = [
        ...Array.from({ length: 1000 }, (_, i) => ({
          data: { subject_id: i, srs_stage: 9 }
        })),
        ...Array.from({ length: 1000 }, (_, i) => ({
          data: { subject_id: i + 1000 }  // missing srs_stage, treated as 0
        }))
      ];

      const result = calculateCompletionPercentage(assignments);
      expect(result).toBeCloseTo(10.94, 1);
    });

    test('should show meaningful change with ~10 level-ups', () => {
      // Simulate a realistic scenario with ~8500 items started
      // Create 8500 items at stage 4 (mid-way)
      const baseAssignments = Array.from({ length: 8500 }, (_, i) => ({
        data: { subject_id: i, srs_stage: 4 }
      }));

      const basePct = calculateCompletionPercentage(baseAssignments);

      // Level up 10 items from stage 4 to stage 5
      const updatedAssignments = [...baseAssignments];
      for (let i = 0; i < 10; i++) {
        updatedAssignments[i] = { data: { subject_id: i, srs_stage: 5 } };
      }

      const newPct = calculateCompletionPercentage(updatedAssignments);
      const change = newPct - basePct;

      // With 2 decimal places, we should see a visible change
      // 10 level-ups out of 82242 max = 10/82242 ≈ 0.012%
      // Rounded to 2 decimals, this is approximately 0.01-0.02%
      expect(change).toBeGreaterThan(0);
      expect(change).toBeLessThanOrEqual(0.03); // Should be a small but visible change
    });

    test('should reflect actual WaniKani progress for level 47 user', () => {
      // A level 47 user has unlocked ~7000-7500 items
      // If most are burned (stage 9), percentage should be ~75-80%, not 95%
      const assignments = Array.from({ length: 7200 }, (_, i) => ({
        data: { subject_id: i, srs_stage: 9 }  // all burned
      }));

      const result = calculateCompletionPercentage(assignments);
      // 7200 × 9 = 64800 / 82242 ≈ 78.79%
      expect(result).toBeCloseTo(78.79, 1);
      expect(result).toBeLessThan(80); // Should NOT be 95%+
    });
  });
});

describe('Browser Integration', () => {
  const fs = require('fs');
  const path = require('path');
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  test('index.html should not redeclare variables from app.js in global scope', () => {
    // Read app.js and find top-level const declarations
    const appJs = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
    const appJsConstRegex = /^const\s+(\w+)\s*=/gm;
    const appJsConsts = new Set();
    let match;
    while ((match = appJsConstRegex.exec(appJs)) !== null) {
      appJsConsts.add(match[1]);
    }

    // Read index.html and find inline script const declarations
    // Extract inline script content (after app.js is loaded)
    const scriptMatch = indexHtml.match(/<script src="js\/app\.js"><\/script>\s*<script>([\s\S]*?)<\/script>/);
    expect(scriptMatch).toBeTruthy();

    const inlineScript = scriptMatch[1];

    // If the inline script is wrapped in an IIFE (possibly with leading comments),
    // it creates a new scope so variable declarations won't conflict with globals
    const isWrappedInIIFE = /^\s*(\/\/[^\n]*\n\s*)?\(function\s*\(\)\s*\{/.test(inlineScript);
    if (isWrappedInIIFE) {
      // IIFE creates its own scope, so no conflicts with global scope
      return;
    }

    // Find const declarations in inline script that would conflict with app.js globals
    // Look for destructuring: const { STORAGE_KEYS, ... } = ...
    const destructuringMatch = inlineScript.match(/const\s*\{([^}]+)\}/);
    if (destructuringMatch) {
      const destructuredVars = destructuringMatch[1]
        .split(',')
        .map(v => v.trim().split(/\s+/)[0]); // Handle "STORAGE_KEYS as alias" patterns

      const conflicts = destructuredVars.filter(v => appJsConsts.has(v));
      expect(conflicts).toEqual([]);
    }

    // Also check for direct const declarations
    const directConstRegex = /const\s+(\w+)\s*=/g;
    const directConflicts = [];
    while ((match = directConstRegex.exec(inlineScript)) !== null) {
      if (appJsConsts.has(match[1])) {
        directConflicts.push(match[1]);
      }
    }
    expect(directConflicts).toEqual([]);
  });

  test('index.html should include analytics tracking for key app actions', () => {
    expect(indexHtml).toContain('function trackEvent(eventName, params = {})');
    expect(indexHtml).toContain("trackEvent('token_saved');");
    expect(indexHtml).toContain("trackEvent('progress_refreshed', {");
    expect(indexHtml).toContain("trackEvent('app_reset');");
    expect(indexHtml).toContain("app_name: 'wanikani-progress-tracker'");
  });
});

describe('formatElapsedTime', () => {
  test('should format years with remaining months', () => {
    const start = new Date('2023-01-01');
    const end = new Date('2025-07-15');
    const result = formatElapsedTime(start, end);
    expect(result).toBe('2y 6mo');
  });

  test('should format years only when no remaining months', () => {
    const start = new Date('2023-01-01');
    const end = new Date('2025-01-01');
    const result = formatElapsedTime(start, end);
    expect(result).toBe('2y');
  });

  test('should format months with remaining days', () => {
    const start = new Date('2024-01-01');
    const end = new Date('2024-04-16'); // 106 days = 3mo 16d
    const result = formatElapsedTime(start, end);
    expect(result).toBe('3mo 16d');
  });

  test('should format months only when no remaining days', () => {
    const start = new Date('2024-01-01');
    const end = new Date('2024-03-31'); // 90 days = exactly 3mo
    const result = formatElapsedTime(start, end);
    expect(result).toBe('3mo');
  });

  test('should format days', () => {
    const start = new Date('2024-01-01');
    const end = new Date('2024-01-15');
    const result = formatElapsedTime(start, end);
    expect(result).toBe('14d');
  });

  test('should return today for same day', () => {
    const start = new Date('2024-01-01T10:00:00');
    const end = new Date('2024-01-01T15:00:00');
    const result = formatElapsedTime(start, end);
    expect(result).toBe('today');
  });

  test('should return empty string for negative diff', () => {
    const start = new Date('2024-01-15');
    const end = new Date('2024-01-01');
    const result = formatElapsedTime(start, end);
    expect(result).toBe('');
  });

  test('should accept ISO date strings', () => {
    const result = formatElapsedTime('2023-01-01T00:00:00.000000Z', new Date('2024-01-01'));
    expect(result).toBe('1y');
  });
});

describe('sortByStartedAt', () => {
  test('should sort items by started_at date (oldest to newest)', () => {
    const items = [
      { subjectId: 1, oldStage: 4, newStage: 5 },
      { subjectId: 2, oldStage: 4, newStage: 5 },
      { subjectId: 3, oldStage: 4, newStage: 5 }
    ];

    const assignmentMap = {
      1: { started_at: '2024-03-01T00:00:00Z' }, // newest
      2: { started_at: '2024-01-01T00:00:00Z' }, // oldest
      3: { started_at: '2024-02-01T00:00:00Z' }  // middle
    };

    const result = sortByStartedAt(items, assignmentMap);

    expect(result[0].subjectId).toBe(2); // oldest first
    expect(result[1].subjectId).toBe(3); // middle
    expect(result[2].subjectId).toBe(1); // newest last
  });

  test('should not mutate the original array', () => {
    const items = [
      { subjectId: 1, oldStage: 4, newStage: 5 },
      { subjectId: 2, oldStage: 4, newStage: 5 }
    ];

    const assignmentMap = {
      1: { started_at: '2024-02-01T00:00:00Z' },
      2: { started_at: '2024-01-01T00:00:00Z' }
    };

    const result = sortByStartedAt(items, assignmentMap);

    expect(items[0].subjectId).toBe(1); // original unchanged
    expect(result[0].subjectId).toBe(2); // sorted result
  });

  test('should put items without started_at at the end', () => {
    const items = [
      { subjectId: 1, oldStage: 4, newStage: 5 },
      { subjectId: 2, oldStage: 4, newStage: 5 },
      { subjectId: 3, oldStage: 4, newStage: 5 }
    ];

    const assignmentMap = {
      1: { started_at: '2024-02-01T00:00:00Z' },
      2: {}, // no started_at
      3: { started_at: '2024-01-01T00:00:00Z' }
    };

    const result = sortByStartedAt(items, assignmentMap);

    expect(result[0].subjectId).toBe(3); // oldest first
    expect(result[1].subjectId).toBe(1); // second oldest
    expect(result[2].subjectId).toBe(2); // no started_at at end
  });

  test('should put items without assignment at the end', () => {
    const items = [
      { subjectId: 1, oldStage: 4, newStage: 5 },
      { subjectId: 2, oldStage: 4, newStage: 5 },
      { subjectId: 3, oldStage: 4, newStage: 5 }
    ];

    const assignmentMap = {
      1: { started_at: '2024-02-01T00:00:00Z' },
      // subject 2 has no entry in assignmentMap
      3: { started_at: '2024-01-01T00:00:00Z' }
    };

    const result = sortByStartedAt(items, assignmentMap);

    expect(result[0].subjectId).toBe(3); // oldest first
    expect(result[1].subjectId).toBe(1); // second oldest
    expect(result[2].subjectId).toBe(2); // no assignment at end
  });

  test('should handle empty array', () => {
    const result = sortByStartedAt([], {});
    expect(result).toEqual([]);
  });

  test('should handle array with single item', () => {
    const items = [{ subjectId: 1, oldStage: 4, newStage: 5 }];
    const assignmentMap = { 1: { started_at: '2024-01-01T00:00:00Z' } };

    const result = sortByStartedAt(items, assignmentMap);

    expect(result).toHaveLength(1);
    expect(result[0].subjectId).toBe(1);
  });

  test('should maintain relative order when all items have no started_at', () => {
    const items = [
      { subjectId: 1, oldStage: 4, newStage: 5 },
      { subjectId: 2, oldStage: 4, newStage: 5 }
    ];

    const assignmentMap = {
      1: {},
      2: {}
    };

    const result = sortByStartedAt(items, assignmentMap);

    // When all items lack started_at, they should maintain stable order
    expect(result).toHaveLength(2);
  });
});
