<?php
/**
 * PhotoLike Repository
 *
 * @package FairEvents
 */

namespace FairEvents\Database;

use FairEvents\Models\PhotoLike;

defined( 'WPINC' ) || die;

/**
 * Repository for photo-like relationships.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class PhotoLikeRepository {

	/**
	 * Get table name.
	 *
	 * @return string Table name.
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_events_photo_likes';
	}

	/**
	 * Add a like to a photo.
	 *
	 * @param int $attachment_id Attachment ID.
	 * @param int $user_id       User ID.
	 * @return PhotoLike|null The like object or null on failure.
	 */
	public function add_like( $attachment_id, $user_id ) {
		// Check if already liked.
		$existing = $this->get_like( $attachment_id, $user_id );
		if ( $existing ) {
			return $existing;
		}

		$like = new PhotoLike(
			array(
				'attachment_id' => $attachment_id,
				'user_id'       => $user_id,
			)
		);

		return $like->save() ? $like : null;
	}

	/**
	 * Remove a like from a photo.
	 *
	 * @param int $attachment_id Attachment ID.
	 * @param int $user_id       User ID.
	 * @return bool Success.
	 */
	public function remove_like( $attachment_id, $user_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		return $wpdb->delete(
			$table_name,
			array(
				'attachment_id' => $attachment_id,
				'user_id'       => $user_id,
			),
			array( '%d', '%d' )
		) !== false;
	}

	/**
	 * Get a specific like record.
	 *
	 * @param int $attachment_id Attachment ID.
	 * @param int $user_id       User ID.
	 * @return PhotoLike|null The like object or null if not found.
	 */
	public function get_like( $attachment_id, $user_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE attachment_id = %d AND user_id = %d',
				$table_name,
				$attachment_id,
				$user_id
			),
			ARRAY_A
		);

		return $result ? new PhotoLike( $result ) : null;
	}

	/**
	 * Check if a user has liked a photo.
	 *
	 * @param int $attachment_id Attachment ID.
	 * @param int $user_id       User ID.
	 * @return bool True if liked.
	 */
	public function has_liked( $attachment_id, $user_id ) {
		return null !== $this->get_like( $attachment_id, $user_id );
	}

	/**
	 * Get like count for a photo.
	 *
	 * @param int $attachment_id Attachment ID.
	 * @return int Like count.
	 */
	public function get_count( $attachment_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		return (int) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM %i WHERE attachment_id = %d',
				$table_name,
				$attachment_id
			)
		);
	}

	/**
	 * Get like counts for multiple photos.
	 *
	 * @param int[] $attachment_ids Array of attachment IDs.
	 * @return array Associative array of attachment_id => count.
	 */
	public function get_counts_for_photos( $attachment_ids ) {
		global $wpdb;

		if ( empty( $attachment_ids ) ) {
			return array();
		}

		$table_name = $this->get_table_name();

		// Build placeholders for IN clause.
		$placeholders = implode( ',', array_fill( 0, count( $attachment_ids ), '%d' ) );

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$results = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT attachment_id, COUNT(*) as count FROM %i WHERE attachment_id IN ({$placeholders}) GROUP BY attachment_id",
				array_merge( array( $table_name ), $attachment_ids )
			),
			ARRAY_A
		);

		$counts = array();
		foreach ( $results as $row ) {
			$counts[ (int) $row['attachment_id'] ] = (int) $row['count'];
		}

		// Fill in zeros for photos with no likes.
		foreach ( $attachment_ids as $id ) {
			if ( ! isset( $counts[ $id ] ) ) {
				$counts[ $id ] = 0;
			}
		}

		return $counts;
	}

	/**
	 * Get which photos a user has liked from a list.
	 *
	 * @param int[] $attachment_ids Array of attachment IDs.
	 * @param int   $user_id        User ID.
	 * @return int[] Array of attachment IDs that the user has liked.
	 */
	public function get_user_likes_for_photos( $attachment_ids, $user_id ) {
		global $wpdb;

		if ( empty( $attachment_ids ) || empty( $user_id ) ) {
			return array();
		}

		$table_name = $this->get_table_name();

		// Build placeholders for IN clause.
		$placeholders = implode( ',', array_fill( 0, count( $attachment_ids ), '%d' ) );

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$results = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT attachment_id FROM %i WHERE attachment_id IN ({$placeholders}) AND user_id = %d",
				array_merge( array( $table_name ), $attachment_ids, array( $user_id ) )
			)
		);

		return array_map( 'intval', $results );
	}

	/**
	 * Get all likes for a photo.
	 *
	 * @param int $attachment_id Attachment ID.
	 * @return PhotoLike[] Array of like objects.
	 */
	public function get_likes_for_attachment( $attachment_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE attachment_id = %d ORDER BY created_at DESC',
				$table_name,
				$attachment_id
			),
			ARRAY_A
		);

		return array_map(
			function ( $row ) {
				return new PhotoLike( $row );
			},
			$results
		);
	}

	/**
	 * Get all photos liked by a user.
	 *
	 * @param int $user_id User ID.
	 * @return PhotoLike[] Array of like objects.
	 */
	public function get_user_likes( $user_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE user_id = %d ORDER BY created_at DESC',
				$table_name,
				$user_id
			),
			ARRAY_A
		);

		return array_map(
			function ( $row ) {
				return new PhotoLike( $row );
			},
			$results
		);
	}

	/**
	 * Delete all likes for a photo.
	 *
	 * @param int $attachment_id Attachment ID.
	 * @return bool Success.
	 */
	public function delete_by_attachment( $attachment_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		return $wpdb->delete(
			$table_name,
			array( 'attachment_id' => $attachment_id ),
			array( '%d' )
		) !== false;
	}

	/**
	 * Add a participant like to a photo.
	 *
	 * @param int $attachment_id  Attachment ID.
	 * @param int $participant_id Participant ID.
	 * @return PhotoLike|null The like object or null on failure.
	 */
	public function add_participant_like( $attachment_id, $participant_id ) {
		// Check if already liked.
		$existing = $this->get_participant_like( $attachment_id, $participant_id );
		if ( $existing ) {
			return $existing;
		}

		$like = new PhotoLike(
			array(
				'attachment_id'  => $attachment_id,
				'participant_id' => $participant_id,
			)
		);

		return $like->save() ? $like : null;
	}

	/**
	 * Remove a participant like from a photo.
	 *
	 * @param int $attachment_id  Attachment ID.
	 * @param int $participant_id Participant ID.
	 * @return bool Success.
	 */
	public function remove_participant_like( $attachment_id, $participant_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		return $wpdb->delete(
			$table_name,
			array(
				'attachment_id'  => $attachment_id,
				'participant_id' => $participant_id,
			),
			array( '%d', '%d' )
		) !== false;
	}

	/**
	 * Get a specific participant like record.
	 *
	 * @param int $attachment_id  Attachment ID.
	 * @param int $participant_id Participant ID.
	 * @return PhotoLike|null The like object or null if not found.
	 */
	public function get_participant_like( $attachment_id, $participant_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE attachment_id = %d AND participant_id = %d',
				$table_name,
				$attachment_id,
				$participant_id
			),
			ARRAY_A
		);

		return $result ? new PhotoLike( $result ) : null;
	}

	/**
	 * Check if a participant has liked a photo.
	 *
	 * @param int $attachment_id  Attachment ID.
	 * @param int $participant_id Participant ID.
	 * @return bool True if liked.
	 */
	public function has_participant_liked( $attachment_id, $participant_id ) {
		return null !== $this->get_participant_like( $attachment_id, $participant_id );
	}

	/**
	 * Get which photos a participant has liked from a list.
	 *
	 * @param int[] $attachment_ids Array of attachment IDs.
	 * @param int   $participant_id Participant ID.
	 * @return int[] Array of attachment IDs that the participant has liked.
	 */
	public function get_participant_likes_for_photos( $attachment_ids, $participant_id ) {
		global $wpdb;

		if ( empty( $attachment_ids ) || empty( $participant_id ) ) {
			return array();
		}

		$table_name = $this->get_table_name();

		// Build placeholders for IN clause.
		$placeholders = implode( ',', array_fill( 0, count( $attachment_ids ), '%d' ) );

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$results = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT attachment_id FROM %i WHERE attachment_id IN ({$placeholders}) AND participant_id = %d",
				array_merge( array( $table_name ), $attachment_ids, array( $participant_id ) )
			)
		);

		return array_map( 'intval', $results );
	}

	/**
	 * Get all photos liked by a participant.
	 *
	 * @param int $participant_id Participant ID.
	 * @return PhotoLike[] Array of like objects.
	 */
	public function get_participant_likes( $participant_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE participant_id = %d ORDER BY created_at DESC',
				$table_name,
				$participant_id
			),
			ARRAY_A
		);

		return array_map(
			function ( $row ) {
				return new PhotoLike( $row );
			},
			$results
		);
	}

	/**
	 * Delete all likes by a participant.
	 *
	 * @param int $participant_id Participant ID.
	 * @return bool Success.
	 */
	public function delete_by_participant( $participant_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		return $wpdb->delete(
			$table_name,
			array( 'participant_id' => $participant_id ),
			array( '%d' )
		) !== false;
	}
}
