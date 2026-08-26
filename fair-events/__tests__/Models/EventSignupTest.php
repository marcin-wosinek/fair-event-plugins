<?php
/**
 * EventSignup expiry tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Models;

use FairEvents\Models\EventSignup;
use FairEvents\Hooks\PaymentHooks;
use PHPUnit\Framework\TestCase;

/**
 * Verifies paid signup holds use UTC at the database boundary.
 */
class EventSignupTest extends TestCase {

	/**
	 * Install a fresh database double.
	 */
	protected function setUp(): void {
		parent::setUp();
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- test-only fake.
		$GLOBALS['wpdb'] = new \Fair_Test_WPDB();
	}

	/**
	 * UTC expiry writes are invariant across representative site timezones.
	 *
	 * @dataProvider timezone_provider
	 *
	 * @param string $timezone Timezone under test.
	 */
	public function test_transaction_expiry_is_written_as_utc( string $timezone ): void {
		$GLOBALS['_fair_test_timezone'] = $timezone;
		$before                         = time() + 15 * MINUTE_IN_SECONDS;

		EventSignup::update_transaction( 10, 20 );

		$after      = time() + 15 * MINUTE_IN_SECONDS;
		$expires_at = $GLOBALS['wpdb']->last_update['data']['payment_expires_at'];
		$timestamp  = strtotime( $expires_at . ' UTC' );

		$this->assertGreaterThanOrEqual( $before, $timestamp );
		$this->assertLessThanOrEqual( $after, $timestamp );
	}

	/**
	 * Cleanup retains rows and expires them once at/after the UTC boundary.
	 */
	public function test_cleanup_uses_utc_and_includes_exact_expiry_boundary(): void {
		$now   = gmdate( 'Y-m-d H:i:s' );
		$table = 'wp_fair_events_signups';
		$GLOBALS['wpdb']->seed_row(
			$table,
			1,
			(object) array(
				'status'             => 'pending_payment',
				'payment_expires_at' => gmdate( 'Y-m-d H:i:s', time() + 1 ),
			)
		);
		$GLOBALS['wpdb']->seed_row(
			$table,
			2,
			(object) array(
				'status'             => 'pending_payment',
				'payment_expires_at' => $now,
			)
		);
		$GLOBALS['wpdb']->seed_row(
			$table,
			3,
			(object) array(
				'status'             => 'pending_payment',
				'payment_expires_at' => gmdate( 'Y-m-d H:i:s', time() - 1 ),
			)
		);

		$this->assertSame( 2, EventSignup::expire_pending() );
		$this->assertStringContainsString( 'payment_expires_at <= %s', $GLOBALS['wpdb']->last_prepared['query'] );
		$this->assertSame( gmdate( 'Y-m-d H:i:s' ), $GLOBALS['wpdb']->last_prepared['args'][1] );
		$this->assertNotNull( EventSignup::get_by_id( 1 ) );
		$this->assertSame( 'expired', EventSignup::get_by_id( 2 )->status );
		$this->assertSame( 'expired', EventSignup::get_by_id( 3 )->status );
		$this->assertNull( EventSignup::get_by_id( 2 )->payment_expires_at );
		$this->assertSame( 0, EventSignup::expire_pending() );
	}

	/**
	 * A paid callback confirms the signup without replacing customer data.
	 */
	public function test_payment_confirmation_preserves_registration_data(): void {
		$signup = (object) array(
			'id'                 => 10,
			'event_date_id'      => 20,
			'participant_id'     => 30,
			'name'               => 'Jane Doe',
			'email'              => 'jane@example.test',
			'answers'            => '{"accessibility":"Front row"}',
			'status'             => 'pending_payment',
			'transaction_id'     => 40,
			'payment_expires_at' => gmdate( 'Y-m-d H:i:s', time() + 60 ),
		);
		$GLOBALS['wpdb']->seed_row( 'wp_fair_events_signups', 10, $signup );
		$GLOBALS['_fair_test_actions'] = array();

		PaymentHooks::handle_payment_paid(
			(object) array(),
			(object) array(
				'id'       => 40,
				'metadata' => wp_json_encode(
					array(
						'source'    => 'fair-events-get-tickets',
						'signup_id' => 10,
					)
				),
			)
		);

		$confirmed = EventSignup::get_by_id( 10 );
		$this->assertSame( 'confirmed', $confirmed->status );
		$this->assertSame( 'Jane Doe', $confirmed->name );
		$this->assertSame( 'jane@example.test', $confirmed->email );
		$this->assertSame( '{"accessibility":"Front row"}', $confirmed->answers );
		$this->assertCount( 1, $GLOBALS['_fair_test_actions']['fair_events_signup_confirmed'] );
	}

	/**
	 * Retried terminal notifications do not re-dispatch lifecycle actions.
	 */
	public function test_payment_notifications_are_idempotent_and_expiry_is_terminal_for_failures(): void {
		$transaction = (object) array(
			'id'       => 40,
			'metadata' => wp_json_encode(
				array(
					'source'    => 'fair-events-get-tickets',
					'signup_id' => 10,
				)
			),
		);
		$GLOBALS['wpdb']->seed_row(
			'wp_fair_events_signups',
			10,
			(object) array(
				'id'                 => 10,
				'status'             => 'expired',
				'transaction_id'     => 40,
				'payment_expires_at' => null,
			)
		);
		$GLOBALS['_fair_test_actions'] = array();

		PaymentHooks::handle_payment_failed( (object) array(), $transaction );
		$this->assertSame( 'expired', EventSignup::get_by_id( 10 )->status );
		$this->assertArrayNotHasKey( 'fair_events_signup_payment_failed', $GLOBALS['_fair_test_actions'] );

		PaymentHooks::handle_payment_paid( (object) array(), $transaction );
		PaymentHooks::handle_payment_paid( (object) array(), $transaction );
		$this->assertSame( 'confirmed', EventSignup::get_by_id( 10 )->status );
		$this->assertCount( 1, $GLOBALS['_fair_test_actions']['fair_events_signup_confirmed'] );
	}

	/**
	 * Multi-instance rows transition together and failed retries dispatch once.
	 */
	public function test_multi_instance_and_failure_transitions_are_idempotent(): void {
		foreach ( array( 10, 11 ) as $signup_id ) {
			$GLOBALS['wpdb']->seed_row(
				'wp_fair_events_signups',
				$signup_id,
				(object) array(
					'id'                 => $signup_id,
					'status'             => 'pending_payment',
					'transaction_id'     => 40,
					'payment_expires_at' => gmdate( 'Y-m-d H:i:s', time() + 60 ),
				)
			);
		}
		$transaction                   = (object) array(
			'id'       => 40,
			'metadata' => wp_json_encode(
				array(
					'source'     => 'fair-events-get-tickets',
					'signup_ids' => array( 10, 11 ),
				)
			),
		);
		$GLOBALS['_fair_test_actions'] = array();

		PaymentHooks::handle_payment_failed( (object) array(), $transaction );
		PaymentHooks::handle_payment_failed( (object) array(), $transaction );

		$this->assertSame( 'failed', EventSignup::get_by_id( 10 )->status );
		$this->assertSame( 'failed', EventSignup::get_by_id( 11 )->status );
		$this->assertCount( 2, $GLOBALS['_fair_test_actions']['fair_events_signup_payment_failed'] );
	}

	/**
	 * Representative timezones, including DST-observing offsets.
	 *
	 * @return array<string, array{string}>
	 */
	public function timezone_provider(): array {
		return array(
			'UTC'             => array( 'UTC' ),
			'positive DST'    => array( 'Europe/Brussels' ),
			'negative offset' => array( 'America/New_York' ),
		);
	}
}
