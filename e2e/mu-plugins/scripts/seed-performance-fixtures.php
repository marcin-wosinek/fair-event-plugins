<?php
/**
 * Seed the event fixtures measured by scripts/performance-runner.mjs.
 *
 * Run via WP-CLI against the wp-env tests instance, with fair-events active:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-performance-fixtures.php '{"occurrences":48,"measuredOccurrence":24,"options":16}'
 *
 * Creates (composing lib/event-factory.php):
 *   - a weekly recurring event whose occurrences (master included) all start
 *     in the future relative to the run, with an active sale period and a
 *     priced 'multiple_instances' ticket type;
 *   - a single event with one priced ticket type and selectable options, each
 *     with its own price for the active sale period;
 *   - a listings page with the events list, calendar and week blocks.
 *
 * Every post carries the `_fair_performance_fixture` meta, written in the
 * same insert as the post itself and before any dependent row, so
 * cleanup-performance-fixtures.php finds whatever a failed or interrupted
 * seed left behind.
 *
 * Prints a single `PERF_SEED:{json}` line with each measured page's path and
 * the counts the runner verifies before measuring.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/../lib/event-factory.php';

use FairEvents\Helpers\OccurrenceDateParam;
use FairEvents\Helpers\WeekViewParam;
use FairEvents\Models\EventDates;
use FairEvents\Services\ActivitySelection;

$config = isset( $args[0] ) ? json_decode( (string) $args[0], true ) : null;
if ( ! is_array( $config ) ) {
	WP_CLI::error( 'Usage: seed-performance-fixtures.php \'{"occurrences":N,"measuredOccurrence":N,"options":N}\'' );
}

$occurrence_count    = (int) ( $config['occurrences'] ?? 0 );
$measured_occurrence = (int) ( $config['measuredOccurrence'] ?? 0 );
$option_count        = (int) ( $config['options'] ?? 0 );

if ( $occurrence_count < 2 || $measured_occurrence < 2 || $measured_occurrence > $occurrence_count || $option_count < 1 ) {
	WP_CLI::error( 'The measured occurrence must be a generated one within the series, and at least one option is required.' );
}

$marker = array( '_fair_performance_fixture' => '1' );

$event_content = implode(
	"\n\n",
	array(
		'<!-- wp:fair-events/event-dates /-->',
		'<!-- wp:fair-events/event-info /-->',
		'<!-- wp:fair-events/event-prices /-->',
		'<!-- wp:fair-events/event-signup /-->',
		'<!-- wp:fair-events/get-tickets /-->',
	)
);

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

// Dates are relative to the run, at a fixed hour so the first occurrence's
// calendar day (and with it the listing page's month/week) is unambiguous.
$first_start = gmdate( 'Y-m-d', strtotime( '+7 days' ) ) . ' 18:00:00';

// Recurring event: the first occurrence becomes the series master.
$recurring_id       = fair_e2e_create_event( 'Fair Performance – Recurring', $event_content, $marker );
$master_id          = fair_e2e_add_date_at( $recurring_id, $first_start );
$recurring_period   = fair_e2e_add_sale_period( $master_id );
$occurrence_ids     = fair_e2e_add_series( $recurring_id, $occurrence_count );
$recurring_type_id  = fair_e2e_add_multi_instance_ticket_type( $master_id, 'Pick your sessions', 1 );
$measured_date_id   = $occurrence_ids[ $measured_occurrence - 1 ] ?? 0;
$measured_date      = $measured_date_id ? EventDates::get_by_id( $measured_date_id ) : null;
$recurring_url      = get_permalink( $recurring_id );
$upcoming_count     = count( EventDates::get_upcoming_by_master_id( $master_id ) );
$first_start_ts     = strtotime( $first_start );
$listing_query_args = array(
	'calendar_month' => gmdate( 'm', $first_start_ts ),
	'calendar_year'  => gmdate( 'Y', $first_start_ts ),
	'week_view'      => WeekViewParam::format( (int) gmdate( 'o', $first_start_ts ), (int) gmdate( 'W', $first_start_ts ) ),
);

fair_e2e_add_price( $recurring_type_id, $recurring_period, 10.00 );

if ( ! $measured_date || 'generated' !== $measured_date->occurrence_type ) {
	WP_CLI::error( 'The measured occurrence was not generated.' );
}

// Event with options: one priced ticket type with activities enabled, and
// options priced per sale period (not by their stored fallback price).
$options_id     = fair_e2e_create_event( 'Fair Performance – Options', $event_content, $marker );
$options_date   = fair_e2e_add_date_at( $options_id, $first_start );
$options_period = fair_e2e_add_sale_period( $options_date );
$options_type   = fair_e2e_add_ticket_type( $options_date, 'General Admission' );

fair_e2e_add_price( $options_type, $options_period, 25.00 );

for ( $index = 1; $index <= $option_count; $index++ ) {
	$option_id = fair_e2e_add_option( $options_date, 'Workshop ' . $index, 0.00, 'W' . $index, $index, null, true );
	fair_e2e_add_option_price( $option_id, $options_period, 5.00 + $index );
}

// Listings page: the calendar and week blocks are date-windowed, so its URL
// pins both to the first occurrence.
$listings_id = wp_insert_post(
	array(
		'post_type'    => 'page',
		'post_status'  => 'publish',
		'post_title'   => 'Fair Performance – Listings',
		'post_name'    => 'fair-performance-listings',
		'post_content' => implode(
			"\n\n",
			array(
				'<!-- wp:fair-events/events-list /-->',
				'<!-- wp:fair-events/events-calendar /-->',
				'<!-- wp:fair-events/events-week /-->',
			)
		),
		'meta_input'   => $marker,
	),
	true
);

if ( is_wp_error( $listings_id ) ) {
	WP_CLI::error( 'Failed to create the listings page: ' . $listings_id->get_error_message() );
}

echo 'PERF_SEED:' . wp_json_encode(
	array(
		'pages'               => array(
			'recurring-master'     => $relative( $recurring_url ),
			'recurring-occurrence' => $relative( add_query_arg( 'event_date', OccurrenceDateParam::format( $measured_date ), $recurring_url ) ),
			'event-options'        => $relative( get_permalink( $options_id ) ),
			'listings'             => $relative( add_query_arg( $listing_query_args, get_permalink( $listings_id ) ) ),
		),
		'upcomingOccurrences' => $upcoming_count,
		'offeredOptions'      => count( ActivitySelection::offered_options( $options_date, $options_date ) ),
	)
) . "\n";
