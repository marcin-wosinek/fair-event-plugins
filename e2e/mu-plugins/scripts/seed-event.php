<?php
/**
 * Seed a published event in one of several flavours for the E2E specs.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-event.php <flavour> [json-overrides]
 *
 * Flavours (presets composing lib/event-factory.php):
 *   free               event + date + sale period + a free ticket type (no price row).
 *   paid               free, plus a TicketPrice (default 25.00; override {"price":N}).
 *   paid-with-options  paid, plus TicketOption rows (override {"options":["dinner",...]}).
 *   capacity-1         paid with a capacity-1 ticket type, for sold-out/waitlist scenarios.
 *
 * Examples:
 *   wp eval-file .../seed-event.php paid
 *   wp eval-file .../seed-event.php paid '{"price":40}'
 *   wp eval-file .../seed-event.php paid-with-options '{"options":["dinner","tshirt"]}'
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

$price          = isset( $overrides['price'] ) ? (float) $overrides['price'] : 25.00;
$option_names   = isset( $overrides['options'] ) ? (array) $overrides['options'] : array( 'dinner', 'tshirt' );
$option_price   = isset( $overrides['optionPrice'] ) ? (float) $overrides['optionPrice'] : 10.00;
$ticket_type_id = 0;
$option_ids     = array();
$is_paid        = true;

// Which purchase block the event page carries. Default: fair-audience
// event-signup. Override {"block":"get-tickets"} for specs that exercise the
// fair-events standalone purchase path (with fair-audience deactivated).
$block_content = '<!-- wp:fair-audience/event-signup /-->';
if ( isset( $overrides['block'] ) && 'get-tickets' === $overrides['block'] ) {
	$block_content = '<!-- wp:fair-events/get-tickets /-->';
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

	default:
		WP_CLI::error( "Unknown flavour '{$flavour}'. Use one of: free, paid, paid-with-options, capacity-1." );
}

echo 'E2E_SEED:' . wp_json_encode(
	array(
		'flavour'      => $flavour,
		'pageUrl'      => get_permalink( $event_id ),
		'eventId'      => (int) $event_id,
		'eventDateId'  => (int) $event_date_id,
		'salePeriodId' => (int) $sale_period_id,
		'ticketTypeId' => (int) $ticket_type_id,
		'optionIds'    => array_map( 'intval', $option_ids ),
		'price'        => $is_paid ? $price : 0.00,
	)
) . "\n";
