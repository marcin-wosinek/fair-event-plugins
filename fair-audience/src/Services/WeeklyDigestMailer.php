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
	 *
	 * Fair Events can have several weekly email configurations. Since it
	 * gave them IDs, this option holds a read-only summary of all of them
	 * (`summary`, `enabled`, `configured`) instead of one configuration's
	 * settings; `enabled` means at least one is on. The weekly-summary
	 * preference covers every configuration; which feeds a subscriber
	 * receives is chosen separately ({@see WeeklyFeeds}).
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
	 * Feed ID for an email whose sender does not say which feed it lists.
	 */
	const UNKNOWN_FEED = 0;

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
	 * The sender does not say which feed the email lists, so participants
	 * who chose their feeds do not receive it.
	 *
	 * @param string $subject Email subject.
	 * @param string $html    Email content (HTML).
	 * @return array{sent: int, failed: int, skipped: int} Number of participants per outcome.
	 */
	public static function send_to_subscribers( $subject, $html ) {
		$results = ( new EmailService() )->send_bulk_custom_mail_to_all( $subject, $html, true, array(), array(), EmailType::WEEKLY_SUMMARY, null, self::UNKNOWN_FEED );

		return array(
			'sent'    => count( $results['sent'] ),
			'failed'  => count( $results['failed'] ),
			'skipped' => count( $results['skipped'] ),
		);
	}

	/**
	 * Send the email to every participant who may receive the weekly
	 * summary, reporting each one to an observer as it is processed.
	 *
	 * The sender does not say which feed the email lists, so participants
	 * who chose their feeds do not receive it and are not reported.
	 *
	 * The observer is called with an event and the recipient:
	 * 'sending' before the email is handed to the mail system, then 'sent'
	 * or 'failed'; 'rejected' for a participant without a valid address and
	 * 'skipped' for one excluded by consent or opt-out, both with a safe
	 * `reason` code. The recipient array holds the participant's `id`,
	 * `name` and `email` only. Results reported before an error stay
	 * reported.
	 *
	 * @param string   $subject  Email subject.
	 * @param string   $html     Email content (HTML).
	 * @param callable $observer Called as `$observer( string $event, array $recipient )`.
	 * @return array{sent: int, failed: int, skipped: int} Number of participants per outcome.
	 */
	public static function send_to_subscribers_reporting( $subject, $html, callable $observer ) {
		$results = ( new EmailService() )->send_bulk_custom_mail_to_all( $subject, $html, true, array(), array(), EmailType::WEEKLY_SUMMARY, $observer, self::UNKNOWN_FEED );

		return array(
			'sent'    => count( $results['sent'] ),
			'failed'  => count( $results['failed'] ),
			'skipped' => count( $results['skipped'] ),
		);
	}

	/**
	 * Send one event feed's email to the participants who may receive the
	 * weekly summary and receive that feed, reporting each one to an
	 * observer as it is processed.
	 *
	 * Participants who chose their feeds receive it only when they chose
	 * this one; the others receive every feed's email. Participants it is not
	 * meant for are not reported. Otherwise as
	 * {@see self::send_to_subscribers_reporting()}.
	 *
	 * @param int      $feed_id  Fair Events event source ID the email lists.
	 * @param string   $subject  Email subject.
	 * @param string   $html     Email content (HTML).
	 * @param callable $observer Called as `$observer( string $event, array $recipient )`.
	 * @return array{sent: int, failed: int, skipped: int} Number of participants per outcome.
	 * @throws \InvalidArgumentException Without a valid feed ID, so nothing goes to every subscriber.
	 */
	public static function send_to_feed_subscribers_reporting( $feed_id, $subject, $html, callable $observer ) {
		if ( ! is_int( $feed_id ) || $feed_id <= 0 ) {
			throw new \InvalidArgumentException( 'A weekly email feed ID is required.' );
		}

		$results = ( new EmailService() )->send_bulk_custom_mail_to_all( $subject, $html, true, array(), array(), EmailType::WEEKLY_SUMMARY, $observer, $feed_id );

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
	 * while Fair Events is inactive: on while any of Fair Events' weekly email
	 * configurations is on. Before Fair Events took the email over, this
	 * plugin's own former setting still says.
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
		$settings = get_option( self::SETTINGS_OPTION, false );
		if ( is_array( $settings ) && ! empty( $settings['summary'] ) ) {
			return ! empty( $settings['configured'] ) || false !== get_option( self::LEGACY_OPTION, false );
		}

		return false !== $settings || false !== get_option( self::LEGACY_OPTION, false );
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
