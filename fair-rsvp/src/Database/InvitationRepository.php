<?php
/**
 * Invitation Repository for database operations
 *
 * @package FairRsvp
 */

namespace FairRsvp\Database;

defined( 'WPINC' ) || die;

/**
 * Handles invitation database operations
 */
class InvitationRepository {

	/**
	 * Get table name
	 *
	 * @return string Table name with prefix.
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_rsvp_invitations';
	}

	/**
	 * Create an invitation
	 *
	 * @param int    $event_id Event/post ID.
	 * @param int    $inviter_user_id User ID of the person sending invitation.
	 * @param string $invited_email Email address to invite (optional).
	 * @param string $invitation_token Unique token for the invitation link.
	 * @param string $expires_at Expiration datetime (optional).
	 * @return int|false Invitation ID on success, false on failure.
	 */
	public function create_invitation( $event_id, $inviter_user_id, $invited_email, $invitation_token, $expires_at = null ) {
		global $wpdb;

		$table_name = $this->get_table_name();
		$now        = current_time( 'mysql' );

		// Calculate expiration date (30 days from now if not provided).
		if ( null === $expires_at ) {
			$expires_at = gmdate( 'Y-m-d H:i:s', strtotime( '+30 days' ) );
		}

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
		$result = $wpdb->insert(
			$table_name,
			array(
				'event_id'          => $event_id,
				'inviter_user_id'   => $inviter_user_id,
				'invited_email'     => $invited_email,
				'invitation_token'  => $invitation_token,
				'invitation_status' => 'pending',
				'expires_at'        => $expires_at,
				'created_at'        => $now,
			),
			array( '%d', '%d', '%s', '%s', '%s', '%s', '%s' )
		);

		return $result ? $wpdb->insert_id : false;
	}

	/**
	 * Get invitation by token
	 *
	 * @param string $token Invitation token.
	 * @return array|null Invitation data or null if not found.
	 */
	public function get_invitation_by_token( $token ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$sql = $wpdb->prepare( 'SELECT * FROM %i WHERE invitation_token = %s', $table_name, $token );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.PreparedSQL.NotPrepared
		return $wpdb->get_row( $sql, ARRAY_A );
	}

	/**
	 * Mark invitation as accepted
	 *
	 * @param int $invitation_id Invitation ID.
	 * @param int $invited_user_id User ID who accepted the invitation.
	 * @return bool True on success, false on failure.
	 */
	public function mark_invitation_accepted( $invitation_id, $invited_user_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();
		$now        = current_time( 'mysql' );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching
		$result = $wpdb->update(
			$table_name,
			array(
				'invited_user_id'   => $invited_user_id,
				'invitation_status' => 'accepted',
				'used_at'           => $now,
			),
			array( 'id' => $invitation_id ),
			array( '%d', '%s', '%s' ),
			array( '%d' )
		);

		return false !== $result;
	}

	/**
	 * Get invitations sent by a user for a specific event
	 *
	 * @param int $event_id Event/post ID.
	 * @param int $inviter_user_id User ID of the person who sent invitations.
	 * @return array Array of invitations.
	 */
	public function get_user_invitations( $event_id, $inviter_user_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$sql = $wpdb->prepare(
			'SELECT * FROM %i WHERE event_id = %d AND inviter_user_id = %d ORDER BY created_at DESC',
			$table_name,
			$event_id,
			$inviter_user_id
		);

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.PreparedSQL.NotPrepared
		return $wpdb->get_results( $sql, ARRAY_A );
	}

	/**
	 * Check if user was invited to an event
	 *
	 * @param int $event_id Event/post ID.
	 * @param int $user_id User ID to check.
	 * @return array|null Invitation data if user was invited, null otherwise.
	 */
	public function get_user_invitation_for_event( $event_id, $user_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$sql = $wpdb->prepare(
			'SELECT * FROM %i WHERE event_id = %d AND invited_user_id = %d AND invitation_status = %s LIMIT 1',
			$table_name,
			$event_id,
			$user_id,
			'accepted'
		);

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.PreparedSQL.NotPrepared
		return $wpdb->get_row( $sql, ARRAY_A );
	}

	/**
	 * Check if user was invited to an event by email
	 *
	 * @param int    $event_id Event/post ID.
	 * @param string $email Email address to check.
	 * @return array|null Invitation data if email was invited, null otherwise.
	 */
	public function get_invitation_by_email( $event_id, $email ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$sql = $wpdb->prepare(
			'SELECT * FROM %i WHERE event_id = %d AND invited_email = %s AND invitation_status = %s LIMIT 1',
			$table_name,
			$event_id,
			$email,
			'pending'
		);

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.PreparedSQL.NotPrepared
		return $wpdb->get_row( $sql, ARRAY_A );
	}

	/**
	 * Expire old invitations
	 *
	 * @return int Number of invitations expired.
	 */
	public function expire_old_invitations() {
		global $wpdb;

		$table_name = $this->get_table_name();
		$now        = current_time( 'mysql' );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching
		$result = $wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET invitation_status = %s WHERE invitation_status = %s AND expires_at < %s',
				$table_name,
				'expired',
				'pending',
				$now
			)
		);

		return $result !== false ? $result : 0;
	}

	/**
	 * Get all invitations with user and event details (admin view)
	 *
	 * @param int    $event_id Optional event ID filter.
	 * @param string $status Optional status filter (pending, accepted, expired).
	 * @param int    $limit Number of invitations to retrieve.
	 * @param int    $offset Offset for pagination.
	 * @return array Array of invitations with user and event data.
	 */
	public function get_all_invitations( $event_id = null, $status = null, $limit = 100, $offset = 0 ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		// Build WHERE clause.
		$where_clauses = array();
		$where_values  = array();

		if ( $event_id ) {
			$where_clauses[] = 'event_id = %d';
			$where_values[]  = $event_id;
		}

		if ( $status ) {
			$where_clauses[] = 'invitation_status = %s';
			$where_values[]  = $status;
		}

		$where_sql = ! empty( $where_clauses ) ? 'WHERE ' . implode( ' AND ', $where_clauses ) : '';

		// Build full query.
		$sql = 'SELECT * FROM %i ' . $where_sql . ' ORDER BY created_at DESC LIMIT %d OFFSET %d';

		// Prepare values array.
		$prepare_values = array_merge( array( $table_name ), $where_values, array( $limit, $offset ) );
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$prepared_sql = $wpdb->prepare( $sql, ...$prepare_values );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.PreparedSQL.NotPrepared,PluginCheck.Security.DirectDB.UnescapedDBParameter
		$invitations = $wpdb->get_results( $prepared_sql, ARRAY_A );

		// Enrich with user and event data.
		foreach ( $invitations as &$invitation ) {
			// Get inviter user data.
			$inviter = get_userdata( $invitation['inviter_user_id'] );
			if ( $inviter ) {
				$invitation['inviter_name']  = $inviter->display_name;
				$invitation['inviter_email'] = $inviter->user_email;
			} else {
				$invitation['inviter_name']  = __( 'Unknown', 'fair-rsvp' );
				$invitation['inviter_email'] = '';
			}

			// Get invited user data if accepted.
			if ( $invitation['invited_user_id'] ) {
				$invited_user = get_userdata( $invitation['invited_user_id'] );
				if ( $invited_user ) {
					$invitation['invited_user_name']  = $invited_user->display_name;
					$invitation['invited_user_email'] = $invited_user->user_email;
				}
			} else {
				$invitation['invited_user_name']  = '';
				$invitation['invited_user_email'] = $invitation['invited_email'];
			}

			// Get event data.
			$event = get_post( $invitation['event_id'] );
			if ( $event ) {
				$invitation['event_title'] = $event->post_title;
				$invitation['event_url']   = get_permalink( $event->ID );
			} else {
				$invitation['event_title'] = __( 'Deleted Event', 'fair-rsvp' );
				$invitation['event_url']   = '';
			}
		}

		return $invitations;
	}

	/**
	 * Get total count of invitations (for pagination)
	 *
	 * @param int    $event_id Optional event ID filter.
	 * @param string $status Optional status filter.
	 * @return int Total count.
	 */
	public function get_invitations_count( $event_id = null, $status = null ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		// Build WHERE clause.
		$where_clauses = array();
		$where_values  = array();

		if ( $event_id ) {
			$where_clauses[] = 'event_id = %d';
			$where_values[]  = $event_id;
		}

		if ( $status ) {
			$where_clauses[] = 'invitation_status = %s';
			$where_values[]  = $status;
		}

		$where_sql = ! empty( $where_clauses ) ? 'WHERE ' . implode( ' AND ', $where_clauses ) : '';

		// Build query.
		$sql = 'SELECT COUNT(*) FROM %i ' . $where_sql;

		// Prepare values.
		$prepare_values = array_merge( array( $table_name ), $where_values );
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$prepared_sql = $wpdb->prepare( $sql, ...$prepare_values );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.PreparedSQL.NotPrepared,PluginCheck.Security.DirectDB.UnescapedDBParameter
		return (int) $wpdb->get_var( $prepared_sql );
	}
}
