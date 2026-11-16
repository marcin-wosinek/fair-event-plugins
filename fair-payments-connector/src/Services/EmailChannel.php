<?php
/**
 * Email notification channel
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Services;

use FairEventsShared\Notifications\EmailLayout;

defined( 'WPINC' ) || die;

/**
 * Delivers notifications via wp_mail.
 *
 * The rendered text produced by TelegramService::render_template() (which already
 * applies HTML escaping) is wrapped in the common Fair Event Plugins email layout so it works in
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
			__( 'Payment notification — %s', 'fair-payments-connector' ),
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
	 * Wrap the rendered text in the common email layout.
	 *
	 * @param string $text      Already-escaped HTML body from render_template().
	 * @param string $site_name Site name for the header.
	 * @return string Full HTML document.
	 */
	private function build_html( string $text, string $site_name ): string {
		return EmailLayout::document(
			esc_html( $site_name ),
			EmailLayout::content_block( wp_kses_post( nl2br( $text ) ) ),
			EmailLayout::paragraph( esc_html( $site_name ), EmailLayout::FOOTER_TEXT )
		);
	}
}
