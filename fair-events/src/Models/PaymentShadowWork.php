<?php
/**
 * Payment shadow work queue storage
 *
 * @package FairEvents
 */

namespace FairEvents\Models;

defined( 'WPINC' ) || die;

/**
 * Rows of fair_events_payment_shadow_work: shadow writes the payment
 * history migration still owes (PAYMENT_HISTORY_MIGRATION.md §8.8). A row
 * is queued when a live writer records something, processed later in the
 * same request, and removed once the work succeeds. A row that failed, or
 * whose evidence named no purchase yet, stays with its reason and is
 * retried with a growing delay.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class PaymentShadowWork {

	/**
	 * Work on one Connector transaction: write its payment links.
	 */
	const KIND_TRANSACTION = 'transaction';

	/**
	 * Work on one Fair Audience relationship: bring its shadow purchase in step.
	 */
	const KIND_RELATIONSHIP = 'relationship';

	/**
	 * Not attempted yet.
	 */
	const STATUS_PENDING = 'pending';

	/**
	 * An attempt failed with an error.
	 */
	const STATUS_FAILED = 'failed';

	/**
	 * The evidence named no purchase, or named one ambiguously.
	 */
	const STATUS_UNRESOLVED = 'unresolved';

	/**
	 * Longest delay between two attempts, in seconds.
	 */
	const MAX_RETRY_DELAY = DAY_IN_SECONDS;

	/**
	 * Table name.
	 *
	 * @return string
	 */
	public static function table() {
		global $wpdb;
		return $wpdb->prefix . 'fair_events_payment_shadow_work';
	}

	/**
	 * Queue work, or bring queued work forward so it runs now. Atomic, so
	 * concurrent writers queueing the same source keep one row.
	 *
	 * @param string $kind      KIND_TRANSACTION or KIND_RELATIONSHIP.
	 * @param int    $source_id Transaction or relationship ID.
	 * @return bool True when the row exists afterwards.
	 */
	public static function enqueue( $kind, $source_id ) {
		global $wpdb;

		$now = gmdate( 'Y-m-d H:i:s' );

		return false !== $wpdb->query(
			$wpdb->prepare(
				'INSERT INTO %i (kind, source_id, status, attempts, next_attempt_at, created_at, updated_at) VALUES (%s, %d, %s, 0, %s, %s, %s)
				ON DUPLICATE KEY UPDATE next_attempt_at = VALUES(next_attempt_at), updated_at = VALUES(updated_at)',
				self::table(),
				(string) $kind,
				(int) $source_id,
				self::STATUS_PENDING,
				$now,
				$now,
				$now
			)
		);
	}

	/**
	 * Remove a source's row once its work succeeded.
	 *
	 * @param string $kind      Kind.
	 * @param int    $source_id Source ID.
	 * @return void
	 */
	public static function complete( $kind, $source_id ) {
		global $wpdb;

		$wpdb->delete(
			self::table(),
			array(
				'kind'      => (string) $kind,
				'source_id' => (int) $source_id,
			),
			array( '%s', '%d' )
		);
	}

	/**
	 * Record an unsuccessful attempt and when to try again.
	 *
	 * @param string $kind      Kind.
	 * @param int    $source_id Source ID.
	 * @param string $status    STATUS_FAILED or STATUS_UNRESOLVED.
	 * @param string $reason    Error code or unresolved reason.
	 * @param array  $detail    Context, stored as JSON.
	 * @return void
	 */
	public static function defer( $kind, $source_id, $status, $reason, array $detail = array() ) {
		global $wpdb;

		$row      = self::get( $kind, $source_id );
		$attempts = $row ? (int) $row['attempts'] + 1 : 1;
		$now      = gmdate( 'Y-m-d H:i:s' );
		$next     = gmdate( 'Y-m-d H:i:s', time() + self::retry_delay( $attempts ) );

		$wpdb->query(
			$wpdb->prepare(
				'INSERT INTO %i (kind, source_id, status, reason, detail, attempts, next_attempt_at, created_at, updated_at) VALUES (%s, %d, %s, %s, %s, %d, %s, %s, %s)
				ON DUPLICATE KEY UPDATE status = VALUES(status), reason = VALUES(reason), detail = VALUES(detail), attempts = VALUES(attempts), next_attempt_at = VALUES(next_attempt_at), updated_at = VALUES(updated_at)',
				self::table(),
				(string) $kind,
				(int) $source_id,
				(string) $status,
				substr( (string) $reason, 0, 64 ),
				(string) wp_json_encode( $detail ),
				$attempts,
				$next,
				$now,
				$now
			)
		);
	}

	/**
	 * Seconds to wait before the given attempt number runs again: two
	 * minutes, doubling, at most a day.
	 *
	 * @param int $attempts Attempts made so far.
	 * @return int
	 */
	public static function retry_delay( $attempts ) {
		$attempts = max( 1, (int) $attempts );
		return (int) min( self::MAX_RETRY_DELAY, 120 * ( 2 ** min( 20, $attempts - 1 ) ) );
	}

	/**
	 * One source's row.
	 *
	 * @param string $kind      Kind.
	 * @param int    $source_id Source ID.
	 * @return array|null
	 */
	public static function get( $kind, $source_id ) {
		global $wpdb;

		$row = $wpdb->get_row(
			$wpdb->prepare( 'SELECT * FROM %i WHERE kind = %s AND source_id = %d', self::table(), (string) $kind, (int) $source_id ),
			ARRAY_A
		);
		return $row ? $row : null;
	}

	/**
	 * Rows whose next attempt is due, oldest first.
	 *
	 * @param int $limit Maximum rows.
	 * @return array[]
	 */
	public static function get_due( $limit ) {
		global $wpdb;

		return (array) $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE next_attempt_at <= %s ORDER BY next_attempt_at ASC, id ASC LIMIT %d',
				self::table(),
				gmdate( 'Y-m-d H:i:s' ),
				max( 1, (int) $limit )
			),
			ARRAY_A
		);
	}

	/**
	 * Outstanding rows per kind and status.
	 *
	 * @return array<string, array<string, int>> kind => status => count.
	 */
	public static function count_outstanding() {
		global $wpdb;

		$counts = array();
		foreach ( (array) $wpdb->get_results(
			$wpdb->prepare( 'SELECT kind, status, COUNT(*) AS total FROM %i GROUP BY kind, status', self::table() ),
			ARRAY_A
		) as $row ) {
			$counts[ (string) $row['kind'] ][ (string) $row['status'] ] = (int) $row['total'];
		}
		return $counts;
	}
}
