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
			'event_name' => 'Purchase',
			'event_time' => 123,
			'event_id'   => 'stable',
			'source_url' => 'https://example.test/event',
			'fbp'        => 'fb.1.1712345678901.browser',
			'fbc'        => '',
			'value'      => '12.50',
			'currency'   => 'EUR',
			'order_id'   => '77',
		);
		$payload = Conversions::payload_for( $row );
		$this->assertSame( array( 'fbp' => $row->fbp ), $payload['user_data'] );
		$this->assertSame( '77', $payload['custom_data']['order_id'] );
		$this->assertArrayNotHasKey( 'email', $payload['user_data'] );
		$this->assertArrayNotHasKey( 'client_ip_address', $payload['user_data'] );
	}
}
