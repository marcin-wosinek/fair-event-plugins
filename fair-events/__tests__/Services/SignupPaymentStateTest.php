<?php
/**
 * SignupPaymentState resolution tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairEvents\Services\SignupPaymentState;

/**
 * Validates the pure state-selection math used by resolve_state(), and
 * resolve_for_transaction()'s card payload assembly with sync disabled (no
 * database / payment-provider round trip).
 */
class SignupPaymentStateTest extends TestCase {

	/**
	 * A paid transaction always resolves to confirmed, checkout_url or not.
	 */
	public function test_paid_resolves_confirmed() {
		$this->assertSame( SignupPaymentState::CONFIRMED, SignupPaymentState::resolve_state( 'paid', '' ) );
		$this->assertSame( SignupPaymentState::CONFIRMED, SignupPaymentState::resolve_state( 'paid', 'https://example.test/checkout' ) );
	}

	/**
	 * A live Mollie 'pending' status is a real payment attempt in flight.
	 */
	public function test_pending_resolves_processing() {
		$this->assertSame( SignupPaymentState::PROCESSING, SignupPaymentState::resolve_state( 'pending', '' ) );
		$this->assertSame( SignupPaymentState::PROCESSING, SignupPaymentState::resolve_state( 'pending', 'https://example.test/checkout' ) );
	}

	/**
	 * 'open' (Mollie: created but never finished) resumes when a checkout
	 * link is still on file.
	 */
	public function test_open_with_checkout_url_resolves_resume() {
		$this->assertSame( SignupPaymentState::RESUME, SignupPaymentState::resolve_state( 'open', 'https://example.test/checkout' ) );
	}

	/**
	 * 'pending_payment' (checkout link created, provider not yet consulted)
	 * resumes the same way — the render/route layer always syncs before
	 * reading, so this is the fallback when sync could not run.
	 */
	public function test_pending_payment_with_checkout_url_resolves_resume() {
		$this->assertSame( SignupPaymentState::RESUME, SignupPaymentState::resolve_state( 'pending_payment', 'https://example.test/checkout' ) );
	}

	/**
	 * Terminal failure states retry regardless of a stale checkout_url.
	 */
	public function test_terminal_states_resolve_retry() {
		foreach ( array( 'failed', 'canceled', 'expired' ) as $status ) {
			$this->assertSame( SignupPaymentState::RETRY, SignupPaymentState::resolve_state( $status, '' ) );
			$this->assertSame( SignupPaymentState::RETRY, SignupPaymentState::resolve_state( $status, 'https://example.test/checkout' ) );
		}
	}

	/**
	 * 'draft' (never initiated) has no checkout link — retry, not resume.
	 */
	public function test_draft_without_checkout_url_resolves_retry() {
		$this->assertSame( SignupPaymentState::RETRY, SignupPaymentState::resolve_state( 'draft', '' ) );
	}

	/**
	 * Resolve_for_transaction(), with sync disabled, builds the card payload
	 * straight from the given transaction/signup rows, no DB/provider calls.
	 *
	 * Event_date_id is left at 0 (no signup rows) so this stays a pure test:
	 * a non-zero event_date_id would make resolve_event_title() reach for
	 * FairEvents\Models\EventDates, which needs a live $wpdb.
	 */
	public function test_resolve_for_transaction_builds_card_payload_without_sync() {
		$transaction = (object) array(
			'id'                => 42,
			'status'            => 'failed',
			'amount'            => 15.5,
			'currency'          => 'EUR',
			'checkout_url'      => '',
			'mollie_payment_id' => 'tr_test',
		);

		$result = SignupPaymentState::resolve_for_transaction( $transaction, array(), false );

		$this->assertSame( SignupPaymentState::RETRY, $result['state'] );
		$this->assertSame( 42, $result['transaction_id'] );
		$this->assertSame( 15.5, $result['amount'] );
		$this->assertSame( 'EUR', $result['currency'] );
		$this->assertSame( '', $result['checkout_url'] );
		$this->assertSame( 0, $result['event_date_id'] );
	}

	/**
	 * The checkout_url is only surfaced on the resume state — a retry card
	 * must never link to a stale checkout page.
	 */
	public function test_checkout_url_is_blanked_outside_resume_state() {
		$transaction = (object) array(
			'id'           => 1,
			'status'       => 'paid',
			'amount'       => 10,
			'currency'     => 'EUR',
			'checkout_url' => 'https://example.test/stale-checkout',
		);

		$result = SignupPaymentState::resolve_for_transaction( $transaction, array(), false );

		$this->assertSame( SignupPaymentState::CONFIRMED, $result['state'] );
		$this->assertSame( '', $result['checkout_url'] );
	}

	/**
	 * With no signup rows at all (shouldn't normally happen, but defensive),
	 * event_date_id/event_title fall back to empty rather than erroring.
	 */
	public function test_resolve_for_transaction_with_no_signup_rows() {
		$transaction = (object) array(
			'id'           => 1,
			'status'       => 'open',
			'amount'       => 10,
			'currency'     => 'EUR',
			'checkout_url' => 'https://example.test/checkout',
		);

		$result = SignupPaymentState::resolve_for_transaction( $transaction, array(), false );

		$this->assertSame( SignupPaymentState::RESUME, $result['state'] );
		$this->assertSame( 0, $result['event_date_id'] );
		$this->assertSame( '', $result['event_title'] );
	}
}
