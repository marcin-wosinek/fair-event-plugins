/**
 * Question-text helpers shared by the question editors (#2077, #2235).
 *
 * Kept free of editor and component imports so any question editor can use
 * it without pulling in choice- or category-specific code.
 *
 * @package FairForm
 */

import { generateQuestionKey } from 'fair-events-shared/src/question-utils.js';

/**
 * Attribute updates for a new question text. The key follows the text while
 * it is empty or still the one generated from the previous text; a key the
 * author customized is kept.
 *
 * @param {Object} attributes Current question attributes.
 * @param {string} value      New question text.
 * @return {Object} Attributes to set.
 */
export function questionTextUpdates( attributes, value ) {
	const { questionText, questionKey } = attributes;
	const updates = { questionText: value };
	if (
		! questionKey ||
		questionKey === generateQuestionKey( questionText )
	) {
		updates.questionKey = generateQuestionKey( value );
	}
	return updates;
}
