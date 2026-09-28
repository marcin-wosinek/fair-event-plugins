<?php
/**
 * Questionnaire Submission Repository
 *
 * @package FairForm
 */

namespace FairForm\Database;

use FairForm\Models\QuestionnaireSubmission;

defined( 'WPINC' ) || die;

/**
 * Repository for questionnaire submission data access.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 * phpcs:disable WordPress.DB.PreparedSQL.NotPrepared
 */
class QuestionnaireSubmissionRepository {

	/**
	 * Get table name.
	 *
	 * @return string Table name.
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_audience_questionnaire_submissions';
	}

	/**
	 * Get all submissions.
	 *
	 * @return QuestionnaireSubmission[] Array of submissions.
	 */
	public function get_all() {
		global $wpdb;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i ORDER BY created_at DESC',
				$table_name
			),
			ARRAY_A
		);

		return array_map(
			function ( $row ) {
				return new QuestionnaireSubmission( $row );
			},
			$results
		);
	}

	/**
	 * Get a submission by ID.
	 *
	 * @param int $id Submission ID.
	 * @return QuestionnaireSubmission|null Submission or null if not found.
	 */
	public function get_by_id( $id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$row = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE id = %d',
				$table_name,
				$id
			),
			ARRAY_A
		);

		if ( ! $row ) {
			return null;
		}

		return new QuestionnaireSubmission( $row );
	}

	/**
	 * Get submissions by participant.
	 *
	 * @param int $participant_id Participant ID.
	 * @return QuestionnaireSubmission[] Array of submissions.
	 */
	public function get_by_participant( $participant_id ) {
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
				return new QuestionnaireSubmission( $row );
			},
			$results
		);
	}

	/**
	 * Get submissions by event date.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return QuestionnaireSubmission[] Array of submissions.
	 */
	public function get_by_event_date( $event_date_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE event_date_id = %d ORDER BY created_at DESC',
				$table_name,
				$event_date_id
			),
			ARRAY_A
		);

		return array_map(
			function ( $row ) {
				return new QuestionnaireSubmission( $row );
			},
			$results
		);
	}

	/**
	 * Get submissions by post.
	 *
	 * @param int $post_id Post ID.
	 * @return QuestionnaireSubmission[] Array of submissions.
	 */
	public function get_by_post( $post_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE post_id = %d ORDER BY created_at DESC',
				$table_name,
				$post_id
			),
			ARRAY_A
		);

		return array_map(
			function ( $row ) {
				return new QuestionnaireSubmission( $row );
			},
			$results
		);
	}

	/**
	 * Get total count of submissions, optionally filtered.
	 *
	 * @param array $filters Optional filters: participant_id, event_date_id, post_id.
	 * @return int Count.
	 */
	public function get_count( $filters = array() ) {
		global $wpdb;

		$table_name = $this->get_table_name();
		$where      = array();
		$values     = array( $table_name );

		if ( ! empty( $filters['participant_id'] ) ) {
			$where[]  = 'participant_id = %d';
			$values[] = $filters['participant_id'];
		}

		if ( ! empty( $filters['event_date_id'] ) ) {
			$where[]  = 'event_date_id = %d';
			$values[] = $filters['event_date_id'];
		}

		if ( ! empty( $filters['post_id'] ) ) {
			$where[]  = 'post_id = %d';
			$values[] = $filters['post_id'];
		}

		$sql = 'SELECT COUNT(*) FROM %i';

		if ( ! empty( $where ) ) {
			$sql .= ' WHERE ' . implode( ' AND ', $where );
		}

		return (int) $wpdb->get_var(
			$wpdb->prepare( $sql, ...$values )
		);
	}

	/**
	 * Get submissions matching multiple filters.
	 *
	 * @param array $filters Associative array of filters: event_date_id, post_id, title, participant_id.
	 * @return QuestionnaireSubmission[] Array of submissions.
	 */
	public function get_by_filters( $filters = array() ) {
		global $wpdb;

		$table_name = $this->get_table_name();
		$where      = array();
		$values     = array( $table_name );

		if ( ! empty( $filters['event_date_id'] ) ) {
			$where[]  = 'event_date_id = %d';
			$values[] = $filters['event_date_id'];
		}

		if ( ! empty( $filters['post_id'] ) ) {
			$where[]  = 'post_id = %d';
			$values[] = $filters['post_id'];
		}

		if ( ! empty( $filters['title'] ) ) {
			$where[]  = 'title = %s';
			$values[] = $filters['title'];
		}

		if ( ! empty( $filters['participant_id'] ) ) {
			$where[]  = 'participant_id = %d';
			$values[] = $filters['participant_id'];
		}

		if ( ! empty( $filters['form_id'] ) ) {
			$where[]  = 'form_id = %s';
			$values[] = $filters['form_id'];
		}

		if ( ! empty( $filters['ticket_id'] ) ) {
			$where[]  = 'ticket_id = %d';
			$values[] = $filters['ticket_id'];
		}

		$sql = 'SELECT * FROM %i';

		if ( ! empty( $where ) ) {
			$sql .= ' WHERE ' . implode( ' AND ', $where );
		}

		$sql .= ' ORDER BY created_at DESC';

		$results = $wpdb->get_results(
			$wpdb->prepare( $sql, ...$values ),
			ARRAY_A
		);

		return array_map(
			function ( $row ) {
				return new QuestionnaireSubmission( $row );
			},
			$results
		);
	}

	/**
	 * Get the submissions linked to any of the given tickets, oldest first.
	 *
	 * @param int[] $ticket_ids Ticket IDs.
	 * @return QuestionnaireSubmission[] Array of submissions.
	 */
	public function get_by_ticket_ids( array $ticket_ids ) {
		global $wpdb;

		$ticket_ids = array_values( array_filter( array_map( 'intval', $ticket_ids ) ) );
		if ( ! $ticket_ids ) {
			return array();
		}

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE ticket_id IN (' . implode( ', ', array_fill( 0, count( $ticket_ids ), '%d' ) ) . ') ORDER BY id ASC',
				array_merge( array( $this->get_table_name() ), $ticket_ids )
			),
			ARRAY_A
		);

		return array_map(
			function ( $row ) {
				return new QuestionnaireSubmission( $row );
			},
			$results
		);
	}

	/**
	 * Detach submissions from tickets that are being removed. The
	 * submissions and their answers are kept at participant scope and
	 * flagged for review; they are never moved to another ticket.
	 *
	 * @param int[] $ticket_ids Ticket IDs being removed.
	 * @return int|false Number of submissions detached, or false on error.
	 */
	public function unlink_tickets( array $ticket_ids ) {
		global $wpdb;

		$ticket_ids = array_values( array_filter( array_map( 'intval', $ticket_ids ) ) );
		if ( ! $ticket_ids ) {
			return 0;
		}

		return $wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET ticket_id = NULL, ticket_link = %s WHERE ticket_id IN (' . implode( ', ', array_fill( 0, count( $ticket_ids ), '%d' ) ) . ')',
				array_merge( array( $this->get_table_name(), QuestionnaireSubmission::LINK_TICKET_REMOVED ), $ticket_ids )
			)
		);
	}

	/**
	 * Set how a submission is linked to a ticket.
	 *
	 * @param int      $id          Submission ID.
	 * @param int|null $ticket_id   Ticket ID, or null for none.
	 * @param string   $ticket_link A QuestionnaireSubmission::LINK_* value.
	 * @return bool Success.
	 */
	public function set_ticket_link( $id, $ticket_id, $ticket_link ) {
		global $wpdb;

		return false !== $wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET ticket_id = NULLIF(%d, 0), ticket_link = %s WHERE id = %d',
				$this->get_table_name(),
				(int) $ticket_id,
				$ticket_link,
				(int) $id
			)
		);
	}

	/**
	 * Get form summaries grouped by post_id for a given event date.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return array Array of form summary objects with post_id, title, post_title, and submission_count.
	 */
	public function get_forms_summary_by_event_date( $event_date_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT post_id, title, COUNT(*) AS submission_count FROM %i WHERE event_date_id = %d GROUP BY post_id, title ORDER BY submission_count DESC',
				$table_name,
				$event_date_id
			),
			ARRAY_A
		);

		return array_map(
			function ( $row ) {
				$post_title = '';
				if ( ! empty( $row['post_id'] ) ) {
					$post = get_post( (int) $row['post_id'] );
					if ( $post ) {
						$post_title = $post->post_title;
					}
				}

				return array(
					'post_id'          => (int) $row['post_id'],
					'title'            => $row['title'],
					'post_title'       => $post_title,
					'submission_count' => (int) $row['submission_count'],
				);
			},
			$results
		);
	}

	/**
	 * Get submission counts grouped by a dimension.
	 *
	 * @param string $by Grouping dimension: 'page', 'event', or 'form'.
	 * @return array[] Each row: group_key (int|string|null), count (int), plus extra label columns depending on $by.
	 */
	public function get_groups( string $by ): array {
		global $wpdb;

		$table_name = $this->get_table_name();

		$column_map = array(
			'page'  => 'post_id',
			'event' => 'event_date_id',
			'form'  => 'form_id',
		);

		if ( ! isset( $column_map[ $by ] ) ) {
			return array();
		}

		$group_column = $column_map[ $by ];

		$extra_select = '';
		if ( 'form' === $by ) {
			$extra_select = ', form_title';
		}

		$results = $wpdb->get_results(
			$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				"SELECT {$group_column} AS group_key, COUNT(*) AS count{$extra_select} FROM %i GROUP BY {$group_column} ORDER BY count DESC",
				$table_name
			),
			ARRAY_A
		);

		return $results;
	}

	/**
	 * Delete a submission by ID.
	 *
	 * @param int $id Submission ID.
	 * @return bool Success.
	 */
	public function delete_by_id( $id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		return $wpdb->delete(
			$table_name,
			array( 'id' => $id ),
			array( '%d' )
		) !== false;
	}

	/**
	 * Delete all submissions for a participant.
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
