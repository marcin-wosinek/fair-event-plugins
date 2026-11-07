<?php
/**
 * Payment history cutover activation
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Models\PaymentHistoryAudit;
use FairEvents\Models\PaymentHistoryFinding;
use FairEvents\Models\PaymentShadowWork;

defined( 'WPINC' ) || die;

/**
 * The stage 4 activation (PAYMENT_HISTORY_MIGRATION.md §8.13): an
 * administrator switches purchase payment authority from the Fair Audience
 * ledger to Fair Events' payment links, once the backfill is verified and a
 * fresh database backup is confirmed. Nothing activates it on upgrade or
 * when readiness first passes.
 *
 * - blockers() lists what stops the activation. It refuses while any is
 *   listed, including an active Fair Audience without the purchase
 *   lifecycle (`audience_lifecycle_unavailable`, §8.12).
 * - activate() takes the activation lock and the backfill's batch lock, so
 *   no other activation, backfill batch or verification pass runs under
 *   it, reads the state again from the database, rechecks every blocker
 *   and the verification's global checks, and only then records the
 *   activation with an audit entry in one database transaction.
 * - The activation lives in its own option
 *   (PaymentHistoryCompatibility::CUTOVER_OPTION), apart from the
 *   backfill's mutable status: a later verification failure, a re-run or a
 *   plugin deactivation never clears it, so ledger authority is never
 *   silently restored. Recovery after it is forward repair (§8.5); nothing
 *   here undoes it.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class PaymentHistoryCutover {

	/**
	 * Seconds activate() waits for each lock.
	 */
	const LOCK_TIMEOUT = 5;

	/**
	 * Fires after the activation committed, with the recorded activation.
	 */
	const ACTIVATED_HOOK = 'fair_events_payment_history_cutover_activated';

	/**
	 * Everything stage 4 readiness depends on, read from the site now.
	 *
	 * @return array storage, verified, backfill_status, shadow_write_coverage,
	 *               payment_information, audience_compatible,
	 *               audience_lifecycle, outstanding_work.
	 */
	public static function facts() {
		// The audit (DB 3.52.0) records the activation; it implies the
		// links, the work queue and the backfill's tables.
		$storage  = PaymentHistoryCompatibility::reconciliation_available();
		$backfill = PaymentHistoryBackfill::get_run( PaymentHistoryBackfill::MODE_BACKFILL );

		return array(
			'storage'               => $storage,
			'verified'              => PaymentHistoryCompatibility::migration_verified(),
			'backfill_status'       => $backfill ? (string) $backfill['status'] : null,
			'shadow_write_coverage' => PaymentHistoryCompatibility::shadow_write_coverage(),
			'payment_information'   => PaymentHistoryCompatibility::payment_information_available(),
			'audience_compatible'   => PaymentHistoryCompatibility::audience_compatible(),
			'audience_lifecycle'    => PaymentHistoryCompatibility::audience_lifecycle_available(),
			'outstanding_work'      => $storage ? PaymentShadowWork::count_outstanding() : array(),
		);
	}

	/**
	 * What stops the activation, given the site's facts; empty when it can
	 * run.
	 *
	 * @param array $facts From facts().
	 * @return string[] Codes: storage_unavailable, migration_unverified,
	 *                  shadow_writes_incomplete, payment_information_unavailable,
	 *                  audience_incompatible, audience_lifecycle_unavailable,
	 *                  shadow_work_outstanding.
	 */
	public static function blockers( array $facts ) {
		$blockers = array();
		if ( empty( $facts['storage'] ) ) {
			$blockers[] = 'storage_unavailable';
		}
		if ( empty( $facts['verified'] ) ) {
			$blockers[] = 'migration_unverified';
		}
		if ( empty( $facts['shadow_write_coverage'] ) ) {
			$blockers[] = 'shadow_writes_incomplete';
		}
		if ( empty( $facts['payment_information'] ) ) {
			$blockers[] = 'payment_information_unavailable';
		}
		if ( empty( $facts['audience_compatible'] ) ) {
			$blockers[] = 'audience_incompatible';
		}
		if ( empty( $facts['audience_lifecycle'] ) ) {
			$blockers[] = 'audience_lifecycle_unavailable';
		}
		if ( ! empty( $facts['outstanding_work'] ) ) {
			$blockers[] = 'shadow_work_outstanding';
		}
		return $blockers;
	}

	/**
	 * What needs forward repair once the activation is recorded; empty when
	 * nothing does. None of these moves authority back to the ledger.
	 *
	 * @param array $facts  From facts().
	 * @param bool  $active Whether the cutover is in effect (its storage exists).
	 * @return string[] Codes: storage_unavailable, audience_lifecycle_unavailable,
	 *                  payment_information_unavailable, verification_failed.
	 */
	public static function issues( array $facts, $active ) {
		$issues = array();
		if ( ! $active ) {
			$issues[] = 'storage_unavailable';
		}
		if ( empty( $facts['audience_lifecycle'] ) ) {
			$issues[] = 'audience_lifecycle_unavailable';
		}
		if ( empty( $facts['payment_information'] ) ) {
			$issues[] = 'payment_information_unavailable';
		}
		if ( PaymentHistoryBackfill::STATUS_VERIFICATION_FAILED === ( $facts['backfill_status'] ?? null ) ) {
			$issues[] = 'verification_failed';
		}
		return $issues;
	}

	/**
	 * The activation's state for administrators.
	 *
	 * @return array active, activation (with user_name), blockers (before
	 *               the activation), issues (after it) and the queued work
	 *               by kind and status.
	 */
	public static function status() {
		$facts      = self::facts();
		$activation = PaymentHistoryCompatibility::get_cutover();
		$active     = PaymentHistoryCompatibility::ownership_cutover();

		if ( $activation ) {
			$user                    = get_userdata( (int) ( $activation['user_id'] ?? 0 ) );
			$activation['user_name'] = $user ? (string) $user->display_name : null;
		}

		return array(
			'active'     => $active,
			'activation' => $activation,
			'blockers'   => $activation ? array() : self::blockers( $facts ),
			'issues'     => $activation ? self::issues( $facts, $active ) : array(),
			'work'       => $facts['outstanding_work'],
		);
	}

	/**
	 * Activate the cutover: from now on payment links are the authority for
	 * purchase payments (§8.1 stage 4).
	 *
	 * @param array $args backup_confirmed (bool), user_id (int).
	 * @return array|\WP_Error The recorded activation, or why it was refused:
	 *                         backup_required, cutover_active, cutover_blocked
	 *                         (with `blockers`), cutover_busy, verification_stale
	 *                         (with `verification_blockers`), cutover_failed.
	 */
	public static function activate( array $args = array() ) {
		if ( empty( $args['backup_confirmed'] ) ) {
			return new \WP_Error( 'backup_required', 'Confirm that a fresh database backup was taken before switching payment records.' );
		}
		if ( PaymentHistoryCompatibility::get_cutover() ) {
			return self::already_active();
		}
		$refused = self::refuse( self::facts() );
		if ( $refused ) {
			return $refused;
		}

		$locks = array( self::lock_name(), PaymentHistoryBackfill::lock_name() );
		$held  = array();
		foreach ( $locks as $lock ) {
			if ( ! self::acquire( $lock ) ) {
				self::release( $held );
				return new \WP_Error( 'cutover_busy', 'The payment history migration is busy. Try again in a moment.' );
			}
			$held[] = $lock;
		}

		try {
			return self::activate_locked( (int) ( $args['user_id'] ?? get_current_user_id() ) );
		} finally {
			self::release( $held );
		}
	}

	/**
	 * The activation as it will be recorded.
	 *
	 * @param array  $backfill    The verified backfill run.
	 * @param array  $comparisons PaymentHistoryVerification::summary().
	 * @param array  $findings    Backfill finding counts by status.
	 * @param int    $user_id     Administrator.
	 * @param string $now         UTC time, `Y-m-d H:i:s`.
	 * @return array
	 */
	public static function record( array $backfill, array $comparisons, array $findings, $user_id, $now ) {
		$checked_at = (string) ( $backfill['verification']['checked_at'] ?? $backfill['completed_at'] ?? '' );
		return array(
			'activated_at'        => $now,
			'user_id'             => (int) $user_id,
			'backup_confirmed_at' => $now,
			'reference'           => 'backfill-verification:' . $checked_at,
			'verification'        => array(
				'checked_at'   => $checked_at,
				'rechecked_at' => $now,
				'cutoffs'      => $backfill['cutoffs'] ?? null,
				'comparisons'  => $comparisons,
				'findings'     => $findings,
			),
		);
	}

	/**
	 * Body of activate(), holding both locks.
	 *
	 * @param int $user_id Administrator.
	 * @return array|\WP_Error
	 */
	private static function activate_locked( $user_id ) {
		global $wpdb;

		// Decide again from the database: another request may have
		// activated, or the migration may have changed, since the first check.
		PaymentHistoryCompatibility::reset_cache();
		wp_cache_delete( PaymentHistoryCompatibility::STATE_OPTION, 'options' );
		if ( self::stored_activation() ) {
			return self::already_active();
		}
		$refused = self::refuse( self::facts() );
		if ( $refused ) {
			return $refused;
		}

		$backfill = PaymentHistoryBackfill::get_run( PaymentHistoryBackfill::MODE_BACKFILL );
		$checks   = PaymentHistoryVerification::global_checks( (int) ( $backfill['cutoffs']['transaction_id'] ?? 0 ) );
		if ( $checks ) {
			return new \WP_Error(
				'verification_stale',
				'The verification no longer passes. Verify the migration again before switching payment records.',
				array( 'verification_blockers' => array_keys( $checks ) )
			);
		}

		$record = self::record(
			$backfill,
			PaymentHistoryVerification::summary(),
			PaymentHistoryFinding::count_by_status( PaymentHistoryFinding::MODE_BACKFILL ),
			$user_id,
			gmdate( 'Y-m-d H:i:s' )
		);

		$wpdb->query( 'START TRANSACTION' );
		$audit_id = PaymentHistoryAudit::append(
			array(
				'action'  => PaymentHistoryAudit::ACTION_ACTIVATE,
				'reason'  => 'ownership_cutover',
				'user_id' => $user_id,
				'note'    => '',
				'before'  => array( 'cutover' => null ),
				'after'   => array( 'cutover' => $record ),
			)
		);
		if ( ! $audit_id ) {
			$wpdb->query( 'ROLLBACK' );
			return self::failed();
		}
		$record['audit_id'] = $audit_id;
		if ( ! update_option( PaymentHistoryCompatibility::CUTOVER_OPTION, $record, true ) ) {
			$wpdb->query( 'ROLLBACK' );
			wp_cache_delete( PaymentHistoryCompatibility::CUTOVER_OPTION, 'options' );
			wp_cache_delete( 'alloptions', 'options' );
			return self::failed();
		}
		$wpdb->query( 'COMMIT' );

		// The retry cron runs the lifecycle's queued work from now on.
		PaymentHistoryShadowWrites::maybe_enable();
		do_action( self::ACTIVATED_HOOK, $record );
		return $record;
	}

	/**
	 * A refusal for the site's facts, if anything blocks.
	 *
	 * @param array $facts From facts().
	 * @return \WP_Error|null
	 */
	private static function refuse( array $facts ) {
		$blockers = self::blockers( $facts );
		if ( ! $blockers ) {
			return null;
		}
		return new \WP_Error( 'cutover_blocked', 'Payment records can\'t be switched to Fair Events on this site yet.', array( 'blockers' => $blockers ) );
	}

	/**
	 * The activation as stored now, bypassing the options cache.
	 *
	 * @return bool Whether one is recorded.
	 */
	private static function stored_activation() {
		global $wpdb;
		$value = $wpdb->get_var( $wpdb->prepare( 'SELECT option_value FROM %i WHERE option_name = %s', $wpdb->options, PaymentHistoryCompatibility::CUTOVER_OPTION ) );
		if ( null === $value ) {
			return false;
		}
		$stored = maybe_unserialize( $value );
		return is_array( $stored ) && ! empty( $stored['activated_at'] );
	}

	/**
	 * Refusal: the cutover is already active.
	 *
	 * @return \WP_Error
	 */
	private static function already_active() {
		return new \WP_Error( 'cutover_active', 'Payment records already use Fair Events.' );
	}

	/**
	 * Refusal: the activation couldn't be stored; nothing changed.
	 *
	 * @return \WP_Error
	 */
	private static function failed() {
		return new \WP_Error( 'cutover_failed', 'The switch couldn\'t be recorded. Nothing changed; try again.' );
	}

	/**
	 * Named lock serializing activations.
	 *
	 * @return string
	 */
	private static function lock_name() {
		global $wpdb;
		return substr( $wpdb->prefix . 'fair_events_payment_history_cutover', 0, 64 );
	}

	/**
	 * Take a named lock.
	 *
	 * @param string $lock Lock name.
	 * @return bool
	 */
	private static function acquire( $lock ) {
		global $wpdb;
		return '1' === (string) $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, %d)', $lock, self::LOCK_TIMEOUT ) );
	}

	/**
	 * Release named locks.
	 *
	 * @param string[] $locks Lock names.
	 * @return void
	 */
	private static function release( array $locks ) {
		global $wpdb;
		foreach ( array_reverse( $locks ) as $lock ) {
			$wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $lock ) );
		}
	}
}
