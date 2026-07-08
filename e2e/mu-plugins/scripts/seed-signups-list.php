<?php
/**
 * Seed data for the signups-list e2e test (issue #888).
 *
 * Creates a published fair_event with the signups-list block, an event date,
 * several signed-up participants, a group, a GroupPermissionRule granting
 * view_signups, and returns a participant_token for a group member and for a
 * non-member so both positive and negative assertions can run.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-signups-list.php
 *
 * Prints a single `E2E_SIGNUPS_SEED:{json}` line the spec parses.
 *
 * @package FairEventsE2E
 */

use FairEvents\Models\EventDates;
use FairEventsExperimental\Models\GroupPermissionRule;
use FairAudienceExperimental\Models\Group;
use FairAudience\Models\Participant;
use FairAudience\Database\EventParticipantRepository;
use FairAudienceExperimental\Database\GroupParticipantRepository;
use FairAudience\Services\ParticipantToken;

$event_id = wp_insert_post(
	array(
		'post_type'    => 'fair_event',
		'post_status'  => 'publish',
		'post_title'   => 'E2E Signups List ' . gmdate( 'YmdHis' ),
		'post_content' => '<!-- wp:fair-audience/signups-list /-->',
	),
	true
);

if ( is_wp_error( $event_id ) ) {
	WP_CLI::error( 'Failed to create event: ' . $event_id->get_error_message() );
}

$event_date_id = EventDates::save_occurrence(
	$event_id,
	gmdate( 'Y-m-d H:i:s', strtotime( '+7 days' ) ),
	gmdate( 'Y-m-d H:i:s', strtotime( '+7 days +2 hours' ) ),
	false,
	'single'
);

if ( ! $event_date_id ) {
	WP_CLI::error( 'Failed to create event date.' );
}

$event_participant_repo = new EventParticipantRepository();
$group_participant_repo = new GroupParticipantRepository();

// Seed two participants that are signed up on this event date.
$member_participant = new Participant(
	array(
		'name'    => 'Alice',
		'surname' => 'Member',
		'email'   => 'alice.member.' . gmdate( 'YmdHis' ) . '@example.com',
	)
);
if ( ! $member_participant->save() ) {
	WP_CLI::error( 'Failed to create member participant.' );
}

$other_participant = new Participant(
	array(
		'name'    => 'Bob',
		'surname' => 'Other',
		'email'   => 'bob.other.' . gmdate( 'YmdHis' ) . '@example.com',
	)
);
if ( ! $other_participant->save() ) {
	WP_CLI::error( 'Failed to create other participant.' );
}

// Register both as signed_up on the event date.
foreach ( array( $member_participant->id, $other_participant->id ) as $pid ) {
	$event_participant_repo->add_participant_to_event( $event_id, $pid, 'signed_up', $event_date_id );
}

// Create a group, add only the member participant.
$group = new Group( array( 'name' => 'E2E View Group ' . gmdate( 'YmdHis' ) ) );
if ( ! $group->save() ) {
	WP_CLI::error( 'Failed to create group.' );
}

$group_participant_repo->add_participant_to_group( $group->id, $member_participant->id );

// Grant view_signups for this event date.
$rule_id = GroupPermissionRule::create( $event_date_id, $group->id, 'view_signups' );
if ( ! $rule_id ) {
	WP_CLI::error( 'Failed to create group permission rule.' );
}

$member_token = ParticipantToken::generate( $member_participant->id, $event_date_id );
$other_token  = ParticipantToken::generate( $other_participant->id, $event_date_id );

echo 'E2E_SIGNUPS_SEED:' . wp_json_encode(
	array(
		'pageUrl'             => get_permalink( $event_id ),
		'eventId'             => (int) $event_id,
		'eventDateId'         => (int) $event_date_id,
		'groupId'             => (int) $group->id,
		'ruleId'              => (int) $rule_id,
		'memberParticipantId' => (int) $member_participant->id,
		'otherParticipantId'  => (int) $other_participant->id,
		'memberToken'         => $member_token,
		'otherToken'          => $other_token,
	)
) . "\n";
