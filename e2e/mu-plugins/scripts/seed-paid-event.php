<?php
/**
 * Seed a published paid event for the ticket-purchase E2E spec.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-paid-event.php
 *
 * Creates a fair_event post (with the event-signup block in its content), a
 * single event date, an active sale period, one paid ticket type, and its
 * price. Prints a single `E2E_SEED:{json}` line the spec parses for the event
 * permalink and ids.
 *
 * @package FairEventsE2E
 */

use FairEvents\Models\EventDates;
use FairEvents\Models\TicketSalePeriod;
use FairEvents\Models\TicketType;
use FairEvents\Models\TicketPrice;

$price = 25.00;

$event_id = wp_insert_post(
	array(
		'post_type'    => 'fair_event',
		'post_status'  => 'publish',
		'post_title'   => 'E2E Paid Event ' . gmdate( 'YmdHis' ),
		'post_content' => '<!-- wp:fair-audience/event-signup /-->',
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

$ticket_type_id = TicketType::create( $event_date_id, 'General Admission', null, 0 );

if ( ! $ticket_type_id ) {
	WP_CLI::error( 'Failed to create ticket type.' );
}

if ( ! TicketPrice::create( $ticket_type_id, $sale_period_id, $price, null ) ) {
	WP_CLI::error( 'Failed to create ticket price.' );
}

echo 'E2E_SEED:' . wp_json_encode(
	array(
		'pageUrl'      => get_permalink( $event_id ),
		'eventId'      => (int) $event_id,
		'eventDateId'  => (int) $event_date_id,
		'ticketTypeId' => (int) $ticket_type_id,
		'price'        => $price,
	)
) . "\n";
