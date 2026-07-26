/**
 * Timezone-derived example placeholder for the `fair-form-phone` question
 * block. Mirrored by the PHP twin `QuestionnaireService::PHONE_PLACEHOLDERS`
 * in fair-form — keep both maps in sync.
 */

import { getSettings } from '@wordpress/date';

/**
 * Example phone number per site timezone, one entry per country in the
 * ticket's table.
 *
 * @type {Object<string, string>}
 */
export const PHONE_PLACEHOLDER_BY_TIMEZONE = {
	'Europe/Madrid': '+34 612 34 56 78',
	'Europe/Berlin': '+49 170 1234567',
	'Europe/Paris': '+33 6 12 34 56 78',
	'Europe/Rome': '+39 312 345 6789',
	'Europe/Amsterdam': '+31 6 12345678',
	'Europe/Brussels': '+32 470 12 34 56',
	'Europe/Zurich': '+41 79 123 45 67',
	'Europe/Warsaw': '+48 512 345 678',
	'Europe/Lisbon': '+351 912 345 678',
	'Europe/London': '+44 7700 900123',
	'America/New_York': '+1 201 555 0123',
	'America/Chicago': '+1 201 555 0123',
	'America/Denver': '+1 201 555 0123',
	'America/Los_Angeles': '+1 201 555 0123',
};

/**
 * Fallback example for timezones outside the mapped set, and for sites
 * configured with a raw UTC offset instead of a city.
 *
 * @type {string}
 */
export const FALLBACK_PHONE_PLACEHOLDER = '+49 170 1234567';

/**
 * Resolve the example placeholder for a given timezone string.
 *
 * @param {string|null|undefined} timezoneString A WP timezone string (e.g. "Europe/Madrid"), or a raw UTC offset / empty value.
 * @return {string} The mapped example, or the fallback.
 */
export function getPhonePlaceholderForTimezone(timezoneString) {
	return (
		PHONE_PLACEHOLDER_BY_TIMEZONE[timezoneString] ||
		FALLBACK_PHONE_PLACEHOLDER
	);
}

/**
 * Resolve the example placeholder for the current site, from
 * `@wordpress/date`'s settings (populated from `get_option( 'timezone_string' )`).
 *
 * @return {string} The mapped example, or the fallback.
 */
export function getSitePhonePlaceholder() {
	return getPhonePlaceholderForTimezone(getSettings().timezone.string);
}

/**
 * Resolve the placeholder to display for a phone question: an explicit
 * author override always wins over the timezone-derived example.
 *
 * @param {string}                 attributeValue The block's `placeholder` attribute value.
 * @param {string|null|undefined}  timezoneString  A WP timezone string, passed through to {@link getPhonePlaceholderForTimezone}.
 * @return {string} The placeholder to display.
 */
export function resolvePhonePlaceholder(attributeValue, timezoneString) {
	const trimmed = (attributeValue || '').trim();
	return trimmed || getPhonePlaceholderForTimezone(timezoneString);
}
