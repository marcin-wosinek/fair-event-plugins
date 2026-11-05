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

use FairAudience\Core\Cron;
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
	 *
	 * The interval is registered before anything schedules with it, and
	 * scheduling waits for `init`: it runs every plugin's translated
	 * `cron_schedules` labels.
	 */
	public static function init() {
		Cron::register_interval();
		add_action( self::CRON_HOOK, array( static::class, 'run' ) );
		add_action( 'init', array( static::class, 'schedule' ), 11 );
	}

	/**
	 * Restore the tick when it is missing, keeping an existing one.
	 *
	 * @return true|string True when it is scheduled, or a failure code.
	 */
	public static function schedule() {
		return Cron::ensure_recurring( self::CRON_HOOK, Cron::EVERY_FIVE_MINUTES, time() + MINUTE_IN_SECONDS );
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
