<?php
/**
 * Create a participant and a valid token for an E2E event date.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-participant-token.php <eventDateId> [emailProfile]
 *
 * The optional second arg sets the participant's email profile (default
 * 'minimal'; pass 'marketing' for someone already subscribed to mailings).
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

$event_date_id = isset( $args[0] ) ? (int) $args[0] : 0;
if ( ! $event_date_id ) {
	WP_CLI::error( 'Usage: seed-participant-token.php <eventDateId> [emailProfile]' );
}
$email_profile = isset( $args[1] ) && 'marketing' === $args[1] ? 'marketing' : 'minimal';

$stamp       = gmdate( 'YmdHis' ) . '-' . wp_rand( 1000, 9999 );
$participant = new \FairAudience\Models\Participant(
	array(
		'name'          => 'Token',
		'surname'       => 'Viewer ' . $stamp,
		'email'         => 'token-viewer-' . $stamp . '@example.test',
		'email_profile' => $email_profile,
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
