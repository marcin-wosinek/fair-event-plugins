<?php
/**
 * Seed a stuck "pending_payment" signup for the E2E cancel-and-restart specs.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-pending-signup.php <eventId> <eventDateId> <ticketTypeId> <price> [status]
 *
 * The Mollie double always reports "paid" on GET (see lib/mollie-http-double.php),
 * so a failed/canceled/expired transaction can't be produced by driving the real
 * checkout — it has to be written directly, the same way a stalled real-world
 * payment would leave the database. This creates:
 *   - a participant (linkable via a real ParticipantToken, so the page renders
 *     the 'with_token' authenticated state — the branch that shows the
 *     "Cancel and start over" link);
 *   - a fair_payment_transactions row in the given status (default 'failed',
 *     one of the statuses event-signup/render.php treats as retriable: failed,
 *     canceled, expired, draft);
 *   - an event_participants row with label 'pending_payment' and a
 *     payment_expires_at an hour out (within the hold window), plus a ledger
 *     row linking it to the transaction (#1113), so event-signup/render.php's
 *     "no URL callback? look up an in-progress payment" fallback (issue #554)
 *     synthesises the retry UI even when the spec navigates straight to the
 *     plain participant-token URL, exactly as a buyer returning to the page
 *     directly (not via Mollie's redirect) would.
 *
 * Prints a single `E2E_PENDING:{json}` line with the participant id,
 * transaction id, and participant token.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

use FairAudience\Database\EventParticipantTransactionRepository;
use FairAudience\Models\Participant;
use FairAudience\Models\EventParticipant;
use FairAudience\Services\ParticipantToken;
use FairPaymentsConnector\Models\Transaction;

$event_id       = isset( $args[0] ) ? (int) $args[0] : 0;
$event_date_id  = isset( $args[1] ) ? (int) $args[1] : 0;
$ticket_type_id = isset( $args[2] ) ? (int) $args[2] : 0;
$price          = isset( $args[3] ) ? (float) $args[3] : 0.0;
$tx_status      = isset( $args[4] ) && '' !== $args[4] ? (string) $args[4] : 'failed';

if ( ! $event_id || ! $event_date_id ) {
	WP_CLI::error( 'Usage: seed-pending-signup.php <eventId> <eventDateId> <ticketTypeId> <price> [status]' );
}

$stamp = gmdate( 'YmdHis' ) . '-' . wp_rand( 1000, 9999 );
$email = 'pending.' . $stamp . '@example.test';

$participant = new Participant(
	array(
		'name'          => 'E2E Pending Buyer ' . $stamp,
		'email'         => $email,
		'email_profile' => 'minimal',
		'status'        => 'confirmed',
	)
);
if ( ! $participant->save() ) {
	WP_CLI::error( 'Failed to create participant.' );
}

$transaction_id = Transaction::create(
	array(
		'mollie_payment_id' => 'tr_e2e_' . $stamp,
		'post_id'           => $event_id,
		'event_date_id'     => $event_date_id,
		'participant_id'    => $participant->id,
		'amount'            => $price,
		'status'            => $tx_status,
		'description'       => 'E2E pending signup',
	)
);
if ( ! $transaction_id ) {
	WP_CLI::error( 'Failed to create transaction.' );
}

$event_participant = new EventParticipant(
	array(
		'event_id'           => $event_id,
		'event_date_id'      => $event_date_id,
		'participant_id'     => $participant->id,
		'label'              => 'pending_payment',
		'ticket_type_id'     => $ticket_type_id ? $ticket_type_id : null,
		'payment_expires_at' => gmdate( 'Y-m-d H:i:s', strtotime( '+1 hour' ) ),
	)
);
if ( ! $event_participant->save() ) {
	WP_CLI::error( 'Failed to create event_participant row.' );
}

// The transaction↔registration link now lives solely in the ledger (#1113).
( new EventParticipantTransactionRepository() )->record( (int) $event_participant->id, (int) $transaction_id, 'charge' );

$token = ParticipantToken::generate( (int) $participant->id, $event_date_id );

echo 'E2E_PENDING:' . wp_json_encode(
	array(
		'participantId' => (int) $participant->id,
		'transactionId' => (int) $transaction_id,
		'token'         => $token,
		'email'         => $email,
	)
) . "\n";
