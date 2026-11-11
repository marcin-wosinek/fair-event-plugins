<?php
/**
 * Legacy feed mode repository
 *
 * @package FairAudience
 */

namespace FairAudience\Database;

defined( 'WPINC' ) || die;

/**
 * Storage for {@see FeedModeConversion}: finds participants still in the
 * legacy 'all' feed mode and converts them one at a time.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class LegacyFeedModeRepository {

	/**
	 * Participants table.
	 *
	 * @return string
	 */
	private function participants_table() {
		global $wpdb;
		return $wpdb->prefix . 'fair_audience_participants';
	}

	/**
	 * Participant feeds table.
	 *
	 * @return string
	 */
	private function feeds_table() {
		global $wpdb;
		return $wpdb->prefix . 'fair_audience_participant_feeds';
	}

	/**
	 * Whether any participant still has the legacy mode.
	 *
	 * @return bool
	 */
	public function has_legacy() {
		global $wpdb;

		return (bool) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT 1 FROM %i WHERE weekly_feed_mode = %s LIMIT 1',
				$this->participants_table(),
				'all'
			)
		);
	}

	/**
	 * The next participants with the legacy mode.
	 *
	 * @param int $limit How many.
	 * @return array[] Rows with id, weekly_feed_mode, email_profile, status and weekly_summary_opt_out.
	 */
	public function legacy_batch( $limit ) {
		global $wpdb;

		$rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT id, weekly_feed_mode, email_profile, status, weekly_summary_opt_out FROM %i WHERE weekly_feed_mode = %s ORDER BY id ASC LIMIT %d',
				$this->participants_table(),
				'all',
				$limit
			),
			ARRAY_A
		);

		return is_array( $rows ) ? $rows : array();
	}

	/**
	 * Add feeds to a legacy participant and record it as converted, together
	 * or not at all. Existing subscriptions are kept.
	 *
	 * @param int   $participant_id Participant ID.
	 * @param int[] $feed_ids       Feeds to add; empty for none.
	 * @return bool Whether the participant is converted.
	 */
	public function convert( $participant_id, array $feed_ids ) {
		global $wpdb;

		$wpdb->query( 'START TRANSACTION' );

		$ok = true;
		foreach ( $feed_ids as $feed_id ) {
			$ok = false !== $wpdb->query(
				$wpdb->prepare(
					'INSERT IGNORE INTO %i (participant_id, feed_id) VALUES (%d, %d)',
					$this->feeds_table(),
					$participant_id,
					$feed_id
				)
			);
			if ( ! $ok ) {
				break;
			}
		}

		$ok = $ok && false !== $wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET weekly_feed_mode = %s WHERE id = %d AND weekly_feed_mode = %s',
				$this->participants_table(),
				'selected',
				$participant_id,
				'all'
			)
		);

		if ( $ok ) {
			$wpdb->query( 'COMMIT' );
		} else {
			$wpdb->query( 'ROLLBACK' );
		}

		return $ok;
	}
}
