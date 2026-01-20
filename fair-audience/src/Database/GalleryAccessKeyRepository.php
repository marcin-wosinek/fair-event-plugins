<?php
/**
 * Gallery Access Key Repository
 *
 * @package FairAudience
 */

namespace FairAudience\Database;

use FairAudience\Models\GalleryAccessKey;

defined( 'WPINC' ) || die;

/**
 * Repository for gallery access key data access.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class GalleryAccessKeyRepository {

	/**
	 * Get table name.
	 *
	 * @return string Table name.
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_audience_gallery_access_keys';
	}

	/**
	 * Create access key for a participant.
	 *
	 * @param int $event_id       Event ID.
	 * @param int $participant_id Participant ID.
	 * @return GalleryAccessKey|null Created access key or null on failure.
	 */
	public function create_for_participant( $event_id, $participant_id ) {
		// Check if key already exists.
		$existing = $this->get_by_event_and_participant( $event_id, $participant_id );
		if ( $existing ) {
			return $existing;
		}

		// Generate cryptographically secure random token.
		$token = wp_generate_password( 32, false );

		// Hash token with SHA-256.
		$access_key_hash = hash( 'sha256', $token );

		$access_key = new GalleryAccessKey();
		$access_key->populate(
			array(
				'event_id'       => $event_id,
				'participant_id' => $participant_id,
				'access_key'     => $access_key_hash,
				'token'          => $token,
			)
		);

		if ( $access_key->save() ) {
			return $access_key;
		}

		return null;
	}

	/**
	 * Get access key by token (plain token from URL).
	 *
	 * @param string $token Plain token from URL.
	 * @return GalleryAccessKey|null Access key or null if not found.
	 */
	public function get_by_token( $token ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE token = %s',
				$table_name,
				$token
			),
			ARRAY_A
		);

		return $result ? new GalleryAccessKey( $result ) : null;
	}

	/**
	 * Get access key by hash.
	 *
	 * @param string $access_key_hash SHA-256 hash of token.
	 * @return GalleryAccessKey|null Access key or null if not found.
	 */
	public function get_by_access_key( $access_key_hash ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE access_key = %s',
				$table_name,
				$access_key_hash
			),
			ARRAY_A
		);

		return $result ? new GalleryAccessKey( $result ) : null;
	}

	/**
	 * Get access key for a specific event and participant.
	 *
	 * @param int $event_id       Event ID.
	 * @param int $participant_id Participant ID.
	 * @return GalleryAccessKey|null Access key or null if not found.
	 */
	public function get_by_event_and_participant( $event_id, $participant_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE event_id = %d AND participant_id = %d',
				$table_name,
				$event_id,
				$participant_id
			),
			ARRAY_A
		);

		return $result ? new GalleryAccessKey( $result ) : null;
	}

	/**
	 * Get all access keys for an event.
	 *
	 * @param int $event_id Event ID.
	 * @return GalleryAccessKey[] Array of access keys.
	 */
	public function get_by_event( $event_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE event_id = %d ORDER BY created_at DESC',
				$table_name,
				$event_id
			),
			ARRAY_A
		);

		return array_map(
			function ( $row ) {
				return new GalleryAccessKey( $row );
			},
			$results
		);
	}

	/**
	 * Generate access keys for all participants of an event.
	 *
	 * @param int $event_id Event ID.
	 * @return int Number of keys created.
	 */
	public function generate_keys_for_event_participants( $event_id ) {
		$event_participant_repo = new EventParticipantRepository();
		$participants           = $event_participant_repo->get_by_event( $event_id );

		$created_count = 0;

		foreach ( $participants as $event_participant ) {
			$access_key = $this->create_for_participant( $event_id, $event_participant->participant_id );
			if ( $access_key ) {
				++$created_count;
			}
		}

		return $created_count;
	}

	/**
	 * Get statistics for access keys of an event.
	 *
	 * @param int $event_id Event ID.
	 * @return array Array with counts ['total' => 5, 'sent' => 3, 'not_sent' => 2].
	 */
	public function get_stats( $event_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		// Get total count.
		$total = (int) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM %i WHERE event_id = %d',
				$table_name,
				$event_id
			)
		);

		// Get count of emails sent (sent_at IS NOT NULL).
		$sent = (int) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM %i WHERE event_id = %d AND sent_at IS NOT NULL',
				$table_name,
				$event_id
			)
		);

		// Calculate not sent.
		$not_sent = $total - $sent;

		return array(
			'total'    => $total,
			'sent'     => $sent,
			'not_sent' => $not_sent,
		);
	}

	/**
	 * Delete all access keys for an event.
	 *
	 * @param int $event_id Event ID.
	 * @return bool Success.
	 */
	public function delete_by_event( $event_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		return $wpdb->delete(
			$table_name,
			array( 'event_id' => $event_id ),
			array( '%d' )
		) !== false;
	}

	/**
	 * Delete all access keys for a participant.
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
