/**
 * Every `fair-audience/fair-form-*` question block name.
 *
 * Shared source of truth for the two parent blocks whose allow-lists are
 * supposed to contain the full set (`fair-form` and `fair-form-conditional`).
 * The `event-signup` parents keep their own hardcoded, deliberately smaller
 * subsets — see FAIR_FORM_QUESTION_BLOCKS.md.
 *
 * @type {string[]}
 */
export const FAIR_FORM_QUESTION_BLOCK_NAMES = [
	'fair-audience/fair-form-short-text',
	'fair-audience/fair-form-long-text',
	'fair-audience/fair-form-email',
	'fair-audience/fair-form-phone',
	'fair-audience/fair-form-url',
	'fair-audience/fair-form-date',
	'fair-audience/fair-form-datetime',
	'fair-audience/fair-form-select-one',
	'fair-audience/fair-form-multiselect',
	'fair-audience/fair-form-radio',
	'fair-audience/fair-form-file-upload',
	'fair-audience/fair-form-consent',
	'fair-audience/fair-form-conditional',
	'fair-audience/fair-form-mailing-signup',
];

/**
 * Generate a question key from question text.
 *
 * Converts text to a lowercase snake_case key suitable for use as a
 * unique identifier. E.g. "What is your name?" → "what_is_your_name"
 *
 * @param {string} text Question text.
 * @return {string} Generated key.
 */
export function generateQuestionKey(text) {
	if (!text) {
		return '';
	}

	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, '')
		.trim()
		.replace(/\s+/g, '_')
		.substring(0, 100);
}
