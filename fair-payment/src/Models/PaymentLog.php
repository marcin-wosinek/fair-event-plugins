<?php
/**
 * Payment Log Model
 *
 * @package FairPayment
 */

namespace FairPayment\Models;

defined( 'WPINC' ) || die;

/**
 * Payment log model (insert-only).
 */
class PaymentLog {

	/**
	 * Log entry ID.
	 *
	 * @var int|null
	 */
	public $id;

	/**
	 * Transaction ID (nullable - some events fire before a transaction exists).
	 *
	 * @var int|null
	 */
	public $transaction_id;

	/**
	 * Severity level: info|warning|error.
	 *
	 * @var string
	 */
	public $level;

	/**
	 * Event name (e.g. mollie_call_failed).
	 *
	 * @var string
	 */
	public $event;

	/**
	 * Short human-readable message.
	 *
	 * @var string|null
	 */
	public $message;

	/**
	 * Structured context as JSON string.
	 *
	 * @var string|null
	 */
	public $context;

	/**
	 * User ID at time of event.
	 *
	 * @var int|null
	 */
	public $user_id;

	/**
	 * Client IP at time of event.
	 *
	 * @var string|null
	 */
	public $ip_address;

	/**
	 * Per-request UUID linking events from one HTTP call.
	 *
	 * @var string|null
	 */
	public $request_id;

	/**
	 * Created timestamp.
	 *
	 * @var string
	 */
	public $created_at;

	/**
	 * Constructor.
	 *
	 * @param array $data Optional data to populate.
	 */
	public function __construct( $data = array() ) {
		if ( ! empty( $data ) ) {
			$this->populate( $data );
		}
	}

	/**
	 * Populate from data array.
	 *
	 * @param array $data Data array.
	 */
	public function populate( $data ) {
		$this->id             = isset( $data['id'] ) ? (int) $data['id'] : null;
		$this->transaction_id = isset( $data['transaction_id'] ) && null !== $data['transaction_id']
			? (int) $data['transaction_id']
			: null;
		$this->level          = isset( $data['level'] ) ? sanitize_text_field( $data['level'] ) : 'info';
		$this->event          = isset( $data['event'] ) ? sanitize_text_field( $data['event'] ) : '';
		$this->message        = isset( $data['message'] ) ? (string) $data['message'] : null;
		$this->context        = isset( $data['context'] ) ? (string) $data['context'] : null;
		$this->user_id        = isset( $data['user_id'] ) && null !== $data['user_id']
			? (int) $data['user_id']
			: null;
		$this->ip_address     = isset( $data['ip_address'] ) ? sanitize_text_field( $data['ip_address'] ) : null;
		$this->request_id     = isset( $data['request_id'] ) ? sanitize_text_field( $data['request_id'] ) : null;
		$this->created_at     = isset( $data['created_at'] ) ? $data['created_at'] : '';
	}

	/**
	 * Save to database (insert only).
	 *
	 * @return bool Success.
	 */
	public function save() {
		global $wpdb;

		$table_name = \FairPayment\Database\Schema::get_log_table_name();

		// Insert-only: existing rows can't be updated.
		if ( $this->id ) {
			return false;
		}

		// Event is the only required field; transaction_id is intentionally optional.
		if ( empty( $this->event ) ) {
			return false;
		}

		$allowed_levels = array( 'info', 'warning', 'error' );
		if ( ! in_array( $this->level, $allowed_levels, true ) ) {
			$this->level = 'info';
		}

		$data = array(
			'transaction_id' => $this->transaction_id,
			'level'          => $this->level,
			'event'          => $this->event,
			'message'        => $this->message,
			'context'        => $this->context,
			'user_id'        => $this->user_id,
			'ip_address'     => $this->ip_address,
			'request_id'     => $this->request_id,
		);

		$format = array( '%d', '%s', '%s', '%s', '%s', '%d', '%s', '%s' );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$result = $wpdb->insert( $table_name, $data, $format );
		if ( $result ) {
			$this->id = $wpdb->insert_id;
		}

		return false !== $result;
	}
}
