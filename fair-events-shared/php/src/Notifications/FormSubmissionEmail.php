<?php
/**
 * Shared form-submission admin notification email.
 *
 * @package FairEventsShared
 */

namespace FairEventsShared\Notifications;

defined( 'WPINC' ) || die;

/**
 * Renders the HTML document for the admin notification sent when a form is
 * submitted (#2233), used by Fair Form and by Fair Audience's deprecated
 * notification path.
 *
 * Follows the BookingConfirmationEmail pattern: it takes only
 * pre-translated, pre-escaped strings and never calls translation
 * functions, so each plugin keeps its literal calls against its own text
 * domain. Recipients, subjects, submitter extraction and delivery stay with
 * the calling services.
 */
class FormSubmissionEmail {

	/**
	 * Build the full HTML email body.
	 *
	 * `$args` keys, all already escaped by the caller:
	 * - site_name: escaped site name for the header and footer.
	 * - intro: escaped intro sentence.
	 * - context_html: optional paragraph(s) placed after the intro, such as
	 *   the submitted page; '' omits it.
	 * - submitter_html: optional `<tr>` rows describing the submitter, placed
	 *   before the answers; '' omits them.
	 * - answers_html: `<tr>` rows from QuestionnaireAnswerRows::html().
	 *
	 * @param array $args See above.
	 * @return string Full HTML document.
	 */
	public static function html( array $args ): string {
		$site_name      = $args['site_name'] ?? '';
		$intro          = $args['intro'] ?? '';
		$context_html   = $args['context_html'] ?? '';
		$submitter_html = $args['submitter_html'] ?? '';
		$answers_html   = $args['answers_html'] ?? '';

		return '<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; font-size: 16px; line-height: 1.6; color: #333333; background-color: #f4f4f4;">
	<table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4;">
		<tr>
			<td align="center" style="padding: 20px 0;">
				<table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
					<!-- Header -->
					<tr>
						<td style="background-color: #0073aa; color: #ffffff; padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
							<h1 style="margin: 0; font-size: 24px; font-weight: bold;">' . $site_name . '</h1>
						</td>
					</tr>

					<!-- Content -->
					<tr>
						<td style="padding: 40px 30px;">
							<p style="margin: 0 0 20px 0; font-size: 16px;">
								' . $intro . '
							</p>

							' . $context_html . '

							<table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 20px 0; border: 1px solid #eeeeee; border-radius: 4px;">
								' . $submitter_html . $answers_html . '
							</table>
						</td>
					</tr>

					<!-- Footer -->
					<tr>
						<td style="background-color: #f8f8f8; padding: 20px 30px; border-radius: 0 0 8px 8px; text-align: center; font-size: 12px; color: #666666;">
							<p style="margin: 0;">
								' . $site_name . '
							</p>
						</td>
					</tr>
				</table>
			</td>
		</tr>
	</table>
</body>
</html>';
	}
}
