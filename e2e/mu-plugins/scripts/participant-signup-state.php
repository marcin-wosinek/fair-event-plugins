<?php
/**
 * Read a participant's unified-signup relationship for E2E assertions.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

$participant_id = isset( $args[0] ) ? (int) $args[0] : 0;
$event_date_id  = isset( $args[1] ) ? (int) $args[1] : 0;
if ( ! $participant_id || ! $event_date_id ) {
	WP_CLI::error( 'Usage: participant-signup-state.php <participantId> <eventDateId>' );
}

$relationship = ( new \FairAudience\Database\EventParticipantRepository() )
	->get_by_event_date_and_participant( $event_date_id, $participant_id );

echo 'E2E_PARTICIPANT_STATE:' . wp_json_encode(
	array(
		'label' => $relationship ? $relationship->label : null,
	)
) . "\n";
