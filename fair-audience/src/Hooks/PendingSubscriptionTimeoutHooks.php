<?php
/**
 * Pending Subscription Timeout Hooks
 *
 * Drives the pending-marketing-subscription timeout sweep: a 5-minute cron
 * tick reverts participants stuck at marketing+pending for over a week back
 * to minimal+confirmed, logs the change, and clears expired confirmation
 * tokens.
 *
 * @package FairAudience
 */

namespace FairAudience\Hooks;

use FairAudience\Database\EmailConfirmationTokenRepository;
use FairAudience\Database\ParticipantRepository;
use FairAudience\Models\EmailConsentLog;

defined( 'WPINC' ) || die;

/**
 * Cron hooks for the pending-subscription timeout sweep.
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
	 * Cron tick: revert long-pending marketing subscribers to minimal and
	 * clear expired confirmation tokens.
	 *
	 * Runs unconditionally each tick — idempotent, since only rows past the
	 * cutoff match.
	 */
	public static function run() {
		$repository = new ParticipantRepository();

		foreach ( $repository->get_expired_pending_marketing( self::cutoff() ) as $participant ) {
			$old_profile = $participant->email_profile;

			$participant->email_profile = 'minimal';
			$participant->status        = 'confirmed';

			if ( ! $participant->save() ) {
				continue;
			}

			EmailConsentLog::create(
				array(
					'participant_id' => $participant->id,
					'old_profile'    => $old_profile,
					'new_profile'    => 'minimal',
					'source'         => 'pending_timeout',
					'comment'        => __( 'Reverted to minimal: marketing subscription was never confirmed within a week.', 'fair-audience' ),
				)
			);
		}

		( new EmailConfirmationTokenRepository() )->delete_expired();
	}

	/**
	 * The cutoff datetime (UTC): rows with updated_at older than this are
	 * considered timed out.
	 *
	 * @return string Datetime string ('Y-m-d H:i:s').
	 */
	public static function cutoff() {
		return gmdate( 'Y-m-d H:i:s', time() - WEEK_IN_SECONDS );
	}
}
