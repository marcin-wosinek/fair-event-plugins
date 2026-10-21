<?php
/**
 * Seed one fixture size of the events list scaling sweep run by
 * scripts/performance-runner.mjs (`--events-list-scaling`).
 *
 * Run via WP-CLI against the wp-env tests instance, with fair-events active
 * and after cleanup-performance-fixtures.php:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-events-list-fixtures.php '{"sweep":"events","size":50}'
 *
 * Sweeps (see PERFORMANCE.md § Events list scaling):
 *   - `events`: `size` distinct published events, each with one upcoming
 *     date, in a deterministic order (event N starts N days after the
 *     first). Each event has an excerpt, a meta value, one of three
 *     synthetic categories (on the post and on its date) and one of three
 *     synthetic venues.
 *   - `recurring`: one published event whose weekly series has `size`
 *     occurrences, the master included (none for size 0), with the same
 *     category and venue on its master.
 *
 * Both sweeps create the same four pages:
 *   - `control`: a paragraph and no Fair Event blocks;
 *   - `bundled-query-loop`: the events list with the bundled
 *     `fair-events/event-list` Query Loop pattern (10 per page);
 *   - `scaled-query-loop`: the events list with a synced copy of that
 *     pattern whose limit is the fixture size, so it renders every event;
 *   - `per-event`: the events list with a synced per-event pattern, which
 *     renders every eligible occurrence.
 *
 * Every post (events, pages, synced patterns) carries the
 * `_fair_performance_fixture` meta; venue and term IDs are recorded in the
 * `fair_performance_fixture_records` option as they are created. Both are
 * what cleanup-performance-fixtures.php removes.
 *
 * Prints a single `PERF_EVENTS_LIST:{json}` line with each page's path, the
 * stored counts, and the number of upcoming feed occurrences — split into
 * fixture-owned and foreign ones, so the runner can refuse a site whose
 * leftover events would distort every list.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/../lib/event-factory.php';

use FairEvents\Models\EventDates;
use FairEvents\Services\EventFeedProvider;

$config = isset( $args[0] ) ? json_decode( (string) $args[0], true ) : null;
if ( ! is_array( $config ) || ! in_array( $config['sweep'] ?? '', array( 'events', 'recurring' ), true ) ) {
	WP_CLI::error( 'Usage: seed-events-list-fixtures.php \'{"sweep":"events"|"recurring","size":N}\'' );
}

$sweep = $config['sweep'];
$size  = (int) ( $config['size'] ?? -1 );

if ( $size < 0 || ( 'recurring' === $sweep && 1 === $size ) ) {
	WP_CLI::error( 'The size must be 0 or more, and a recurring series needs at least 2 occurrences.' );
}

$marker = array( '_fair_performance_fixture' => '1' );

/**
 * Remember a venue or term ID for cleanup-performance-fixtures.php, before
 * anything else depends on it.
 *
 * @param string $type 'venues' or 'terms'.
 * @param int    $id   Created ID.
 * @return void
 */
$record = static function ( $type, $id ) {
	$records          = get_option( 'fair_performance_fixture_records', array() );
	$records          = is_array( $records ) ? $records : array();
	$records[ $type ] = array_merge( $records[ $type ] ?? array(), array( (int) $id ) );
	update_option( 'fair_performance_fixture_records', $records, false );
};

/**
 * Path and query of a URL on this site, for the runner to append to its own
 * base URL.
 *
 * @param string $url Absolute URL.
 * @return string
 */
$relative = static function ( $url ) {
	$parts = wp_parse_url( $url );

	return ( $parts['path'] ?? '/' ) . ( isset( $parts['query'] ) ? '?' . $parts['query'] : '' );
};

/**
 * Insert a fixture post, failing the seed on error.
 *
 * @param array $postarr wp_insert_post() arguments.
 * @return int Post ID.
 */
$insert = static function ( $postarr ) use ( $marker ) {
	$post_id = wp_insert_post( array_merge( array( 'post_status' => 'publish' ), $postarr, array( 'meta_input' => $marker ) ), true );

	if ( is_wp_error( $post_id ) ) {
		WP_CLI::error( 'Failed to create ' . $postarr['post_title'] . ': ' . $post_id->get_error_message() );
	}

	return (int) $post_id;
};

$category_ids = array();
$venue_ids    = array();
for ( $index = 1; $index <= 3; $index++ ) {
	$category = wp_insert_term( 'Fair Performance Category ' . $index, 'category' );
	if ( is_wp_error( $category ) ) {
		WP_CLI::error( 'Failed to create a category: ' . $category->get_error_message() );
	}
	$record( 'terms', $category['term_id'] );
	$category_ids[] = (int) $category['term_id'];

	$venue_id = fair_e2e_create_venue( 'Fair Performance Venue ' . $index, 'Calle Falsa ' . $index . ', Madrid' );
	$record( 'venues', $venue_id );
	$venue_ids[] = $venue_id;
}

/**
 * Create a published event with an excerpt, a meta value, a category and a
 * first date at `$start` carrying the same category and a venue.
 *
 * @param int    $index Fixture position (1-based), picks category and venue.
 * @param string $start First date's start, 'Y-m-d H:i:s'.
 * @return int[] Event post ID and first event date ID.
 */
$create_event = static function ( $index, $start ) use ( $marker, $category_ids, $venue_ids ) {
	$slot     = ( $index - 1 ) % 3;
	$event_id = fair_e2e_create_event(
		sprintf( 'Fair Performance – Event %03d', $index ),
		'<!-- wp:paragraph --><p>Synthetic event for the events list scaling sweep.</p><!-- /wp:paragraph -->',
		array_merge( $marker, array( 'fair_performance_sequence' => (string) $index ) )
	);

	wp_update_post(
		array(
			'ID'           => $event_id,
			'post_excerpt' => sprintf( 'Synthetic event %03d.', $index ),
		)
	);
	wp_set_post_terms( $event_id, array( $category_ids[ $slot ] ), 'category' );

	$date_id = fair_e2e_add_date_at( $event_id, $start );
	EventDates::set_category_ids( $date_id, array( $category_ids[ $slot ] ) );
	fair_e2e_set_venue( $date_id, $venue_ids[ $slot ] );

	return array( $event_id, $date_id );
};

// Dates are relative to the run, at a fixed hour, so every occurrence is
// upcoming whenever the sweep runs.
$first_start = strtotime( gmdate( 'Y-m-d', strtotime( '+7 days' ) ) . ' 18:00:00' );

if ( 'events' === $sweep ) {
	for ( $index = 1; $index <= $size; $index++ ) {
		$create_event( $index, gmdate( 'Y-m-d H:i:s', $first_start + ( $index - 1 ) * DAY_IN_SECONDS ) );
	}
} elseif ( $size > 0 ) {
	list( $event_id ) = $create_event( 1, gmdate( 'Y-m-d H:i:s', $first_start ) );
	fair_e2e_add_series( $event_id, $size );
}

$bundled_pattern = WP_Block_Patterns_Registry::get_instance()->get_registered( 'fair-events/event-list' );
if ( ! $bundled_pattern ) {
	WP_CLI::error( 'The bundled fair-events/event-list pattern is not registered.' );
}

// The same layout as the bundled pattern, but with a limit that never hides
// an event at this size.
$scaled_pattern_id = $insert(
	array(
		'post_type'    => 'wp_block',
		'post_title'   => 'Fair Performance – Scaled Query Loop',
		'post_content' => str_replace( '"perPage":10', '"perPage":' . max( 1, $size ), $bundled_pattern['content'] ),
	)
);

$per_event_pattern_id = $insert(
	array(
		'post_type'    => 'wp_block',
		'post_title'   => 'Fair Performance – Per Event',
		'post_content' => implode(
			'',
			array(
				'<!-- wp:group {"className":"fair-performance-entry"} --><div class="wp-block-group fair-performance-entry">',
				'<!-- wp:heading {"level":3} --><h3 class="wp-block-heading">{{title_link_open}}{{title}}{{title_link_close}}</h3><!-- /wp:heading -->',
				'<!-- wp:paragraph --><p>{{date_range}}</p><!-- /wp:paragraph -->',
				'<!-- wp:paragraph --><p>{{location}}</p><!-- /wp:paragraph -->',
				'<!-- wp:paragraph --><p>{{description}}</p><!-- /wp:paragraph -->',
				'</div><!-- /wp:group -->',
			)
		),
	)
);

$page_contents = array(
	'control'            => '<!-- wp:paragraph --><p>Control page with no Fair Event blocks.</p><!-- /wp:paragraph -->',
	'bundled-query-loop' => '<!-- wp:fair-events/events-list /-->',
	'scaled-query-loop'  => '<!-- wp:fair-events/events-list {"displayPattern":"wp_block:' . $scaled_pattern_id . '"} /-->',
	'per-event'          => '<!-- wp:fair-events/events-list {"displayPattern":"wp_block:' . $per_event_pattern_id . '"} /-->',
);

$page_paths = array();
foreach ( $page_contents as $key => $content ) {
	$page_id            = $insert(
		array(
			'post_type'    => 'page',
			'post_title'   => 'Fair Performance – Events List ' . $key,
			'post_name'    => 'fair-performance-events-list-' . $key,
			'post_content' => $content,
		)
	);
	$page_paths[ $key ] = $relative( get_permalink( $page_id ) );
}

global $wpdb;

$owned_event_ids = array_map(
	'intval',
	// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-off fixture check.
	$wpdb->get_col(
		$wpdb->prepare(
			'SELECT p.ID FROM %i p INNER JOIN %i pm ON pm.post_id = p.ID AND pm.meta_key = %s WHERE p.post_type = %s AND p.post_status = %s',
			$wpdb->posts,
			$wpdb->postmeta,
			'_fair_performance_fixture',
			'fair_event',
			'publish'
		)
	)
);

$owned    = 0;
$foreign  = 0;
$series   = array();
$upcoming = ( new EventFeedProvider() )->get_occurrences( current_time( 'Y-m-d H:i:s' ), null );
foreach ( $upcoming as $occurrence ) {
	if ( in_array( (int) ( $occurrence['event_id'] ?? 0 ), $owned_event_ids, true ) ) {
		++$owned;
		if ( ! empty( $occurrence['series_id'] ) ) {
			$series[ $occurrence['series_id'] ] = true;
		}
	} else {
		++$foreign;
	}
}

echo 'PERF_EVENTS_LIST:' . wp_json_encode(
	array(
		'sweep'               => $sweep,
		'size'                => $size,
		'pages'               => $page_paths,
		'storedEvents'        => count( $owned_event_ids ),
		'storedSeries'        => count( $series ),
		'upcomingOccurrences' => $owned,
		'foreignOccurrences'  => $foreign,
	)
) . "\n";
