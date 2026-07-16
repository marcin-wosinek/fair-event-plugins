<?php
/**
 * Seed a published event in one of several flavours for the E2E specs.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-event.php <flavour> [json-overrides]
 *
 * Flavours (presets composing lib/event-factory.php):
 *   free                 event + date + sale period + a free ticket type (no price row).
 *   paid                 free, plus a TicketPrice (default 25.00; override {"price":N}).
 *   paid-with-options    paid, plus TicketOption rows (override {"options":["dinner",...]}).
 *   capacity-1           paid with a capacity-1 ticket type, for sold-out/waitlist scenarios.
 *   multiple-instances   a 3-occurrence weekly series with a 'multiple_instances'
 *                        ticket type priced per instance (default 10.00; override
 *                        {"price":N}), minimum_instances default 2 (override
 *                        {"minimumInstances":N}).
 *
 * Examples:
 *   wp eval-file .../seed-event.php paid
 *   wp eval-file .../seed-event.php paid '{"price":40}'
 *   wp eval-file .../seed-event.php paid-with-options '{"options":["dinner","tshirt"]}'
 *   wp eval-file .../seed-event.php multiple-instances
 *
 * Prints a single `E2E_SEED:{json}` line the spec/fixture parses for the event
 * permalink and ids (incl. the ids cleanup-event.php needs).
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/../lib/event-factory.php';

$flavour   = isset( $args[0] ) ? (string) $args[0] : 'paid';
$overrides = array();
if ( isset( $args[1] ) && '' !== $args[1] ) {
	$decoded = json_decode( (string) $args[1], true );
	if ( ! is_array( $decoded ) ) {
		WP_CLI::error( 'Second argument must be a JSON object of overrides, got: ' . $args[1] );
	}
	$overrides = $decoded;
}

$price             = isset( $overrides['price'] ) ? (float) $overrides['price'] : 25.00;
$option_names      = isset( $overrides['options'] ) ? (array) $overrides['options'] : array( 'dinner', 'tshirt' );
$option_price      = isset( $overrides['optionPrice'] ) ? (float) $overrides['optionPrice'] : 10.00;
$minimum_instances = isset( $overrides['minimumInstances'] ) ? (int) $overrides['minimumInstances'] : 2;
$ticket_type_id    = 0;
$option_ids        = array();
$occurrence_ids    = array();
$is_paid           = true;

// Which purchase block the event page carries. Default: fair-audience
// event-signup. Override {"block":"get-tickets"} for specs that exercise the
// fair-events standalone purchase path (with fair-audience deactivated).
// Override {"block":"unified-with-question"} for specs that exercise the
// unified fair-events/event-signup block with a nested fair-form question,
// delegated through fair-audience's participant-aware flow (#1160).
$block_content = '<!-- wp:fair-audience/event-signup /-->';
if ( isset( $overrides['block'] ) && 'get-tickets' === $overrides['block'] ) {
	$block_content = '<!-- wp:fair-events/get-tickets /-->';
} elseif ( isset( $overrides['block'] ) && 'unified-with-question' === $overrides['block'] ) {
	$block_content = implode(
		"\n",
		array(
			'<!-- wp:fair-events/event-signup -->',
			'<!-- wp:fair-audience/fair-form-short-text {"questionKey":"dietary","questionText":"Dietary needs"} /-->',
			'<!-- /wp:fair-events/event-signup -->',
		)
	);
}

$event_id       = fair_e2e_create_event( 'E2E ' . $flavour . ' Event ' . gmdate( 'YmdHis' ) . ' ' . wp_rand( 1000, 9999 ), $block_content );
$event_date_id  = fair_e2e_add_date( $event_id );
$sale_period_id = fair_e2e_add_sale_period( $event_date_id );

switch ( $flavour ) {
	case 'free':
		$ticket_type_id = fair_e2e_add_ticket_type( $event_date_id, 'Free Admission', null );
		$is_paid        = false;
		$price          = 0.00;
		break;

	case 'paid':
		$ticket_type_id = fair_e2e_add_ticket_type( $event_date_id, 'General Admission', null );
		fair_e2e_add_price( $ticket_type_id, $sale_period_id, $price, null );
		break;

	case 'paid-with-options':
		$ticket_type_id = fair_e2e_add_ticket_type( $event_date_id, 'General Admission', null );
		fair_e2e_add_price( $ticket_type_id, $sale_period_id, $price, null );
		foreach ( array_values( $option_names ) as $index => $name ) {
			$option_ids[] = fair_e2e_add_option(
				$event_date_id,
				(string) $name,
				$option_price,
				substr( (string) $name, 0, 12 ),
				$index
			);
		}
		break;

	case 'capacity-1':
		$ticket_type_id = fair_e2e_add_ticket_type( $event_date_id, 'Limited Admission', 1 );
		fair_e2e_add_price( $ticket_type_id, $sale_period_id, $price, 1 );
		break;

	case 'multiple-instances':
		$price = isset( $overrides['price'] ) ? (float) $overrides['price'] : 10.00;
		// Turns the single occurrence already created above into the series
		// master (same event_date_id/sale_period_id) plus 2 generated siblings.
		// Ticket types and sale periods always attach to the master.
		$occurrence_ids = fair_e2e_add_series( $event_id, 3 );
		$ticket_type_id = fair_e2e_add_multi_instance_ticket_type( $event_date_id, 'Pick your sessions', $minimum_instances );
		fair_e2e_add_price( $ticket_type_id, $sale_period_id, $price, null );
		break;

	default:
		WP_CLI::error( "Unknown flavour '{$flavour}'. Use one of: free, paid, paid-with-options, capacity-1, multiple-instances." );
}

echo 'E2E_SEED:' . wp_json_encode(
	array(
		'flavour'          => $flavour,
		'pageUrl'          => get_permalink( $event_id ),
		'eventId'          => (int) $event_id,
		'eventDateId'      => (int) $event_date_id,
		'salePeriodId'     => (int) $sale_period_id,
		'ticketTypeId'     => (int) $ticket_type_id,
		'optionIds'        => array_map( 'intval', $option_ids ),
		'occurrenceIds'    => array_map( 'intval', $occurrence_ids ),
		'minimumInstances' => (int) $minimum_instances,
		'price'            => $is_paid ? $price : 0.00,
	)
) . "\n";
