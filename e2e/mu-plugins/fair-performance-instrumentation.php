<?php
/**
 * Plugin Name: Fair Performance Instrumentation
 * Description: Test-only request metrics for scripts/performance-runner.mjs.
 *              Loaded ONLY inside the Playwright wp-env instance (mounted via
 *              the `mappings` entry in .wp-env.json). Never shipped to
 *              production and never mounted by the dev `docker compose`
 *              stack. Adds X-Fair-Perf-* response headers, but only for a
 *              request that opts in with the X-Fair-Performance-Audit
 *              header, so it never affects an ordinary request.
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

if ( fair_perf_is_opt_in_request() ) {
	$GLOBALS['fair_perf_request_start'] = microtime( true );

	/*
	 * Buffer the whole response so headers can still be added once rendering
	 * finishes (duration, peak memory, and query count are only known at the
	 * very end of the request). PHP flushes an open output buffer, running
	 * this callback, after the 'shutdown' action completes but before any
	 * byte reaches the client, so header() remains valid here even though
	 * WordPress has already produced the full page.
	 *
	 * @param string $buffer Buffered response body.
	 * @return string Unmodified buffer.
	 */
	ob_start(
		function ( $buffer ) {
			if ( ! headers_sent() ) {
				global $wpdb;
				$duration_ms = ( microtime( true ) - $GLOBALS['fair_perf_request_start'] ) * 1000;
				header( 'X-Fair-Perf-Duration-Ms: ' . round( $duration_ms, 2 ) );
				header( 'X-Fair-Perf-Peak-Memory-Bytes: ' . memory_get_peak_usage( true ) );
				header( 'X-Fair-Perf-Query-Count: ' . (int) $wpdb->num_queries );
			}
			return $buffer;
		}
	);
}
