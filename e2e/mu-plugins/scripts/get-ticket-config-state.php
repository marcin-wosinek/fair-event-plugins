<?php
/**
 * Report an event date's ticket configuration (types, sale periods, options)
 * for the Duplicate Event wizard's round-trip specs (#1330).
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/get-ticket-config-state.php <event_date_id>
 *
 * Prints a single `E2E_TICKET_STATE:{json}` line: ticket_types (name,
 * recurrence_scope, capacity), sale_periods (name, sale_start, sale_end), and
 * options (name, price).
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

use FairEvents\Models\TicketType;
use FairEvents\Models\TicketSalePeriod;
use FairEventsExperimental\Models\TicketOption;

$event_date_id = isset( $args[0] ) ? (int) $args[0] : 0;
if ( ! $event_date_id ) {
	WP_CLI::error( 'Usage: get-ticket-config-state.php <event_date_id>' );
}

$ticket_types = array_map(
	function ( $type ) {
		return array(
			'name'             => $type->name,
			'recurrence_scope' => $type->recurrence_scope,
			'capacity'         => $type->capacity,
		);
	},
	TicketType::get_all_by_event_date_id( $event_date_id )
);

$sale_periods = array_map(
	function ( $period ) {
		return array(
			'name'       => $period->name,
			'sale_start' => $period->sale_start,
			'sale_end'   => $period->sale_end,
		);
	},
	TicketSalePeriod::get_all_by_event_date_id( $event_date_id )
);

$options = array_map(
	function ( $option ) {
		return array(
			'name'  => $option->name,
			'price' => (float) $option->price,
		);
	},
	TicketOption::get_all_by_event_date_id( $event_date_id )
);

echo 'E2E_TICKET_STATE:' . wp_json_encode(
	array(
		'ticket_types' => $ticket_types,
		'sale_periods' => $sale_periods,
		'options'      => $options,
	)
) . "\n";
