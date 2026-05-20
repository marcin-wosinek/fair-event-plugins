<?php
/**
 * Email Consent Log Model
 *
 * @package FairAudience
 */

namespace FairAudience\Models;

defined( 'WPINC' ) || die;

/**
 * Email consent log model (insert-only).
 *
 * Records changes to a participant's email_profile so there is an audit trail
 * of who recorded a marketing consent, when, and at which event.
 */
class EmailConsentLog {

	/**
	 * Log entry ID.
	 *
	 * @var int|null
	 */
	public $id;

	/**
	 * Participant ID.
	 *
	 * @var int
	 */
	public $participant_id;

	/**
	 * Event post ID.
	 *
	 * @var int|null
	 */
	public $event_id;

	/**
	 * Event date ID.
	 *
	 * @var int|null
	 */
	public $event_date_id;

	/**
	 * Previous email profile.
	 *
	 * @var string|null
	 */
	public $old_profile;

	/**
	 * New email profile.
	 *
	 * @var string
	 */
	public $new_profile;

	/**
	 * Consent source identifier (e.g. 'verbal_admin').
	 *
	 * @var string
	 */
	public $source;

	/**
	 * Human-readable audit comment.
	 *
	 * @var string|null
	 */
	public $comment;

	/**
	 * Performed by user ID.
	 *
	 * @var int
	 */
	public $performed_by;

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
		$this->participant_id = isset( $data['participant_id'] ) ? (int) $data['participant_id'] : 0;
		$this->event_id       = isset( $data['event_id'] ) && $data['event_id'] ? (int) $data['event_id'] : null;
		$this->event_date_id  = isset( $data['event_date_id'] ) && $data['event_date_id'] ? (int) $data['event_date_id'] : null;
		$this->old_profile    = isset( $data['old_profile'] ) ? sanitize_text_field( $data['old_profile'] ) : null;
		$this->new_profile    = isset( $data['new_profile'] ) ? sanitize_text_field( $data['new_profile'] ) : '';
		$this->source         = isset( $data['source'] ) ? sanitize_text_field( $data['source'] ) : '';
		$this->comment        = isset( $data['comment'] ) ? sanitize_textarea_field( $data['comment'] ) : null;
		$this->performed_by   = isset( $data['performed_by'] ) ? (int) $data['performed_by'] : 0;
		$this->created_at     = isset( $data['created_at'] ) ? $data['created_at'] : '';
	}

	/**
	 * Save to database (insert only).
	 *
	 * @return bool Success.
	 */
	public function save() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_audience_email_consent_log';

		// Consent log is insert-only.
		if ( $this->id ) {
			return false;
		}

		// Validate required fields.
		if ( empty( $this->participant_id ) || empty( $this->new_profile ) || empty( $this->source ) ) {
			return false;
		}

		// Auto-set performed_by from current user if not set.
		if ( empty( $this->performed_by ) ) {
			$this->performed_by = get_current_user_id();
		}

		$data = array(
			'participant_id' => $this->participant_id,
			'event_id'       => $this->event_id,
			'event_date_id'  => $this->event_date_id,
			'old_profile'    => $this->old_profile,
			'new_profile'    => $this->new_profile,
			'source'         => $this->source,
			'comment'        => $this->comment,
			'performed_by'   => $this->performed_by,
		);

		$format = array( '%d', '%d', '%d', '%s', '%s', '%s', '%s', '%d' );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$result = $wpdb->insert( $table_name, $data, $format );
		if ( $result ) {
			$this->id = $wpdb->insert_id;
		}

		return false !== $result;
	}

	/**
	 * Create and persist a consent log entry in one step.
	 *
	 * @param array $data Data array.
	 * @return bool Success.
	 */
	public static function create( $data ) {
		$entry = new self( $data );
		return $entry->save();
	}
}
