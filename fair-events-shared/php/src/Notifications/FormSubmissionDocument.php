<?php
/**
 * Form-submission admin notification in the common email design.
 *
 * @package FairEventsShared
 */

namespace FairEventsShared\Notifications;

defined( 'WPINC' ) || die;

/**
 * Renders the admin notification for a form submission through
 * {@see EmailLayout} (#2322).
 *
 * A new class rather than a change to FormSubmissionEmail::html(), which
 * older plugins still call and whose output they keep. Takes only
 * pre-translated, pre-escaped strings.
 */
final class FormSubmissionDocument {

	/**
	 * Build the full HTML email body.
	 *
	 * Accepts the FormSubmissionEmail::html() keys with the same meaning:
	 * site_name, intro, context_html, submitter_html, answers_html.
	 *
	 * @param array $args See FormSubmissionEmail::html().
	 * @return string Full HTML document.
	 */
	public static function html( array $args ): string {
		$site_name = (string) ( $args['site_name'] ?? '' );

		$content = EmailLayout::paragraph( (string) ( $args['intro'] ?? '' ) )
			. (string) ( $args['context_html'] ?? '' )
			. EmailLayout::answers_table( (string) ( $args['submitter_html'] ?? '' ) . (string) ( $args['answers_html'] ?? '' ) );

		return EmailLayout::document(
			$site_name,
			$content,
			EmailLayout::paragraph( $site_name, EmailLayout::FOOTER_TEXT )
		);
	}
}
