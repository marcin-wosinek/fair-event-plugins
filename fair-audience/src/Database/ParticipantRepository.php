<?php
/**
 * Participant Repository
 *
 * @package FairAudience
 */

namespace FairAudience\Database;

use FairAudience\Models\Participant;

defined( 'WPINC' ) || die;

/**
 * Repository for participant data access.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class ParticipantRepository {

	/**
	 * Get table name.
	 *
	 * @return string Table name.
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_audience_participants';
	}

	/**
	 * Get all participants.
	 *
	 * @param string $orderby Column to order by.
	 * @param string $order   Order direction (ASC/DESC).
	 * @return Participant[] Array of participants.
	 */
	public function get_all( $orderby = 'surname', $order = 'ASC' ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$allowed_orderby = array( 'id', 'name', 'surname', 'email', 'created_at' );
		$orderby         = in_array( $orderby, $allowed_orderby, true ) ? $orderby : 'surname';
		$order           = in_array( strtoupper( $order ), array( 'ASC', 'DESC' ), true ) ? strtoupper( $order ) : 'ASC';

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $order is safely validated above.
		$results = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM %i ORDER BY %i $order",
				$table_name,
				$orderby
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

		return array_map(
			function ( $row ) {
				return new Participant( $row );
			},
			$results
		);
	}

	/**
	 * Get participant by ID.
	 *
	 * @param int $id Participant ID.
	 * @return Participant|null Participant or null if not found.
	 */
	public function get_by_id( $id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE id = %d',
				$table_name,
				$id
			),
			ARRAY_A
		);

		return $result ? new Participant( $result ) : null;
	}

	/**
	 * Get participant by email.
	 *
	 * @param string $email Email address.
	 * @return Participant|null Participant or null if not found.
	 */
	public function get_by_email( $email ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE email = %s',
				$table_name,
				$email
			),
			ARRAY_A
		);

		return $result ? new Participant( $result ) : null;
	}

	/**
	 * Get participant by WordPress user ID.
	 *
	 * @param int $wp_user_id WordPress user ID.
	 * @return Participant|null Participant or null if not found.
	 */
	public function get_by_user_id( $wp_user_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE wp_user_id = %d',
				$table_name,
				$wp_user_id
			),
			ARRAY_A
		);

		return $result ? new Participant( $result ) : null;
	}

	/**
	 * Search participants by name or email.
	 *
	 * @param string $search_term Search term.
	 * @return Participant[] Array of participants.
	 */
	public function search( $search_term ) {
		global $wpdb;

		$table_name = $this->get_table_name();
		$like       = '%' . $wpdb->esc_like( $search_term ) . '%';

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE name LIKE %s OR surname LIKE %s OR email LIKE %s ORDER BY surname ASC',
				$table_name,
				$like,
				$like,
				$like
			),
			ARRAY_A
		);

		return array_map(
			function ( $row ) {
				return new Participant( $row );
			},
			$results
		);
	}

	/**
	 * Build WHERE clause and prepare args for filtered queries.
	 *
	 * @param array $args Filter arguments.
	 * @return array Array with 'where_sql' and 'prepare_args' keys.
	 */
	private function build_where_clause( $args ) {
		global $wpdb;

		$where_clauses = array();
		$prepare_args  = array();

		// Search filter.
		if ( ! empty( $args['search'] ) ) {
			$like            = '%' . $wpdb->esc_like( $args['search'] ) . '%';
			$where_clauses[] = '(name LIKE %s OR surname LIKE %s OR email LIKE %s)';
			$prepare_args[]  = $like;
			$prepare_args[]  = $like;
			$prepare_args[]  = $like;
		}

		// Email profile filter.
		$allowed_email_profiles = array( 'minimal', 'marketing' );
		if ( ! empty( $args['email_profile'] ) && in_array( $args['email_profile'], $allowed_email_profiles, true ) ) {
			$where_clauses[] = 'email_profile = %s';
			$prepare_args[]  = $args['email_profile'];
		}

		// Status filter.
		$allowed_statuses = array( 'pending', 'confirmed' );
		if ( ! empty( $args['status'] ) && in_array( $args['status'], $allowed_statuses, true ) ) {
			$where_clauses[] = 'status = %s';
			$prepare_args[]  = $args['status'];
		}

		$where_sql = '';
		if ( ! empty( $where_clauses ) ) {
			$where_sql = 'WHERE ' . implode( ' AND ', $where_clauses );
		}

		return array(
			'where_sql'    => $where_sql,
			'prepare_args' => $prepare_args,
		);
	}

	/**
	 * Get filtered participants with optional search, filters, sorting, and pagination.
	 *
	 * @param array $args {
	 *     Optional. Arguments for filtering, sorting, and pagination.
	 *
	 *     @type string $search        Search term for name/surname/email.
	 *     @type string $email_profile Filter by email profile (minimal, marketing).
	 *     @type string $status        Filter by status (pending, confirmed).
	 *     @type string $orderby       Column to order by.
	 *     @type string $order         Order direction (ASC/DESC).
	 *     @type int    $per_page      Number of items per page (0 for all).
	 *     @type int    $page          Page number (1-indexed).
	 * }
	 * @return Participant[] Array of participants.
	 */
	public function get_filtered( $args = array() ) {
		global $wpdb;

		$defaults = array(
			'search'        => '',
			'email_profile' => '',
			'status'        => '',
			'orderby'       => 'surname',
			'order'         => 'ASC',
			'per_page'      => 0,
			'page'          => 1,
		);

		$args = wp_parse_args( $args, $defaults );

		$table_name       = $this->get_table_name();
		$event_table_name = $wpdb->prefix . 'fair_audience_event_participants';
		$group_table_name = $wpdb->prefix . 'fair_audience_group_participants';

		// Validate orderby - includes event count and group count columns.
		$allowed_orderby      = array( 'id', 'name', 'surname', 'email', 'email_profile', 'status', 'created_at' );
		$event_count_orderbys = array( 'events_signed_up', 'events_collaborated', 'events_interested' );
		$is_event_count_order = in_array( $args['orderby'], $event_count_orderbys, true );
		$is_group_count_order = 'groups' === $args['orderby'];
		$orderby              = in_array( $args['orderby'], $allowed_orderby, true ) ? $args['orderby'] : ( $is_event_count_order || $is_group_count_order ? $args['orderby'] : 'surname' );
		$order                = in_array( strtoupper( $args['order'] ), array( 'ASC', 'DESC' ), true ) ? strtoupper( $args['order'] ) : 'ASC';

		// Build WHERE clause.
		$where_data   = $this->build_where_clause( $args );
		$where_sql    = $where_data['where_sql'];
		$prepare_args = array_merge( array( $table_name ), $where_data['prepare_args'] );

		// Build pagination.
		$limit_sql = '';
		if ( $args['per_page'] > 0 ) {
			$offset    = ( max( 1, (int) $args['page'] ) - 1 ) * (int) $args['per_page'];
			$limit_sql = ' LIMIT %d OFFSET %d';
		}

		// Use different query for event count sorting, group count sorting, or regular column sorting.
		if ( $is_event_count_order ) {
			// Map orderby to label value.
			$label_map = array(
				'events_signed_up'    => 'signed_up',
				'events_collaborated' => 'collaborator',
				'events_interested'   => 'interested',
			);
			$label     = $label_map[ $args['orderby'] ];

			// Add event table and label to prepare args.
			$prepare_args[] = $event_table_name;
			$prepare_args[] = $label;

			if ( $args['per_page'] > 0 ) {
				$prepare_args[] = (int) $args['per_page'];
				$prepare_args[] = $offset;
			}

			// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- $where_sql, $order, and $limit_sql are safely constructed with validated values.
			$results = $wpdb->get_results(
				$wpdb->prepare(
					"SELECT p.*, COALESCE(event_counts.cnt, 0) as event_count
					FROM %i p
					LEFT JOIN (
						SELECT participant_id, COUNT(*) as cnt
						FROM %i
						WHERE label = %s
						GROUP BY participant_id
					) event_counts ON p.id = event_counts.participant_id
					$where_sql
					ORDER BY event_count $order, p.surname ASC
					$limit_sql",
					$prepare_args
				),
				ARRAY_A
			);
			// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber
		} elseif ( $is_group_count_order ) {
			// Add group table to prepare args.
			$prepare_args[] = $group_table_name;

			if ( $args['per_page'] > 0 ) {
				$prepare_args[] = (int) $args['per_page'];
				$prepare_args[] = $offset;
			}

			// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- $where_sql, $order, and $limit_sql are safely constructed with validated values.
			$results = $wpdb->get_results(
				$wpdb->prepare(
					"SELECT p.*, COALESCE(group_counts.cnt, 0) as group_count
					FROM %i p
					LEFT JOIN (
						SELECT participant_id, COUNT(*) as cnt
						FROM %i
						GROUP BY participant_id
					) group_counts ON p.id = group_counts.participant_id
					$where_sql
					ORDER BY group_count $order, p.surname ASC
					$limit_sql",
					$prepare_args
				),
				ARRAY_A
			);
			// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber
		} else {
			// Regular column sorting.
			$prepare_args[] = $orderby;

			if ( $args['per_page'] > 0 ) {
				$prepare_args[] = (int) $args['per_page'];
				$prepare_args[] = $offset;
			}

			// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- $where_sql, $order, and $limit_sql are safely constructed with validated values.
			$results = $wpdb->get_results(
				$wpdb->prepare(
					"SELECT * FROM %i $where_sql ORDER BY %i $order$limit_sql",
					$prepare_args
				),
				ARRAY_A
			);
			// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber
		}

		return array_map(
			function ( $row ) {
				return new Participant( $row );
			},
			$results
		);
	}

	/**
	 * Get count of filtered participants.
	 *
	 * @param array $args {
	 *     Optional. Arguments for filtering.
	 *
	 *     @type string $search        Search term for name/surname/email.
	 *     @type string $email_profile Filter by email profile (minimal, marketing).
	 *     @type string $status        Filter by status (pending, confirmed).
	 * }
	 * @return int Count of matching participants.
	 */
	public function get_filtered_count( $args = array() ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		// Build WHERE clause.
		$where_data   = $this->build_where_clause( $args );
		$where_sql    = $where_data['where_sql'];
		$prepare_args = array_merge( array( $table_name ), $where_data['prepare_args'] );

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- $where_sql is safely constructed with validated values.
		return (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM %i $where_sql",
				$prepare_args
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber
	}

	/**
	 * Get total count of participants.
	 *
	 * @return int Count.
	 */
	public function get_count() {
		global $wpdb;

		$table_name = $this->get_table_name();

		return (int) $wpdb->get_var(
			$wpdb->prepare( 'SELECT COUNT(*) FROM %i', $table_name )
		);
	}
}
