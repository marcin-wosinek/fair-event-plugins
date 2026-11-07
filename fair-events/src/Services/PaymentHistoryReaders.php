<?php
/**
 * Payment history reader activation
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Models\PaymentHistoryAudit;
use FairEvents\Models\PaymentShadowWork;
use FairEvents\Models\SignupPaymentLink;

defined( 'WPINC' ) || die;

/**
 * The stage 5 reader activation (PAYMENT_HISTORY_MIGRATION.md §8.14):
 * Statistics, ticket counts and capacity read only what Fair Events owns
 * (ticket units, activities and payment links) instead of Fair Audience's
 * relationships, participant-scope activities and ledger.
 *
 * - A site with history from before the migration switches when an
 *   administrator does, on the Payment history page, after the stage 4
 *   activation and a verification that ran after it. activate() rechecks
 *   every blocker under the same locks as the stage 4 activation and
 *   records the activation with an audit entry.
 * - A site with no such history (no Fair Audience tables, every payment
 *   attempt linked by shadow writes) is recorded as activated the first
 *   time that is seen (maybe_activate_without_history()), with no
 *   migration and without Connector.
 * - The activation lives in its own option and nothing removes it: a
 *   missing plugin, a later verification failure or a new finding never
 *   restores the Audience readers. Recovery is forward repair (§8.5).
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class PaymentHistoryReaders {

	/**
	 * Option holding the reader activation.
	 */
	const OPTION = 'fair_events_payment_history_readers';

	/**
	 * Seconds activate() waits for each lock.
	 */
	const LOCK_TIMEOUT = 5;

	/**
	 * Fires after the activation committed, with the recorded activation.
	 */
	const ACTIVATED_HOOK = 'fair_events_payment_history_readers_activated';

	/**
	 * Activation reason: an administrator switched after verification.
	 */
	const REASON_VERIFIED = 'reader_cutover';

	/**
	 * Activation reason: the site had nothing to migrate.
	 */
	const REASON_NO_HISTORY = 'no_source_history';

	/**
	 * Record a site without source history on the shadow work cron.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( PaymentHistoryShadowWrites::CRON_HOOK, array( static::class, 'maybe_activate_without_history' ), 30 );
	}

	/**
	 * Whether the Events readers are in effect: an activation is recorded
	 * and the payment link storage exists.
	 *
	 * @return bool
	 */
	public static function active() {
		return null !== self::get_activation() && PaymentHistoryCompatibility::storage_available();
	}

	/**
	 * The recorded activation, or null when there is none.
	 *
	 * @return array|null activated_at, reason, user_id, reference, audit_id.
	 */
	public static function get_activation() {
		$activation = get_option( self::OPTION, null );
		return is_array( $activation ) && ! empty( $activation['activated_at'] ) ? $activation : null;
	}

	/**
	 * Everything the activation depends on, read from the site now.
	 *
	 * @return array storage, ownership_cutover, cutover_activated_at,
	 *               verified, verification_checked_at, payment_information,
	 *               outstanding_work, relationship_admissions.
	 */
	public static function facts() {
		$storage  = PaymentHistoryCompatibility::reconciliation_available();
		$cutover  = PaymentHistoryCompatibility::get_cutover();
		$backfill = $storage ? PaymentHistoryBackfill::get_run( PaymentHistoryBackfill::MODE_BACKFILL ) : null;

		return array(
			'storage'                 => $storage,
			'ownership_cutover'       => PaymentHistoryCompatibility::ownership_cutover(),
			'cutover_activated_at'    => $cutover ? (string) $cutover['activated_at'] : null,
			'verified'                => PaymentHistoryCompatibility::migration_verified(),
			'verification_checked_at' => $backfill ? (string) ( $backfill['verification']['checked_at'] ?? '' ) : null,
			'payment_information'     => PaymentHistoryCompatibility::payment_information_available(),
			'outstanding_work'        => $storage ? PaymentShadowWork::count_outstanding() : array(),
			'relationship_admissions' => $storage ? self::relationship_admission_dates() : array(),
		);
	}

	/**
	 * What stops the activation, given the site's facts; empty when it can
	 * run.
	 *
	 * @param array $facts From facts().
	 * @return string[] Codes: storage_unavailable, ownership_cutover_inactive,
	 *                  migration_unverified, verification_before_cutover,
	 *                  payment_information_unavailable, shadow_work_outstanding,
	 *                  relationship_admissions.
	 */
	public static function blockers( array $facts ) {
		$blockers = array();
		if ( empty( $facts['storage'] ) ) {
			$blockers[] = 'storage_unavailable';
		}
		if ( empty( $facts['ownership_cutover'] ) ) {
			$blockers[] = 'ownership_cutover_inactive';
		}
		if ( empty( $facts['verified'] ) ) {
			$blockers[] = 'migration_unverified';
		} elseif ( ! empty( $facts['cutover_activated_at'] )
			&& (string) ( $facts['verification_checked_at'] ?? '' ) < (string) $facts['cutover_activated_at']
		) {
			// The comparisons must describe the history the stage 4
			// lifecycle wrote, not only what the backfill found before it.
			$blockers[] = 'verification_before_cutover';
		}
		if ( empty( $facts['payment_information'] ) ) {
			$blockers[] = 'payment_information_unavailable';
		}
		if ( ! empty( $facts['outstanding_work'] ) ) {
			$blockers[] = 'shadow_work_outstanding';
		}
		if ( ! empty( $facts['relationship_admissions'] ) ) {
			$blockers[] = 'relationship_admissions';
		}
		return $blockers;
	}

	/**
	 * The activation's state for administrators.
	 *
	 * @return array active, activation (with user_name), blockers (before the
	 *               activation), relationship_admissions (event date IDs).
	 */
	public static function status() {
		$activation = self::get_activation();
		$facts      = $activation ? null : self::facts();

		if ( $activation ) {
			$user                    = get_userdata( (int) ( $activation['user_id'] ?? 0 ) );
			$activation['user_name'] = $user ? (string) $user->display_name : null;
		}

		return array(
			'active'                  => self::active(),
			'activation'              => $activation,
			'blockers'                => $facts ? self::blockers( $facts ) : array(),
			'relationship_admissions' => $facts ? $facts['relationship_admissions'] : array(),
		);
	}

	/**
	 * Stored event dates where today's Statistics counts a signed-up Fair
	 * Audience relationship with no Events purchase behind it: admissions
	 * the Events readers would no longer count (§8.14). A relationship
	 * reported as `duplicate_series_relationship` is explained: its
	 * whole-series pass already counts there.
	 *
	 * @param int $limit Most dates returned.
	 * @return int[] Event date IDs, ascending.
	 */
	public static function relationship_admission_dates( $limit = 100 ) {
		global $wpdb;

		if ( ! ShadowPurchases::audience_tables_exist() ) {
			return array();
		}

		$signups = $wpdb->prefix . 'fair_events_signups';
		return array_map(
			'intval',
			(array) $wpdb->get_col(
				$wpdb->prepare(
					"SELECT DISTINCT ep.event_date_id FROM %i AS ep
					WHERE ep.label = 'signed_up'
					AND NOT EXISTS (
						SELECT 1 FROM %i AS s WHERE s.participant_id = ep.participant_id
						AND ( s.event_date_id = ep.event_date_id OR ( ep.ticket_type_id IS NOT NULL AND s.ticket_type_id = ep.ticket_type_id ) )
					)
					AND NOT EXISTS ( SELECT 1 FROM %i AS bp WHERE bp.legacy_event_participant_id = ep.id )
					AND NOT EXISTS (
						SELECT 1 FROM %i AS f WHERE f.mode = %s AND f.reason = 'duplicate_series_relationship'
						AND f.source_type = %s AND f.source_id = ep.id
					)
					ORDER BY ep.event_date_id ASC LIMIT %d",
					$wpdb->prefix . 'fair_audience_event_participants',
					$signups,
					$signups,
					\FairEvents\Models\PaymentHistoryFinding::table(),
					\FairEvents\Models\PaymentHistoryFinding::MODE_BACKFILL,
					\FairEvents\Models\PaymentHistoryFinding::SOURCE_RELATIONSHIP,
					max( 1, (int) $limit )
				)
			)
		);
	}

	/**
	 * Whether the site has no payment history from before the migration:
	 * Fair Audience's tables don't exist, shadow writes cover the live
	 * writers, and every purchase with a payment attempt has a payment link.
	 * Such a site has nothing to migrate, so the Events readers apply from
	 * the start.
	 *
	 * @return bool
	 */
	public static function without_source_history() {
		global $wpdb;

		if ( class_exists( \FairAudience\Database\EventParticipantRepository::class )
			|| ! PaymentHistoryCompatibility::storage_available()
			|| ShadowPurchases::audience_tables_exist()
			|| ! PaymentHistoryCompatibility::shadow_write_coverage()
		) {
			return false;
		}

		return ! $wpdb->get_var(
			$wpdb->prepare(
				'SELECT 1 FROM %i AS s WHERE s.transaction_id IS NOT NULL AND s.transaction_id > 0
				AND NOT EXISTS ( SELECT 1 FROM %i AS lk WHERE lk.signup_id = s.id ) LIMIT 1',
				$wpdb->prefix . 'fair_events_signups',
				SignupPaymentLink::table()
			)
		);
	}

	/**
	 * Record the activation for a site without source history, once. Runs
	 * on the shadow work cron and when Statistics checks its availability.
	 *
	 * @return bool Whether the Events readers are active afterwards.
	 */
	public static function maybe_activate_without_history() {
		if ( self::get_activation() ) {
			return self::active();
		}
		if ( ! self::without_source_history() ) {
			return false;
		}

		$record = array(
			'activated_at' => gmdate( 'Y-m-d H:i:s' ),
			'reason'       => self::REASON_NO_HISTORY,
			'user_id'      => 0,
			'reference'    => null,
		);
		if ( ! add_option( self::OPTION, $record, '', true ) ) {
			// Another request recorded it first.
			wp_cache_delete( self::OPTION, 'options' );
			return self::active();
		}
		do_action( self::ACTIVATED_HOOK, $record );
		return true;
	}

	/**
	 * The activation as an administrator records it.
	 *
	 * @param array  $facts   From facts(), rechecked under the locks.
	 * @param array  $summary PaymentHistoryVerification::summary().
	 * @param int    $user_id Administrator.
	 * @param string $now     UTC time, `Y-m-d H:i:s`.
	 * @return array
	 */
	public static function record( array $facts, array $summary, $user_id, $now ) {
		return array(
			'activated_at' => $now,
			'reason'       => self::REASON_VERIFIED,
			'user_id'      => (int) $user_id,
			'reference'    => 'backfill-verification:' . (string) ( $facts['verification_checked_at'] ?? '' ),
			'verification' => array(
				'checked_at'           => (string) ( $facts['verification_checked_at'] ?? '' ),
				'rechecked_at'         => $now,
				'cutover_activated_at' => (string) ( $facts['cutover_activated_at'] ?? '' ),
				'comparisons'          => $summary,
			),
		);
	}

	/**
	 * Switch Statistics, ticket counts and capacity to the Events readers.
	 *
	 * @param array $args user_id (int).
	 * @return array|\WP_Error The recorded activation, or why it was refused:
	 *                         readers_active, readers_blocked (with `blockers`),
	 *                         readers_busy, verification_stale (with
	 *                         `verification_blockers`), readers_failed.
	 */
	public static function activate( array $args = array() ) {
		if ( self::get_activation() ) {
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
				return new \WP_Error( 'readers_busy', 'The payment history migration is busy. Try again in a moment.' );
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
	 * Body of activate(), holding both locks.
	 *
	 * @param int $user_id Administrator.
	 * @return array|\WP_Error
	 */
	private static function activate_locked( $user_id ) {
		global $wpdb;

		PaymentHistoryCompatibility::reset_cache();
		wp_cache_delete( PaymentHistoryCompatibility::STATE_OPTION, 'options' );
		wp_cache_delete( self::OPTION, 'options' );
		if ( self::stored_activation() ) {
			return self::already_active();
		}
		$facts   = self::facts();
		$refused = self::refuse( $facts );
		if ( $refused ) {
			return $refused;
		}

		$backfill = PaymentHistoryBackfill::get_run( PaymentHistoryBackfill::MODE_BACKFILL );
		$checks   = PaymentHistoryVerification::global_checks( (int) ( $backfill['cutoffs']['transaction_id'] ?? 0 ) );
		if ( $checks ) {
			return new \WP_Error(
				'verification_stale',
				'The verification no longer passes. Verify the migration again before switching statistics.',
				array( 'verification_blockers' => array_keys( $checks ) )
			);
		}

		$record = self::record( $facts, PaymentHistoryVerification::summary(), $user_id, gmdate( 'Y-m-d H:i:s' ) );

		$wpdb->query( 'START TRANSACTION' );
		$audit_id = PaymentHistoryAudit::append(
			array(
				'action'  => PaymentHistoryAudit::ACTION_ACTIVATE,
				'reason'  => self::REASON_VERIFIED,
				'user_id' => $user_id,
				'note'    => '',
				'before'  => array( 'readers' => null ),
				'after'   => array( 'readers' => $record ),
			)
		);
		if ( ! $audit_id ) {
			$wpdb->query( 'ROLLBACK' );
			return self::failed();
		}
		$record['audit_id'] = $audit_id;
		if ( ! update_option( self::OPTION, $record, true ) ) {
			$wpdb->query( 'ROLLBACK' );
			wp_cache_delete( self::OPTION, 'options' );
			wp_cache_delete( 'alloptions', 'options' );
			return self::failed();
		}
		$wpdb->query( 'COMMIT' );

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
		return new \WP_Error( 'readers_blocked', 'Statistics can\'t switch to Fair Events records on this site yet.', array( 'blockers' => $blockers ) );
	}

	/**
	 * Whether an activation is stored now, bypassing the options cache.
	 *
	 * @return bool
	 */
	private static function stored_activation() {
		global $wpdb;
		$value = $wpdb->get_var( $wpdb->prepare( 'SELECT option_value FROM %i WHERE option_name = %s', $wpdb->options, self::OPTION ) );
		if ( null === $value ) {
			return false;
		}
		$stored = maybe_unserialize( $value );
		return is_array( $stored ) && ! empty( $stored['activated_at'] );
	}

	/**
	 * Refusal: the readers are already active.
	 *
	 * @return \WP_Error
	 */
	private static function already_active() {
		return new \WP_Error( 'readers_active', 'Statistics already use Fair Events records.' );
	}

	/**
	 * Refusal: the activation couldn't be stored; nothing changed.
	 *
	 * @return \WP_Error
	 */
	private static function failed() {
		return new \WP_Error( 'readers_failed', 'The switch couldn\'t be recorded. Nothing changed; try again.' );
	}

	/**
	 * Named lock serializing activations.
	 *
	 * @return string
	 */
	private static function lock_name() {
		global $wpdb;
		return substr( $wpdb->prefix . 'fair_events_payment_history_readers', 0, 64 );
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
