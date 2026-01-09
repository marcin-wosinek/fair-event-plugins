<?php
/**
 * Poll Access Key Repository
 *
 * @package FairAudience
 */

namespace FairAudience\Database;

use FairAudience\Models\PollAccessKey;

defined( 'WPINC' ) || die;

/**
 * Repository for poll access key data access.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class PollAccessKeyRepository {

	/**
	 * Get table name.
	 *
	 * @return string Table name.
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_audience_poll_access_keys';
	}

	/**
	 * Create access key for a participant.
	 *
	 * @param int $poll_id        Poll ID.
	 * @param int $participant_id Participant ID.
	 * @return PollAccessKey|null Created access key or null on failure.
	 */
	public function create_for_participant( $poll_id, $participant_id ) {
		// Check if key already exists.
		$existing = $this->get_by_participant( $poll_id, $participant_id );
		if ( $existing ) {
			return $existing;
		}

		// Generate cryptographically secure random token.
		$token = wp_generate_password( 32, false );

		// Hash token with SHA-256.
		$access_key_hash = hash( 'sha256', $token );

		$access_key = new PollAccessKey();
		$access_key->populate(
			array(
				'poll_id'        => $poll_id,
				'participant_id' => $participant_id,
				'access_key'     => $access_key_hash,
				'token'          => $token,
				'status'         => 'pending',
			)
		);

		if ( $access_key->save() ) {
			return $access_key;
		}

		return null;
	}

	/**
	 * Get access key by hash.
	 *
	 * @param string $access_key_hash SHA-256 hash of token.
	 * @return PollAccessKey|null Access key or null if not found.
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

		return $result ? new PollAccessKey( $result ) : null;
	}

	/**
	 * Get all access keys for a poll.
	 *
	 * @param int $poll_id Poll ID.
	 * @return PollAccessKey[] Array of access keys.
	 */
	public function get_by_poll( $poll_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE poll_id = %d ORDER BY created_at DESC',
				$table_name,
				$poll_id
			),
			ARRAY_A
		);

		return array_map(
			function ( $row ) {
				return new PollAccessKey( $row );
			},
			$results
		);
	}

	/**
	 * Get access key for a specific participant and poll.
	 *
	 * @param int $poll_id        Poll ID.
	 * @param int $participant_id Participant ID.
	 * @return PollAccessKey|null Access key or null if not found.
	 */
	public function get_by_participant( $poll_id, $participant_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE poll_id = %d AND participant_id = %d',
				$table_name,
				$poll_id,
				$participant_id
			),
			ARRAY_A
		);

		return $result ? new PollAccessKey( $result ) : null;
	}

	/**
	 * Generate access keys for all participants of an event.
	 *
	 * @param int $poll_id  Poll ID.
	 * @param int $event_id Event ID.
	 * @return int Number of keys created.
	 */
	public function generate_keys_for_event_participants( $poll_id, $event_id ) {
		$event_participant_repo = new EventParticipantRepository();
		$participants           = $event_participant_repo->get_by_event( $event_id );

		$created_count = 0;

		foreach ( $participants as $event_participant ) {
			$access_key = $this->create_for_participant( $poll_id, $event_participant->participant_id );
			if ( $access_key ) {
				++$created_count;
			}
		}

		return $created_count;
	}

	/**
	 * Get statistics for access keys of a poll.
	 *
	 * @param int $poll_id Poll ID.
	 * @return array Array with counts by status ['pending' => 5, 'responded' => 3, 'expired' => 0].
	 */
	public function get_stats( $poll_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT status, COUNT(*) as count FROM %i WHERE poll_id = %d GROUP BY status',
				$table_name,
				$poll_id
			),
			ARRAY_A
		);

		$stats = array(
			'pending'   => 0,
			'responded' => 0,
			'expired'   => 0,
		);

		foreach ( $results as $row ) {
			$stats[ $row['status'] ] = (int) $row['count'];
		}

		return $stats;
	}

	/**
	 * Get detailed statistics for a poll including email sent status.
	 *
	 * @param int $poll_id Poll ID.
	 * @return array Array with detailed statistics.
	 */
	public function get_detailed_stats( $poll_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		// Get total count.
		$total = (int) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM %i WHERE poll_id = %d',
				$table_name,
				$poll_id
			)
		);

		// Get count of responded participants.
		$responded = (int) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM %i WHERE poll_id = %d AND status = %s',
				$table_name,
				$poll_id,
				'responded'
			)
		);

		// Get count of emails sent (sent_at IS NOT NULL).
		$sent = (int) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM %i WHERE poll_id = %d AND sent_at IS NOT NULL',
				$table_name,
				$poll_id
			)
		);

		// Calculate not sent.
		$not_sent = $total - $sent;

		return array(
			'total'     => $total,
			'responded' => $responded,
			'sent'      => $sent,
			'not_sent'  => $not_sent,
		);
	}
}
