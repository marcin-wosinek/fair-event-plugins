<?php
/**
 * Shared signup confirmation email formatter.
 *
 * @package FairEventsShared
 */

namespace FairEventsShared\Notifications;

/**
 * Renders the branded signup confirmation email shared by fair-audience and
 * standalone fair-events. Takes only pre-translated, pre-escaped strings —
 * it never calls translation functions itself, so each plugin keeps its own
 * literal calls against its own text domain and this class stays free of any
 * plugin-specific dependency.
 */
class SignupConfirmationEmail {

	/**
	 * Build the email subject line.
	 *
	 * @param string $subject_template Translated subject with one `%s` placeholder for the event title.
	 * @param string $event_title      Event title.
	 * @return string Finished subject line.
	 */
	public static function subject( string $subject_template, string $event_title ): string {
		return sprintf( $subject_template, $event_title );
	}

	/**
	 * Wrap the event title for its inline mention in the confirmation
	 * sentence — a link when an event URL is available, otherwise the
	 * existing bold-only markup.
	 *
	 * @param string $event_title_html Pre-escaped event title.
	 * @param string $event_url        Pre-escaped event URL. Pass '' to omit the link.
	 * @return string HTML fragment: `<a href="…">…</a>` or `<strong>…</strong>`.
	 */
	public static function linked_event_title( string $event_title_html, string $event_url = '' ): string {
		if ( '' === $event_url ) {
			return '<strong>' . $event_title_html . '</strong>';
		}

		return '<a href="' . $event_url . '" style="color:#0073aa; font-weight:bold; text-decoration:underline;">' . $event_title_html . '</a>';
	}

	/**
	 * Build the full HTML email body.
	 *
	 * Kept for compatibility; delegates to BookingConfirmationEmail::html(),
	 * which documents `$args`. Callers that pass `custom_message_html` must
	 * call BookingConfirmationEmail directly: an older copy of this class,
	 * bundled by a plugin that has not been updated, ignores that key.
	 *
	 * @param array $args See BookingConfirmationEmail::html().
	 * @return string Full HTML document.
	 */
	public static function html( array $args ): string {
		return BookingConfirmationEmail::html( $args );
	}
}
