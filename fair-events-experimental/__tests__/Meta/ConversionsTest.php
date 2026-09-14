<?php
/**
 * Meta conversion payload tests.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\Meta;

use FairEventsExperimental\Meta\Conversions;
use PHPUnit\Framework\TestCase;

/** Covers privacy-sensitive pure conversion transformations. */
class ConversionsTest extends TestCase {
	/** Identifier validation fails closed. */
	public function test_identifier_validation() {
		$this->assertTrue( Conversions::valid_identifier( 'fb.1.1712345678901.click_ABC-2' ) );
		$this->assertFalse( Conversions::valid_identifier( 'not-a-meta-id' ) );
	}

	/** Logical lifecycle events get stable, distinct IDs. */
	public function test_event_ids_are_deterministic_and_distinct() {
		$this->assertSame( Conversions::event_id( 42, 'Purchase' ), Conversions::event_id( 42, 'Purchase' ) );
		$this->assertNotSame( Conversions::event_id( 42, 'Purchase' ), Conversions::event_id( 42, 'InitiateCheckout' ) );
	}

	/** Payload contains only the approved matching and commerce fields. */
	public function test_payload_omits_unapproved_customer_data() {
		$row     = (object) array(
			'event_name'   => 'Purchase',
			'event_time'   => 123,
			'event_id'     => 'stable',
			'source_url'   => 'https://example.test/event',
			'fbp'          => 'fb.1.1712345678901.browser',
			'fbc'          => '',
			'value'        => '12.50',
			'currency'     => 'EUR',
			'order_id'     => '77',
			'payment_mode' => 'live',
		);
		$payload = Conversions::payload_for( $row );
		$this->assertSame( array( 'fbp' => $row->fbp ), $payload['user_data'] );
		$this->assertSame( '77', $payload['custom_data']['order_id'] );
		$this->assertArrayNotHasKey( 'email', $payload['user_data'] );
		$this->assertArrayNotHasKey( 'client_ip_address', $payload['user_data'] );
	}

	/** The delivered custom_data always names which payment mode produced the sale. */
	public function test_payload_includes_payment_mode() {
		$row     = (object) array(
			'event_name'   => 'Purchase',
			'event_time'   => 123,
			'event_id'     => 'stable',
			'source_url'   => '',
			'fbp'          => 'fb.1.1712345678901.browser',
			'fbc'          => '',
			'value'        => '12.50',
			'currency'     => 'EUR',
			'order_id'     => '77',
			'payment_mode' => 'test',
		);
		$payload = Conversions::payload_for( $row );
		$this->assertSame( 'test', $payload['custom_data']['payment_mode'] );
	}

	/**
	 * Build a transaction fixture that passes every eligibility check.
	 *
	 * @param array $overrides Fields to override on the base fixture.
	 * @return object
	 */
	private function eligible_transaction( array $overrides = array() ) {
		$defaults = array(
			'id'                   => 42,
			'amount'               => '12.50',
			'currency'             => 'eur',
			'testmode'             => 1,
			'status'               => 'paid',
			'updated_at'           => '2026-01-01 10:00:00',
			'payment_initiated_at' => '2026-01-01 09:59:00',
			'metadata'             => wp_json_encode(
				array(
					'source'          => 'fair-events-get-tickets',
					'meta_consent'    => true,
					'meta_fbp'        => 'fb.1.1712345678901.click_ABC-2',
					'meta_fbc'        => '',
					'meta_source_url' => 'https://example.test/event',
				)
			),
		);
		return (object) array_merge( $defaults, $overrides );
	}

	/** A payment-mode-eligible transaction stays eligible in both modes and carries its own mode. */
	public function test_build_event_reports_both_payment_modes() {
		$test_event = Conversions::build_event( $this->eligible_transaction( array( 'testmode' => 1 ) ), 'Purchase' );
		$live_event = Conversions::build_event( $this->eligible_transaction( array( 'testmode' => 0 ) ), 'Purchase' );
		$this->assertIsArray( $test_event );
		$this->assertIsArray( $live_event );
		$this->assertSame( 'test', $test_event['payment_mode'] );
		$this->assertSame( 'live', $live_event['payment_mode'] );
	}

	/** Without current marketing consent, no event is built regardless of payment mode. */
	public function test_build_event_rejects_missing_consent() {
		$transaction = $this->eligible_transaction(
			array(
				'metadata' => wp_json_encode(
					array(
						'source'   => 'fair-events-get-tickets',
						'meta_fbp' => 'fb.1.1712345678901.click_ABC-2',
					)
				),
			)
		);
		$this->assertNull( Conversions::build_event( $transaction, 'Purchase' ) );
	}

	/** Without a valid Meta browser identifier, no event is built. */
	public function test_build_event_rejects_missing_browser_identifier() {
		$transaction = $this->eligible_transaction(
			array(
				'metadata' => wp_json_encode(
					array(
						'source'       => 'fair-events-get-tickets',
						'meta_consent' => true,
						'meta_fbp'     => 'not-a-meta-id',
						'meta_fbc'     => '',
					)
				),
			)
		);
		$this->assertNull( Conversions::build_event( $transaction, 'Purchase' ) );
	}

	/** Only the unified checkout's transactions are eligible. */
	public function test_build_event_rejects_other_sources() {
		$transaction = $this->eligible_transaction( array( 'metadata' => wp_json_encode( array( 'source' => 'some-other-plugin' ) ) ) );
		$this->assertNull( Conversions::build_event( $transaction, 'Purchase' ) );
	}

	/** The payment-mode helper reads the transaction's raw testmode flag. */
	public function test_payment_mode_helper_reads_the_transaction_flag() {
		$this->assertSame( 'live', Conversions::payment_mode( (object) array( 'testmode' => 0 ) ) );
		$this->assertSame( 'test', Conversions::payment_mode( (object) array( 'testmode' => 1 ) ) );
	}
}
