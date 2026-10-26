<?php
/**
 * Payment Log Repository
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Database;

use FairPaymentsConnector\Models\PaymentLog;

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
	 * Context fields kept on new log rows, mapped to the value type each must
	 * have. Any other field, and any value of the wrong type, is dropped, so
	 * descriptions, URLs, credentials and raw exception text never reach the
	 * log.
	 */
	const CONTEXT_FIELDS = array(
		'transaction_id'         => 'id',
		'deleted_transaction_id' => 'id',
		'post_id'                => 'id',
		'event_date_id'          => 'id',
		'user_id'                => 'id',
		'participant_id'         => 'id',
		'amount'                 => 'amount',
		'currency'               => 'currency',
		'status'                 => 'code',
		'old_status'             => 'code',
		'new_status'             => 'code',
		'mollie_status'          => 'code',
		'reason'                 => 'code',
		'error_code'             => 'code',
		'credential_status'      => 'code',
		'mollie_payment_id'      => 'mollie_id',
		'exception_class'        => 'class',
		'testmode'               => 'bool',
		'has_profile'            => 'bool',
	);

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
	 * Auto-fills user_id and request_id. The client IP is not recorded. Context
	 * is reduced to the fields in CONTEXT_FIELDS. When WP_DEBUG is on,
	 * error-level rows are mirrored to PHP error_log so server-side log
	 * aggregation also picks them up; callers keep messages free of raw
	 * exception text, so the mirror only ever receives fixed messages.
	 *
	 * @param string $event Event name from the taxonomy.
	 * @param array  $args  {
	 *     Optional event details.
	 *     @type int|null   $transaction_id Transaction ID (nullable).
	 *     @type string     $level          info|warning|error. Default 'info'.
	 *     @type string     $message        Short human message.
	 *     @type array|null $context        Diagnostic fields from CONTEXT_FIELDS, JSON-encoded on save.
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

		$context      = self::sanitize_context( $args['context'] );
		$context_json = null === $context ? null : wp_json_encode( $context );

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
				'ip_address'     => null,
				'request_id'     => self::current_request_id(),
			)
		);

		$saved = $log->save();

		if ( 'error' === $args['level'] && defined( 'WP_DEBUG' ) && WP_DEBUG ) {
			$message = $args['message'] ? $args['message'] : '';
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			error_log(
				sprintf(
					'[Fair Payments Connector][%s][req:%s] %s',
					$event,
					self::current_request_id(),
					$message
				)
			);
		}

		return $saved;
	}

	/**
	 * Reduce a context array to the allowlisted diagnostic fields.
	 *
	 * Unknown fields, nested arrays, opaque strings (including pre-encoded
	 * JSON) and values of the wrong type are dropped.
	 *
	 * @param mixed $context Context passed to log().
	 * @return array|null Allowed fields, or null when none remain.
	 */
	public static function sanitize_context( $context ) {
		if ( ! is_array( $context ) ) {
			return null;
		}

		$clean = array();
		foreach ( $context as $field => $value ) {
			if ( ! isset( self::CONTEXT_FIELDS[ $field ] ) ) {
				continue;
			}
			$value = self::sanitize_context_value( $value, self::CONTEXT_FIELDS[ $field ] );
			if ( null !== $value ) {
				$clean[ $field ] = $value;
			}
		}

		return empty( $clean ) ? null : $clean;
	}

	/**
	 * Validate one context value against its type.
	 *
	 * @param mixed  $value Raw value.
	 * @param string $type  Type from CONTEXT_FIELDS.
	 * @return mixed Normalized value, or null when it does not match.
	 */
	private static function sanitize_context_value( $value, $type ) {
		switch ( $type ) {
			case 'id':
				if ( is_int( $value ) && $value > 0 ) {
					return $value;
				}
				if ( is_string( $value ) && preg_match( '/^[1-9][0-9]{0,18}$/', $value ) ) {
					return (int) $value;
				}
				return null;

			case 'amount':
				if ( is_int( $value ) || ( is_float( $value ) && is_finite( $value ) ) ) {
					return $value;
				}
				if ( is_string( $value ) && preg_match( '/^-?[0-9]{1,15}(\.[0-9]{1,6})?$/', $value ) ) {
					return (float) $value;
				}
				return null;

			case 'currency':
				return is_string( $value ) && preg_match( '/^[A-Z]{3}$/', $value ) ? $value : null;

			case 'code':
				return is_string( $value ) && preg_match( '/^[a-z0-9_]{1,64}$/', $value ) ? $value : null;

			case 'mollie_id':
				return is_string( $value ) && preg_match( '/^[A-Za-z0-9_]{1,64}$/', $value ) ? $value : null;

			case 'class':
				return is_string( $value ) && preg_match( '/^[A-Za-z_][A-Za-z0-9_\\\\]{0,190}$/', $value ) ? $value : null;

			case 'bool':
				return is_bool( $value ) ? $value : null;
		}

		return null;
	}

	/**
	 * Delete one bounded batch of log rows older than the retention window.
	 *
	 * The cutoff is computed by the database from its own clock, the same
	 * clock that fills created_at through CURRENT_TIMESTAMP, so the site's
	 * timezone setting cannot shift it. A row exactly at the cutoff is kept.
	 * Rows go oldest first, and at most $limit of them, so a large backlog is
	 * cleared over several runs. Nothing is written to the payment log.
	 *
	 * @param int $days  Retention window in days.
	 * @param int $limit Maximum rows to delete.
	 * @return int|false Number of rows deleted, or false on a database error.
	 */
	public function prune_older_than( $days, $limit ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		return $wpdb->query(
			$wpdb->prepare(
				'DELETE FROM %i WHERE created_at < DATE_SUB( CURRENT_TIMESTAMP, INTERVAL %d DAY ) ORDER BY created_at ASC, id ASC LIMIT %d',
				$table_name,
				(int) $days,
				(int) $limit
			)
		);
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
}
