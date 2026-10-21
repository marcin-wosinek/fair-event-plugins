<?php
/**
 * Plugin Name: Fair Performance Instrumentation
 * Description: Test-only request metrics for scripts/performance-runner.mjs.
 *              Loaded ONLY inside the Playwright wp-env instance (mounted via
 *              the `mappings` entry in .wp-env.json). Never shipped to
 *              production and never mounted by the dev `docker compose`
 *              stack. Adds X-Fair-Perf-* response headers, but only for a
 *              request that opts in with the X-Fair-Performance-Audit
 *              header, so it never affects an ordinary request. A request
 *              that also sends X-Fair-Performance-Profile records its SQL
 *              (see fair_perf_is_profile_request()).
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

/**
 * Whether the current request explicitly opted into performance metrics.
 *
 * @return bool
 */
function fair_perf_is_opt_in_request() {
	return isset( $_SERVER['HTTP_X_FAIR_PERFORMANCE_AUDIT'] )
		&& '1' === $_SERVER['HTTP_X_FAIR_PERFORMANCE_AUDIT'];
}

/**
 * Whether an opted-in request also asked for its queries to be recorded.
 *
 * Recording turns on SAVEQUERIES, whose call-stack capture slows every query
 * down, so the runner sends this on separate requests whose timing it never
 * reports.
 *
 * @return bool
 */
function fair_perf_is_profile_request() {
	return fair_perf_is_opt_in_request()
		&& isset( $_SERVER['HTTP_X_FAIR_PERFORMANCE_PROFILE'] )
		&& '1' === $_SERVER['HTTP_X_FAIR_PERFORMANCE_PROFILE'];
}

/**
 * Per-request totals for the fair-events/events-list blocks rendered so far:
 * the queries and wall-clock time spent inside their render callbacks
 * (nested blocks included), and, on a profile request, the recorded queries.
 *
 * @return array
 */
function &fair_perf_list_totals() {
	static $totals = array(
		'count'      => 0,
		'queries'    => 0,
		'durationMs' => 0.0,
		'recorded'   => array(),
		'open'       => array(),
	);

	return $totals;
}

if ( fair_perf_is_opt_in_request() ) {
	$GLOBALS['fair_perf_request_start'] = microtime( true );

	if ( fair_perf_is_profile_request() && ! defined( 'SAVEQUERIES' ) ) {
		define( 'SAVEQUERIES', true );
	}

	add_filter(
		'pre_render_block',
		function ( $pre_render, $parsed_block ) {
			if ( null === $pre_render && 'fair-events/events-list' === ( $parsed_block['blockName'] ?? '' ) ) {
				global $wpdb;
				$totals           = &fair_perf_list_totals();
				$totals['open'][] = array(
					'queries' => (int) $wpdb->num_queries,
					'logged'  => is_array( $wpdb->queries ) ? count( $wpdb->queries ) : 0,
					'start'   => microtime( true ),
				);
			}
			return $pre_render;
		},
		PHP_INT_MAX,
		2
	);

	add_filter(
		'render_block',
		function ( $block_content, $block ) {
			$totals = &fair_perf_list_totals();
			if ( 'fair-events/events-list' === ( $block['blockName'] ?? '' ) && $totals['open'] ) {
				global $wpdb;
				$open = array_pop( $totals['open'] );
				// Only the outermost list counts, so a nested list is not
				// counted twice.
				if ( ! $totals['open'] ) {
					++$totals['count'];
					$totals['queries']    += (int) $wpdb->num_queries - $open['queries'];
					$totals['durationMs'] += ( microtime( true ) - $open['start'] ) * 1000;
					if ( is_array( $wpdb->queries ) ) {
						foreach ( array_slice( $wpdb->queries, $open['logged'] ) as $query ) {
							$totals['recorded'][] = array(
								'sql'    => $query[0],
								'caller' => $query[2],
							);
						}
					}
				}
			}
			return $block_content;
		},
		PHP_INT_MIN,
		2
	);

	/*
	 * Buffer the whole response so headers can still be added once rendering
	 * finishes (duration, peak memory, and query count are only known at the
	 * very end of the request). PHP flushes an open output buffer, running
	 * this callback, after the 'shutdown' action completes but before any
	 * byte reaches the client, so header() remains valid here even though
	 * WordPress has already produced the full page.
	 *
	 * @param string $buffer Buffered response body.
	 * @return string The buffer, with the recorded list queries appended as
	 *                an HTML comment on a profile request.
	 */
	ob_start(
		function ( $buffer ) {
			if ( ! headers_sent() ) {
				global $wpdb;
				$duration_ms = ( microtime( true ) - $GLOBALS['fair_perf_request_start'] ) * 1000;
				header( 'X-Fair-Perf-Duration-Ms: ' . round( $duration_ms, 2 ) );
				header( 'X-Fair-Perf-Peak-Memory-Bytes: ' . memory_get_peak_usage( true ) );
				header( 'X-Fair-Perf-Query-Count: ' . (int) $wpdb->num_queries );

				$totals = fair_perf_list_totals();
				header( 'X-Fair-Perf-List-Count: ' . (int) $totals['count'] );
				header( 'X-Fair-Perf-List-Query-Count: ' . (int) $totals['queries'] );
				header( 'X-Fair-Perf-List-Duration-Ms: ' . round( $totals['durationMs'], 2 ) );

				$opcache = function_exists( 'opcache_get_status' ) ? opcache_get_status( false ) : false;
				header(
					'X-Fair-Perf-Environment: ' . wp_json_encode(
						array(
							'wordpress'   => get_bloginfo( 'version' ),
							'php'         => PHP_VERSION,
							'database'    => $wpdb->db_server_info(),
							'theme'       => get_stylesheet(),
							'plugins'     => implode( ', ', (array) get_option( 'active_plugins', array() ) ),
							'objectCache' => wp_using_ext_object_cache() ? 'yes' : 'no',
							'opcache'     => is_array( $opcache ) && ! empty( $opcache['opcache_enabled'] ) ? 'on' : 'off',
						)
					)
				);

				// Too large for a header; the runner reads it from the body.
				if ( fair_perf_is_profile_request() ) {
					$buffer .= "\n<!-- FAIR_PERF_PROFILE:" . str_replace( '--', '\u002d\u002d', wp_json_encode( $totals['recorded'] ) ) . ' -->';
				}
			}
			return $buffer;
		}
	);
}
