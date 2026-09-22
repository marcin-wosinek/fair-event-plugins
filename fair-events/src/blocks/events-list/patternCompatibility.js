/**
 * Pure helpers for classifying Events List display patterns in the editor.
 *
 * Mirrors FairEvents\Helpers\PatternResolver on the PHP side so the editor's
 * pattern picker and compatibility guidance agree with what render.php will
 * actually do with the same pattern content.
 */

/**
 * Bundled Fair Events patterns whose name matches this are built for
 * calendar/week per-day cells, not the Events List block (they show a title
 * only, with no room for the events-list layout options). Mirrors the
 * substring filter events-calendar's own pattern picker already applies.
 */
const CALENDAR_OR_WEEK_ONLY_PATTERN = /calendar-event|schedule-event/;

/**
 * Whether a bundled pattern name is a suitable Events List layout.
 *
 * @param {string} patternName Registered pattern name.
 * @return {boolean} False for calendar/week-only patterns.
 */
export function isEventsListPattern( patternName ) {
	return ! CALENDAR_OR_WEEK_ONLY_PATTERN.test( patternName || '' );
}

export const PATTERN_TYPE_QUERY_LOOP = 'query-loop';
export const PATTERN_TYPE_PER_EVENT = 'per-event';
export const PATTERN_TYPE_UNAVAILABLE = 'unavailable';

/**
 * Classify pattern content as a Query Loop layout (post-backed events only)
 * or a per-event layout (every occurrence source).
 *
 * @param {string} content Pattern block markup.
 * @return {string} One of the PATTERN_TYPE_* constants.
 */
export function classifyPatternContent( content ) {
	if ( ! content ) {
		return PATTERN_TYPE_UNAVAILABLE;
	}

	if (
		content.includes( '<!-- wp:query' ) ||
		content.includes( '<!-- wp:post-template' )
	) {
		return PATTERN_TYPE_QUERY_LOOP;
	}

	return PATTERN_TYPE_PER_EVENT;
}
