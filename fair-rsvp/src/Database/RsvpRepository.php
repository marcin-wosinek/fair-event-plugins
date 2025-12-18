<?php
/**
 * RSVP Repository for database operations
 *
 * @package FairRsvp
 */

namespace FairRsvp\Database;

defined( 'WPINC' ) || die;

/**
 * Handles RSVP database operations
 */
class RsvpRepository {

	/**
	 * Get table name
	 *
	 * @return string Table name with prefix.
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_rsvp';
	}

	/**
	 * Upsert RSVP (insert or update if exists)
	 *
	 * @param int      $event_id           Event/post ID.
	 * @param int      $user_id            User ID.
	 * @param string   $rsvp_status        RSVP status (yes, maybe, no, cancelled).
	 * @param int|null $invited_by_user_id User ID who invited this person (optional).
	 * @param int|null $invitation_id      Invitation ID that led to this RSVP (optional).
	 * @return int|false RSVP ID on success, false on failure.
	 */
	public function upsert_rsvp( $event_id, $user_id, $rsvp_status, $invited_by_user_id = null, $invitation_id = null ) {
		global $wpdb;

		$table_name = $this->get_table_name();
		$now        = current_time( 'mysql' );

		// Try to get existing RSVP.
		$existing = $this->get_rsvp_by_event_and_user( $event_id, $user_id );

		if ( $existing ) {
			// Update existing RSVP.
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching
			$result = $wpdb->update(
				$table_name,
				array(
					'rsvp_status' => $rsvp_status,
					'rsvp_at'     => $now,
					'updated_at'  => $now,
				),
				array(
					'event_id' => $event_id,
					'user_id'  => $user_id,
				),
				array( '%s', '%s', '%s' ),
				array( '%d', '%d' )
			);

			return $result !== false ? $existing['id'] : false;
		} else {
			// Insert new RSVP.
			$data   = array(
				'event_id'          => $event_id,
				'user_id'           => $user_id,
				'rsvp_status'       => $rsvp_status,
				'attendance_status' => 'not_applicable',
				'rsvp_at'           => $now,
				'created_at'        => $now,
				'updated_at'        => $now,
			);
			$format = array( '%d', '%d', '%s', '%s', '%s', '%s', '%s' );

			// Add invitation tracking if provided.
			if ( null !== $invited_by_user_id ) {
				$data['invited_by_user_id'] = $invited_by_user_id;
				$format[]                   = '%d';
			}

			if ( null !== $invitation_id ) {
				$data['invitation_id'] = $invitation_id;
				$format[]              = '%d';
			}

			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			$result = $wpdb->insert( $table_name, $data, $format );

			return $result ? $wpdb->insert_id : false;
		}
	}

	/**
	 * Create guest RSVP (without WordPress user account)
	 *
	 * @param int      $event_id           Event/post ID.
	 * @param string   $guest_name         Guest's name.
	 * @param string   $guest_email        Guest's email.
	 * @param string   $rsvp_status        RSVP status (yes, maybe, no, cancelled).
	 * @param int|null $invited_by_user_id User ID who invited this person (optional).
	 * @param int|null $invitation_id      Invitation ID that led to this RSVP (optional).
	 * @return int|false RSVP ID on success, false on failure.
	 */
	public function create_guest_rsvp( $event_id, $guest_name, $guest_email, $rsvp_status, $invited_by_user_id = null, $invitation_id = null ) {
		global $wpdb;

		$table_name = $this->get_table_name();
		$now        = current_time( 'mysql' );

		// Insert new guest RSVP.
		$data   = array(
			'event_id'          => $event_id,
			'user_id'           => null,
			'guest_name'        => sanitize_text_field( $guest_name ),
			'guest_email'       => sanitize_email( $guest_email ),
			'rsvp_status'       => $rsvp_status,
			'attendance_status' => 'not_applicable',
			'rsvp_at'           => $now,
			'created_at'        => $now,
			'updated_at'        => $now,
		);
		$format = array( '%d', '%d', '%s', '%s', '%s', '%s', '%s', '%s', '%s' );

		// Add invitation tracking if provided.
		if ( null !== $invited_by_user_id ) {
			$data['invited_by_user_id'] = $invited_by_user_id;
			$format[]                   = '%d';
		}

		if ( null !== $invitation_id ) {
			$data['invitation_id'] = $invitation_id;
			$format[]              = '%d';
		}

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
		$result = $wpdb->insert( $table_name, $data, $format );

		return $result ? $wpdb->insert_id : false;
	}

	/**
	 * Get RSVP by ID
	 *
	 * @param int $id RSVP ID.
	 * @return array|null RSVP data or null if not found.
	 */
	public function get_rsvp_by_id( $id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$sql = $wpdb->prepare( 'SELECT * FROM %i WHERE id = %d', $table_name, $id );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.PreparedSQL.NotPrepared
		return $wpdb->get_row( $sql, ARRAY_A );
	}

	/**
	 * Get RSVP by event and user
	 *
	 * @param int $event_id Event ID.
	 * @param int $user_id  User ID.
	 * @return array|null RSVP data or null if not found.
	 */
	public function get_rsvp_by_event_and_user( $event_id, $user_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$sql = $wpdb->prepare( 'SELECT * FROM %i WHERE event_id = %d AND user_id = %d', $table_name, $event_id, $user_id );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.PreparedSQL.NotPrepared
		return $wpdb->get_row( $sql, ARRAY_A );
	}

	/**
	 * Get all RSVPs for an event
	 *
	 * @param int    $event_id          Event ID.
	 * @param string $rsvp_status       Optional. Filter by RSVP status.
	 * @param string $attendance_status Optional. Filter by attendance status.
	 * @param int    $limit             Limit results.
	 * @param int    $offset            Offset for pagination.
	 * @return array Array of RSVPs.
	 */
	public function get_rsvps_by_event( $event_id, $rsvp_status = null, $attendance_status = null, $limit = 100, $offset = 0 ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$sql  = 'SELECT * FROM %i WHERE event_id = %d';
		$args = array( $table_name, $event_id );

		if ( $rsvp_status ) {
			$sql   .= ' AND rsvp_status = %s';
			$args[] = $rsvp_status;
		}

		if ( $attendance_status ) {
			$sql   .= ' AND attendance_status = %s';
			$args[] = $attendance_status;
		}

		// ORDER BY is hardcoded, LIMIT/OFFSET use placeholders - safe.
		$sql   .= ' ORDER BY created_at DESC LIMIT %d OFFSET %d';
		$args[] = $limit;
		$args[] = $offset;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.PreparedSQL.NotPrepared,PluginCheck.Security.DirectDB.UnescapedDBParameter
		return $wpdb->get_results( $wpdb->prepare( $sql, $args ), ARRAY_A );
	}

	/**
	 * Update attendance status
	 *
	 * @param int    $id                RSVP ID.
	 * @param string $attendance_status Attendance status.
	 * @return bool True on success, false on failure.
	 */
	public function update_attendance_status( $id, $attendance_status ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching
		$result = $wpdb->update(
			$table_name,
			array(
				'attendance_status' => $attendance_status,
				'updated_at'        => current_time( 'mysql' ),
			),
			array( 'id' => $id ),
			array( '%s', '%s' ),
			array( '%d' )
		);

		return $result !== false;
	}

	/**
	 * Get all posts with RSVP block and RSVP counts
	 *
	 * Returns posts of any type (events, posts, pages, etc.) that have the RSVP block.
	 *
	 * @param string $post_status Post status filter (default: 'publish').
	 * @param string $orderby     Order by field (default: 'title').
	 * @param string $order       Order direction (default: 'ASC').
	 * @return array Array of posts with RSVP counts.
	 */
	public function get_events_with_rsvp_counts( $post_status = 'publish', $orderby = 'title', $order = 'ASC' ) {
		global $wpdb;

		$table_name        = $this->get_table_name();
		$posts_table       = $wpdb->posts;
		$postmeta_table    = $wpdb->postmeta;
		$event_dates_table = $wpdb->prefix . 'fair_event_dates';

		// Sanitize orderby and order.
		$allowed_orderby = array( 'title', 'total_rsvps', 'yes_count' );
		$orderby         = in_array( $orderby, $allowed_orderby, true ) ? $orderby : 'title';

		$order = strtoupper( $order ) === 'DESC' ? 'DESC' : 'ASC';

		// Build ORDER BY clause (validated above, safe to use directly).
		$order_clause = '';
		if ( 'title' === $orderby ) {
			$order_clause = "p.post_title {$order}";
		} elseif ( 'total_rsvps' === $orderby ) {
			$order_clause = "total_rsvps {$order}";
		} elseif ( 'yes_count' === $orderby ) {
			$order_clause = "yes_count {$order}";
		}

		$sql = $wpdb->prepare(
			"SELECT
				p.ID as event_id,
				p.post_title as title,
				COUNT(r.id) as total_rsvps,
				SUM(CASE WHEN r.rsvp_status = 'yes' THEN 1 ELSE 0 END) as yes_count,
				SUM(CASE WHEN r.rsvp_status = 'maybe' THEN 1 ELSE 0 END) as maybe_count,
				SUM(CASE WHEN r.rsvp_status = 'no' THEN 1 ELSE 0 END) as no_count,
				SUM(CASE WHEN r.rsvp_status = 'pending' THEN 1 ELSE 0 END) as pending_count,
				SUM(CASE WHEN r.rsvp_status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count,
				SUM(CASE WHEN r.attendance_status = 'checked_in' THEN 1 ELSE 0 END) as checked_in_count,
				ed.start_datetime,
				ed.end_datetime,
				ed.all_day
			FROM %i p
			INNER JOIN %i pm ON p.ID = pm.post_id
			LEFT JOIN %i r ON p.ID = r.event_id
			LEFT JOIN %i ed ON p.ID = ed.event_id
			WHERE p.post_status = %s
				AND pm.meta_key = '_has_rsvp_block'
				AND pm.meta_value = '1'
			GROUP BY p.ID, p.post_title, ed.start_datetime, ed.end_datetime, ed.all_day",
			$posts_table,
			$postmeta_table,
			$table_name,
			$event_dates_table,
			$post_status
		);

		// Append ORDER BY clause (validated above: $orderby from whitelist, $order validated to DESC/ASC only).
		$sql .= " ORDER BY {$order_clause}";

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.PreparedSQL.NotPrepared,PluginCheck.Security.DirectDB.UnescapedDBParameter
		$results = $wpdb->get_results( $sql, ARRAY_A );

		// Add permalink and format data for each result.
		foreach ( $results as &$result ) {
			$result['link']             = get_permalink( $result['event_id'] );
			$result['event_id']         = (int) $result['event_id'];
			$result['total_rsvps']      = (int) $result['total_rsvps'];
			$result['checked_in_count'] = (int) $result['checked_in_count'];
			$result['rsvp_counts']      = array(
				'yes'       => (int) $result['yes_count'],
				'maybe'     => (int) $result['maybe_count'],
				'no'        => (int) $result['no_count'],
				'pending'   => (int) $result['pending_count'],
				'cancelled' => (int) $result['cancelled_count'],
			);
			// Keep date fields for frontend formatting.
			$result['event_date'] = array(
				'start_datetime' => $result['start_datetime'],
				'end_datetime'   => $result['end_datetime'],
				'all_day'        => (bool) $result['all_day'],
			);
			// Remove individual count fields and raw date fields.
			unset( $result['yes_count'], $result['maybe_count'], $result['no_count'], $result['pending_count'], $result['cancelled_count'], $result['start_datetime'], $result['end_datetime'], $result['all_day'] );
		}

		return $results;
	}

	/**
	 * Get participants for an event with user information
	 *
	 * Supports both registered users and guest RSVPs.
	 * Email is excluded for privacy (only used for avatar).
	 *
	 * @param int    $event_id    Event ID.
	 * @param string $rsvp_status Optional. Filter by RSVP status (default: 'yes').
	 * @return array Array of participants with user data.
	 */
	public function get_participants_with_user_data( $event_id, $rsvp_status = 'yes' ) {
		global $wpdb;

		$table_name  = $this->get_table_name();
		$users_table = $wpdb->users;

		$sql = $wpdb->prepare(
			'SELECT
				r.user_id,
				r.guest_name,
				COALESCE(u.display_name, r.guest_name) as display_name,
				COALESCE(u.user_email, r.guest_email) as user_email,
				r.rsvp_status,
				r.rsvp_at
			FROM %i r
			LEFT JOIN %i u ON r.user_id = u.ID
			WHERE r.event_id = %d AND r.rsvp_status = %s
			ORDER BY r.rsvp_at ASC',
			$table_name,
			$users_table,
			$event_id,
			$rsvp_status
		);

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.PreparedSQL.NotPrepared
		$results = $wpdb->get_results( $sql, ARRAY_A );

		// Add avatar URL to each result.
		foreach ( $results as &$result ) {
			// For guests, user_id will be NULL, use 0 for avatar.
			$avatar_user_id       = ! empty( $result['user_id'] ) ? (int) $result['user_id'] : 0;
			$result['user_id']    = ! empty( $result['user_id'] ) ? (int) $result['user_id'] : null;
			$result['avatar_url'] = get_avatar_url( $avatar_user_id, array( 'size' => 48 ) );
			// Remove email for privacy (will be used only for gravatar).
			unset( $result['user_email'], $result['guest_name'] );
		}

		return $results;
	}

	/**
	 * Get participants who checked in to the event
	 *
	 * Returns only participants with attendance_status = 'checked_in'.
	 * Used for displaying actual attendees after an event has ended.
	 *
	 * @param int $event_id Event ID.
	 * @return array Array of participants who attended.
	 */
	public function get_checked_in_participants( $event_id ) {
		global $wpdb;

		$table_name  = $this->get_table_name();
		$users_table = $wpdb->users;

		$sql = $wpdb->prepare(
			'SELECT
				r.user_id,
				r.guest_name,
				COALESCE(u.display_name, r.guest_name) as display_name,
				COALESCE(u.user_email, r.guest_email) as user_email,
				r.attendance_status,
				r.rsvp_at
			FROM %i r
			LEFT JOIN %i u ON r.user_id = u.ID
			WHERE r.event_id = %d AND r.attendance_status = %s
			ORDER BY r.rsvp_at ASC',
			$table_name,
			$users_table,
			$event_id,
			'checked_in'
		);

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.PreparedSQL.NotPrepared
		$results = $wpdb->get_results( $sql, ARRAY_A );

		// Add avatar URL to each result.
		foreach ( $results as &$result ) {
			// For guests, user_id will be NULL, use 0 for avatar.
			$avatar_user_id       = ! empty( $result['user_id'] ) ? (int) $result['user_id'] : 0;
			$result['user_id']    = ! empty( $result['user_id'] ) ? (int) $result['user_id'] : null;
			$result['avatar_url'] = get_avatar_url( $avatar_user_id, array( 'size' => 48 ) );
			// Remove email for privacy (will be used only for gravatar).
			unset( $result['user_email'], $result['guest_name'] );
		}

		return $results;
	}

	/**
	 * Get event end datetime
	 *
	 * @param int $event_id Event ID.
	 * @return string|null Event end datetime in MySQL format, or null if not found.
	 */
	public function get_event_end_datetime( $event_id ) {
		global $wpdb;

		$event_dates_table = $wpdb->prefix . 'fair_event_dates';

		$sql = $wpdb->prepare(
			'SELECT end_datetime FROM %i WHERE event_id = %d',
			$event_dates_table,
			$event_id
		);

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.PreparedSQL.NotPrepared
		return $wpdb->get_var( $sql );
	}

	/**
	 * Bulk update attendance status for multiple RSVPs
	 *
	 * @param array $updates Array of arrays with 'id' and 'attendance_status' keys.
	 * @return array Array with 'success' count and 'failed' IDs.
	 */
	public function bulk_update_attendance( $updates ) {
		global $wpdb;

		$table_name = $this->get_table_name();
		$now        = current_time( 'mysql' );
		$success    = 0;
		$failed     = array();

		foreach ( $updates as $update ) {
			if ( ! isset( $update['id'] ) || ! isset( $update['attendance_status'] ) ) {
				continue;
			}

			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching
			$result = $wpdb->update(
				$table_name,
				array(
					'attendance_status' => $update['attendance_status'],
					'updated_at'        => $now,
				),
				array( 'id' => $update['id'] ),
				array( '%s', '%s' ),
				array( '%d' )
			);

			if ( false === $result ) {
				$failed[] = $update['id'];
			} else {
				++$success;
			}
		}

		return array(
			'success' => $success,
			'failed'  => $failed,
		);
	}

	/**
	 * Get all users suitable for event attendance selection
	 *
	 * @return array Array of user data with id, display_name, user_email
	 */
	public function get_all_users_for_selection() {
		$users = get_users(
			array(
				'orderby' => 'display_name',
				'order'   => 'ASC',
				'fields'  => array( 'ID', 'display_name', 'user_email' ),
			)
		);

		$user_data = array();
		foreach ( $users as $user ) {
			$user_data[] = array(
				'user_id'      => (int) $user->ID,
				'display_name' => $user->display_name,
				'user_email'   => $user->user_email,
			);
		}

		return $user_data;
	}

	/**
	 * Get participants for attendance check with full user information
	 *
	 * Similar to get_participants_with_user_data but includes email for search.
	 * Only use this method for privileged views (event editors).
	 * Supports both registered users and guest RSVPs.
	 *
	 * @param int    $event_id    Event ID.
	 * @param string $rsvp_status Optional. Filter by RSVP status (default: 'yes').
	 * @return array Array of participants with full user data including email.
	 */
	public function get_participants_for_attendance_check( $event_id, $rsvp_status = 'yes' ) {
		global $wpdb;

		$table_name  = $this->get_table_name();
		$users_table = $wpdb->users;

		$sql = $wpdb->prepare(
			'SELECT
				r.id as rsvp_id,
				r.user_id,
				r.guest_name,
				r.guest_email,
				COALESCE(u.display_name, r.guest_name) as display_name,
				COALESCE(u.user_email, r.guest_email) as email,
				r.rsvp_status,
				r.attendance_status,
				r.rsvp_at
			FROM %i r
			LEFT JOIN %i u ON r.user_id = u.ID
			WHERE r.event_id = %d AND r.rsvp_status = %s
			ORDER BY r.rsvp_at ASC',
			$table_name,
			$users_table,
			$event_id,
			$rsvp_status
		);

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.PreparedSQL.NotPrepared
		$results = $wpdb->get_results( $sql, ARRAY_A );

		// Format results with avatar URL.
		$formatted = array();
		foreach ( $results as $result ) {
			// For guests, user_id will be NULL, use 0 for avatar.
			$avatar_user_id = ! empty( $result['user_id'] ) ? (int) $result['user_id'] : 0;

			$formatted[] = array(
				'rsvp_id'           => (int) $result['rsvp_id'],
				'id'                => ! empty( $result['user_id'] ) ? (int) $result['user_id'] : null,
				'name'              => $result['display_name'],
				'email'             => $result['email'],
				'avatar_url'        => get_avatar_url( $avatar_user_id, array( 'size' => 48 ) ),
				'attendance_status' => $result['attendance_status'],
			);
		}

		return $formatted;
	}

	/**
	 * Get RSVP statistics for a specific user
	 *
	 * @param int $user_id User ID to get stats for.
	 * @return array Stats including total_rsvps, yes_count, maybe_count, no_count, checked_in_count, attendance_rate.
	 */
	public function get_user_rsvp_stats( $user_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$sql = $wpdb->prepare(
			"SELECT
				COUNT(*) as total_rsvps,
				SUM(CASE WHEN rsvp_status = 'yes' THEN 1 ELSE 0 END) as yes_count,
				SUM(CASE WHEN rsvp_status = 'maybe' THEN 1 ELSE 0 END) as maybe_count,
				SUM(CASE WHEN rsvp_status = 'no' THEN 1 ELSE 0 END) as no_count,
				SUM(CASE WHEN rsvp_status = 'pending' THEN 1 ELSE 0 END) as pending_count,
				SUM(CASE WHEN attendance_status = 'checked_in' THEN 1 ELSE 0 END) as checked_in_count
			FROM %i
			WHERE user_id = %d",
			$table_name,
			$user_id
		);

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.PreparedSQL.NotPrepared
		$result = $wpdb->get_row( $sql, ARRAY_A );

		if ( ! $result ) {
			return array(
				'total_rsvps'      => 0,
				'yes_count'        => 0,
				'maybe_count'      => 0,
				'no_count'         => 0,
				'pending_count'    => 0,
				'checked_in_count' => 0,
				'attendance_rate'  => 0,
			);
		}

		// Calculate attendance rate.
		$yes_count                 = (int) $result['yes_count'];
		$checked_in_count          = (int) $result['checked_in_count'];
		$result['attendance_rate'] = $yes_count > 0 ? round( ( $checked_in_count / $yes_count ) * 100, 1 ) : 0;

		// Convert string numbers to integers.
		$result['total_rsvps']      = (int) $result['total_rsvps'];
		$result['yes_count']        = $yes_count;
		$result['maybe_count']      = (int) $result['maybe_count'];
		$result['no_count']         = (int) $result['no_count'];
		$result['pending_count']    = (int) $result['pending_count'];
		$result['checked_in_count'] = $checked_in_count;

		return $result;
	}

	/**
	 * Get event history for a specific user (RSVPs and invitations)
	 *
	 * @param int $user_id User ID to get history for.
	 * @return array Event history with RSVP and invitation information.
	 */
	public function get_user_events_history( $user_id ) {
		global $wpdb;

		$table_name        = $this->get_table_name();
		$invitations_table = $wpdb->prefix . 'fair_rsvp_invitations';

		$sql = $wpdb->prepare(
			"SELECT
				r.event_id,
				p.post_title as event_title,
				r.rsvp_status,
				r.attendance_status,
				r.rsvp_at,
				r.invited_by_user_id,
				u.display_name as invited_by_name,
				CASE WHEN i.id IS NOT NULL THEN 1 ELSE 0 END as was_invited
			FROM %i r
			LEFT JOIN {$wpdb->posts} p ON r.event_id = p.ID
			LEFT JOIN {$wpdb->users} u ON r.invited_by_user_id = u.ID
			LEFT JOIN %i i ON r.invitation_id = i.id
			WHERE r.user_id = %d
			ORDER BY r.rsvp_at DESC",
			$table_name,
			$invitations_table,
			$user_id
		);

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.PreparedSQL.NotPrepared
		$results = $wpdb->get_results( $sql, ARRAY_A );

		return $results ? $results : array();
	}

	/**
	 * Get RSVP statistics for all users (admin view)
	 *
	 * @return array Array of user stats with RSVP and invitation data.
	 */
	public function get_all_users_stats() {
		global $wpdb;

		$table_name        = $this->get_table_name();
		$invitations_table = $wpdb->prefix . 'fair_rsvp_invitations';

		$sql = "
			SELECT
				u.ID as user_id,
				u.display_name as user_name,
				u.user_email,
				COUNT(DISTINCT r.id) as total_rsvps,
				SUM(CASE WHEN r.rsvp_status = 'yes' THEN 1 ELSE 0 END) as yes_count,
				SUM(CASE WHEN r.attendance_status = 'checked_in' THEN 1 ELSE 0 END) as checked_in_count,
				COUNT(DISTINCT i.id) as invitations_sent,
				SUM(CASE WHEN i.invitation_status = 'accepted' THEN 1 ELSE 0 END) as invitations_accepted
			FROM {$wpdb->users} u
			LEFT JOIN %i r ON u.ID = r.user_id
			LEFT JOIN %i i ON u.ID = i.inviter_user_id
			WHERE r.id IS NOT NULL OR i.id IS NOT NULL
			GROUP BY u.ID, u.display_name, u.user_email
			HAVING total_rsvps > 0 OR invitations_sent > 0
			ORDER BY total_rsvps DESC, invitations_sent DESC
		";

		$prepare_values = array( $table_name, $invitations_table );

		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$prepared_sql = $wpdb->prepare( $sql, ...$prepare_values );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.PreparedSQL.NotPrepared
		$results = $wpdb->get_results( $prepared_sql, ARRAY_A );

		// Calculate attendance and acceptance rates.
		foreach ( $results as &$result ) {
			$yes_count            = (int) $result['yes_count'];
			$checked_in_count     = (int) $result['checked_in_count'];
			$invitations_sent     = (int) $result['invitations_sent'];
			$invitations_accepted = (int) $result['invitations_accepted'];

			$result['attendance_rate'] = $yes_count > 0 ? round( ( $checked_in_count / $yes_count ) * 100, 1 ) : 0;
			$result['acceptance_rate'] = $invitations_sent > 0 ? round( ( $invitations_accepted / $invitations_sent ) * 100, 1 ) : 0;

			// Convert to integers.
			$result['user_id']              = (int) $result['user_id'];
			$result['total_rsvps']          = (int) $result['total_rsvps'];
			$result['yes_count']            = $yes_count;
			$result['checked_in_count']     = $checked_in_count;
			$result['invitations_sent']     = $invitations_sent;
			$result['invitations_accepted'] = $invitations_accepted;
		}

		return $results ? $results : array();
	}

	/**
	 * Get top users leaderboard (best attendees and inviters)
	 *
	 * @param int $limit Number of users to return per category.
	 * @return array Array with 'top_attendees' and 'top_inviters' keys.
	 */
	public function get_top_users( $limit = 10 ) {
		global $wpdb;

		$table_name        = $this->get_table_name();
		$invitations_table = $wpdb->prefix . 'fair_rsvp_invitations';

		// Top attendees (most checked-in).
		$attendees_sql = $wpdb->prepare(
			"SELECT
				u.ID as user_id,
				u.display_name as user_name,
				u.user_email,
				COUNT(*) as events_attended
			FROM {$wpdb->users} u
			INNER JOIN %i r ON u.ID = r.user_id
			WHERE r.attendance_status = 'checked_in'
			GROUP BY u.ID, u.display_name, u.user_email
			ORDER BY events_attended DESC
			LIMIT %d",
			$table_name,
			$limit
		);

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.PreparedSQL.NotPrepared
		$top_attendees = $wpdb->get_results( $attendees_sql, ARRAY_A );

		// Top inviters (highest acceptance rate, minimum 5 invitations).
		$inviters_sql = $wpdb->prepare(
			"SELECT
				u.ID as user_id,
				u.display_name as user_name,
				u.user_email,
				COUNT(*) as invitations_sent,
				SUM(CASE WHEN i.invitation_status = 'accepted' THEN 1 ELSE 0 END) as invitations_accepted
			FROM {$wpdb->users} u
			INNER JOIN %i i ON u.ID = i.inviter_user_id
			GROUP BY u.ID, u.display_name, u.user_email
			HAVING invitations_sent >= 5
			ORDER BY (invitations_accepted / invitations_sent) DESC, invitations_sent DESC
			LIMIT %d",
			$invitations_table,
			$limit
		);

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.PreparedSQL.NotPrepared
		$top_inviters = $wpdb->get_results( $inviters_sql, ARRAY_A );

		// Calculate acceptance rate for inviters.
		foreach ( $top_inviters as &$inviter ) {
			$sent                       = (int) $inviter['invitations_sent'];
			$accepted                   = (int) $inviter['invitations_accepted'];
			$inviter['acceptance_rate'] = $sent > 0 ? round( ( $accepted / $sent ) * 100, 1 ) : 0;
			$inviter['user_id']         = (int) $inviter['user_id'];
		}

		// Format attendees.
		foreach ( $top_attendees as &$attendee ) {
			$attendee['user_id']         = (int) $attendee['user_id'];
			$attendee['events_attended'] = (int) $attendee['events_attended'];
		}

		return array(
			'top_attendees' => $top_attendees ? $top_attendees : array(),
			'top_inviters'  => $top_inviters ? $top_inviters : array(),
		);
	}
}
