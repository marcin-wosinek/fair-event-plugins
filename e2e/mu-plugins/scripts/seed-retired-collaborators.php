<?php
/**
 * Recreate what a site using the retired Collaborators page had stored.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-retired-collaborators.php <eventId> <eventDateId>
 *
 * Adds a participant as a collaborator of the given event date, stores the
 * `collaborators` feature choice next to another bundle's choice, and
 * rewinds the fair-audience schema version so the next WordPress load runs
 * the collaborators cleanup again.
 *
 * Prints a single `E2E_SEED:{json}` line with the created ids.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

$event_id      = isset( $args[0] ) ? (int) $args[0] : 0;
$event_date_id = isset( $args[1] ) ? (int) $args[1] : 0;

$email       = 'e2e-collaborator-' . wp_generate_password( 8, false ) . '@example.com';
$participant = new \FairAudience\Models\Participant(
	array(
		'name'          => 'Retired',
		'surname'       => 'Collaborator',
		'email'         => $email,
		'email_profile' => 'minimal',
		'status'        => 'confirmed',
	)
);
$participant->save();

$repository      = new \FairAudience\Database\EventParticipantRepository();
$relationship_id = $repository->add_participant_to_event( $event_id, (int) $participant->id, 'collaborator', $event_date_id );

// Store the choice as the old code did: the current sanitizer no longer
// knows the `collaborators` key and would drop it.
remove_all_filters( 'sanitize_option_fair_audience_experimental_features' );
update_option(
	'fair_audience_experimental_features',
	array(
		'collaborators' => true,
		'polls'         => true,
	)
);
update_option( 'fair_audience_db_version', '1.46.0' );

echo 'E2E_SEED:' . wp_json_encode(
	array(
		'participantId'  => (int) $participant->id,
		'email'          => $email,
		'relationshipId' => (int) $relationship_id,
	)
) . "\n";
