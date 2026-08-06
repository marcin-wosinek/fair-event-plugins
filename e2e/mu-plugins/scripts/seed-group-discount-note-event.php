<?php
/**
 * Seed an event with a single ticket type, plus a fair-audience Participant
 * who is a member of a group carrying a discount rule against that tier —
 * for the group-discount-note E2E spec (#1297).
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-group-discount-note-event.php <json-args>
 *
 * The event renders fair-audience's own event-signup block (event-factory's
 * default) — the one variant that resolves the viewer synchronously via a
 * `?participant_token=` URL, so the seeded participant's personalized note
 * and price are present in the very first server-rendered page, no cookie or
 * login choreography needed.
 *
 * Args (JSON object):
 *   price          Ticket type base price. Default 20.00.
 *   discountType   'percentage' | 'amount', or omitted for no rule at all
 *                  (the "genuinely undiscounted" case).
 *   discountValue  Discount magnitude. Required when discountType is set.
 *
 * Prints a single `E2E_SEED:{json}` line with the participant-token page URL
 * and every id `cleanup-group-discount-note-event.php` needs to tear down.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/../lib/event-factory.php';

$overrides = array();
if ( isset( $args[0] ) && '' !== $args[0] ) {
	$decoded = json_decode( (string) $args[0], true );
	if ( ! is_array( $decoded ) ) {
		WP_CLI::error( 'Argument must be a JSON object, got: ' . $args[0] );
	}
	$overrides = $decoded;
}

$price          = isset( $overrides['price'] ) ? (float) $overrides['price'] : 20.00;
$discount_type  = isset( $overrides['discountType'] ) ? (string) $overrides['discountType'] : null;
$discount_value = isset( $overrides['discountValue'] ) ? (float) $overrides['discountValue'] : null;

$event_id       = fair_e2e_create_event( 'E2E Group Discount Note Event ' . gmdate( 'YmdHis' ) . ' ' . wp_rand( 1000, 9999 ) );
$event_date_id  = fair_e2e_add_date( $event_id );
$sale_period_id = fair_e2e_add_sale_period( $event_date_id );
$ticket_type_id = fair_e2e_add_ticket_type( $event_date_id, 'General Admission', null );
fair_e2e_add_price( $ticket_type_id, $sale_period_id, $price, null );

$participant = new \FairAudience\Models\Participant(
	array(
		'name'  => 'Discount Note Tester',
		'email' => 'discount-note-' . gmdate( 'YmdHis' ) . '-' . wp_rand( 1000, 9999 ) . '@example.test',
	)
);
$participant->save();

$group_id = 0;
$rule_id  = 0;
if ( null !== $discount_type ) {
	$group = new \FairAudienceExperimental\Models\Group(
		array( 'name' => 'E2E Discount Note Group ' . gmdate( 'YmdHis' ) . ' ' . wp_rand( 1000, 9999 ) )
	);
	$group->save();
	$group_id = (int) $group->id;

	( new \FairAudienceExperimental\Database\GroupParticipantRepository() )
		->add_participant_to_group( $group_id, (int) $participant->id );

	$rule_id = \FairEventsExperimental\Models\GroupPricingRule::create(
		$event_date_id,
		$group_id,
		$discount_type,
		$discount_value
	);
}

$token    = \FairAudience\Services\ParticipantToken::generate( (int) $participant->id, (int) $event_date_id );
$page_url = add_query_arg( 'participant_token', $token, get_permalink( $event_id ) );

echo 'E2E_SEED:' . wp_json_encode(
	array(
		'pageUrl'       => $page_url,
		'eventId'       => (int) $event_id,
		'eventDateId'   => (int) $event_date_id,
		'ticketTypeId'  => (int) $ticket_type_id,
		'participantId' => (int) $participant->id,
		'groupId'       => $group_id,
		'ruleId'        => $rule_id,
		'price'         => $price,
	)
) . "\n";
