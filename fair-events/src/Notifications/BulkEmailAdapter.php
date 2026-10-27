<?php
/**
 * Bulk email adapter for weekly event notifications.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

defined( 'WPINC' ) || die;

/**
 * Hands the weekly email to Fair Audience.
 *
 * Fair Audience decides who may receive it (eligibility, consent, weekly
 * summary opt-out), personalizes it, adds the unsubscribe link and sends it.
 * This plugin only says when, and for which events.
 */
class BulkEmailAdapter {
	private const MAILER = '\FairAudience\Services\WeeklyDigestMailer';

	public const ACTIVE          = 'active';
	public const INACTIVE        = 'inactive';
	public const UPDATE_REQUIRED = 'update_required';

	/**
	 * Whether Fair Audience can send the email on this request.
	 *
	 * Fair Audience must report each recipient's outcome, for the
	 * notification history ({@see HistoryRecorder::recipient_observer()}),
	 * and send each feed's email only to that feed's subscribers.
	 *
	 * @return string ACTIVE, INACTIVE (Fair Audience is not active) or
	 *     UPDATE_REQUIRED (an older Fair Audience still sends it itself,
	 *     cannot report each recipient or cannot limit it to a feed's
	 *     subscribers).
	 */
	public function availability() {
		if ( ! Ownership::legacy_active( Ownership::BULK_EMAIL ) ) {
			return self::INACTIVE;
		}

		return Ownership::legacy_yields( Ownership::BULK_EMAIL ) && method_exists( self::MAILER, 'send_to_subscribers' ) && self::reports_recipients() && self::supports_feeds()
			? self::ACTIVE
			: self::UPDATE_REQUIRED;
	}

	/**
	 * Whether Fair Audience handed the email over and reports each
	 * recipient, but must be updated to send a feed's email only to the
	 * subscribers who chose that feed.
	 *
	 * @return bool
	 */
	public function needs_feed_update() {
		return Ownership::legacy_active( Ownership::BULK_EMAIL )
			&& Ownership::legacy_yields( Ownership::BULK_EMAIL )
			&& method_exists( self::MAILER, 'send_to_subscribers' )
			&& self::reports_recipients()
			&& ! self::supports_feeds();
	}

	/**
	 * Whether Fair Audience sends a feed's email only to its subscribers.
	 *
	 * @return bool
	 */
	public static function supports_feeds() {
		return method_exists( self::MAILER, 'send_to_feed_subscribers_reporting' );
	}

	/**
	 * Whether Fair Audience handed the email over but must be updated to
	 * report each recipient before this plugin sends it again.
	 *
	 * @return bool
	 */
	public function needs_reporting_update() {
		return Ownership::legacy_active( Ownership::BULK_EMAIL )
			&& Ownership::legacy_yields( Ownership::BULK_EMAIL )
			&& method_exists( self::MAILER, 'send_to_subscribers' )
			&& ! self::reports_recipients();
	}

	/**
	 * Whether Fair Audience reports each recipient's outcome while sending.
	 *
	 * @return bool
	 */
	public static function reports_recipients() {
		return method_exists( self::MAILER, 'send_to_subscribers_reporting' );
	}

	/**
	 * Render the email for a week.
	 *
	 * @param array $week     Week from {@see \FairEvents\Services\WeeklyEventsProvider::get_week()}.
	 * @param array $settings Bulk email settings.
	 * @return array{subject: string, html: string, empty: bool}
	 */
	public function compose( array $week, array $settings ) {
		$mailer = self::MAILER;
		return $mailer::compose( $week, $settings );
	}

	/**
	 * Send the email to every eligible subscriber, or only to the eligible
	 * subscribers of one feed.
	 *
	 * @param string        $subject  Subject.
	 * @param string        $html     Body.
	 * @param callable|null $observer Told about each recipient as it is processed.
	 * @param int|null      $feed_id  Event feed (source) ID the email lists, or null for every subscriber.
	 * @return array{sent: int, failed: int, skipped: int}
	 */
	public function send( $subject, $html, $observer = null, $feed_id = null ) {
		$mailer = self::MAILER;
		if ( null !== $feed_id ) {
			$observer = null !== $observer ? $observer : static function () {};
			return $mailer::send_to_feed_subscribers_reporting( (int) $feed_id, $subject, $html, $observer );
		}

		return null !== $observer
			? $mailer::send_to_subscribers_reporting( $subject, $html, $observer )
			: $mailer::send_to_subscribers( $subject, $html );
	}

	/**
	 * Send the email to one address, as a test.
	 *
	 * @param string $email   Recipient.
	 * @param string $subject Subject.
	 * @param string $html    Body.
	 * @return bool
	 */
	public function send_test( $email, $subject, $html ) {
		$mailer = self::MAILER;
		return (bool) $mailer::send_test( $email, $subject, $html );
	}
}
