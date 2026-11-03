<?php
/**
 * Stand-in for a SignupConfirmationEmail copy bundled by a plugin that has
 * not been updated since before #2126. It predates `custom_message_html`, so
 * html() renders without the organizer's message whatever the caller passes.
 *
 * Loaded only by MixedVersionAutoloadTest through its own PSR-4 loader.
 *
 * @package FairAudience
 */

namespace FairEventsShared\Notifications;

// phpcs:disable Generic.Classes.DuplicateClassName.Found -- deliberate stale copy.

/**
 * Pre-#2126 renderer: knows nothing about the booking message.
 */
class SignupConfirmationEmail {

	/**
	 * Build the email subject line.
	 *
	 * @param string $subject_template Subject with one `%s` placeholder.
	 * @param string $event_title      Event title.
	 * @return string Subject line.
	 */
	public static function subject( string $subject_template, string $event_title ): string {
		return sprintf( $subject_template, $event_title );
	}

	/**
	 * Build the email body, ignoring any key this version does not know.
	 *
	 * @param array $args Email data.
	 * @return string HTML body without a custom message.
	 */
	public static function html( array $args ): string {
		return '<html><body><p>stale renderer: ' . ( $args['event_title'] ?? '' ) . '</p></body></html>';
	}
}
