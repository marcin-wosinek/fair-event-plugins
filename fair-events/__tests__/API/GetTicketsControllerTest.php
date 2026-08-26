<?php
/**
 * Get tickets controller retry tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\API;

use FairEvents\API\GetTicketsController;
use PHPUnit\Framework\TestCase;
use ReflectionMethod;

/**
 * Regression coverage for persisted signup email recovery.
 */
class GetTicketsControllerTest extends TestCase {
	/**
	 * Resolve a retry email through the controller's validation boundary.
	 *
	 * @param string[] $emails Signup email values.
	 * @return string|\WP_Error
	 */
	private function resolve_email( $emails ) {
		$method = new ReflectionMethod( GetTicketsController::class, 'resolve_retry_buyer_email' );
		if ( PHP_VERSION_ID < 80100 ) {
			$method->setAccessible( true );
		}
		$rows = array_map(
			static function ( $email ) {
				return (object) array( 'email' => $email );
			},
			$emails
		);
		return $method->invoke( new GetTicketsController(), $rows );
	}

	/**
	 * A single consistent valid email is accepted for single and multi rows.
	 */
	public function test_accepts_one_valid_email_across_all_signup_rows() {
		$this->assertSame( 'buyer@example.test', $this->resolve_email( array( 'buyer@example.test' ) ) );
		$this->assertSame(
			'buyer@example.test',
			$this->resolve_email( array( 'buyer@example.test', 'buyer@example.test' ) )
		);
	}

	/**
	 * Missing, invalid, sanitized-different, and inconsistent emails fail safe.
	 *
	 * @dataProvider invalid_email_sets
	 * @param string[] $emails Invalid signup email values.
	 */
	public function test_rejects_unreliable_retry_email_context( $emails ) {
		$result = $this->resolve_email( $emails );

		$this->assertTrue( is_wp_error( $result ) );
		$this->assertSame( 'invalid_retry_state', $result->get_error_code() );
		$this->assertSame( 409, $result->get_error_data()['status'] );
	}

	/**
	 * Invalid retry email scenarios.
	 *
	 * @return array[]
	 */
	public static function invalid_email_sets() {
		return array(
			'missing'       => array( array( '' ) ),
			'invalid'       => array( array( 'not-an-email' ) ),
			'needs cleanup' => array( array( ' buyer@example.test ' ) ),
			'inconsistent'  => array( array( 'one@example.test', 'two@example.test' ) ),
		);
	}
}
