<?php
/**
 * Payment links: writes and reads
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Models\SignupPaymentLink;

defined( 'WPINC' ) || die;

/**
 * Writes and reads the Events-owned payment history of purchases
 * (PAYMENT_HISTORY_MIGRATION.md §5.1). Connector stays authoritative for each
 * transaction's total, currency and status; Events owns which purchase a
 * transaction belongs to and how much of it.
 *
 * Writes for one transaction are serialized with a named database lock, so
 * two writers can't both see room under the total and together exceed it.
 * A transaction's allocation set is written in one database transaction:
 * every link lands or none does. Links are never updated or deleted here, so
 * a backfill can't change a live or reconciled link.
 *
 * Nothing calls write() in stage 2 (#2138): the storage stays empty until
 * stage 3 turns on shadow writes, and existing readers keep using the
 * Audience ledger.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class PaymentLinks {

	/**
	 * Seconds a writer waits for another writer of the same transaction.
	 */
	const LOCK_TIMEOUT = 10;

	/**
	 * Add links to one Connector transaction, atomically.
	 *
	 * @param int   $transaction_id Connector transaction ID.
	 * @param array $links          Links; see PaymentLinkAllocation::prepare().
	 * @return array{inserted: int, unchanged: int, links: array[]}|\WP_Error Outcome, or why nothing was written.
	 */
	public static function write( $transaction_id, array $links ) {
		global $wpdb;

		$transaction_id = (int) $transaction_id;
		if ( ! self::acquire_lock( $transaction_id ) ) {
			return new \WP_Error( 'payment_links_busy', 'Another writer is recording links for this transaction.', array( 'transaction_id' => $transaction_id ) );
		}

		try {
			$wpdb->query( 'START TRANSACTION' );
			$result = self::write_in_transaction( $transaction_id, $links );
			if ( is_wp_error( $result ) ) {
				$wpdb->query( 'ROLLBACK' );
			} else {
				$wpdb->query( 'COMMIT' );
			}
			return $result;
		} finally {
			self::release_lock( $transaction_id );
		}
	}

	/**
	 * Add links inside a database transaction the caller opened, e.g. one
	 * that also creates the purchase and its units. The caller must hold
	 * acquire_lock() for the transaction until it commits or rolls back, and
	 * must roll back when this returns an error: links inserted before the
	 * failing one are then discarded with it.
	 *
	 * @param int   $transaction_id Connector transaction ID.
	 * @param array $links          Links; see PaymentLinkAllocation::prepare().
	 * @return array{inserted: int, unchanged: int, links: array[]}|\WP_Error Outcome, or why the set was refused.
	 */
	public static function write_in_transaction( $transaction_id, array $links ) {
		$transaction_id = (int) $transaction_id;

		if ( ! PaymentHistoryCompatibility::storage_available() ) {
			return new \WP_Error( 'payment_links_unavailable', 'Payment link storage is not installed yet.', array( 'transaction_id' => $transaction_id ) );
		}

		$transaction = self::read_transaction( $transaction_id );
		if ( is_wp_error( $transaction ) ) {
			return $transaction;
		}

		$plan = PaymentLinkAllocation::prepare( $links, $transaction, SignupPaymentLink::get_by_transaction_id( $transaction_id ) );
		if ( is_wp_error( $plan ) ) {
			return $plan;
		}

		$signup_ids = array_column( $plan['insert'], 'signup_id' );
		$missing    = array_values( array_diff( array_unique( $signup_ids ), SignupPaymentLink::existing_signup_ids( $signup_ids ) ) );
		if ( $missing ) {
			return new \WP_Error(
				'payment_link_unknown_purchase',
				'A link names a purchase that does not exist.',
				array(
					'transaction_id' => $transaction_id,
					'signup_ids'     => $missing,
				)
			);
		}

		foreach ( $plan['insert'] as $link ) {
			if ( ! SignupPaymentLink::insert( $link ) ) {
				return new \WP_Error(
					'payment_link_write_failed',
					'A link could not be stored; none of the set was written.',
					array(
						'transaction_id' => $transaction_id,
						'signup_id'      => $link['signup_id'],
						'role'           => $link['role'],
					)
				);
			}
		}

		return array(
			'inserted'  => count( $plan['insert'] ),
			'unchanged' => count( $plan['unchanged'] ),
			'links'     => SignupPaymentLink::get_by_transaction_id( $transaction_id ),
		);
	}

	/**
	 * A purchase's payment history with each transaction's Connector state.
	 *
	 * `payment_information` is `unavailable` when Connector can't be read:
	 * the links are still returned, with no transaction, and nothing about
	 * them may be read as zero revenue. When it is `available`, a link whose
	 * transaction was deleted in Connector has `transaction_missing` true and
	 * no transaction.
	 *
	 * @param int $signup_id Signup (purchase) ID.
	 * @return array{payment_information: string, links: array[]}
	 */
	public static function get_for_signup( $signup_id ) {
		$links = PaymentHistoryCompatibility::storage_available() ? SignupPaymentLink::get_by_signup_id( (int) $signup_id ) : array();

		if ( ! PaymentHistoryCompatibility::payment_information_available() ) {
			return array(
				'payment_information' => 'unavailable',
				'links'               => array_map(
					static function ( $link ) {
						return $link + array(
							'transaction'         => null,
							'transaction_missing' => false,
						);
					},
					$links
				),
			);
		}

		foreach ( $links as &$link ) {
			$transaction                 = \FairPaymentsConnector\Models\Transaction::get_by_id( (int) $link['transaction_id'] );
			$link['transaction']         = $transaction ? array(
				'status'   => (string) $transaction->status,
				'amount'   => (float) $transaction->amount,
				'currency' => (string) $transaction->currency,
			) : null;
			$link['transaction_missing'] = ! $transaction;
		}
		unset( $link );

		return array(
			'payment_information' => 'available',
			'links'               => $links,
		);
	}

	/**
	 * Take the named lock that serializes link writers of one transaction.
	 *
	 * @param int $transaction_id Connector transaction ID.
	 * @return bool True when the lock is held.
	 */
	public static function acquire_lock( $transaction_id ) {
		global $wpdb;
		return '1' === (string) $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, %d)', self::lock_name( $transaction_id ), self::LOCK_TIMEOUT ) );
	}

	/**
	 * Release the lock taken by acquire_lock().
	 *
	 * @param int $transaction_id Connector transaction ID.
	 * @return void
	 */
	public static function release_lock( $transaction_id ) {
		global $wpdb;
		$wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', self::lock_name( $transaction_id ) ) );
	}

	/**
	 * Name of a transaction's writer lock. Prefixed with the table prefix so
	 * sites sharing one database server don't block each other.
	 *
	 * @param int $transaction_id Connector transaction ID.
	 * @return string
	 */
	public static function lock_name( $transaction_id ) {
		global $wpdb;
		return substr( $wpdb->prefix . 'fair_events_payment_links_' . (int) $transaction_id, 0, 64 );
	}

	/**
	 * The Connector transaction's total, currency and creation time.
	 *
	 * @param int $transaction_id Connector transaction ID.
	 * @return array|\WP_Error Transaction fields, or why they can't be read.
	 */
	private static function read_transaction( $transaction_id ) {
		if ( ! PaymentHistoryCompatibility::payment_information_available() ) {
			return new \WP_Error( 'payment_information_unavailable', 'Payment information can\'t be read because Fair Payments Connector is inactive or not installed.', array( 'transaction_id' => $transaction_id ) );
		}

		$transaction = \FairPaymentsConnector\Models\Transaction::get_by_id( $transaction_id );
		if ( ! $transaction ) {
			return new \WP_Error( 'missing_transaction', 'The transaction does not exist in Fair Payments Connector.', array( 'transaction_id' => $transaction_id ) );
		}

		return array(
			'id'         => (int) $transaction->id,
			'amount'     => $transaction->amount,
			'currency'   => (string) $transaction->currency,
			'created_at' => (string) $transaction->created_at,
		);
	}
}
