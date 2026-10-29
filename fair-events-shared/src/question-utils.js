/**
 * Namespace the Fair Form blocks are registered under.
 *
 * @type {string}
 */
export const FAIR_FORM_BLOCK_NAMESPACE = 'fair-form';

/**
 * Namespace the Fair Form blocks were registered under before #1161. Fair
 * Form keeps these names registered as hidden aliases so stored content
 * still renders and converts to the canonical names when edited.
 *
 * @type {string}
 */
export const LEGACY_FAIR_FORM_BLOCK_NAMESPACE = 'fair-audience';

/**
 * Slugs (the part after the namespace) of the Fair Form blocks that also
 * exist under the legacy namespace: every block from before #1161. A block
 * type added later has no legacy name.
 *
 * @type {string[]}
 */
export const LEGACY_FAIR_FORM_BLOCK_SLUGS = [
	'fair-form',
	'fair-form-short-text',
	'fair-form-long-text',
	'fair-form-email',
	'fair-form-phone',
	'fair-form-url',
	'fair-form-date',
	'fair-form-datetime',
	'fair-form-select-one',
	'fair-form-multiselect',
	'fair-form-radio',
	'fair-form-option',
	'fair-form-file-upload',
	'fair-form-consent',
	'fair-form-conditional',
	'fair-form-mailing-signup',
];

/**
 * Canonical name of a Fair Form block, accepting either namespace.
 *
 * Returns the name unchanged when it is not a legacy Fair Form block name,
 * so callers can compare any block's name against a canonical one.
 *
 * @param {string} name Block name.
 * @return {string} Canonical block name.
 */
export function canonicalFairFormBlockName( name ) {
	const prefix = `${ LEGACY_FAIR_FORM_BLOCK_NAMESPACE }/`;
	if (
		typeof name === 'string' &&
		name.startsWith( prefix ) &&
		LEGACY_FAIR_FORM_BLOCK_SLUGS.includes( name.slice( prefix.length ) )
	) {
		return `${ FAIR_FORM_BLOCK_NAMESPACE }/${ name.slice(
			prefix.length
		) }`;
	}
	return name;
}

/**
 * Every Fair Form question block name.
 *
 * Shared source of truth for the two parent blocks whose allow-lists are
 * supposed to contain the full set (`fair-form` and `fair-form-conditional`).
 * The Event Signup block keeps its own hardcoded, deliberately smaller
 * subset — see FAIR_FORM_QUESTION_BLOCKS.md.
 *
 * @type {string[]}
 */
export const FAIR_FORM_QUESTION_BLOCK_NAMES = [
	'fair-form/fair-form-short-text',
	'fair-form/fair-form-long-text',
	'fair-form/fair-form-email',
	'fair-form/fair-form-phone',
	'fair-form/fair-form-url',
	'fair-form/fair-form-date',
	'fair-form/fair-form-datetime',
	'fair-form/fair-form-select-one',
	'fair-form/fair-form-multiselect',
	'fair-form/fair-form-radio',
	'fair-form/fair-form-file-upload',
	'fair-form/fair-form-consent',
	'fair-form/fair-form-conditional',
	'fair-form/fair-form-mailing-signup',
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
export function generateQuestionKey( text ) {
	if ( ! text ) {
		return '';
	}

	return text
		.toLowerCase()
		.replace( /[^a-z0-9\s]/g, '' )
		.trim()
		.replace( /\s+/g, '_' )
		.substring( 0, 100 );
}
