<?php
/**
 * Optionally update, then report, an event date master's `address` column
 * and every generated child's resolved address — for the event-date-address
 * E2E spec (#721).
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/event-date-address-state.php <masterEventDateId> [newAddress]
 *
 * With a second argument, updates the master's `address` first (exactly what
 * EventDatesController::update_item does for this field), so the spec can
 * assert the edit cascades to every generated child through
 * resolve_instance()'s COALESCE( child.address, master.address ) fallback.
 * Without it, this is a read-only check.
 *
 * Prints a single `E2E_STATE:{json}` line: the master's address and an array
 * of every child's id + resolved address.
 *
 * @package FairEventsE2E
 */

use FairEvents\Models\EventDates;

$master_id   = isset( $args[0] ) ? (int) $args[0] : 0;
$new_address = isset( $args[1] ) ? (string) $args[1] : null;

if ( ! $master_id ) {
	WP_CLI::error( 'Usage: event-date-address-state.php <masterEventDateId> [newAddress]' );
}

if ( null !== $new_address ) {
	if ( ! EventDates::update_by_id( $master_id, array( 'address' => $new_address ) ) ) {
		WP_CLI::error( 'Failed to update master address.' );
	}
}

$master = EventDates::get_by_id( $master_id );

if ( ! $master ) {
	WP_CLI::error( "No event date found for id {$master_id}." );
}

$children = array();
foreach ( EventDates::get_all_by_master_id( $master_id ) as $row ) {
	if ( (int) $row->id === $master_id ) {
		continue;
	}
	$children[] = array(
		'id'      => (int) $row->id,
		'address' => $row->address,
	);
}

echo 'E2E_STATE:' . wp_json_encode(
	array(
		'masterAddress' => $master->address,
		'children'      => $children,
	)
) . "\n";
