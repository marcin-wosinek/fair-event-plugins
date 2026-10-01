<?php
/**
 * Seed signups, ticket units, activity selections and capacity limits for
 * EventStatistics API coverage (#1725, #1711).
 *
 * Usage: wp eval-file .../seed-event-statistics-tickets.php <action> <json>
 *
 * Actions:
 *   signup              {eventDateId, participantId, ticketTypeId?, quantity,
 *                       status?, createdAt (site-local 'Y-m-d H:i:s'),
 *                       holdMinutes?,
 *                       units: [{status, activities: [{optionId, name, status?, holdMinutes?}]}]}
 *                       Omit units (or pass []) for a signup not yet backfilled.
 *                       holdMinutes sets a payment hold ending that many
 *                       minutes from now (negative: already lapsed).
 *   configure           {eventDateId, eventCapacity?,
 *                       ticketTypes?: [{name, capacity}], options?: [{name, capacity}]}
 *                       A null capacity is unlimited.
 *   ticket-type-limit   {ticketTypeId, capacity}
 *   ticket-status       {ticketId, status}
 *   transfer            {ticketId, holderParticipantId}
 *   participant-option  {relationshipId, optionId, name}
 *   cleanup             {eventDateIds: [], configuredEventDateIds?: []}
 *                       configuredEventDateIds also lose the ticket types and
 *                       activities `configure` gave them.
 *
 * Rows are written directly so no signup hook creates relationships the
 * spec did not ask for. Prints one `E2E_EVENT_STATISTICS_TICKETS:{json}` line.
 *
 * @package FairEventsE2E
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery -- Test fixture writes exact rows.
 */

defined( 'ABSPATH' ) || exit;

global $wpdb;

$fixture_action = isset( $args[0] ) ? (string) $args[0] : '';
$data           = isset( $args[1] ) ? json_decode( (string) $args[1], true ) : array();
if ( ! is_array( $data ) ) {
	WP_CLI::error( 'Second argument must be a JSON object.' );
}

$signups_table    = $wpdb->prefix . 'fair_events_signups';
$tickets_table    = $wpdb->prefix . 'fair_events_tickets';
$activities_table = $wpdb->prefix . 'fair_events_ticket_activities';
$types_table      = $wpdb->prefix . 'fair_events_ticket_types';
$options_table    = $wpdb->prefix . 'fair_events_ticket_options';
$result           = array();

$hold_until = static function ( $item ) {
	return isset( $item['holdMinutes'] ) ? gmdate( 'Y-m-d H:i:s', time() + (int) $item['holdMinutes'] * MINUTE_IN_SECONDS ) : null;
};

switch ( $fixture_action ) {
	case 'signup':
		$quantity = (int) $data['quantity'];
		$wpdb->insert(
			$signups_table,
			array(
				'event_date_id'      => (int) $data['eventDateId'],
				'ticket_type_id'     => empty( $data['ticketTypeId'] ) ? null : (int) $data['ticketTypeId'],
				'name'               => 'Statistics buyer',
				'email'              => 'statistics-buyer@example.test',
				'quantity'           => $quantity,
				'status'             => $data['status'] ?? 'confirmed',
				'participant_id'     => empty( $data['participantId'] ) ? null : (int) $data['participantId'],
				'payment_expires_at' => $hold_until( $data ),
				'created_at'         => (string) $data['createdAt'],
			)
		);
		$signup_id  = (int) $wpdb->insert_id;
		$ticket_ids = array();
		foreach ( array_values( $data['units'] ?? array() ) as $index => $unit ) {
			$wpdb->insert(
				$tickets_table,
				array(
					'reference'                => md5( wp_generate_uuid4() ),
					'signup_id'                => $signup_id,
					'unit_position'            => $index + 1,
					'event_date_id'            => (int) $data['eventDateId'],
					'ticket_type_id'           => empty( $data['ticketTypeId'] ) ? null : (int) $data['ticketTypeId'],
					'status'                   => (string) $unit['status'],
					'purchaser_participant_id' => empty( $data['participantId'] ) ? null : (int) $data['participantId'],
					'holder_participant_id'    => empty( $data['participantId'] ) ? null : (int) $data['participantId'],
				)
			);
			$ticket_id    = (int) $wpdb->insert_id;
			$ticket_ids[] = $ticket_id;
			foreach ( $unit['activities'] ?? array() as $activity ) {
				$wpdb->insert(
					$activities_table,
					array(
						'ticket_id'          => $ticket_id,
						'ticket_option_id'   => (int) $activity['optionId'],
						'ticket_option_name' => (string) $activity['name'],
						'status'             => $activity['status'] ?? 'confirmed',
						'expires_at'         => $hold_until( $activity ),
					)
				);
			}
		}
		$result = array(
			'signupId'  => $signup_id,
			'ticketIds' => $ticket_ids,
		);
		break;

	case 'configure':
		$event_date_id = (int) $data['eventDateId'];
		if ( array_key_exists( 'eventCapacity', $data ) ) {
			$result['eventCapacity'] = $wpdb->query( $wpdb->prepare( 'UPDATE %i SET capacity = NULLIF(%d, -1) WHERE id = %d', $wpdb->prefix . 'fair_event_dates', null === $data['eventCapacity'] ? -1 : (int) $data['eventCapacity'], $event_date_id ) );
		}
		$result['ticketTypeIds'] = array();
		foreach ( array_values( $data['ticketTypes'] ?? array() ) as $index => $ticket_type ) {
			$result['ticketTypeIds'][] = (int) \FairEvents\Models\TicketType::create( $event_date_id, (string) $ticket_type['name'], isset( $ticket_type['capacity'] ) ? (int) $ticket_type['capacity'] : null, $index );
		}
		$result['optionIds'] = array();
		foreach ( array_values( $data['options'] ?? array() ) as $index => $option ) {
			$wpdb->insert(
				$options_table,
				array(
					'event_date_id' => $event_date_id,
					'name'          => (string) $option['name'],
					'capacity'      => isset( $option['capacity'] ) ? (int) $option['capacity'] : null,
					'sort_order'    => $index,
				)
			);
			$result['optionIds'][] = (int) $wpdb->insert_id;
		}
		break;

	case 'ticket-type-limit':
		$result['updated'] = $wpdb->query( $wpdb->prepare( 'UPDATE %i SET capacity = NULLIF(%d, -1) WHERE id = %d', $types_table, null === $data['capacity'] ? -1 : (int) $data['capacity'], (int) $data['ticketTypeId'] ) );
		break;

	case 'ticket-status':
		$result['updated'] = $wpdb->update( $tickets_table, array( 'status' => (string) $data['status'] ), array( 'id' => (int) $data['ticketId'] ) );
		break;

	case 'transfer':
		$result['updated'] = $wpdb->update( $tickets_table, array( 'holder_participant_id' => (int) $data['holderParticipantId'] ), array( 'id' => (int) $data['ticketId'] ) );
		break;

	case 'participant-option':
		$result['inserted'] = $wpdb->insert(
			$wpdb->prefix . 'fair_audience_event_participant_options',
			array(
				'event_participant_id' => (int) $data['relationshipId'],
				'ticket_option_id'     => (int) $data['optionId'],
				'ticket_option_name'   => (string) $data['name'],
				'status'               => 'confirmed',
			)
		);
		break;

	case 'cleanup':
		$event_date_ids = array_values( array_filter( array_map( 'intval', (array) ( $data['eventDateIds'] ?? array() ) ) ) );
		if ( $event_date_ids ) {
			$placeholders = implode( ', ', array_fill( 0, count( $event_date_ids ), '%d' ) );
			// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- $placeholders is a generated %d list.
			$result['activities'] = $wpdb->query( $wpdb->prepare( "DELETE ta FROM %i AS ta INNER JOIN %i AS t ON t.id = ta.ticket_id WHERE t.event_date_id IN ( $placeholders )", array_merge( array( $activities_table, $tickets_table ), $event_date_ids ) ) );
			$result['tickets']    = $wpdb->query( $wpdb->prepare( "DELETE FROM %i WHERE event_date_id IN ( $placeholders )", array_merge( array( $tickets_table ), $event_date_ids ) ) );
			$result['signups']    = $wpdb->query( $wpdb->prepare( "DELETE FROM %i WHERE event_date_id IN ( $placeholders )", array_merge( array( $signups_table ), $event_date_ids ) ) );
			$result['options']    = $wpdb->query( $wpdb->prepare( "DELETE epo FROM %i AS epo INNER JOIN %i AS ep ON ep.id = epo.event_participant_id WHERE ep.event_date_id IN ( $placeholders )", array_merge( array( $wpdb->prefix . 'fair_audience_event_participant_options', $wpdb->prefix . 'fair_audience_event_participants' ), $event_date_ids ) ) );
			// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber
		}
		foreach ( array_filter( array_map( 'intval', (array) ( $data['configuredEventDateIds'] ?? array() ) ) ) as $configured_id ) {
			$wpdb->delete( $types_table, array( 'event_date_id' => $configured_id ) );
			$wpdb->delete( $options_table, array( 'event_date_id' => $configured_id ) );
		}
		break;

	default:
		WP_CLI::error( "Unknown action '{$fixture_action}'." );
}

echo 'E2E_EVENT_STATISTICS_TICKETS:' . wp_json_encode( $result ) . "\n";
