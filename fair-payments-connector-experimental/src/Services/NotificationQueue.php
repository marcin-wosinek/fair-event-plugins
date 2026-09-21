<?php
/**
 * Notification queue storage
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\Services;

defined( 'WPINC' ) || die;

/**
 * Database boundary for digest rows waiting in the notification queue.
 *
 * A row is `pending` until a digest run claims it (`sending`), then `sent` once
 * the channel reports success or back to `pending` when it does not. Claiming
 * is a single UPDATE tagged with a per-run token, so two overlapping cron runs
 * can never both take the same rows.
 */
class NotificationQueue {

	const STATUS_PENDING = 'pending';
	const STATUS_SENDING = 'sending';
	const STATUS_SENT    = 'sent';

	/**
	 * Fully prefixed table name.
	 *
	 * @return string
	 */
	private function table(): string {
		global $wpdb;

		return $wpdb->prefix . 'fair_payment_notification_queue';
	}

	/**
	 * Distinct route/channel/destination groups that have rows ready to send.
	 *
	 * Ready means pending, or left in `sending` since before $stale_before by a
	 * run that never finished.
	 *
	 * @param string $frequency    Digest frequency.
	 * @param string $stale_before GMT datetime; older claims are recoverable.
	 * @return object[] Objects with route_id, channel and destination.
	 */
	public function due_groups( string $frequency, string $stale_before ): array {
		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$groups = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT DISTINCT route_id, channel, destination FROM %i
				WHERE frequency = %s AND ( status = %s OR ( status = %s AND claimed_at < %s ) )
				ORDER BY route_id',
				$this->table(),
				$frequency,
				self::STATUS_PENDING,
				self::STATUS_SENDING,
				$stale_before
			)
		);

		return is_array( $groups ) ? $groups : array();
	}

	/**
	 * Atomically claim every ready row of one group and return them.
	 *
	 * @param object $group        Group from due_groups().
	 * @param string $frequency    Digest frequency.
	 * @param string $stale_before GMT datetime; older claims are recoverable.
	 * @param string $token        Unique token identifying this run's claim.
	 * @param string $claimed_at   GMT datetime of the claim.
	 * @return object[] The claimed rows, oldest first; empty when another run won them.
	 */
	public function claim_group( object $group, string $frequency, string $stale_before, string $token, string $claimed_at ): array {
		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$claimed = $wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET status = %s, claim_token = %s, claimed_at = %s, attempts = attempts + 1
				WHERE frequency = %s AND route_id = %s AND channel = %s AND destination = %s
				AND ( status = %s OR ( status = %s AND claimed_at < %s ) )',
				$this->table(),
				self::STATUS_SENDING,
				$token,
				$claimed_at,
				$frequency,
				(string) $group->route_id,
				(string) $group->channel,
				(string) $group->destination,
				self::STATUS_PENDING,
				self::STATUS_SENDING,
				$stale_before
			)
		);

		if ( ! $claimed ) {
			return array();
		}

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE claim_token = %s AND status = %s ORDER BY created_at, id',
				$this->table(),
				$token,
				self::STATUS_SENDING
			)
		);

		return is_array( $rows ) ? $rows : array();
	}

	/**
	 * Mark a run's claimed rows as sent.
	 *
	 * @param string $token   Claim token.
	 * @param string $sent_at GMT datetime of delivery.
	 * @return void
	 */
	public function mark_sent( string $token, string $sent_at ) {
		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET status = %s, sent_at = %s, last_error = %s, claim_token = %s WHERE claim_token = %s AND status = %s',
				$this->table(),
				self::STATUS_SENT,
				$sent_at,
				'',
				'',
				$token,
				self::STATUS_SENDING
			)
		);
	}

	/**
	 * Return a run's claimed rows to `pending` so the next run retries them.
	 *
	 * The row payload is left untouched; only the failure description is stored.
	 *
	 * @param string $token Claim token.
	 * @param string $error Non-sensitive description of the failure.
	 * @return void
	 */
	public function release( string $token, string $error ) {
		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET status = %s, last_error = %s, claim_token = %s WHERE claim_token = %s AND status = %s',
				$this->table(),
				self::STATUS_PENDING,
				substr( $error, 0, 255 ),
				'',
				$token,
				self::STATUS_SENDING
			)
		);
	}
}
