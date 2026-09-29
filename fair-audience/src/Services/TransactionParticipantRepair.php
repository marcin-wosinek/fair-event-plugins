<?php
/**
 * Transaction Participant Repair
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

defined( 'WPINC' ) || die;

/**
 * Links get-tickets transactions created before their participant link was
 * written at purchase time, only where the persisted signups make it
 * unambiguous.
 *
 * Each get-tickets transaction recorded before the repair started is
 * examined once, in ID order: the signups its metadata names (or, for the
 * oldest ones, the signup still pointing at it) must all carry the same
 * participant. Retries are included, since their metadata still names the
 * signups after those moved on to a newer transaction. The empty participant
 * link and missing ledger rows are then filled; a transaction linked or
 * recorded to another participant, or whose signups name none or several,
 * is skipped and counted. Email addresses are never consulted.
 *
 * Restartable and idempotent: progress is the last examined transaction
 * ID, saved after every batch, and linking never overwrites a link.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class TransactionParticipantRepair {

	/**
	 * Option holding the cutoff, progress and counts.
	 */
	const STATE_OPTION = 'fair_audience_transaction_participant_repair';

	/**
	 * Transactions examined per request.
	 */
	const BATCH_SIZE = 100;

	/**
	 * Run one batch unless the repair is finished or its tables are missing.
	 *
	 * @return void
	 */
	public static function maybe_run() {
		$state = get_option( self::STATE_OPTION );
		if ( ( is_array( $state ) && ! empty( $state['done_at'] ) ) || ! TransactionParticipantLink::available() ) {
			return;
		}

		self::run_batch( self::BATCH_SIZE );
	}

	/**
	 * Examine up to $limit transactions not examined yet.
	 *
	 * @param int $limit Maximum transactions to examine.
	 * @return array Repair state: cutoff, cursor, repaired, skipped, done_at.
	 */
	public static function run_batch( $limit ) {
		global $wpdb;

		$table = \FairPaymentsConnector\Database\Schema::get_payments_table_name();
		$state = get_option( self::STATE_OPTION );
		if ( ! is_array( $state ) ) {
			// Transactions created from now on are linked at purchase time.
			$state = array(
				'cutoff'   => (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COALESCE(MAX(id), 0) FROM %i', $table ) ),
				'cursor'   => 0,
				'repaired' => 0,
				'skipped'  => 0,
				'done_at'  => null,
			);
		}

		$transactions = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT id, participant_id, metadata FROM %i
				 WHERE id > %d AND id <= %d AND metadata LIKE %s
				 ORDER BY id ASC
				 LIMIT %d',
				$table,
				(int) $state['cursor'],
				(int) $state['cutoff'],
				'%' . $wpdb->esc_like( '"source":"fair-events-get-tickets"' ) . '%',
				(int) $limit
			)
		);

		foreach ( $transactions as $transaction ) {
			$result = TransactionParticipantLink::link( (int) $transaction->id, self::signup_ids( $transaction ) );
			if ( TransactionParticipantLink::LINKED === $result ) {
				if ( empty( $transaction->participant_id ) ) {
					++$state['repaired'];
				}
			} else {
				++$state['skipped'];
			}
			$state['cursor'] = (int) $transaction->id;
		}

		if ( count( $transactions ) < (int) $limit ) {
			$state['done_at'] = gmdate( 'Y-m-d H:i:s' );
		}

		update_option( self::STATE_OPTION, $state );

		return $state;
	}

	/**
	 * The signups a transaction was created for, as its metadata names
	 * them, regardless of whether they have since moved to a retry.
	 *
	 * @param object $transaction Transaction row (id, metadata).
	 * @return int[]
	 */
	private static function signup_ids( $transaction ) {
		$metadata = json_decode( (string) $transaction->metadata, true );
		if ( ! is_array( $metadata ) ) {
			return array();
		}

		if ( ! empty( $metadata['signup_ids'] ) && is_array( $metadata['signup_ids'] ) ) {
			return array_map( 'intval', $metadata['signup_ids'] );
		}

		if ( ! empty( $metadata['signup_id'] ) ) {
			return array( (int) $metadata['signup_id'] );
		}

		$signup = \FairEvents\Models\EventSignup::get_by_transaction_id( (int) $transaction->id );
		return $signup ? array( (int) $signup->id ) : array();
	}
}
