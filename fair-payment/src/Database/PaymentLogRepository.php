<?php
/**
 * Payment Log Repository
 *
 * @package FairPayment
 */

namespace FairPayment\Database;

use FairPayment\Models\PaymentLog;

defined( 'WPINC' ) || die;

/**
 * Repository for payment log entries.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class PaymentLogRepository {

	/**
	 * Cached per-request ID, generated once per HTTP request.
	 *
	 * @var string|null
	 */
	private static $request_id;

	/**
	 * Get table name.
	 *
	 * @return string Table name.
	 */
	private function get_table_name() {
		return Schema::get_log_table_name();
	}

	/**
	 * Return (and lazily generate) the per-request UUID.
	 *
	 * All log rows written within the same HTTP request share this ID, so the
	 * admin UI can group a chain of events (request_started -> mollie_call_failed)
	 * even when several customers are paying simultaneously.
	 *
	 * @return string UUID v4.
	 */
	public static function current_request_id() {
		if ( null === self::$request_id ) {
			self::$request_id = wp_generate_uuid4();
		}
		return self::$request_id;
	}

	/**
	 * Reset the per-request ID. For tests only.
	 *
	 * @return void
	 */
	public static function reset_request_id() {
		self::$request_id = null;
	}

	/**
	 * Log an event.
	 *
	 * Auto-fills user_id, ip_address, and request_id. Mirrors error-level rows
	 * to PHP error_log so server-side log aggregation also picks them up.
	 *
	 * @param string $event Event name from the taxonomy.
	 * @param array  $args  {
	 *     Optional event details.
	 *     @type int|null   $transaction_id Transaction ID (nullable).
	 *     @type string     $level          info|warning|error. Default 'info'.
	 *     @type string     $message        Short human message.
	 *     @type array|null $context        Extra structured data, JSON-encoded on save.
	 * }
	 * @return bool True on success.
	 */
	public function log( $event, $args = array() ) {
		$defaults = array(
			'transaction_id' => null,
			'level'          => 'info',
			'message'        => null,
			'context'        => null,
		);

		$args = wp_parse_args( $args, $defaults );

		$context_json = null;
		if ( null !== $args['context'] ) {
			$context_json = is_string( $args['context'] )
				? $args['context']
				: wp_json_encode( $args['context'] );
		}

		$user_id = get_current_user_id();
		if ( ! $user_id ) {
			$user_id = null;
		}

		$log = new PaymentLog();
		$log->populate(
			array(
				'transaction_id' => $args['transaction_id'],
				'level'          => $args['level'],
				'event'          => $event,
				'message'        => $args['message'],
				'context'        => $context_json,
				'user_id'        => $user_id,
				'ip_address'     => $this->get_client_ip(),
				'request_id'     => self::current_request_id(),
			)
		);

		$saved = $log->save();

		if ( 'error' === $args['level'] ) {
			$message = $args['message'] ? $args['message'] : '';
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			error_log(
				sprintf(
					'[Fair Payment][%s][req:%s] %s',
					$event,
					self::current_request_id(),
					$message
				)
			);
		}

		return $saved;
	}

	/**
	 * Get all log entries for a transaction, oldest first (chronological flow).
	 *
	 * @param int $transaction_id Transaction ID.
	 * @return array Array of PaymentLog objects.
	 */
	public function get_by_transaction_id( $transaction_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE transaction_id = %d ORDER BY id ASC',
				$table_name,
				$transaction_id
			),
			ARRAY_A
		);

		return $this->hydrate( $results );
	}

	/**
	 * Get recent log entries with optional filters.
	 *
	 * @param array $args {
	 *     Optional filters.
	 *     @type string $level   Exact level match (info|warning|error).
	 *     @type string $event   Exact event name match.
	 *     @type int    $limit   Maximum rows. Default 100.
	 *     @type int    $offset  Pagination offset. Default 0.
	 * }
	 * @return array Array of PaymentLog objects.
	 */
	public function get_recent( $args = array() ) {
		global $wpdb;

		$defaults = array(
			'level'  => '',
			'event'  => '',
			'limit'  => 100,
			'offset' => 0,
		);

		$args = wp_parse_args( $args, $defaults );

		$where_clauses = array();
		if ( ! empty( $args['level'] ) ) {
			$where_clauses[] = $wpdb->prepare( 'level = %s', $args['level'] );
		}
		if ( ! empty( $args['event'] ) ) {
			$where_clauses[] = $wpdb->prepare( 'event = %s', $args['event'] );
		}

		$where = '';
		if ( ! empty( $where_clauses ) ) {
			$where = ' WHERE ' . implode( ' AND ', $where_clauses );
		}

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $where joins clauses already individually prepared above.
				"SELECT * FROM %i{$where} ORDER BY id DESC LIMIT %d OFFSET %d",
				$table_name,
				(int) $args['limit'],
				(int) $args['offset']
			),
			ARRAY_A
		);

		return $this->hydrate( $results );
	}

	/**
	 * Hydrate raw rows into PaymentLog objects.
	 *
	 * @param array|null $rows Raw rows from $wpdb->get_results.
	 * @return array
	 */
	private function hydrate( $rows ) {
		if ( empty( $rows ) ) {
			return array();
		}

		$logs = array();
		foreach ( $rows as $row ) {
			$logs[] = new PaymentLog( $row );
		}
		return $logs;
	}

	/**
	 * Best-effort client IP capture. Trusts REMOTE_ADDR only.
	 *
	 * @return string|null
	 */
	private function get_client_ip() {
		if ( empty( $_SERVER['REMOTE_ADDR'] ) ) {
			return null;
		}
		// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotValidated, WordPress.Security.ValidatedSanitizedInput.MissingUnslash
		$ip = sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) );
		return $ip ? $ip : null;
	}
}
