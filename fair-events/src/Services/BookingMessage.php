<?php
/**
 * Organizer's custom post-booking message
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Models\EventDates;

defined( 'WPINC' ) || die;

/**
 * Stores, sanitizes and resolves the message an organizer adds to the
 * booking confirmation email of an event (issue #2126).
 *
 * The message lives on the event date row, so events without a linked post
 * can have one too. A recurring series has one message, stored on its
 * master: every occurrence inherits it and none can override it.
 *
 * Both confirmation senders — fair-events' baseline EmailService and
 * fair-audience's richer one — read the message through for_email(), so the
 * content is identical whichever plugin sends the email.
 */
class BookingMessage {

	/**
	 * Link protocols kept in the message; anything else (javascript:, data:…)
	 * is removed from the href.
	 *
	 * @var string[]
	 */
	const ALLOWED_PROTOCOLS = array( 'http', 'https', 'mailto', 'tel' );

	/**
	 * Resolve the event date row that owns the message: the series master
	 * for a generated occurrence, otherwise the row itself.
	 *
	 * @param EventDates $event_date Event date row.
	 * @return int Owning event date ID.
	 */
	public static function owner_id( EventDates $event_date ) {
		if ( 'generated' === $event_date->occurrence_type && $event_date->master_id ) {
			return (int) $event_date->master_id;
		}

		return (int) $event_date->id;
	}

	/**
	 * Get the sanitized message that applies to an event date.
	 *
	 * @param int $event_date_id Event date ID (a series occurrence resolves to its series).
	 * @return string Sanitized HTML, or '' when none applies.
	 */
	public static function get( $event_date_id ) {
		$event_date = EventDates::get_by_id( (int) $event_date_id );
		if ( ! $event_date ) {
			return '';
		}

		return self::sanitize( EventDates::get_booking_message( self::owner_id( $event_date ) ) );
	}

	/**
	 * Sanitize and store the message for an event date row.
	 *
	 * @param int    $event_date_id Owning event date ID.
	 * @param string $message       Raw HTML from the editor. Empty clears it.
	 * @return string|false The stored, sanitized HTML, or false on failure.
	 */
	public static function save( $event_date_id, $message ) {
		$sanitized = self::sanitize( $message );

		if ( ! EventDates::save_booking_message( (int) $event_date_id, $sanitized ) ) {
			return false;
		}

		return $sanitized;
	}

	/**
	 * Get the message to include in a confirmation email.
	 *
	 * Sanitized again on the way out, so content written before a stricter
	 * rule (or directly in the database) never reaches an inbox unchecked.
	 *
	 * @param int $event_date_id Event date the booking targets.
	 * @return string Email-safe HTML fragment, or '' when there is no message.
	 */
	public static function for_email( $event_date_id ) {
		return $event_date_id > 0 ? self::get( $event_date_id ) : '';
	}

	/**
	 * Reduce editor HTML to the formatting an email can carry safely.
	 *
	 * Keeps paragraphs, line breaks, emphasis, lists, headings, quotes and
	 * links with http(s), mailto and tel addresses. Drops scripts and styles
	 * together with their content, every other tag (keeping its text),
	 * event handlers and inline styles. Shortcodes stay literal text: the
	 * message is never passed through do_shortcode() or the content filters.
	 *
	 * @param string $html Raw HTML.
	 * @return string Sanitized HTML; '' when nothing visible remains.
	 */
	public static function sanitize( $html ) {
		$html = (string) $html;

		// wp_kses() keeps the text inside a removed tag; script and style
		// bodies must go entirely.
		$html = preg_replace( '@<(script|style)[^>]*?>.*?</\\1>@si', '', $html );

		$link = array(
			'href'   => true,
			'title'  => true,
			'target' => true,
			'rel'    => true,
		);

		$allowed = array(
			'a'          => $link,
			'p'          => array(),
			'br'         => array(),
			'strong'     => array(),
			'b'          => array(),
			'em'         => array(),
			'i'          => array(),
			'u'          => array(),
			'ul'         => array(),
			'ol'         => array(),
			'li'         => array(),
			'h2'         => array(),
			'h3'         => array(),
			'h4'         => array(),
			'blockquote' => array(),
		);

		$html = trim( wp_kses( $html, $allowed, self::ALLOWED_PROTOCOLS ) );

		// An editor that was emptied still leaves `<p><br></p>` or
		// `<p>&nbsp;</p>` behind: that is no message.
		$visible = str_replace( array( '&nbsp;', "\xC2\xA0" ), '', wp_strip_all_tags( $html ) );
		if ( '' === trim( $visible ) ) {
			return '';
		}

		return $html;
	}
}
