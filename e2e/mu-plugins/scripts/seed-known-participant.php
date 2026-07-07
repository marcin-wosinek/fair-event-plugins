<?php
/**
 * Create a standalone participant (no event signup) for the resume-anonymous
 * -signup-on-recognised-email E2E spec.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-known-participant.php <name> <email>
 *
 * Used to create two distinct participants: the one whose email the spec
 * later "recognises" (triggering the register endpoint's anti-enumeration
 * resume flow), and a second one the spec binds an unrelated
 * fair_audience_session cookie to (via seed-audience-session-cookie.php) so
 * the browser looks like it already has an active session for someone else
 * when it submits the first participant's email.
 *
 * Prints a single `E2E_PARTICIPANT:{json}` line with the participant id.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

use FairAudience\Models\Participant;

$name  = isset( $args[0] ) ? (string) $args[0] : '';
$email = isset( $args[1] ) ? (string) $args[1] : '';

if ( ! $name || ! $email ) {
	WP_CLI::error( 'Usage: seed-known-participant.php <name> <email>' );
}

$participant = new Participant(
	array(
		'name'          => $name,
		'email'         => $email,
		'email_profile' => 'minimal',
		'status'        => 'confirmed',
	)
);
if ( ! $participant->save() ) {
	WP_CLI::error( 'Failed to create participant.' );
}

echo 'E2E_PARTICIPANT:' . wp_json_encode(
	array(
		'participantId' => (int) $participant->id,
		'email'         => $email,
	)
) . "\n";
