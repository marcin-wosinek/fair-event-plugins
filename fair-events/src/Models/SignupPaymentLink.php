<?php
/**
 * Signup payment link storage
 *
 * @package FairEvents
 */

namespace FairEvents\Models;

defined( 'WPINC' ) || die;

/**
 * Rows of fair_events_signup_payment_links: which Connector transactions
 * belong to which purchase, with what role and allocation
 * (PAYMENT_HISTORY_MIGRATION.md §5.1).
 *
 * Rows are only ever inserted, never updated, so a later writer can never
 * change a link another one recorded. Write through
 * \FairEvents\Services\PaymentLinks, which validates a transaction's
 * allocation set and serializes writers. The one deletion is an
 * administrator removing a link they reconciled
 * (\FairEvents\Services\PaymentHistoryReconciliation, §6.3):
 * delete_reconciled() refuses every other attribution.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class SignupPaymentLink {

	/**
	 * Purchase price.
	 */
	const ROLE_CHARGE = 'charge';

	/**
	 * Activities added to a purchase later.
	 */
	const ROLE_ADDITIONAL_CHARGE = 'additional_charge';

	/**
	 * Series upgrade of a purchase.
	 */
	const ROLE_UPGRADE = 'upgrade';

	/**
	 * Refund-labelled Audience ledger row preserved as is; never revenue.
	 */
	const ROLE_LEGACY_REFUND_RECORD = 'legacy_refund_record';

	/**
	 * Written by the payment lifecycle.
	 */
	const ATTRIBUTION_LIVE = 'live';

	/**
	 * Written by the historical backfill from deterministic evidence.
	 */
	const ATTRIBUTION_BACKFILL = 'backfill';

	/**
	 * Written by an administrator during reconciliation.
	 */
	const ATTRIBUTION_RECONCILED = 'reconciled';

	/**
	 * Every role a link can have.
	 *
	 * @return string[]
	 */
	public static function roles() {
		return array( self::ROLE_CHARGE, self::ROLE_ADDITIONAL_CHARGE, self::ROLE_UPGRADE, self::ROLE_LEGACY_REFUND_RECORD );
	}

	/**
	 * Every attribution a link can have.
	 *
	 * @return string[]
	 */
	public static function attributions() {
		return array( self::ATTRIBUTION_LIVE, self::ATTRIBUTION_BACKFILL, self::ATTRIBUTION_RECONCILED );
	}

	/**
	 * Table name.
	 *
	 * @return string
	 */
	public static function table() {
		global $wpdb;
		return $wpdb->prefix . 'fair_events_signup_payment_links';
	}

	/**
	 * Links of one transaction, oldest first.
	 *
	 * @param int $transaction_id Connector transaction ID.
	 * @return array[] Rows as associative arrays.
	 */
	public static function get_by_transaction_id( $transaction_id ) {
		global $wpdb;

		return (array) $wpdb->get_results(
			$wpdb->prepare( 'SELECT * FROM %i WHERE transaction_id = %d ORDER BY id ASC', self::table(), (int) $transaction_id ),
			ARRAY_A
		);
	}

	/**
	 * Links of one purchase, in the order the attempts were created.
	 *
	 * @param int $signup_id Signup (purchase) ID.
	 * @return array[] Rows as associative arrays.
	 */
	public static function get_by_signup_id( $signup_id ) {
		global $wpdb;

		return (array) $wpdb->get_results(
			$wpdb->prepare( 'SELECT * FROM %i WHERE signup_id = %d ORDER BY created_at ASC, id ASC', self::table(), (int) $signup_id ),
			ARRAY_A
		);
	}

	/**
	 * Insert one validated link. Callers run it inside the transaction
	 * PaymentLinks opened; a duplicate (signup, transaction, role) fails on
	 * the unique key instead of overwriting.
	 *
	 * @param array $link Normalized link from PaymentLinkAllocation::prepare().
	 * @return bool True when the row was inserted.
	 */
	public static function insert( array $link ) {
		global $wpdb;

		return 1 === $wpdb->insert(
			self::table(),
			array(
				'signup_id'        => (int) $link['signup_id'],
				'transaction_id'   => (int) $link['transaction_id'],
				'role'             => (string) $link['role'],
				'allocated_amount' => number_format( (float) $link['allocated_amount'], 2, '.', '' ),
				'currency'         => (string) $link['currency'],
				'attribution'      => (string) $link['attribution'],
				'evidence'         => (string) $link['evidence'],
				'created_at'       => (string) $link['created_at'],
			),
			array( '%d', '%d', '%s', '%s', '%s', '%s', '%s', '%s' )
		);
	}

	/**
	 * One link.
	 *
	 * @param int $id Link ID.
	 * @return array|null Row as an associative array.
	 */
	public static function get( $id ) {
		global $wpdb;

		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM %i WHERE id = %d', self::table(), (int) $id ), ARRAY_A );
		return $row ? $row : null;
	}

	/**
	 * Delete a link an administrator reconciled. Live and backfilled links
	 * are never deleted. Callers hold the transaction's writer lock.
	 *
	 * @param int $id Link ID.
	 * @return bool True when a reconciled link was deleted.
	 */
	public static function delete_reconciled( $id ) {
		global $wpdb;

		return 1 === (int) $wpdb->query(
			$wpdb->prepare( 'DELETE FROM %i WHERE id = %d AND attribution = %s', self::table(), (int) $id, self::ATTRIBUTION_RECONCILED )
		);
	}

	/**
	 * Which of the given signup IDs exist.
	 *
	 * @param int[] $signup_ids Signup IDs.
	 * @return int[] Existing IDs.
	 */
	public static function existing_signup_ids( array $signup_ids ) {
		global $wpdb;

		$signup_ids = array_values( array_unique( array_filter( array_map( 'intval', $signup_ids ) ) ) );
		if ( ! $signup_ids ) {
			return array();
		}

		return array_map(
			'intval',
			(array) $wpdb->get_col(
				$wpdb->prepare(
					// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare -- generated %d list.
					'SELECT id FROM %i WHERE id IN ( ' . implode( ', ', array_fill( 0, count( $signup_ids ), '%d' ) ) . ' )',
					array_merge( array( $wpdb->prefix . 'fair_events_signups' ), $signup_ids )
				)
			)
		);
	}
}
