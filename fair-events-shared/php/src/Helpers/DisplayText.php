<?php
/**
 * Readable text from values stored with HTML entities (#2300)
 *
 * WordPress keeps post titles HTML-encoded (`La&nbsp;Mutable`,
 * `Rock &amp; Roll`, texturized `&#8220;…&#8221;`), and strings built from
 * them, such as transaction descriptions, carry the entities along. Every
 * plain-text output (email subjects and text bodies, iCalendar, JSON-LD,
 * payment-provider descriptions) normalizes them here, then applies its own
 * escaping. The browser twin is `decodeEntityText()` /
 * `getEventDisplayTitle()` in `fair-events-shared/src/event-utils.js`.
 *
 * HTML output either escapes a stored value with `esc_html()` /
 * `esc_attr()`, which leave valid entities alone and so render them once,
 * or escapes decoded text with html(). Never pass decoded text to
 * `esc_html()`: it would turn literal `&lt;` text back into markup.
 *
 * @package FairEventsShared
 */

namespace FairEventsShared\Helpers;

defined( 'WPINC' ) || die;

/**
 * Decodes stored entities exactly once, for display.
 */
class DisplayText {

	/**
	 * Decode HTML entities once: named (HTML5), numeric and quotes.
	 *
	 * `&nbsp;` becomes a non-breaking space (U+00A0). Doubly encoded text
	 * (`&amp;lt;`) decodes to the literal entity (`&lt;`), never further.
	 * HTML-like text is not stripped; escape it for the output context.
	 *
	 * @param mixed $value Stored text; null becomes ''.
	 * @return string Decoded text, not trimmed.
	 */
	public static function decode( $value ) {
		if ( null === $value || is_array( $value ) || is_object( $value ) ) {
			return '';
		}
		return html_entity_decode( (string) $value, ENT_QUOTES | ENT_HTML5, 'UTF-8' );
	}

	/**
	 * Decoded, trimmed event title, or the caller's fallback when empty.
	 *
	 * Trims ASCII whitespace and non-breaking spaces at the edges only, so
	 * a title consisting of `&nbsp;` counts as empty like in the browser.
	 *
	 * @param mixed  $title    Stored event title.
	 * @param string $fallback Text for an untitled event (already translated
	 *                         by the caller; this package has no text domain).
	 * @return string Event name for plain-text output.
	 */
	public static function event_title( $title, $fallback = '' ) {
		$decoded = preg_replace( '/^[\s\x{00A0}]+|[\s\x{00A0}]+$/u', '', self::decode( $title ) );
		if ( null === $decoded ) {
			$decoded = trim( self::decode( $title ) );
		}
		return '' === $decoded ? (string) $fallback : $decoded;
	}

	/**
	 * Escape decoded (plain) text for HTML text or attribute output.
	 *
	 * Unlike `esc_html()`, this always encodes `&`, so decoded text that
	 * shows a literal entity (`&lt;`) displays as written.
	 *
	 * @param string $text Plain text, for example from decode().
	 * @return string HTML-escaped text.
	 */
	public static function html( $text ) {
		return htmlspecialchars( (string) $text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8', true );
	}
}
