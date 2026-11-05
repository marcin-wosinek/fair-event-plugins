<?php
/**
 * Payment attribution lookups against the site's database
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

defined( 'WPINC' ) || die;

/**
 * Reads the records PaymentAttribution needs. Fair Audience tables are read
 * directly, as EventTicketStatistics does, and only when they exist: with
 * Audience missing, nothing resolves through a relationship.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class PaymentAttributionDatabase implements PaymentAttributionSources {

	/**
	 * Whether each Audience table exists, cached per instance.
	 *
	 * @var array<string, bool>
	 */
	private $tables = array();

	/**
	 * A Connector transaction as PaymentAttribution reads it.
	 *
	 * @param int $transaction_id Connector transaction ID.
	 * @return array|null id, amount, currency, status, created_at, metadata, line_items; null when missing
	 *                    or Connector can't be read.
	 */
	public static function transaction( $transaction_id ) {
		if ( ! PaymentHistoryCompatibility::payment_information_available() ) {
			return null;
		}

		$transaction = \FairPaymentsConnector\Models\Transaction::get_by_id( (int) $transaction_id );
		if ( ! $transaction ) {
			return null;
		}

		$line_items = class_exists( \FairPaymentsConnector\Models\LineItem::class )
			? (array) \FairPaymentsConnector\Models\LineItem::get_by_transaction_id( (int) $transaction_id )
			: array();

		return array(
			'id'         => (int) $transaction->id,
			'amount'     => $transaction->amount,
			'currency'   => (string) $transaction->currency,
			'status'     => (string) $transaction->status,
			'created_at' => (string) $transaction->created_at,
			'metadata'   => self::decode_metadata( $transaction->metadata ?? null ),
			'line_items' => array_map(
				static function ( $line ) {
					return array(
						'name'         => (string) ( $line->name ?? '' ),
						'quantity'     => (int) ( $line->quantity ?? 1 ),
						'total_amount' => $line->total_amount ?? 0,
					);
				},
				$line_items
			),
		);
	}

	/**
	 * Metadata as an array, whether stored as JSON or already decoded.
	 *
	 * @param mixed $metadata Stored metadata.
	 * @return array
	 */
	public static function decode_metadata( $metadata ) {
		if ( is_array( $metadata ) ) {
			return $metadata;
		}
		if ( is_object( $metadata ) ) {
			return (array) json_decode( (string) wp_json_encode( $metadata ), true );
		}
		if ( is_string( $metadata ) && '' !== $metadata ) {
			$decoded = json_decode( $metadata, true );
			return is_array( $decoded ) ? $decoded : array();
		}
		return array();
	}

	/**
	 * {@inheritDoc}
	 *
	 * @param int[] $signup_ids Signup IDs.
	 * @return array
	 */
	public function signups( array $signup_ids ) {
		global $wpdb;

		$signup_ids = self::ids( $signup_ids );
		if ( ! $signup_ids ) {
			return array();
		}

		$rows = $wpdb->get_results(
			$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare -- generated %d list.
				'SELECT id, amount, event_date_id, participant_id, status FROM %i WHERE id IN ( ' . implode( ', ', array_fill( 0, count( $signup_ids ), '%d' ) ) . ' )',
				array_merge( array( $wpdb->prefix . 'fair_events_signups' ), $signup_ids )
			),
			ARRAY_A
		);

		$signups = array();
		foreach ( (array) $rows as $row ) {
			$signups[ (int) $row['id'] ] = array(
				'id'             => (int) $row['id'],
				'amount'         => (string) $row['amount'],
				'event_date_id'  => (int) $row['event_date_id'],
				'participant_id' => $row['participant_id'] ? (int) $row['participant_id'] : null,
				'status'         => (string) $row['status'],
			);
		}
		return $signups;
	}

	/**
	 * {@inheritDoc}
	 *
	 * @param int $transaction_id Connector transaction ID.
	 * @return int[]
	 */
	public function signup_ids_with_latest_transaction( $transaction_id ) {
		global $wpdb;

		return array_map(
			'intval',
			(array) $wpdb->get_col(
				$wpdb->prepare( 'SELECT id FROM %i WHERE transaction_id = %d ORDER BY id ASC', $wpdb->prefix . 'fair_events_signups', (int) $transaction_id )
			)
		);
	}

	/**
	 * {@inheritDoc}
	 *
	 * @param int $transaction_id Connector transaction ID.
	 * @return array[]
	 */
	public function ledger_rows( $transaction_id ) {
		global $wpdb;

		$table = $wpdb->prefix . 'fair_audience_event_participant_transactions';
		if ( ! $this->table_exists( $table ) ) {
			return array();
		}

		return array_map(
			static function ( $row ) {
				return array(
					'event_participant_id' => (int) $row['event_participant_id'],
					'kind'                 => (string) $row['kind'],
				);
			},
			(array) $wpdb->get_results(
				$wpdb->prepare( 'SELECT event_participant_id, kind FROM %i WHERE transaction_id = %d ORDER BY id ASC', $table, (int) $transaction_id ),
				ARRAY_A
			)
		);
	}

	/**
	 * {@inheritDoc}
	 *
	 * @param int[] $relationship_ids Relationship IDs.
	 * @return array
	 */
	public function relationships( array $relationship_ids ) {
		global $wpdb;

		$table            = $wpdb->prefix . 'fair_audience_event_participants';
		$relationship_ids = self::ids( $relationship_ids );
		if ( ! $relationship_ids || ! $this->table_exists( $table ) ) {
			return array();
		}

		$rows = $wpdb->get_results(
			$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare -- generated %d list.
				'SELECT id, participant_id, event_date_id, label FROM %i WHERE id IN ( ' . implode( ', ', array_fill( 0, count( $relationship_ids ), '%d' ) ) . ' )',
				array_merge( array( $table ), $relationship_ids )
			),
			ARRAY_A
		);

		$relationships = array();
		foreach ( (array) $rows as $row ) {
			$relationships[ (int) $row['id'] ] = array(
				'id'             => (int) $row['id'],
				'participant_id' => (int) $row['participant_id'],
				'event_date_id'  => (int) $row['event_date_id'],
				'label'          => (string) $row['label'],
			);
		}
		return $relationships;
	}

	/**
	 * {@inheritDoc}
	 *
	 * @param int $relationship_id Relationship ID.
	 * @return int|null
	 */
	public function purchase_for_relationship( $relationship_id ) {
		global $wpdb;

		$signup_id = $wpdb->get_var(
			$wpdb->prepare( 'SELECT id FROM %i WHERE legacy_event_participant_id = %d', $wpdb->prefix . 'fair_events_signups', (int) $relationship_id )
		);
		return $signup_id ? (int) $signup_id : null;
	}

	/**
	 * {@inheritDoc}
	 *
	 * @param int $event_date_id  Event date ID.
	 * @param int $participant_id Participant ID.
	 * @return int[]
	 */
	public function active_purchases( $event_date_id, $participant_id ) {
		global $wpdb;

		if ( (int) $participant_id <= 0 ) {
			return array();
		}

		return array_map(
			'intval',
			(array) $wpdb->get_col(
				$wpdb->prepare(
					"SELECT id FROM %i WHERE event_date_id = %d AND participant_id = %d
					AND ( status = 'confirmed' OR ( status = 'pending_payment' AND payment_expires_at IS NOT NULL AND payment_expires_at > %s ) )
					ORDER BY id ASC",
					$wpdb->prefix . 'fair_events_signups',
					(int) $event_date_id,
					(int) $participant_id,
					gmdate( 'Y-m-d H:i:s' )
				)
			)
		);
	}

	/**
	 * {@inheritDoc}
	 *
	 * @param int $ticket_id Ticket ID.
	 * @return int|null
	 */
	public function purchase_for_ticket( $ticket_id ) {
		global $wpdb;

		$signup_id = $wpdb->get_var(
			$wpdb->prepare( 'SELECT signup_id FROM %i WHERE id = %d', $wpdb->prefix . 'fair_events_tickets', (int) $ticket_id )
		);
		return $signup_id ? (int) $signup_id : null;
	}

	/**
	 * {@inheritDoc}
	 *
	 * @param int $transaction_id Connector transaction ID.
	 * @return array|null
	 */
	public function transaction_metadata( $transaction_id ) {
		$transaction = self::transaction( $transaction_id );
		return $transaction ? $transaction['metadata'] : null;
	}

	/**
	 * Whether a table exists, cached per instance.
	 *
	 * @param string $table Table name.
	 * @return bool
	 */
	private function table_exists( $table ) {
		global $wpdb;

		if ( ! isset( $this->tables[ $table ] ) ) {
			$this->tables[ $table ] = $table === $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( $table ) ) );
		}
		return $this->tables[ $table ];
	}

	/**
	 * Positive integer IDs.
	 *
	 * @param array $values Values.
	 * @return int[]
	 */
	private static function ids( array $values ) {
		return array_values( array_unique( array_filter( array_map( 'intval', $values ) ) ) );
	}
}
