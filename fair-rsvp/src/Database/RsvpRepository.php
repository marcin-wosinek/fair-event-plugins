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
	 * @param int    $event_id     Event/post ID.
	 * @param int    $user_id      User ID.
	 * @param string $rsvp_status  RSVP status (yes, maybe, no, cancelled).
	 * @return int|false RSVP ID on success, false on failure.
	 */
	public function upsert_rsvp( $event_id, $user_id, $rsvp_status ) {
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
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			$result = $wpdb->insert(
				$table_name,
				array(
					'event_id'          => $event_id,
					'user_id'           => $user_id,
					'rsvp_status'       => $rsvp_status,
					'attendance_status' => 'not_applicable',
					'rsvp_at'           => $now,
					'created_at'        => $now,
					'updated_at'        => $now,
				),
				array( '%d', '%d', '%s', '%s', '%s', '%s', '%s' )
			);

			return $result ? $wpdb->insert_id : false;
		}
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

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$sql  = "SELECT * FROM {$table_name} WHERE event_id = %d";
		$args = array( $event_id );

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
				u.display_name,
				u.user_email,
				r.rsvp_status,
				r.rsvp_at
			FROM %i r
			INNER JOIN %i u ON r.user_id = u.ID
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
			$result['user_id']    = (int) $result['user_id'];
			$result['avatar_url'] = get_avatar_url( $result['user_id'], array( 'size' => 48 ) );
			// Remove email for privacy (will be used only for gravatar).
			unset( $result['user_email'] );
		}

		return $results;
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
				u.display_name,
				u.user_email,
				r.rsvp_status,
				r.attendance_status,
				r.rsvp_at
			FROM %i r
			INNER JOIN %i u ON r.user_id = u.ID
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
			$formatted[] = array(
				'rsvp_id'           => (int) $result['rsvp_id'],
				'id'                => (int) $result['user_id'],
				'name'              => $result['display_name'],
				'email'             => $result['user_email'],
				'avatar_url'        => get_avatar_url( $result['user_id'], array( 'size' => 48 ) ),
				'attendance_status' => $result['attendance_status'],
			);
		}

		return $formatted;
	}

	/**
	 * Create or get user for walk-in attendee
	 *
	 * @param string $name  Attendee name.
	 * @param string $email Optional. Attendee email.
	 * @return int|false User ID on success, false on failure.
	 */
	public function get_or_create_walk_in_user( $name, $email = '' ) {
		// If email provided, check if user exists.
		if ( ! empty( $email ) && is_email( $email ) ) {
			$user = get_user_by( 'email', $email );
			if ( $user ) {
				return $user->ID;
			}

			// Create new user with email.
			$username = sanitize_user( $email, true );
			// Make username unique if needed.
			if ( username_exists( $username ) ) {
				$username = $username . '_' . wp_rand( 1000, 9999 );
			}

			$user_id = wp_create_user( $username, wp_generate_password(), $email );
			if ( is_wp_error( $user_id ) ) {
				return false;
			}

			// Update display name.
			wp_update_user(
				array(
					'ID'           => $user_id,
					'display_name' => sanitize_text_field( $name ),
					'role'         => 'subscriber',
				)
			);

			return $user_id;
		}

		// No email - create a guest user with username based on name.
		$username = sanitize_user( strtolower( str_replace( ' ', '_', $name ) ), true );
		// Make username unique.
		$base_username = $username;
		$counter       = 1;
		while ( username_exists( $username ) ) {
			$username = $base_username . '_' . $counter;
			++$counter;
		}

		$user_id = wp_create_user( $username, wp_generate_password() );
		if ( is_wp_error( $user_id ) ) {
			return false;
		}

		// Update display name and set as subscriber.
		wp_update_user(
			array(
				'ID'           => $user_id,
				'display_name' => sanitize_text_field( $name ),
				'role'         => 'subscriber',
			)
		);

		return $user_id;
	}
}
