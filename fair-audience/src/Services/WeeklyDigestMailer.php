<?php
/**
 * Weekly Digest Mailer
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

defined( 'WPINC' ) || die;

/**
 * Sends the weekly events email for Fair Events.
 *
 * Fair Events owns the weekly email's settings and schedule (Fair Events →
 * Event notifications) and calls this class when a send is due. Fair Audience
 * stays responsible for everything about the recipients: who is eligible,
 * marketing consent, the weekly-summary opt-out, personalization, the
 * unsubscribe link and the delivery itself.
 *
 * Fair Events checks for these methods before calling them. Never change
 * their signatures; add new methods instead.
 */
class WeeklyDigestMailer {

	/**
	 * Option where Fair Events keeps the weekly email settings.
	 */
	const SETTINGS_OPTION = 'fair_events_notification_bulk_email';

	/**
	 * Option where Fair Events records the notification channels it took over.
	 */
	const OWNERSHIP_OPTION = 'fair_events_notification_ownership';

	/**
	 * Option this plugin kept the weekly digest settings in.
	 */
	const LEGACY_OPTION = 'fair_audience_weekly_digest';

	/**
	 * Recurring cron hook of this plugin's former weekly digest sender.
	 */
	const LEGACY_CRON_HOOK = 'fair_audience_weekly_digest_tick';

	/**
	 * Remove the former sender's recurring cron event.
	 *
	 * Nothing listens to it any more, so an event still queued does nothing;
	 * this only stops it from being queued forever.
	 */
	public static function init() {
		add_action(
			'init',
			static function () {
				if ( wp_next_scheduled( self::LEGACY_CRON_HOOK ) ) {
					wp_clear_scheduled_hook( self::LEGACY_CRON_HOOK );
				}
			}
		);
	}

	/**
	 * Render the email for a week of events.
	 *
	 * @param array $week     Week data from FairEvents\Services\WeeklyEventsProvider::get_week().
	 * @param array $settings Weekly email settings: subject, intro, outro.
	 * @return array{subject: string, html: string, empty: bool}
	 */
	public static function compose( array $week, array $settings ) {
		return array(
			'subject' => WeeklyDigestRenderer::render_subject( (string) ( $settings['subject'] ?? '' ), $week ),
			'html'    => WeeklyDigestRenderer::render( $week, (string) ( $settings['intro'] ?? '' ), (string) ( $settings['outro'] ?? '' ) ),
			'empty'   => WeeklyDigestRenderer::is_week_empty( $week ),
		);
	}

	/**
	 * Send the email to every participant who may receive the weekly summary.
	 *
	 * @param string $subject Email subject.
	 * @param string $html    Email content (HTML).
	 * @return array{sent: int, failed: int, skipped: int} Number of participants per outcome.
	 */
	public static function send_to_subscribers( $subject, $html ) {
		$results = ( new EmailService() )->send_bulk_custom_mail_to_all( $subject, $html, true, array(), array(), EmailType::WEEKLY_SUMMARY );

		return array(
			'sent'    => count( $results['sent'] ),
			'failed'  => count( $results['failed'] ),
			'skipped' => count( $results['skipped'] ),
		);
	}

	/**
	 * Send the email to one address as a test, outside any participant.
	 *
	 * @param string $email   Recipient address.
	 * @param string $subject Email subject.
	 * @param string $html    Email content (HTML).
	 * @return bool Whether the message was accepted for delivery.
	 */
	public static function send_test( $email, $subject, $html ) {
		return (bool) ( new EmailService() )->send_html_mail_to_address( $email, $subject, $html );
	}

	/**
	 * Whether the weekly email is turned on, so its preference can be offered.
	 *
	 * Read from the stored settings, so participants keep their preference
	 * while Fair Events is inactive. Before Fair Events took the email over,
	 * this plugin's own former setting still says.
	 *
	 * @return bool
	 */
	public static function is_enabled() {
		$ownership = get_option( self::OWNERSHIP_OPTION, array() );
		$option    = is_array( $ownership ) && ! empty( $ownership['bulk_email'] ) ? self::SETTINGS_OPTION : self::LEGACY_OPTION;
		$settings  = get_option( $option, array() );

		return is_array( $settings ) && ! empty( $settings['enabled'] );
	}

	/**
	 * Whether a weekly email was ever set up on this site.
	 *
	 * @return bool
	 */
	public static function is_configured() {
		return false !== get_option( self::SETTINGS_OPTION, false ) || false !== get_option( self::LEGACY_OPTION, false );
	}

	/**
	 * The page where the weekly email is managed, when Fair Events provides it.
	 *
	 * @return string|null Admin URL, or null while Fair Events is inactive or too old.
	 */
	public static function management_url() {
		return defined( 'FAIR_EVENTS_OWNS_EVENT_NOTIFICATIONS' )
			? admin_url( 'admin.php?page=fair-events-event-notifications' )
			: null;
	}
}
