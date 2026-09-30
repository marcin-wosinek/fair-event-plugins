<?php
/**
 * Seed signups, ticket units and activity selections for EventStatistics
 * API coverage (#1725).
 *
 * Usage: wp eval-file .../seed-event-statistics-tickets.php <action> <json>
 *
 * Actions:
 *   signup              {eventDateId, participantId, ticketTypeId?, quantity,
 *                       status?, createdAt (site-local 'Y-m-d H:i:s'),
 *                       units: [{status, activities: [{optionId, name, status?}]}]}
 *                       Omit units (or pass []) for a signup not yet backfilled.
 *   ticket-status       {ticketId, status}
 *   transfer            {ticketId, holderParticipantId}
 *   participant-option  {relationshipId, optionId, name}
 *   cleanup             {eventDateIds: []}
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
$result           = array();

switch ( $fixture_action ) {
	case 'signup':
		$quantity = (int) $data['quantity'];
		$wpdb->insert(
			$signups_table,
			array(
				'event_date_id'  => (int) $data['eventDateId'],
				'ticket_type_id' => empty( $data['ticketTypeId'] ) ? null : (int) $data['ticketTypeId'],
				'name'           => 'Statistics buyer',
				'email'          => 'statistics-buyer@example.test',
				'quantity'       => $quantity,
				'status'         => $data['status'] ?? 'confirmed',
				'participant_id' => empty( $data['participantId'] ) ? null : (int) $data['participantId'],
				'created_at'     => (string) $data['createdAt'],
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
					)
				);
			}
		}
		$result = array(
			'signupId'  => $signup_id,
			'ticketIds' => $ticket_ids,
		);
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
		break;

	default:
		WP_CLI::error( "Unknown action '{$fixture_action}'." );
}

echo 'E2E_EVENT_STATISTICS_TICKETS:' . wp_json_encode( $result ) . "\n";
