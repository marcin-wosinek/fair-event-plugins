<?php
/**
 * Transaction API provider metadata tests.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\API;

use FairPaymentsConnector\API\TransactionAPI;
use PHPUnit\Framework\TestCase;
use ReflectionMethod;

/**
 * Regression coverage for Mollie payment metadata assembly.
 */
class TransactionAPITest extends TestCase {
	/**
	 * Invoke the private metadata boundary without a WordPress database.
	 *
	 * @param object $transaction Transaction record.
	 * @param int    $id          Transaction ID.
	 * @return array
	 */
	private function metadata( $transaction, $id ) {
		$method = new ReflectionMethod( TransactionAPI::class, 'prepare_payment_metadata' );
		if ( PHP_VERSION_ID < 80100 ) {
			$method->setAccessible( true );
		}
		return $method->invoke( null, $transaction, $id );
	}

	/**
	 * Existing references survive while local identity keys are omitted.
	 */
	public function test_omits_unresolved_identity_keys_and_preserves_references() {
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
}
