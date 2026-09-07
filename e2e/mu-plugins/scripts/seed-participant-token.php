<?php
/**
 * Create a participant and a valid token for an E2E event date.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

$event_date_id = isset( $args[0] ) ? (int) $args[0] : 0;
if ( ! $event_date_id ) {
	WP_CLI::error( 'Usage: seed-participant-token.php <eventDateId>' );
}

$stamp       = gmdate( 'YmdHis' ) . '-' . wp_rand( 1000, 9999 );
$participant = new \FairAudience\Models\Participant(
	array(
		'name'          => 'Token',
		'surname'       => 'Viewer ' . $stamp,
		'email'         => 'token-viewer-' . $stamp . '@example.test',
		'email_profile' => 'minimal',
		'status'        => 'confirmed',
	)
);
if ( ! $participant->save() ) {
	WP_CLI::error( 'Failed to create participant.' );
}

echo 'E2E_TOKEN:' . wp_json_encode(
	array(
		'participantId' => (int) $participant->id,
		'name'          => trim( $participant->name . ' ' . $participant->surname ),
		'email'         => $participant->email,
		'token'         => \FairAudience\Services\ParticipantToken::generate( (int) $participant->id, $event_date_id ),
	)
) . "\n";
