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
	 * `$args` keys — data: event_title, participant_name, site_name,
	 * event_date_display, registration_reference, ticket_type_name,
	 * payment_amount_display, option_names (array), answers_html
	 * (pre-rendered `<tr>` fragment), action_url (pre-escaped, e.g. via
	 * esc_url()). Copy (already translated/escaped): greeting_template,
	 * confirmation_sentence, event_date_label, registration_reference_label,
	 * ticket_type_label, amount_paid_label, selected_options_label,
	 * your_answers_label, sign_off_template, action_label.
	 *
	 * Each optional data/label pair renders only when the data value is
	 * non-empty. The action link (action_url + action_label) is a plain text
	 * link — not a resume/token URL — so it renders only when both are set.
	 *
	 * @param array $args See above.
	 * @return string Full HTML document.
	 */
	public static function html( array $args ): string {
		$event_title            = $args['event_title'] ?? '';
		$participant_name       = $args['participant_name'] ?? '';
		$site_name              = $args['site_name'] ?? '';
		$event_date_display     = $args['event_date_display'] ?? '';
		$registration_reference = $args['registration_reference'] ?? '';
		$ticket_type_name       = $args['ticket_type_name'] ?? '';
		$payment_amount_display = $args['payment_amount_display'] ?? '';
		$option_names           = $args['option_names'] ?? array();
		$answers_html           = $args['answers_html'] ?? '';
		$action_url             = $args['action_url'] ?? '';

		$greeting_template            = $args['greeting_template'] ?? '';
		$confirmation_sentence        = $args['confirmation_sentence'] ?? '';
		$event_date_label             = $args['event_date_label'] ?? '';
		$registration_reference_label = $args['registration_reference_label'] ?? '';
		$ticket_type_label            = $args['ticket_type_label'] ?? '';
		$amount_paid_label            = $args['amount_paid_label'] ?? '';
		$selected_options_label       = $args['selected_options_label'] ?? '';
		$your_answers_label           = $args['your_answers_label'] ?? '';
		$sign_off_template            = $args['sign_off_template'] ?? '';
		$action_label                 = $args['action_label'] ?? '';

		$details_rows = '';
		foreach (
			array(
				array( $event_date_label, $event_date_display ),
				array( $registration_reference_label, $registration_reference ),
				array( $ticket_type_label, $ticket_type_name ),
				array( $amount_paid_label, $payment_amount_display ),
			) as list( $label, $value )
		) {
			if ( '' === (string) $value ) {
				continue;
			}

			$details_rows .= '<tr>
					<td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">' . $label . '</td>
					<td style="padding: 8px 0; border-bottom: 1px solid #eee;">' . $value . '</td>
				</tr>';
		}

		$details_html = '';
		if ( '' !== $details_rows ) {
			$details_html = '
							<table style="width: 100%; border-collapse: collapse; margin: 0 0 20px 0;">' . $details_rows . '</table>';
		}

		$options_html = '';
		if ( ! empty( $option_names ) ) {
			$options_list = '';
			foreach ( $option_names as $name ) {
				$options_list .= '<li style="padding: 4px 0;">' . $name . '</li>';
			}
			$options_html = '
							<p style="margin: 0 0 8px 0; font-size: 16px; font-weight: bold;">' . $selected_options_label . '</p>
							<ul style="margin: 0 0 20px 20px; padding: 0;">' . $options_list . '</ul>';
		}

		$answers_section = '';
		if ( '' !== $answers_html ) {
			$answers_section = '
							<p style="margin: 0 0 8px 0; font-size: 16px; font-weight: bold;">' . $your_answers_label . '</p>
							<table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 20px 0; border: 1px solid #eeeeee; border-radius: 4px;">' . $answers_html . '</table>';
		}

		$action_html = '';
		if ( '' !== $action_url && '' !== $action_label ) {
			$action_html = '
							<p style="margin: 0 0 20px 0; font-size: 16px;">
								<a href="' . $action_url . '" style="color: #0073aa;">' . $action_label . '</a>
							</p>';
		}

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
					<tr>
						<td style="background-color: #0073aa; color: #ffffff; padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
							<h1 style="margin: 0; font-size: 24px; font-weight: bold;">' . $event_title . '</h1>
						</td>
					</tr>

					<tr>
						<td style="padding: 40px 30px;">
							<p style="margin: 0 0 20px 0; font-size: 16px;">
								' . sprintf( $greeting_template, '<strong>' . $participant_name . '</strong>' ) . '
							</p>

							<p style="margin: 0 0 20px 0; font-size: 16px;">
								' . $confirmation_sentence . '
							</p>

							' . $details_html . '

							' . $options_html . '

							' . $answers_section . '

							' . $action_html . '

							<p style="margin: 20px 0 0 0; font-size: 14px; color: #666666;">
								' . sprintf( $sign_off_template, '<br>', $site_name ) . '
							</p>
						</td>
					</tr>

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
