<?php
/**
 * Seed a published free event whose Event Signup nests a Conditional Section
 * keyed on an event option's short name (issue #681).
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-conditional-signup.php
 *
 * Creates a fair_event post whose content is an event-signup block containing a
 * fair-form-conditional (conditionSource=eventOption, short name "dinner") that
 * wraps a short-text question. Adds one event date, an active sale period, a
 * free ticket type + price, and a "dinner" ticket option carrying the short
 * name. Prints a single `E2E_SEED:{json}` line the spec parses.
 *
 * @package FairEventsE2E
 */

use FairEvents\Models\EventDates;
use FairEvents\Models\TicketSalePeriod;
use FairEvents\Models\TicketType;
use FairEvents\Models\TicketPrice;
use FairEventsExperimental\Models\TicketOption;

// Nested block content: the conditional reveals the "diet" question only when
// the "dinner" option is selected.
$content = implode(
	"\n",
	array(
		'<!-- wp:fair-audience/event-signup -->',
		'<!-- wp:fair-audience/fair-form-conditional {"conditionSource":"eventOption","conditionOptionShortName":"dinner","conditionOperator":"selected"} -->',
		'<!-- wp:fair-audience/fair-form-short-text {"questionKey":"diet","questionText":"Dietary restrictions"} /-->',
		'<!-- /wp:fair-audience/fair-form-conditional -->',
		'<!-- /wp:fair-audience/event-signup -->',
	)
);

$event_id = wp_insert_post(
	array(
		'post_type'    => 'fair_event',
		'post_status'  => 'publish',
		'post_title'   => 'E2E Conditional Signup ' . gmdate( 'YmdHis' ),
		'post_content' => $content,
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

if ( ! TicketPrice::create( $ticket_type_id, $sale_period_id, 0.0, null ) ) {
	WP_CLI::error( 'Failed to create ticket price.' );
}

// The controlling option: short name "dinner" is what the conditional keys on.
$option_id = TicketOption::create( $event_date_id, 'Dinner', 0.0, 0, 'dinner' );

if ( ! $option_id ) {
	WP_CLI::error( 'Failed to create ticket option.' );
}

echo 'E2E_SEED:' . wp_json_encode(
	array(
		'pageUrl'     => get_permalink( $event_id ),
		'eventId'     => (int) $event_id,
		'eventDateId' => (int) $event_date_id,
		'optionId'    => (int) $option_id,
		'shortName'   => 'dinner',
	)
) . "\n";
