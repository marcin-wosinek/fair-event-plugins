<?php
/**
 * EventPhoto model for Fair Events
 *
 * @package FairEvents
 */

namespace FairEvents\Models;

defined( 'WPINC' ) || die;

/**
 * EventPhoto model class for event-attachment relationships.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class EventPhoto {

	/**
	 * Record ID.
	 *
	 * @var int|null
	 */
	public $id;

	/**
	 * Event post ID.
	 *
	 * @var int
	 */
	public $event_id;

	/**
	 * Attachment (photo) ID.
	 *
	 * @var int
	 */
	public $attachment_id;

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
	 * Populate from data array or object.
	 *
	 * @param array|object $data Data array or object.
	 */
	public function populate( $data ) {
		$data = (array) $data;

		$this->id            = isset( $data['id'] ) ? (int) $data['id'] : null;
		$this->event_id      = isset( $data['event_id'] ) ? (int) $data['event_id'] : 0;
		$this->attachment_id = isset( $data['attachment_id'] ) ? (int) $data['attachment_id'] : 0;
		$this->created_at    = isset( $data['created_at'] ) ? $data['created_at'] : '';
	}

	/**
	 * Save to database.
	 *
	 * @return bool Success.
	 */
	public function save() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_events_event_photos';

		if ( empty( $this->event_id ) || empty( $this->attachment_id ) ) {
			return false;
		}

		$data = array(
			'event_id'      => $this->event_id,
			'attachment_id' => $this->attachment_id,
		);

		$format = array( '%d', '%d' );

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

		$table_name = $wpdb->prefix . 'fair_events_event_photos';

		return $wpdb->delete(
			$table_name,
			array( 'id' => $this->id ),
			array( '%d' )
		) !== false;
	}
}
