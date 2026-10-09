<?php
/**
 * Delete every fixture owned by scripts/performance-runner.mjs.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/cleanup-performance-fixtures.php
 *
 * Ownership is the `_fair_performance_fixture` post meta the runner and
 * seed-performance-fixtures.php write together with each post, so this
 * removes whatever exists — a complete set, a partially seeded one, or
 * leftovers of an earlier run that never reached its own cleanup. For event
 * posts it also removes the dates, sale periods, ticket types, options and
 * prices hanging off them.
 *
 * It uses plain queries rather than the fair-events models because the
 * runner calls it in any activation state, including with fair-events
 * inactive or its tables not created yet.
 *
 * Prints a single `PERF_CLEANUP:{json}` line with row counts, and fails when
 * a query errors or an owned post survives.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

global $wpdb;

$marker_key = '_fair_performance_fixture';

$dates_table         = $wpdb->prefix . 'fair_event_dates';
$sale_periods_table  = $wpdb->prefix . 'fair_events_ticket_sale_periods';
$types_table         = $wpdb->prefix . 'fair_events_ticket_types';
$prices_table        = $wpdb->prefix . 'fair_events_ticket_prices';
$options_table       = $wpdb->prefix . 'fair_events_ticket_options';
$option_prices_table = $wpdb->prefix . 'fair_events_ticket_option_prices';
$settings_table      = $wpdb->prefix . 'fair_events_event_date_settings';

$deleted  = array(
	'option_prices' => 0,
	'options'       => 0,
	'ticket_prices' => 0,
	'ticket_types'  => 0,
	'sale_periods'  => 0,
	'settings'      => 0,
	'event_dates'   => 0,
	'posts'         => 0,
);
$failures = array();

// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-off teardown script, no cache to honour.

/**
 * Run a delete and record its row count or its error.
 *
 * @param string $key   Key in $deleted.
 * @param string $query Prepared query.
 * @return void
 */
$run = static function ( $key, $query ) use ( $wpdb, &$deleted, &$failures ) {
	// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- every caller passes $wpdb->prepare() output.
	$result = $wpdb->query( $query );
	if ( false === $result ) {
		$failures[] = $key . ': ' . $wpdb->last_error;
		return;
	}
	$deleted[ $key ] += (int) $result;
};

$post_ids = array_map(
	'intval',
	$wpdb->get_col(
		$wpdb->prepare( 'SELECT DISTINCT post_id FROM %i WHERE meta_key = %s', $wpdb->postmeta, $marker_key )
	)
);

$has_event_tables = $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( $dates_table ) ) ) === $dates_table;

if ( $post_ids && $has_event_tables ) {
	$post_placeholders = implode( ', ', array_fill( 0, count( $post_ids ), '%d' ) );

	// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- the interpolated placeholder lists are safe lists of %d.
	$event_date_ids = array_map(
		'intval',
		$wpdb->get_col(
			$wpdb->prepare(
				"SELECT id FROM %i WHERE event_id IN ({$post_placeholders})",
				array_merge( array( $dates_table ), $post_ids )
			)
		)
	);

	if ( $event_date_ids ) {
		$date_placeholders = implode( ', ', array_fill( 0, count( $event_date_ids ), '%d' ) );

		$run(
			'option_prices',
			$wpdb->prepare(
				"DELETE op FROM %i AS op INNER JOIN %i AS o ON o.id = op.ticket_option_id WHERE o.event_date_id IN ({$date_placeholders})",
				array_merge( array( $option_prices_table, $options_table ), $event_date_ids )
			)
		);
		$run(
			'ticket_prices',
			$wpdb->prepare(
				"DELETE tp FROM %i AS tp INNER JOIN %i AS t ON t.id = tp.ticket_type_id WHERE t.event_date_id IN ({$date_placeholders})",
				array_merge( array( $prices_table, $types_table ), $event_date_ids )
			)
		);

		foreach (
			array(
				'options'      => $options_table,
				'ticket_types' => $types_table,
				'sale_periods' => $sale_periods_table,
				'settings'     => $settings_table,
			) as $key => $table
		) {
			$run(
				$key,
				$wpdb->prepare(
					"DELETE FROM %i WHERE event_date_id IN ({$date_placeholders})",
					array_merge( array( $table ), $event_date_ids )
				)
			);
		}

		$run(
			'event_dates',
			$wpdb->prepare(
				"DELETE FROM %i WHERE id IN ({$date_placeholders})",
				array_merge( array( $dates_table ), $event_date_ids )
			)
		);
	}
	// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber
}

foreach ( $post_ids as $owned_post_id ) {
	if ( wp_delete_post( $owned_post_id, true ) ) {
		++$deleted['posts'];
	}
}

$remaining = (int) $wpdb->get_var(
	$wpdb->prepare( 'SELECT COUNT(DISTINCT post_id) FROM %i WHERE meta_key = %s', $wpdb->postmeta, $marker_key )
);
// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

echo 'PERF_CLEANUP:' . wp_json_encode( $deleted ) . "\n";

if ( $remaining ) {
	$failures[] = $remaining . ' owned post(s) could not be deleted';
}

if ( $failures ) {
	WP_CLI::error( 'Performance fixture cleanup failed: ' . implode( '; ', $failures ) );
}
