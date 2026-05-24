<?php
/**
 * Scheduled Message Repository
 *
 * @package FairAudience
 */

namespace FairAudience\Database;

use FairAudience\Models\ScheduledMessage;

defined( 'WPINC' ) || die;

/**
 * Repository for scheduled message data access.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class ScheduledMessageRepository {

	/**
	 * Get table name.
	 *
	 * @return string Table name.
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_audience_event_scheduled_messages';
	}

	/**
	 * Get a scheduled message by ID.
	 *
	 * @param int $id Message ID.
	 * @return ScheduledMessage|null Message or null if not found.
	 */
	public function get_by_id( $id ) {
		global $wpdb;

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE id = %d',
				$this->get_table_name(),
				$id
			),
			ARRAY_A
		);

		return $result ? new ScheduledMessage( $result ) : null;
	}

	/**
	 * Get all scheduled messages for an event date, newest first.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return ScheduledMessage[] Array of messages.
	 */
	public function get_by_event_date( $event_date_id ) {
		global $wpdb;

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE event_date_id = %d ORDER BY created_at DESC',
				$this->get_table_name(),
				$event_date_id
			),
			ARRAY_A
		);

		return array_map(
			static function ( $row ) {
				return new ScheduledMessage( $row );
			},
			$results
		);
	}

	/**
	 * Get scheduled (still-pending) messages anchored to a given row.
	 *
	 * Used by reschedule hooks when the underlying anchor moves.
	 *
	 * @param string $anchor_type   Anchor type.
	 * @param int    $anchor_ref_id Anchor row ID.
	 * @return ScheduledMessage[] Array of messages with status='scheduled'.
	 */
	public function get_scheduled_by_anchor( $anchor_type, $anchor_ref_id ) {
		global $wpdb;

		$results = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM %i WHERE status = 'scheduled' AND anchor_type = %s AND anchor_ref_id = %d",
				$this->get_table_name(),
				$anchor_type,
				$anchor_ref_id
			),
			ARRAY_A
		);

		return array_map(
			static function ( $row ) {
				return new ScheduledMessage( $row );
			},
			$results
		);
	}

	/**
	 * Atomically claim due messages for sending.
	 *
	 * Selects candidate scheduled rows whose send time has elapsed, then claims
	 * each one with a conditional UPDATE (status='scheduled' -> 'sending'). Only
	 * rows the UPDATE actually flipped are returned, so two overlapping cron
	 * ticks can never both claim the same row (idempotency).
	 *
	 * @param int $limit Maximum rows to claim per tick.
	 * @return ScheduledMessage[] Claimed messages (now status='sending').
	 */
	public function claim_due( $limit = 20 ) {
		global $wpdb;

		$table = $this->get_table_name();
		$now   = current_time( 'mysql' );

		$candidate_ids = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT id FROM %i
				WHERE status = 'scheduled'
				AND scheduled_for IS NOT NULL
				AND scheduled_for <= %s
				ORDER BY scheduled_for ASC
				LIMIT %d",
				$table,
				$now,
				$limit
			)
		);

		$claimed = array();

		foreach ( $candidate_ids as $id ) {
			$affected = $wpdb->query(
				$wpdb->prepare(
					"UPDATE %i SET status = 'sending', updated_at = %s WHERE id = %d AND status = 'scheduled'",
					$table,
					$now,
					$id
				)
			);

			// Only the tick that flips the row wins the claim.
			if ( 1 === (int) $affected ) {
				$message = $this->get_by_id( (int) $id );
				if ( $message ) {
					$claimed[] = $message;
				}
			}
		}

		return $claimed;
	}

	/**
	 * Reclaim rows stuck in 'sending' past a threshold.
	 *
	 * Guards against a crash mid-send: rows left in 'sending' longer than
	 * $threshold_minutes are flipped back to 'scheduled' so the next tick picks
	 * them up again.
	 *
	 * @param int $threshold_minutes Minutes before a sending row is reclaimed.
	 * @return int Number of rows reclaimed.
	 */
	public function reclaim_stuck( $threshold_minutes = 30 ) {
		global $wpdb;

		$cutoff = gmdate( 'Y-m-d H:i:s', strtotime( current_time( 'mysql' ) ) - ( $threshold_minutes * MINUTE_IN_SECONDS ) );

		return (int) $wpdb->query(
			$wpdb->prepare(
				"UPDATE %i SET status = 'scheduled' WHERE status = 'sending' AND updated_at < %s",
				$this->get_table_name(),
				$cutoff
			)
		);
	}

	/**
	 * Cancel all still-scheduled messages for an event date.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return int Number of rows canceled.
	 */
	public function cancel_for_event_date( $event_date_id ) {
		global $wpdb;

		return (int) $wpdb->query(
			$wpdb->prepare(
				"UPDATE %i SET status = 'canceled' WHERE event_date_id = %d AND status = 'scheduled'",
				$this->get_table_name(),
				$event_date_id
			)
		);
	}

	/**
	 * Delete a scheduled message by ID.
	 *
	 * @param int $id Message ID.
	 * @return bool Success.
	 */
	public function delete( $id ) {
		global $wpdb;

		return $wpdb->delete(
			$this->get_table_name(),
			array( 'id' => $id ),
			array( '%d' )
		) !== false;
	}
}
