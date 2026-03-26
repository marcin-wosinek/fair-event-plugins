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
