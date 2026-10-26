<?php
/**
 * Transaction API provider metadata tests.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\API;

use FairPaymentsConnector\API\TransactionAPI;
use FairPaymentsConnector\Settings\Settings;
use PHPUnit\Framework\TestCase;
use ReflectionMethod;

/**
 * Regression coverage for Mollie payment metadata assembly.
 */
class TransactionAPITest extends TestCase {
	/**
	 * Start every test with the disclosure setting unset.
	 */
	protected function setUp(): void {
		unset( $GLOBALS['_fair_test_options'][ Settings::SHARE_TICKET_BUYER_EMAIL ] );
	}

	/**
	 * Leave no option behind for other tests.
	 */
	protected function tearDown(): void {
		unset( $GLOBALS['_fair_test_options'][ Settings::SHARE_TICKET_BUYER_EMAIL ] );
	}

	/**
	 * Store the disclosure setting the way WordPress does.
	 *
	 * @param bool $share Whether buyer emails may be sent.
	 */
	private function set_share_email( $share ) {
		$GLOBALS['_fair_test_options'][ Settings::SHARE_TICKET_BUYER_EMAIL ] = $share ? '1' : '';
	}

	/**
	 * A Fair Events ticket transaction as GetTicketsController stores it.
	 *
	 * @param array $extra Extra metadata.
	 * @return object
	 */
	private function ticket_transaction( $extra = array() ) {
		return (object) array(
			'metadata'       => wp_json_encode(
				array_merge(
					array(
						'source'        => 'fair-events-get-tickets',
						'event_date_id' => 45,
						'signup_id'     => 67,
						'email'         => 'buyer@example.test',
					),
					$extra
				)
			),
			'participant_id' => 81,
		);
	}
	/**
	 * Invoke the private metadata boundary without a WordPress database.
	 *
	 * @param object $transaction Transaction record.
	 * @param int    $id          Transaction ID.
	 * @return array
	 */
	private function metadata( $transaction, $id ) {
		$method = new ReflectionMethod( TransactionAPI::class, 'prepare_payment_metadata' );
		return $method->invoke( null, $transaction, $id );
	}

	/**
	 * Existing references survive while local identity keys are omitted.
	 */
	public function test_omits_unresolved_identity_keys_and_preserves_references() {
		$this->set_share_email( true );
		$metadata = $this->metadata(
			(object) array(
				'metadata'       => wp_json_encode(
					array(
						'source'         => 'fair-events-get-tickets',
						'event_date_id'  => 45,
						'signup_id'      => 67,
						'email'          => 'buyer@example.test',
						'user_id'        => 9,
						'participant_id' => null,
					)
				),
				'participant_id' => null,
			),
			123
		);

		$this->assertSame( 'buyer@example.test', $metadata['email'] );
		$this->assertSame( 45, $metadata['event_date_id'] );
		$this->assertSame( 67, $metadata['signup_id'] );
		$this->assertSame( 123, $metadata['transaction_id'] );
		$this->assertArrayNotHasKey( 'user_id', $metadata );
		$this->assertArrayNotHasKey( 'participant_id', $metadata );
	}

	/**
	 * A resolved positive participant reference is sent to Mollie.
	 */
	public function test_includes_only_the_resolved_positive_participant_id() {
		$metadata = $this->metadata(
			(object) array(
				'metadata'       => wp_json_encode( array( 'participant_id' => 3 ) ),
				'participant_id' => 81,
			),
			124
		);

		$this->assertSame( 81, $metadata['participant_id'] );
		$this->assertSame( 124, $metadata['transaction_id'] );
	}

	/**
	 * With disclosure enabled, a ticket payment sends the buyer email.
	 */
	public function test_ticket_payment_sends_email_when_disclosure_is_enabled() {
		$this->set_share_email( true );

		$metadata = $this->metadata( $this->ticket_transaction(), 125 );

		$this->assertSame( 'buyer@example.test', $metadata['email'] );
	}

	/**
	 * With disclosure disabled, a ticket payment omits the buyer email but
	 * keeps every reconciliation reference.
	 */
	public function test_ticket_payment_omits_email_when_disclosure_is_disabled() {
		$this->set_share_email( false );

		$metadata = $this->metadata( $this->ticket_transaction(), 126 );

		$this->assertArrayNotHasKey( 'email', $metadata );
		$this->assertSame( 'fair-events-get-tickets', $metadata['source'] );
		$this->assertSame( 45, $metadata['event_date_id'] );
		$this->assertSame( 67, $metadata['signup_id'] );
		$this->assertSame( 126, $metadata['transaction_id'] );
		$this->assertSame( 81, $metadata['participant_id'] );
	}

	/**
	 * A site that never chose omits the email: the default is off.
	 */
	public function test_ticket_payment_omits_email_when_setting_is_unset() {
		$metadata = $this->metadata( $this->ticket_transaction(), 127 );

		$this->assertArrayNotHasKey( 'email', $metadata );
	}

	/**
	 * A retry carries its references, and follows the setting in force when
	 * it is initiated.
	 */
	public function test_retry_payment_follows_the_current_setting() {
		$retry = $this->ticket_transaction(
			array(
				'signup_ids'              => array( 67, 68 ),
				'retry_of_transaction_id' => 120,
			)
		);

		$this->set_share_email( true );
		$this->assertSame( 'buyer@example.test', $this->metadata( $retry, 128 )['email'] );

		$this->set_share_email( false );
		$metadata = $this->metadata( $retry, 128 );
		$this->assertArrayNotHasKey( 'email', $metadata );
		$this->assertSame( array( 67, 68 ), $metadata['signup_ids'] );
		$this->assertSame( 120, $metadata['retry_of_transaction_id'] );
	}

	/**
	 * An older local transaction initiated after the setting changed follows
	 * the new setting; its local metadata keeps the email.
	 */
	public function test_older_transaction_follows_the_setting_and_keeps_local_email() {
		$transaction = $this->ticket_transaction();
		$this->set_share_email( false );

		$metadata = $this->metadata( $transaction, 129 );

		$this->assertArrayNotHasKey( 'email', $metadata );
		$this->assertSame( 'buyer@example.test', json_decode( $transaction->metadata, true )['email'] );
	}

	/**
	 * Other payment sources are not governed by the ticket setting.
	 */
	public function test_non_ticket_sources_are_unchanged() {
		$this->set_share_email( false );

		$metadata = $this->metadata(
			(object) array(
				'metadata'       => wp_json_encode(
					array(
						'source' => 'fair-audience-signup',
						'email'  => 'member@example.test',
					)
				),
				'participant_id' => null,
			),
			130
		);

		$this->assertSame( 'member@example.test', $metadata['email'] );
		$this->assertSame( 'fair-audience-signup', $metadata['source'] );
	}
}
