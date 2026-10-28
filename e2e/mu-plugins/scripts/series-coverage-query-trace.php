<?php
/**
 * Trace the queries the signup forms of an event post run for series
 * coverage (#1996).
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/series-coverage-query-trace.php <post_id> <event_date_id> [<occurrence_date>]
 *
 * Renders the post's blocks as an anonymous visitor (with `event_date` set
 * when an occurrence date is given), then runs the viewer-context refresh
 * for the event date. Prints a single `E2E_COVERAGE_TRACE:{json}` line with,
 * for `render` and `refresh`: `total` queries, `date_reads` (one
 * fair_event_dates row read by ID, as EventDates::get_by_id() does) and
 * `admission_counts` (ticket-unit and unbackfilled-signup counts), plus
 * `forms` (signup forms rendered) and `coverage` (the refresh's
 * series_coverage, to check the traced request described the dates).
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

global $wpdb;

$trace_post_id   = isset( $args[0] ) ? (int) $args[0] : 0;
$event_date_id   = isset( $args[1] ) ? (int) $args[1] : 0;
$occurrence_date = isset( $args[2] ) ? (string) $args[2] : '';
if ( ! $trace_post_id || ! $event_date_id ) {
	WP_CLI::error( 'Usage: series-coverage-query-trace.php <post_id> <event_date_id> [<occurrence_date>]' );
}

wp_set_current_user( 0 );

$fair_trace_queries = array();
add_filter(
	'query',
	static function ( $query ) use ( &$fair_trace_queries ) {
		$fair_trace_queries[] = $query;
		return $query;
	}
);

$dates_table = $wpdb->prefix . 'fair_event_dates';
$summarize   = static function ( array $queries ) use ( $dates_table ) {
	$date_reads       = 0;
	$admission_counts = 0;
	foreach ( $queries as $query ) {
		if ( preg_match( '/^SELECT \* FROM `?' . preg_quote( $dates_table, '/' ) . '`? WHERE id = \d+ LIMIT 1$/', trim( $query ) ) ) {
			++$date_reads;
		} elseif ( preg_match( '/^SELECT (COUNT\(\*\)|COALESCE\( SUM)/', trim( $query ) ) ) {
			++$admission_counts;
		}
	}

	return array(
		'total'            => count( $queries ),
		'date_reads'       => $date_reads,
		'admission_counts' => $admission_counts,
	);
};

// Render the post as its page would, one form per signup block.
if ( '' !== $occurrence_date ) {
	$_GET['event_date'] = $occurrence_date;
}
$GLOBALS['post'] = get_post( $trace_post_id ); // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- the blocks read the current post, as on its page.
setup_postdata( $GLOBALS['post'] );

$fair_trace_queries = array();
$html               = do_blocks( $GLOBALS['post']->post_content );
$render             = $summarize( $fair_trace_queries );
unset( $_GET['event_date'] );

// The availability refresh both forms make after load.
$fair_trace_queries = array();
$request            = new WP_REST_Request( 'GET', '/fair-events/v1/get-tickets/viewer-context' );
$request->set_param( 'event_date_id', $event_date_id );
$response = rest_do_request( $request );
$refresh  = $summarize( $fair_trace_queries );

$data = $response->get_data();

echo 'E2E_COVERAGE_TRACE:' . wp_json_encode( // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- CLI output for the spec.
	array(
		'forms'    => substr_count( $html, 'data-series-coverage=' ),
		'render'   => $render,
		'refresh'  => $refresh,
		'status'   => $response->get_status(),
		'coverage' => $data['series_coverage'] ?? null,
	)
) . "\n";
