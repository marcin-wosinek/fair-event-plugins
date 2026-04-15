<?php
/**
 * EventParticipant Model
 *
 * @package FairAudience
 */

namespace FairAudience\Models;

defined( 'WPINC' ) || die;

/**
 * EventParticipant model for junction table.
 */
class EventParticipant {

	/**
	 * Junction record ID.
	 *
	 * @var int|null
	 */
	public $id;

	/**
	 * Event (post) ID.
	 *
	 * @var int
	 */
	public $event_id;

	/**
	 * Event date ID from fair_event_dates table.
	 *
	 * @var int
	 */
	public $event_date_id;

	/**
	 * Participant ID.
	 *
	 * @var int
	 */
	public $participant_id;

	/**
	 * Relationship label.
	 *
	 * @var string
	 */
	public $label;

	/**
	 * Pending payment expiry (nullable DATETIME).
	 *
	 * @var string|null
	 */
	public $payment_expires_at;

	/**
	 * fair-payment transaction ID, when the signup requires payment.
	 *
	 * @var int|null
	 */
	public $transaction_id;

	/**
	 * Ticket type ID from fair_events_ticket_types, when the signup was made against a specific ticket type.
	 *
	 * @var int|null
	 */
	public $ticket_type_id;

	/**
	 * Seats consumed by this signup (snapshot of ticket type's seats_per_ticket).
	 *
	 * @var int
	 */
	public $seats = 1;

	/**
	 * Created timestamp.
	 *
	 * @var string
	 */
	public $created_at;

	/**
	 * Updated timestamp.
	 *
	 * @var string
	 */
	public $updated_at;

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
		$this->id                 = isset( $data['id'] ) ? (int) $data['id'] : null;
		$this->event_id           = isset( $data['event_id'] ) ? (int) $data['event_id'] : 0;
		$this->event_date_id      = isset( $data['event_date_id'] ) && $data['event_date_id'] ? (int) $data['event_date_id'] : 0;
		$this->participant_id     = isset( $data['participant_id'] ) ? (int) $data['participant_id'] : 0;
		$this->label              = isset( $data['label'] ) ? $data['label'] : 'interested';
		$this->payment_expires_at = isset( $data['payment_expires_at'] ) && $data['payment_expires_at'] ? $data['payment_expires_at'] : null;
		$this->transaction_id     = isset( $data['transaction_id'] ) && $data['transaction_id'] ? (int) $data['transaction_id'] : null;
		$this->ticket_type_id     = isset( $data['ticket_type_id'] ) && $data['ticket_type_id'] ? (int) $data['ticket_type_id'] : null;
		$this->seats              = isset( $data['seats'] ) ? max( 1, (int) $data['seats'] ) : 1;
		$this->created_at         = isset( $data['created_at'] ) ? $data['created_at'] : '';
		$this->updated_at         = isset( $data['updated_at'] ) ? $data['updated_at'] : '';
	}

	/**
	 * Save to database.
	 *
	 * @return bool Success.
	 */
	public function save() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_audience_event_participants';

		if ( empty( $this->event_id ) || empty( $this->event_date_id ) || empty( $this->participant_id ) ) {
			return false;
		}

		// Validate label enum.
		if ( ! in_array( $this->label, array( 'interested', 'signed_up', 'collaborator', 'pending_payment' ), true ) ) {
			$this->label = 'interested';
		}

		$data = array(
			'event_id'           => $this->event_id,
			'event_date_id'      => $this->event_date_id,
			'participant_id'     => $this->participant_id,
			'label'              => $this->label,
			'payment_expires_at' => $this->payment_expires_at,
			'transaction_id'     => $this->transaction_id,
			'ticket_type_id'     => $this->ticket_type_id,
			'seats'              => max( 1, (int) $this->seats ),
		);

		$format = array( '%d', '%d', '%d', '%s', '%s', '%d', '%d', '%d' );

		if ( $this->id ) {
			// Update existing.
			$result = $wpdb->update(
				$table_name,
				$data,
				array( 'id' => $this->id ),
				$format,
				array( '%d' )
			);
		} else {
			// Insert new.
			$result = $wpdb->insert( $table_name, $data, $format );
			if ( $result ) {
				$this->id = $wpdb->insert_id;
			}
		}

		return $result !== false;
	}

	/**
	 * Delete from database.
	 *
	 * @return bool Success.
	 */
	public function delete() {
		global $wpdb;

		if ( ! $this->id ) {
			return false;
		}

		$table_name = $wpdb->prefix . 'fair_audience_event_participants';

		return $wpdb->delete(
			$table_name,
			array( 'id' => $this->id ),
			array( '%d' )
		) !== false;
	}
}
