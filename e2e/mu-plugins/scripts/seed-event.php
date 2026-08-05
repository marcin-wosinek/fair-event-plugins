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
 *   three-ticket-scopes  a 3-occurrence weekly series (fixed base date, for
 *                        stable screenshots) carrying one ticket type of each
 *                        recurrence scope: single_instance, whole_series, and
 *                        multiple_instances (default prices 15/40/10; override
 *                        {"price":N} sets the single_instance price). Override
 *                        {"omitMulti":true} to skip the multiple_instances
 *                        type (single_instance + whole_series only), the
 *                        occurrence-picker regression scenario. Override
 *                        {"seriesCount":N} to change the number of occurrences
 *                        (default 3); {"seriesCount":1} seeds a series with
 *                        exactly one upcoming occurrence.
 *   audience-ticket-scopes  like three-ticket-scopes, but always renders the
 *                        dormant fair-audience/event-signup block regardless
 *                        of any {"block":…} override — for specs proving old
 *                        pages (authored before #1245) keep rendering it
 *                        unchanged.
 *   address              event-info block + a calendar button, no ticket
 *                        type/sale period (signup path untouched). Renders
 *                        {"address":"…"} (default 'Calle Mayor 1, Madrid') via
 *                        the event date's inline address column. Override
 *                        {"recurring":true} to seed a 3-occurrence weekly
 *                        series with the master dated -10 days (so the public
 *                        page pivots to a generated child instead of the
 *                        master). Override {"createVenue":true} (+ optional
 *                        {"venueName":"…","venueAddress":"…"}) to attach a
 *                        venue, which must win over any address on the row.
 *   unified-with-options like paid-with-options, but renders the unified
 *                        fair-events/event-signup block (instead of the
 *                        default fair-audience/event-signup) so the base
 *                        plugin's own activities fieldset is under test.
 *                        Override {"minimumActivities":N} to set the
 *                        event-date global minimum-activities requirement
 *                        (default 0 = none).
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

$price              = isset( $overrides['price'] ) ? (float) $overrides['price'] : 25.00;
$option_names       = isset( $overrides['options'] ) ? (array) $overrides['options'] : array( 'dinner', 'tshirt' );
$option_price       = isset( $overrides['optionPrice'] ) ? (float) $overrides['optionPrice'] : 10.00;
$minimum_instances  = isset( $overrides['minimumInstances'] ) ? (int) $overrides['minimumInstances'] : 2;
$series_count       = isset( $overrides['seriesCount'] ) ? (int) $overrides['seriesCount'] : 3;
$minimum_activities = isset( $overrides['minimumActivities'] ) ? (int) $overrides['minimumActivities'] : 0;
$omit_multi         = isset( $overrides['omitMulti'] ) && $overrides['omitMulti'];
$address            = isset( $overrides['address'] ) ? (string) $overrides['address'] : 'Calle Mayor 1, Madrid';
$recurring          = isset( $overrides['recurring'] ) && $overrides['recurring'];
$create_venue       = isset( $overrides['createVenue'] ) && $overrides['createVenue'];
$venue_name         = isset( $overrides['venueName'] ) ? (string) $overrides['venueName'] : 'Test Hall';
$venue_address      = isset( $overrides['venueAddress'] ) ? (string) $overrides['venueAddress'] : 'Calle Venue 1';
$ticket_type_id     = 0;
$option_ids         = array();
$occurrence_ids     = array();
$extra_type_ids     = array();
$venue_id           = 0;
$is_paid            = true;

// Which purchase block the event page carries. Default (#1245 cutover): the
// unified fair-events/event-signup block — the only signup block new content
// uses now that render.php no longer delegates to fair-audience's legacy
// block. Override {"block":"get-tickets"} for specs that exercise the
// fair-events standalone purchase path (with fair-audience deactivated).
// Override {"block":"unified-with-question"} for specs that exercise the
// unified block with a nested fair-form question.
$block_content = '<!-- wp:fair-events/event-signup /-->';
if ( 'audience-ticket-scopes' === $flavour ) {
	// The legacy block deliberately, regardless of any override — this
	// flavour exists to prove old pages (authored before #1245) keep
	// rendering their dormant fair-audience/event-signup block unchanged.
	$block_content = '<!-- wp:fair-audience/event-signup /-->';
} elseif ( isset( $overrides['block'] ) && 'legacy' === $overrides['block'] ) {
	// The dormant legacy block, on request — for specs covering
	// functionality still deferred to it post-#1245 (participant_token URL
	// login, the request-link/resume-by-email flow).
	$block_content = '<!-- wp:fair-audience/event-signup /-->';
} elseif ( isset( $overrides['block'] ) && 'get-tickets' === $overrides['block'] ) {
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
} elseif ( 'unified-with-options' === $flavour ) {
	$block_content = '<!-- wp:fair-events/event-signup /-->';
} elseif ( isset( $overrides['block'] ) && 'unified-with-phone' === $overrides['block'] ) {
	$block_content = implode(
		"\n",
		array(
			'<!-- wp:fair-events/event-signup -->',
			'<!-- wp:fair-audience/fair-form-phone {"questionKey":"mobile","questionText":"Mobile"} /-->',
			'<!-- /wp:fair-events/event-signup -->',
		)
	);
} elseif ( isset( $overrides['block'] ) && 'unified-with-url' === $overrides['block'] ) {
	$block_content = implode(
		"\n",
		array(
			'<!-- wp:fair-events/event-signup -->',
			'<!-- wp:fair-audience/fair-form-url {"questionKey":"website","questionText":"Website"} /-->',
			'<!-- /wp:fair-events/event-signup -->',
		)
	);
} elseif ( isset( $overrides['block'] ) && 'unified-with-date-fields' === $overrides['block'] ) {
	$block_content = implode(
		"\n",
		array(
			'<!-- wp:fair-events/event-signup -->',
			'<!-- wp:fair-audience/fair-form-date {"questionKey":"visit_date","questionText":"Visit date"} /-->',
			'<!-- wp:fair-audience/fair-form-datetime {"questionKey":"appointment_slot","questionText":"Appointment slot"} /-->',
			'<!-- /wp:fair-events/event-signup -->',
		)
	);
} elseif ( 'address' === $flavour ) {
	// event-info block (renders the address/venue) + a calendar button — no
	// signup block, since this flavour never touches the purchase path.
	$block_content = implode(
		"\n",
		array(
			'<!-- wp:fair-events/event-info /-->',
			'',
			'<!-- wp:buttons -->',
			'<div class="wp-block-buttons"><!-- wp:button {"isCalendarButton":true} -->',
			'<div class="wp-block-button"><a class="wp-block-button__link wp-element-button">Add to calendar</a></div>',
			'<!-- /wp:button --></div>',
			'<!-- /wp:buttons -->',
		)
	);
}

$event_id = fair_e2e_create_event( 'E2E ' . $flavour . ' Event ' . gmdate( 'YmdHis' ) . ' ' . wp_rand( 1000, 9999 ), $block_content );

// three-ticket-scopes pins its occurrence to a fixed absolute date (rather than
// fair_e2e_add_date()'s '+7 days') so the rendered dates/prices are stable and
// reviewable as regressions across runs.
if ( 'three-ticket-scopes' === $flavour ) {
	$event_date_id = fair_e2e_add_date_at( $event_id, '2027-01-15 18:00:00' );
} elseif ( 'address' === $flavour && $recurring ) {
	// The master must start in the past: get_upcoming_by_master_id() includes
	// the master row itself when its own start is still upcoming, so a
	// future-dated master would make SelectedOccurrence::resolve() pivot back
	// to the master and never reach a generated child.
	$event_date_id = fair_e2e_add_date_at( $event_id, gmdate( 'Y-m-d H:i:s', strtotime( '-10 days' ) ) );
} else {
	$event_date_id = fair_e2e_add_date( $event_id );
}
// 'address' scenarios never touch the signup path — skip the sale period.
$sale_period_id = 'address' === $flavour ? 0 : fair_e2e_add_sale_period( $event_date_id );

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

	case 'unified-with-options':
		// Override {"fullOptionIndex":N} pre-fills that option's capacity to 0
		// (already full, no seed signup needed) for full-option render specs.
		$full_option_index = isset( $overrides['fullOptionIndex'] ) ? (int) $overrides['fullOptionIndex'] : -1;
		$ticket_type_id    = fair_e2e_add_ticket_type( $event_date_id, 'General Admission', null );
		fair_e2e_add_price( $ticket_type_id, $sale_period_id, $price, null );
		foreach ( array_values( $option_names ) as $index => $name ) {
			$option_ids[] = fair_e2e_add_option(
				$event_date_id,
				(string) $name,
				$option_price,
				substr( (string) $name, 0, 12 ),
				$index,
				$index === $full_option_index ? 0 : null
			);
		}
		if ( $minimum_activities > 0 ) {
			fair_e2e_set_event_date_setting( $event_date_id, 'minimum_activities', $minimum_activities );
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

	case 'three-ticket-scopes':
		$price = isset( $overrides['price'] ) ? (float) $overrides['price'] : 15.00;
		// Turns the single occurrence already created above into the series
		// master (same event_date_id/sale_period_id) plus generated siblings
		// (default 2, for 3 total; override {"seriesCount":1} for the
		// last-occurrence-remaining scenario).
		$occurrence_ids = fair_e2e_add_series( $event_id, $series_count );
		$single_type_id = fair_e2e_add_ticket_type( $event_date_id, 'Single Session', null );
		$whole_type_id  = fair_e2e_add_whole_series_ticket_type( $event_date_id, 'Full Series Pass' );
		fair_e2e_add_price( $single_type_id, $sale_period_id, $price, null );
		fair_e2e_add_price( $whole_type_id, $sale_period_id, 40.00, null );
		$ticket_type_id = $single_type_id;
		$extra_type_ids = array( $whole_type_id );
		if ( ! $omit_multi ) {
			$multi_type_id    = fair_e2e_add_multi_instance_ticket_type( $event_date_id, 'Pick your sessions', $minimum_instances );
			$extra_type_ids[] = $multi_type_id;
			fair_e2e_add_price( $multi_type_id, $sale_period_id, 10.00, null );
		}
		break;

	case 'audience-ticket-scopes':
		$price = isset( $overrides['price'] ) ? (float) $overrides['price'] : 15.00;
		// Turns the single occurrence already created above into the series
		// master (same event_date_id/sale_period_id) plus 2 generated siblings.
		$occurrence_ids = fair_e2e_add_series( $event_id, 3 );
		$single_type_id = fair_e2e_add_ticket_type( $event_date_id, 'Single Session', null );
		$whole_type_id  = fair_e2e_add_whole_series_ticket_type( $event_date_id, 'Full Series Pass' );
		fair_e2e_add_price( $single_type_id, $sale_period_id, $price, null );
		fair_e2e_add_price( $whole_type_id, $sale_period_id, 40.00, null );
		$ticket_type_id = $single_type_id;
		$extra_type_ids = array( $whole_type_id );
		if ( ! $omit_multi ) {
			$multi_type_id    = fair_e2e_add_multi_instance_ticket_type( $event_date_id, 'Pick your sessions', $minimum_instances );
			$extra_type_ids[] = $multi_type_id;
			fair_e2e_add_price( $multi_type_id, $sale_period_id, 10.00, null );
		}
		break;

	case 'address':
		fair_e2e_set_address( $event_date_id, $address );
		if ( $recurring ) {
			$occurrence_ids = fair_e2e_add_series( $event_id, 3 );
		}
		if ( $create_venue ) {
			$venue_id = fair_e2e_create_venue( $venue_name, $venue_address );
			fair_e2e_set_venue( $event_date_id, $venue_id );
		}
		$is_paid = false;
		$price   = 0.00;
		break;

	default:
		WP_CLI::error( "Unknown flavour '{$flavour}'. Use one of: free, paid, paid-with-options, capacity-1, multiple-instances, three-ticket-scopes, audience-ticket-scopes, address, unified-with-options." );
}

echo 'E2E_SEED:' . wp_json_encode(
	array(
		'flavour'          => $flavour,
		'pageUrl'          => get_permalink( $event_id ),
		'eventId'          => (int) $event_id,
		'eventDateId'      => (int) $event_date_id,
		'salePeriodId'     => (int) $sale_period_id,
		'ticketTypeId'     => (int) $ticket_type_id,
		'extraTypeIds'     => array_map( 'intval', $extra_type_ids ),
		'optionIds'        => array_map( 'intval', $option_ids ),
		'occurrenceIds'    => array_map( 'intval', $occurrence_ids ),
		'minimumInstances' => (int) $minimum_instances,
		'price'            => $is_paid ? $price : 0.00,
		'venueId'          => (int) $venue_id,
	)
) . "\n";
