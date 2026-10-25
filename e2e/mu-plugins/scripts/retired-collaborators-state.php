<?php
/**
 * Report the data the Collaborators retirement must keep or must not create.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/retired-collaborators-state.php <participantId> <email>
 *
 * `participantId` is a seeded collaborator; `email` is the address a
 * submission to the retired registration form used.
 *
 * Prints a single `E2E_STATE:{json}` line.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

global $wpdb;

$participant_id = isset( $args[0] ) ? (int) $args[0] : 0;
$email          = isset( $args[1] ) ? (string) $args[1] : '';

// phpcs:disable WordPress.DB.DirectDatabaseQuery
$submitted_ids = $wpdb->get_col(
	$wpdb->prepare( 'SELECT id FROM %i WHERE email = %s', $wpdb->prefix . 'fair_audience_participants', $email )
);
$tokens        = 0;
foreach ( $submitted_ids as $submitted_id ) {
	$tokens += (int) $wpdb->get_var(
		$wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE participant_id = %d', $wpdb->prefix . 'fair_audience_email_confirmation_tokens', $submitted_id )
	);
}

$mail_to_email = 0;
foreach ( (array) get_option( 'fair_e2e_captured_mail', array() ) as $mail ) {
	if ( false !== strpos( wp_json_encode( $mail['to'] ?? '' ), $email ) ) {
		++$mail_to_email;
	}
}

echo 'E2E_STATE:' . wp_json_encode(
	array(
		'participantExists'  => (bool) $wpdb->get_var(
			$wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE id = %d', $wpdb->prefix . 'fair_audience_participants', $participant_id )
		),
		'collaboratorLabels' => (int) $wpdb->get_var(
			$wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE participant_id = %d AND label = %s', $wpdb->prefix . 'fair_audience_event_participants', $participant_id, 'collaborator' )
		),
		'submittedPeople'    => count( $submitted_ids ),
		'submittedTokens'    => $tokens,
		'mailToSubmitted'    => $mail_to_email,
		'audienceDbVersion'  => get_option( 'fair_audience_db_version' ),
		'audienceFeatures'   => get_option( 'fair_audience_experimental_features' ),
	)
) . "\n";
// phpcs:enable
