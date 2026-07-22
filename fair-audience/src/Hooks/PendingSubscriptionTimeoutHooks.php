<?php
/**
 * Pending Subscription Timeout Hooks
 *
 * A 5-minute cron tick that times out marketing subscriptions which were never
 * confirmed: after a week in "marketing + pending" limbo the participant is
 * reverted to a plain minimal (confirmed) mailing profile, with an audit entry.
 * The tick also cleans up expired email-confirmation tokens.
 *
 * @package FairAudience
 */

namespace FairAudience\Hooks;

use FairAudience\Database\EmailConfirmationTokenRepository;
use FairAudience\Database\ParticipantRepository;
use FairAudience\Models\EmailConsentLog;

defined( 'WPINC' ) || die;

/**
 * Cron hooks for timing out unconfirmed marketing subscriptions.
 */
class PendingSubscriptionTimeoutHooks {

	/**
	 * Cron hook name for the recurring tick.
	 */
	const CRON_HOOK = 'fair_audience_pending_subscription_timeout_tick';

	/**
	 * Initialize hooks.
	 */
	public static function init() {
		add_filter( 'cron_schedules', array( static::class, 'add_cron_schedule' ) );

		add_action( self::CRON_HOOK, array( static::class, 'run' ) );
		if ( ! wp_next_scheduled( self::CRON_HOOK ) ) {
			wp_schedule_event( time() + MINUTE_IN_SECONDS, 'fair_audience_every_five_minutes', self::CRON_HOOK );
		}
	}

	/**
	 * Register the shared 5-minute cron schedule.
	 *
	 * Mirrors WeeklyDigestHooks::add_cron_schedule so both coexist; the
	 * `isset()` guard makes adding the same key twice a no-op.
	 *
	 * @param array $schedules Existing schedules.
	 * @return array
	 */
	public static function add_cron_schedule( $schedules ) {
		if ( ! isset( $schedules['fair_audience_every_five_minutes'] ) ) {
			$schedules['fair_audience_every_five_minutes'] = array(
				'interval' => 5 * MINUTE_IN_SECONDS,
				'display'  => __( 'Every 5 minutes (fair-audience)', 'fair-audience' ),
			);
		}
		return $schedules;
	}

	/**
	 * The UTC cutoff before which a pending marketing subscription has timed out.
	 *
	 * Compared against the participant's `updated_at` (a UTC DB timestamp), so
	 * the cutoff is computed in UTC too — matching how
	 * EmailConfirmationTokenRepository::delete_expired() derives its own bound.
	 *
	 * @param int|null $now Unix timestamp to measure from; defaults to time().
	 * @return string MySQL UTC datetime one week before $now.
	 */
	public static function cutoff( $now = null ) {
		$now = null === $now ? time() : (int) $now;
		return gmdate( 'Y-m-d H:i:s', $now - WEEK_IN_SECONDS );
	}

	/**
	 * Cron tick: revert timed-out pending marketing subscribers to minimal and
	 * purge expired confirmation tokens.
	 *
	 * Runs unconditionally each tick; it is idempotent because only rows past
	 * the cutoff match, and reverting them removes them from the next sweep.
	 */
	public static function run() {
		$cutoff       = self::cutoff();
		$repository   = new ParticipantRepository();
		$participants = $repository->get_expired_pending_marketing( $cutoff );

		foreach ( $participants as $participant ) {
			$participant->email_profile = 'minimal';
			$participant->status        = 'confirmed';

			if ( ! $participant->save() ) {
				continue;
			}

			EmailConsentLog::create(
				array(
					'participant_id' => $participant->id,
					'old_profile'    => 'marketing',
					'new_profile'    => 'minimal',
					'source'         => 'pending_timeout',
					'comment'        => __( 'Marketing subscription timed out after a week without confirmation.', 'fair-audience' ),
				)
			);
		}

		( new EmailConfirmationTokenRepository() )->delete_expired();
	}
}
