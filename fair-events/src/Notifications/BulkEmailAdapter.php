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
	 * @return string ACTIVE, INACTIVE (Fair Audience is not active) or
	 *     UPDATE_REQUIRED (an older Fair Audience still sends it itself).
	 */
	public function availability() {
		if ( ! Ownership::legacy_active( Ownership::BULK_EMAIL ) ) {
			return self::INACTIVE;
		}

		return Ownership::legacy_yields( Ownership::BULK_EMAIL ) && method_exists( self::MAILER, 'send_to_subscribers' )
			? self::ACTIVE
			: self::UPDATE_REQUIRED;
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
	 * Send the email to every eligible subscriber.
	 *
	 * @param string $subject Subject.
	 * @param string $html    Body.
	 * @return array{sent: int, failed: int, skipped: int}
	 */
	public function send( $subject, $html ) {
		$mailer = self::MAILER;
		return $mailer::send_to_subscribers( $subject, $html );
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
