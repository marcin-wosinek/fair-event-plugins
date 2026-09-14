<?php
/**
 * Seed data for the Signups tab export e2e test (#1568).
 *
 * Creates a published free event whose Event Signup block nests a
 * "Dietary needs?" custom question, plus one ticket type/price/sale period.
 * The event page is visited with fair-audience deactivated (the List tab —
 * home of the Export popup — is only visible when fair-audience is inactive,
 * see fair-events/src/Admin/manage-event/ManageEventApp.js's `audienceUrl`
 * gate; the calling spec handles activation/deactivation around the whole
 * suite).
 *
 * Also seeds a second signup directly, with a participant_id and a matching
 * signup-origin Fair Form submission/answer (form_id empty) — reachable
 * through GetTicketsController::attach_signup_answers() purely via the
 * stored participant_id column, independent of whether fair-audience is
 * currently active. This is the only way to exercise the "answer present"
 * branch here: fair-audience is what normally populates participant_id on a
 * live signup, but fair-audience active would hide the tab this feature
 * lives on. A real signup submitted through the page below (fair-audience
 * inactive) always gets participant_id NULL, covering the complementary
 * "answer missing, row kept" branch instead.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-signup-export-answers.php
 *
 * Prints a single `E2E_EXPORT_ANSWERS_SEED:{json}` line the spec parses.
 *
 * @package FairEventsE2E
 */

use FairEvents\Models\EventDates;
use FairEvents\Models\TicketSalePeriod;
use FairEvents\Models\TicketType;
use FairEvents\Models\TicketPrice;
use FairEvents\Models\EventSignup;
use FairForm\Services\QuestionnaireService;

$stamp = gmdate( 'YmdHis' ) . '-' . wp_rand( 1000, 9999 );

$content = implode(
	"\n",
	array(
		'<!-- wp:fair-events/event-signup -->',
		'<!-- wp:fair-audience/fair-form-short-text {"questionKey":"diet","questionText":"Dietary needs?"} /-->',
		'<!-- /wp:fair-events/event-signup -->',
	)
);

$event_id = wp_insert_post(
	array(
		'post_type'    => 'fair_event',
		'post_status'  => 'publish',
		'post_title'   => 'E2E Signup Export Answers ' . $stamp,
		'post_content' => $content,
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

$sale_period_id = TicketSalePeriod::create(
	$event_date_id,
	'Standard',
	gmdate( 'Y-m-d H:i:s', strtotime( '-1 day' ) ),
	gmdate( 'Y-m-d H:i:s', strtotime( '+30 days' ) ),
	0
);

if ( ! $sale_period_id ) {
	WP_CLI::error( 'Failed to create sale period.' );
}

$ticket_type_id = TicketType::create( $event_date_id, 'General Admission', null, 0 );

if ( ! $ticket_type_id ) {
	WP_CLI::error( 'Failed to create ticket type.' );
}

if ( ! TicketPrice::create( $ticket_type_id, $sale_period_id, 0.0, null ) ) {
	WP_CLI::error( 'Failed to create ticket price.' );
}

// Directly-seeded, participant-linked signup + Fair Form submission/answer —
// see the docblock above for why this can't be produced through the live
// page while fair-audience stays inactive.
$participant_id   = wp_rand( 900000000, 999999999 );
$linked_email     = 'signup-export-linked-' . $stamp . '@example.test';
$linked_signup_id = EventSignup::save(
	array(
		'event_date_id'  => $event_date_id,
		'ticket_type_id' => $ticket_type_id,
		'name'           => 'Linked Answer Tester',
		'email'          => $linked_email,
		'quantity'       => 1,
		'amount'         => 0.0,
		'status'         => 'confirmed',
		'participant_id' => $participant_id,
	)
);

if ( ! $linked_signup_id ) {
	WP_CLI::error( 'Failed to create linked signup.' );
}

$questionnaire_service = new QuestionnaireService();
$submission_id         = $questionnaire_service->save_answers(
	$participant_id,
	array(
		array(
			'question_key'  => 'diet',
			'question_text' => 'Dietary needs?',
			'question_type' => 'short_text',
			'answer_value'  => 'Vegan (seeded)',
			'display_order' => 0,
		),
	),
	$event_date_id,
	0,
	'Event Signup',
	false
);

if ( ! $submission_id ) {
	WP_CLI::error( 'Failed to create linked submission.' );
}

echo 'E2E_EXPORT_ANSWERS_SEED:' . wp_json_encode(
	array(
		'pageUrl'        => get_permalink( $event_id ),
		'eventId'        => (int) $event_id,
		'eventDateId'    => (int) $event_date_id,
		'ticketTypeId'   => (int) $ticket_type_id,
		'linkedSignupId' => (int) $linked_signup_id,
		'linkedEmail'    => $linked_email,
		'submissionId'   => (int) $submission_id,
	)
) . "\n";
