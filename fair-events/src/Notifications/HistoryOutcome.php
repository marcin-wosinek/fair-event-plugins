<?php
/**
 * Notification history outcomes.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

defined( 'WPINC' ) || die;

/**
 * The outcomes recorded in the notification history, and how an
 * execution's outcome follows from its deliveries.
 *
 * A delivery is one attempt to hand a message to its destination: one
 * Telegram message part to one chat, or one email to one address.
 * "Accepted" means the provider took it over: the site's mail system for
 * email, the Telegram API for Telegram. Neither confirms that a person
 * received or read it.
 *
 * An execution's lifecycle (running, completed, abandoned) is kept apart from
 * its outcome, which is set once it stops running.
 */
class HistoryOutcome {
	// Delivery outcomes.
	public const ACCEPTED = 'accepted';
	public const FAILED   = 'failed';
	public const SKIPPED  = 'skipped';
	public const UNKNOWN  = 'unknown';

	public const DELIVERY_OUTCOMES = array( self::ACCEPTED, self::FAILED, self::SKIPPED, self::UNKNOWN );

	// Execution outcomes.
	public const SUCCESS = 'success';
	public const PARTIAL = 'partial';
	public const FAILURE = 'failure';

	public const EXECUTION_OUTCOMES = array( self::SUCCESS, self::PARTIAL, self::FAILURE, self::SKIPPED, self::UNKNOWN );

	// Execution lifecycle.
	public const RUNNING   = 'running';
	public const COMPLETED = 'completed';
	public const ABANDONED = 'abandoned';

	// Origins.
	public const SCHEDULED = 'scheduled';
	public const TEST      = 'test';

	public const ORIGINS = array( self::SCHEDULED, self::TEST );

	/**
	 * An execution's outcome from its delivery counts.
	 *
	 * - Accepted deliveries alongside failed or unknown ones: partial.
	 * - Accepted deliveries only (skips aside): success.
	 * - Unknown deliveries without any accepted one: unknown.
	 * - Failed deliveries only (skips aside): failure.
	 * - No delivery attempted: the fallback, e.g. skipped with its reason.
	 *
	 * Skipped deliveries, such as recipients without consent, never turn a
	 * success into a partial one.
	 *
	 * @param array  $counts   Counts keyed by delivery outcome.
	 * @param string $fallback Outcome when nothing was attempted.
	 * @return string
	 */
	public static function aggregate( array $counts, $fallback = self::SKIPPED ) {
		$accepted = (int) ( $counts[ self::ACCEPTED ] ?? 0 );
		$failed   = (int) ( $counts[ self::FAILED ] ?? 0 );
		$unknown  = (int) ( $counts[ self::UNKNOWN ] ?? 0 );

		if ( $accepted > 0 ) {
			return $failed > 0 || $unknown > 0 ? self::PARTIAL : self::SUCCESS;
		}
		if ( $unknown > 0 ) {
			return self::UNKNOWN;
		}
		if ( $failed > 0 ) {
			return self::FAILURE;
		}
		return $fallback;
	}

	/**
	 * The delivery outcome of a provider or delivery record state.
	 *
	 * @param string $state 'sent', 'failed', 'skipped', 'uncertain' or 'sending'.
	 * @return string
	 */
	public static function from_state( $state ) {
		switch ( $state ) {
			case 'sent':
				return self::ACCEPTED;
			case 'failed':
				return self::FAILED;
			case 'skipped':
				return self::SKIPPED;
			default:
				return self::UNKNOWN;
		}
	}
}
