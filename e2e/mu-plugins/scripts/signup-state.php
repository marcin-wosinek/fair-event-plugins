<?php
/**
 * Report a buyer's signup state for the ticket-purchase E2E spec.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/signup-state.php <email> <event_date_id>
 *
 * Prints a single `E2E_STATE:{json}` line with the participant's marketing
 * profile, the event-participant label, and the mail captured for this buyer,
 * so the spec can assert that consent was recorded only when opted in, that
 * payment flipped the row to signed_up, and that the confirmation email was
 * delivered.
 *
 * @package FairEventsE2E
 */

use FairAudience\Database\ParticipantRepository;
use FairAudience\Database\EventParticipantRepository;

$email         = isset( $args[0] ) ? $args[0] : '';
$event_date_id = isset( $args[1] ) ? (int) $args[1] : 0;

if ( empty( $email ) ) {
	WP_CLI::error( 'Usage: signup-state.php <email> <event_date_id>' );
}

$participant = ( new ParticipantRepository() )->get_by_email( $email );

if ( ! $participant ) {
	echo 'E2E_STATE:' . wp_json_encode( array( 'found' => false ) ) . "\n";
	return;
}

$label = null;
if ( $event_date_id ) {
	$event_participant = ( new EventParticipantRepository() )->get_by_event_date_and_participant(
		$event_date_id,
		$participant->id
	);
	$label             = $event_participant ? $event_participant->label : null;
}

// Mail addressed to this buyer, captured by fair-e2e-support.php.
$mail = array();
foreach ( get_option( 'fair_e2e_captured_mail', array() ) as $entry ) {
	$recipients = (array) ( $entry['to'] ?? array() );
	if ( in_array( $email, $recipients, true ) ) {
		$mail[] = array(
			'to'      => $entry['to'] ?? '',
			'subject' => $entry['subject'] ?? '',
		);
	}
}

echo 'E2E_STATE:' . wp_json_encode(
	array(
		'found'         => true,
		'email_profile' => $participant->email_profile,
		'status'        => $participant->status,
		'label'         => $label,
		'mail'          => $mail,
	)
) . "\n";
