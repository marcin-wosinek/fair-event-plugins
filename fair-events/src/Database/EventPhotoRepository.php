<?php
/**
 * EventPhoto Repository
 *
 * @package FairEvents
 */

namespace FairEvents\Database;

use FairEvents\Models\EventPhoto;

defined( 'WPINC' ) || die;

/**
 * Repository for event-photo relationships.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class EventPhotoRepository {

	/**
	 * Get table name.
	 *
	 * @return string Table name.
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_events_event_photos';
	}

	/**
	 * Get event for an attachment.
	 *
	 * @param int $attachment_id Attachment ID.
	 * @return EventPhoto|null Event-photo relationship or null if not found.
	 */
	public function get_event_for_attachment( $attachment_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE attachment_id = %d',
				$table_name,
				$attachment_id
			),
			ARRAY_A
		);

		return $result ? new EventPhoto( $result ) : null;
	}

	/**
	 * Get all photos for an event.
	 *
	 * @param int $event_id Event ID.
	 * @return EventPhoto[] Array of event-photo relationships.
	 */
	public function get_attachments_for_event( $event_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE event_id = %d ORDER BY created_at ASC',
				$table_name,
				$event_id
			),
			ARRAY_A
		);

		return array_map(
			function ( $row ) {
				return new EventPhoto( $row );
			},
			$results
		);
	}

	/**
	 * Set event for an attachment.
	 * Replaces any existing event (1-to-1 relationship).
	 *
	 * @param int $attachment_id Attachment ID.
	 * @param int $event_id      Event ID (0 to remove).
	 * @return int|bool Relationship ID or true on removal, false on failure.
	 */
	public function set_event( $attachment_id, $event_id ) {
		// Remove existing event assignment if any.
		$this->remove_from_event( $attachment_id );

		if ( empty( $event_id ) ) {
			return true; // Just removing, no new event.
		}

		$relationship = new EventPhoto(
			array(
				'event_id'      => $event_id,
				'attachment_id' => $attachment_id,
			)
		);

		return $relationship->save() ? $relationship->id : false;
	}

	/**
	 * Remove attachment from any event.
	 *
	 * @param int $attachment_id Attachment ID.
	 * @return bool Success.
	 */
	public function remove_from_event( $attachment_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		return $wpdb->delete(
			$table_name,
			array( 'attachment_id' => $attachment_id ),
			array( '%d' )
		) !== false;
	}

	/**
	 * Remove all photos from an event.
	 *
	 * @param int $event_id Event ID.
	 * @return bool Success.
	 */
	public function remove_all_for_event( $event_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		return $wpdb->delete(
			$table_name,
			array( 'event_id' => $event_id ),
			array( '%d' )
		) !== false;
	}

	/**
	 * Get all attachment IDs for an event.
	 *
	 * @param int $event_id Event ID.
	 * @return int[] Array of attachment IDs.
	 */
	public function get_attachment_ids_by_event( $event_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$result = $wpdb->get_col(
			$wpdb->prepare(
				'SELECT attachment_id FROM %i WHERE event_id = %d',
				$table_name,
				$event_id
			)
		);

		return array_map( 'intval', $result );
	}

	/**
	 * Get count of photos for an event.
	 *
	 * @param int $event_id Event ID.
	 * @return int Count.
	 */
	public function get_count_by_event( $event_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		return (int) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM %i WHERE event_id = %d',
				$table_name,
				$event_id
			)
		);
	}
}
