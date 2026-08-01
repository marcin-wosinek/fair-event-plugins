<?php
/**
 * Seed a published free event whose Event Signup nests a Conditional Section
 * keyed on the selected ticket type (issue #1349).
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-conditional-ticket-type.php
 *
 * Creates a fair_event post with two ticket types (Adult, Child). The
 * event-signup block nests a fair-form-conditional (conditionSource=ticketType,
 * referencing the Adult ticket type ID) that wraps a short-text question. The
 * ticket types don't exist until after the event date is created, so the post
 * content is built in a second pass, once their IDs are known. Prints a single
 * `E2E_SEED:{json}` line the spec parses.
 *
 * @package FairEventsE2E
 */

use FairEvents\Models\EventDates;
use FairEvents\Models\TicketSalePeriod;
use FairEvents\Models\TicketType;
use FairEvents\Models\TicketPrice;

$event_id = wp_insert_post(
	array(
		'post_type'    => 'fair_event',
		'post_status'  => 'publish',
		'post_title'   => 'E2E Conditional Ticket Type ' . gmdate( 'YmdHis' ),
		'post_content' => '',
	),
	true
);

if ( is_wp_error( $event_id ) ) {
	WP_CLI::error( 'Failed to create event: ' . $event_id->get_error_message() );
}

$event_date_id = EventDates::save_occurrence(
	$event_id,
	gmdate( 'Y-m-d H:i:s', strtotime( '+7 days' ) ),
	gmdate( 'Y-m-d H:i:s', strtotime( '+7 days +2 hours' ) ),
	false,
	'single'
);

if ( ! $event_date_id ) {
	WP_CLI::error( 'Failed to create event date.' );
}

$sale_period_id = TicketSalePeriod::create(
	$event_date_id,
	'Standard',
	gmdate( 'Y-m-d H:i:s', strtotime( '-1 day' ) ),
	gmdate( 'Y-m-d H:i:s', strtotime( '+30 days' ) ),
	0
);

if ( ! $sale_period_id ) {
	WP_CLI::error( 'Failed to create sale period.' );
}

$adult_type_id = TicketType::create( $event_date_id, 'Adult', null, 0 );
$child_type_id = TicketType::create( $event_date_id, 'Child', null, 1 );

if ( ! $adult_type_id || ! $child_type_id ) {
	WP_CLI::error( 'Failed to create ticket types.' );
}

if ( ! TicketPrice::create( $adult_type_id, $sale_period_id, 0.0, null ) ) {
	WP_CLI::error( 'Failed to create Adult ticket price.' );
}

if ( ! TicketPrice::create( $child_type_id, $sale_period_id, 0.0, null ) ) {
	WP_CLI::error( 'Failed to create Child ticket price.' );
}

// The conditional reveals the "guardian" question only when the Adult
// ticket type is selected.
$content = implode(
	"\n",
	array(
		'<!-- wp:fair-events/event-signup -->',
		'<!-- wp:fair-audience/fair-form-conditional {"conditionSource":"ticketType","conditionTicketTypeIds":[' . $adult_type_id . '],"conditionOperator":"selected"} -->',
		'<!-- wp:fair-audience/fair-form-short-text {"questionKey":"guardian","questionText":"Guardian contact"} /-->',
		'<!-- /wp:fair-audience/fair-form-conditional -->',
		'<!-- /wp:fair-events/event-signup -->',
	)
);

$updated = wp_update_post(
	array(
		'ID'           => $event_id,
		'post_content' => $content,
	),
	true
);

if ( is_wp_error( $updated ) ) {
	WP_CLI::error( 'Failed to update event content: ' . $updated->get_error_message() );
}

echo 'E2E_SEED:' . wp_json_encode(
	array(
		'pageUrl'     => get_permalink( $event_id ),
		'eventId'     => (int) $event_id,
		'eventDateId' => (int) $event_date_id,
		'adultTypeId' => (int) $adult_type_id,
		'childTypeId' => (int) $child_type_id,
	)
) . "\n";
