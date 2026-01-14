<?php
/**
 * PhotoParticipant Repository
 *
 * @package FairAudience
 */

namespace FairAudience\Database;

use FairAudience\Models\PhotoParticipant;

defined( 'WPINC' ) || die;

/**
 * Repository for photo-participant relationships.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class PhotoParticipantRepository {

	/**
	 * Get table name.
	 *
	 * @return string Table name.
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_audience_photo_participants';
	}

	/**
	 * Get author for an attachment.
	 *
	 * @param int $attachment_id Attachment ID.
	 * @return PhotoParticipant|null Author relationship or null if not found.
	 */
	public function get_author_for_attachment( $attachment_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$result = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT * FROM %i WHERE attachment_id = %d AND role = 'author'",
				$table_name,
				$attachment_id
			),
			ARRAY_A
		);

		return $result ? new PhotoParticipant( $result ) : null;
	}

	/**
	 * Get all relationships for an attachment (author and tagged).
	 *
	 * @param int $attachment_id Attachment ID.
	 * @return PhotoParticipant[] Array of photo-participant relationships.
	 */
	public function get_by_attachment( $attachment_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE attachment_id = %d ORDER BY role ASC, created_at ASC',
				$table_name,
				$attachment_id
			),
			ARRAY_A
		);

		return array_map(
			function ( $row ) {
				return new PhotoParticipant( $row );
			},
			$results
		);
	}

	/**
	 * Get all photos by a participant.
	 *
	 * @param int    $participant_id Participant ID.
	 * @param string $role           Optional role filter ('author', 'tagged', or null for all).
	 * @return PhotoParticipant[] Array of photo-participant relationships.
	 */
	public function get_by_participant( $participant_id, $role = null ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		if ( $role && in_array( $role, PhotoParticipant::VALID_ROLES, true ) ) {
			$results = $wpdb->get_results(
				$wpdb->prepare(
					'SELECT * FROM %i WHERE participant_id = %d AND role = %s ORDER BY created_at DESC',
					$table_name,
					$participant_id,
					$role
				),
				ARRAY_A
			);
		} else {
			$results = $wpdb->get_results(
				$wpdb->prepare(
					'SELECT * FROM %i WHERE participant_id = %d ORDER BY created_at DESC',
					$table_name,
					$participant_id
				),
				ARRAY_A
			);
		}

		return array_map(
			function ( $row ) {
				return new PhotoParticipant( $row );
			},
			$results
		);
	}

	/**
	 * Set author for an attachment.
	 * Replaces any existing author.
	 *
	 * @param int $attachment_id  Attachment ID.
	 * @param int $participant_id Participant ID (0 to remove author).
	 * @return int|false Relationship ID or false on failure.
	 */
	public function set_author( $attachment_id, $participant_id ) {
		// Remove existing author if any.
		$this->remove_author( $attachment_id );

		if ( empty( $participant_id ) ) {
			return true; // Just removing, no new author.
		}

		$relationship = new PhotoParticipant(
			array(
				'attachment_id'  => $attachment_id,
				'participant_id' => $participant_id,
				'role'           => 'author',
			)
		);

		return $relationship->save() ? $relationship->id : false;
	}

	/**
	 * Remove author from an attachment.
	 *
	 * @param int $attachment_id Attachment ID.
	 * @return bool Success.
	 */
	public function remove_author( $attachment_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		return $wpdb->delete(
			$table_name,
			array(
				'attachment_id' => $attachment_id,
				'role'          => 'author',
			),
			array( '%d', '%s' )
		) !== false;
	}

	/**
	 * Get count of photos by participant and role.
	 *
	 * @param int    $participant_id Participant ID.
	 * @param string $role           Optional role filter.
	 * @return int Count.
	 */
	public function get_count_by_participant( $participant_id, $role = null ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		if ( $role && in_array( $role, PhotoParticipant::VALID_ROLES, true ) ) {
			return (int) $wpdb->get_var(
				$wpdb->prepare(
					'SELECT COUNT(*) FROM %i WHERE participant_id = %d AND role = %s',
					$table_name,
					$participant_id,
					$role
				)
			);
		}

		return (int) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM %i WHERE participant_id = %d',
				$table_name,
				$participant_id
			)
		);
	}

	/**
	 * Get all attachment IDs by a participant (for media library filtering).
	 *
	 * @param int    $participant_id Participant ID.
	 * @param string $role           Optional role filter.
	 * @return int[] Array of attachment IDs.
	 */
	public function get_attachment_ids_by_participant( $participant_id, $role = null ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		if ( $role && in_array( $role, PhotoParticipant::VALID_ROLES, true ) ) {
			return $wpdb->get_col(
				$wpdb->prepare(
					'SELECT attachment_id FROM %i WHERE participant_id = %d AND role = %s',
					$table_name,
					$participant_id,
					$role
				)
			);
		}

		return $wpdb->get_col(
			$wpdb->prepare(
				'SELECT attachment_id FROM %i WHERE participant_id = %d',
				$table_name,
				$participant_id
			)
		);
	}
}
