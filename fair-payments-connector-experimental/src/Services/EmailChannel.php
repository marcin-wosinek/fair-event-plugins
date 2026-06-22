<?php
/**
 * Email notification channel
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\Services;

defined( 'WPINC' ) || die;

/**
 * Delivers notifications via wp_mail.
 *
 * The rendered text produced by TelegramService::render_template() (which already
 * applies HTML escaping) is wrapped in a minimal branded HTML email so it works in
 * both channels without any extra escaping. The email path never bypasses the
 * include_pii toggle — that is enforced at render time.
 */
class EmailChannel implements NotificationChannel {

	/**
	 * Send a notification email to one address.
	 *
	 * @param string $destination Email address.
	 * @param string $text        Pre-rendered HTML message body.
	 * @return bool
	 */
	public function send( string $destination, string $text ): bool {
		$site_name = wp_specialchars_decode( (string) get_option( 'blogname', '' ), ENT_QUOTES );
		$subject   = sprintf(
			/* translators: %s: site name */
			__( 'Payment notification — %s', 'fair-payments-connector-experimental' ),
			$site_name
		);

		$message      = $this->build_html( $text, $site_name );
		$content_type = static function () {
			return 'text/html';
		};

		add_filter( 'wp_mail_content_type', $content_type );
		$result = wp_mail( $destination, $subject, $message );
		remove_filter( 'wp_mail_content_type', $content_type );

		return (bool) $result;
	}

	/**
	 * Wrap the rendered text in a simple branded HTML email shell.
	 *
	 * @param string $text      Already-escaped HTML body from render_template().
	 * @param string $site_name Site name for the header.
	 * @return string Full HTML document.
	 */
	private function build_html( string $text, string $site_name ): string {
		$body = nl2br( $text );

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
							<h1 style="margin: 0; font-size: 24px; font-weight: bold;">' . esc_html( $site_name ) . '</h1>
						</td>
					</tr>
					<tr>
						<td style="padding: 40px 30px; font-size: 16px; line-height: 1.6;">
							' . wp_kses_post( $body ) . '
						</td>
					</tr>
					<tr>
						<td style="background-color: #f8f8f8; padding: 20px 30px; border-radius: 0 0 8px 8px; text-align: center; font-size: 12px; color: #666666;">
							<p style="margin: 0;">' . esc_html( $site_name ) . '</p>
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
