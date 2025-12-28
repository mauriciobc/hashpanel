// Daily hashtags by day of week (0 = Sunday, 6 = Saturday)
// Each entry can be a string (single hashtag) or an array (multiple hashtags)
export const HASHTAGS = [
  'silentsunday',    // Sunday
  'segundaficha',     // Monday
  'tercinema',        // Tuesday
  'quartacapa',       // Wednesday
  'musiquinta',       // Thursday
  'sextaserie',       // Friday
  'caturday'          // Saturday
];

/**
 * Normalize hashtag entry to always return an array
 * @param {string|string[]} hashtag - Single hashtag string or array of hashtags
 * @returns {string[]} Array of hashtags
 */
export function getHashtagsForDay(hashtag) {
  return Array.isArray(hashtag) ? hashtag : [hashtag];
}

/**
 * Get the first hashtag for a day (for backward compatibility)
 * @param {string|string[]} hashtag - Single hashtag string or array of hashtags
 * @returns {string} First hashtag
 */
export function getFirstHashtagForDay(hashtag) {
  const hashtags = getHashtagsForDay(hashtag);
  return hashtags[0];
}
  
  export const IGNORED_ACCOUNTS = ['TagsBR', 'TrendsBR', 'trending'];
  
  export const TOOTS_PER_PAGE = 40;
  export const TOP_TOOTS_COUNT = 5;  