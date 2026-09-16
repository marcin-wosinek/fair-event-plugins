<?php
/**
 * Audit Log Entry Model
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Models;

defined( 'WPINC' ) || die;

/**
 * Settings/connection audit log entry (insert-only).
 */
class AuditLogEntry {

	/**
	 * Entry ID.
	 *
	 * @var int|null
	 */
	public $id;

	/**
	 * Action taxonomy value (e.g. setting_changed, mollie_connected).
	 *
	 * @var string
	 */
	public $action;

	/**
	 * Option key changed, when the action is a setting change.
	 *
	 * @var string|null
	 */
	public $setting_key;

	/**
	 * Previous value, or null when unsafe to retain.
	 *
	 * @var string|null
	 */
	public $old_value;

	/**
	 * New value, or null when unsafe to retain.
	 *
	 * @var string|null
	 */
	public $new_value;

	/**
	 * Whether old_value/new_value were redacted instead of retained.
	 *
	 * @var bool
	 */
	public $is_protected;

	/**
	 * Acting WordPress user ID, or null for a system-attributed action.
	 *
	 * @var int|null
	 */
	public $actor_user_id;

	/**
	 * Snapshot of the actor's display name at the time of the change.
	 *
	 * @var string|null
	 */
	public $actor_display_name;

	/**
	 * Snapshot of the actor's username at the time of the change.
	 *
	 * @var string|null
	 */
	public $actor_login;

	/**
	 * Administrator-supplied (or system-generated) reason.
	 *
	 * @var string
	 */
	public $reason;

	/**
	 * Extra non-sensitive structured context as a JSON string.
	 *
	 * @var string|null
	 */
	public $context;

	/**
	 * Created timestamp (UTC).
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
	 * Populate from a data array.
	 *
	 * @param array $data Data array.
	 * @return void
	 */
	public function populate( $data ) {
		$this->id                 = isset( $data['id'] ) ? (int) $data['id'] : null;
		$this->action             = isset( $data['action'] ) ? sanitize_text_field( $data['action'] ) : '';
		$this->setting_key        = isset( $data['setting_key'] ) && null !== $data['setting_key']
			? sanitize_text_field( $data['setting_key'] )
			: null;
		$this->old_value          = isset( $data['old_value'] ) ? $data['old_value'] : null;
		$this->new_value          = isset( $data['new_value'] ) ? $data['new_value'] : null;
		$this->is_protected       = ! empty( $data['is_protected'] );
		$this->actor_user_id      = isset( $data['actor_user_id'] ) && null !== $data['actor_user_id']
			? (int) $data['actor_user_id']
			: null;
		$this->actor_display_name = isset( $data['actor_display_name'] ) ? (string) $data['actor_display_name'] : null;
		$this->actor_login        = isset( $data['actor_login'] ) ? (string) $data['actor_login'] : null;
		$this->reason             = isset( $data['reason'] ) ? (string) $data['reason'] : '';
		$this->context            = isset( $data['context'] ) ? (string) $data['context'] : null;
		$this->created_at         = isset( $data['created_at'] ) ? $data['created_at'] : '';
	}

	/**
	 * Save to database (insert only).
	 *
	 * @return bool Success.
	 */
	public function save() {
		global $wpdb;

		$table_name = \FairPaymentsConnector\Database\Schema::get_audit_log_table_name();

		// Insert-only: existing rows can't be updated.
		if ( $this->id ) {
			return false;
		}

		if ( empty( $this->action ) || '' === trim( (string) $this->reason ) ) {
			return false;
		}

		$data = array(
			'action'             => $this->action,
			'setting_key'        => $this->setting_key,
			'old_value'          => $this->old_value,
			'new_value'          => $this->new_value,
			'is_protected'       => $this->is_protected ? 1 : 0,
			'actor_user_id'      => $this->actor_user_id,
			'actor_display_name' => $this->actor_display_name,
			'actor_login'        => $this->actor_login,
			'reason'             => $this->reason,
			'context'            => $this->context,
		);

		$format = array( '%s', '%s', '%s', '%s', '%d', '%d', '%s', '%s', '%s', '%s' );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$result = $wpdb->insert( $table_name, $data, $format );
		if ( $result ) {
			$this->id = $wpdb->insert_id;
		}

		return false !== $result;
	}
}
