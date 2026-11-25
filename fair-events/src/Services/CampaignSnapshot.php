<?php
/**
 * Coherent reads for complete campaign facts.
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

defined( 'WPINC' ) || die;

use FairEvents\Models\ScheduleItem;
use WP_Error;

// phpcs:disable WordPress.DB.DirectDatabaseQuery

/**
 * Runs a reader inside one read-only database snapshot (#2424).
 *
 * Every source of a complete campaign-facts read (Fair Events tables,
 * companion plugin tables, posts, post meta and options) is read on the one
 * WordPress connection inside a `REPEATABLE READ` transaction started
 * `WITH CONSISTENT SNAPSHOT`. All of it therefore reflects the same set of
 * committed transactions, however long the read takes and whatever commits
 * meanwhile. While the reader runs, the global object cache is replaced
 * with a private SnapshotObjectCache, so WordPress API reads cannot return
 * values cached before the snapshot (or by a persistent cache) and nothing
 * read in the snapshot leaks into the site's cache.
 *
 * Before starting, the participating tables are checked: each one that
 * exists must use a transactional engine (InnoDB). Companion plugins add
 * their tables with the `fair_events_campaign_snapshot_tables` filter.
 *
 * Every condition that prevents a coherent read is a 503
 * `fair_events_campaign_facts_snapshot_unavailable` with `data.reason`
 * (`non_transactional_tables`, `audit_failed`, `transaction`,
 * `object_cache`) and `data.retryable`; the reader then never runs, or its
 * result is discarded.
 */
class CampaignSnapshot {

	/**
	 * Storage engines whose consistent snapshots the read relies on.
	 */
	const TRANSACTIONAL_ENGINES = array( 'innodb' );

	/**
	 * Run a reader inside a read-only snapshot.
	 *
	 * @param callable $reader Reader; its return value is returned.
	 * @return mixed|WP_Error The reader's result, or an error when no coherent snapshot could be established.
	 */
	public static function read( callable $reader ) {
		global $wpdb;

		$audit = self::audit_tables();
		if ( is_wp_error( $audit ) ) {
			return $audit;
		}

		if ( false === $wpdb->query( 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ' )
			|| false === $wpdb->query( 'START TRANSACTION READ ONLY, WITH CONSISTENT SNAPSHOT' )
		) {
			$wpdb->query( 'ROLLBACK' );
			return self::unavailable( 'transaction', true );
		}

		$original = isset( $GLOBALS['wp_object_cache'] ) ? $GLOBALS['wp_object_cache'] : null;
		$isolated = new SnapshotObjectCache();

		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- swapped for the snapshot and restored below.
		$GLOBALS['wp_object_cache'] = $isolated;

		try {
			$result = self::cache_isolated( $isolated ) ? $reader() : self::unavailable( 'object_cache', false );
		} finally {
			// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- restoring the original cache.
			$GLOBALS['wp_object_cache'] = $original;
			$wpdb->query( 'COMMIT' );
		}

		return $result;
	}

	/**
	 * The tables a complete campaign-facts read may touch.
	 *
	 * @return string[] Table names with prefix.
	 */
	public static function tables() {
		global $wpdb;

		$tables = array(
			$wpdb->posts,
			$wpdb->postmeta,
			$wpdb->options,
			$wpdb->terms,
			$wpdb->term_taxonomy,
			$wpdb->term_relationships,
			$wpdb->prefix . 'fair_event_dates',
			$wpdb->prefix . 'fair_event_date_posts',
			$wpdb->prefix . 'fair_event_venues',
			ScheduleItem::get_table_name(),
			$wpdb->prefix . 'fair_events_ticket_options',
			$wpdb->prefix . 'fair_events_event_date_settings',
		);

		/**
		 * Filters the tables a complete campaign-facts read may touch, so
		 * their engines are checked before the snapshot is relied on.
		 *
		 * @param string[] $tables Table names with prefix.
		 */
		$tables = apply_filters( 'fair_events_campaign_snapshot_tables', $tables );

		return array_values( array_unique( array_filter( array_map( 'strval', (array) $tables ) ) ) );
	}

	/**
	 * Check that every existing participating table is transactional.
	 *
	 * @return true|WP_Error
	 */
	private static function audit_tables() {
		global $wpdb;

		$tables       = self::tables();
		$placeholders = implode( ', ', array_fill( 0, count( $tables ), '%s' ) );
		$rows         = $wpdb->get_results(
			$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare,WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- one %s per table.
				"SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ( {$placeholders} )",
				$tables
			)
		);

		if ( '' !== $wpdb->last_error || ! is_array( $rows ) ) {
			return self::unavailable( 'audit_failed', true );
		}

		$non_transactional = array();
		foreach ( $rows as $row ) {
			if ( ! in_array( strtolower( (string) $row->engine ), self::TRANSACTIONAL_ENGINES, true ) ) {
				$non_transactional[] = (string) $row->name;
			}
		}

		if ( $non_transactional ) {
			sort( $non_transactional );
			return self::unavailable( 'non_transactional_tables', false, array( 'tables' => $non_transactional ) );
		}

		return true;
	}

	/**
	 * Whether the WordPress cache functions now use the private cache.
	 *
	 * @param SnapshotObjectCache $isolated Installed cache.
	 * @return bool
	 */
	private static function cache_isolated( SnapshotObjectCache $isolated ) {
		$probe = 'probe-' . bin2hex( random_bytes( 8 ) );

		return wp_cache_set( 'snapshot', $probe, 'fair_events_campaign_snapshot' )
			&& $isolated->holds( 'snapshot', 'fair_events_campaign_snapshot' )
			&& wp_cache_get( 'snapshot', 'fair_events_campaign_snapshot' ) === $probe;
	}

	/**
	 * The error for a read that cannot be made coherent.
	 *
	 * @param string $reason    Machine-readable reason.
	 * @param bool   $retryable Whether retrying may succeed.
	 * @param array  $data      Extra error data.
	 * @return WP_Error
	 */
	private static function unavailable( $reason, $retryable, array $data = array() ) {
		return new WP_Error(
			'fair_events_campaign_facts_snapshot_unavailable',
			__( 'The event facts could not be read consistently. Try again later.', 'fair-events' ),
			array_merge(
				array(
					'status'    => 503,
					'reason'    => $reason,
					'retryable' => $retryable,
				),
				$data
			)
		);
	}
}
