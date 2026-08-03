<?php
/**
 * SignupEmailHooks tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Hooks;

use PHPUnit\Framework\TestCase;
use FairEvents\Hooks\SignupEmailHooks;

/**
 * Verifies SignupEmailHooks reads the fair_events_signups row and threads its
 * ticket_type_id/amount through to EmailService::send_signup_confirmation()
 * for both the free-path (handle_signup_created) and paid-path
 * (handle_signup_confirmed) hooks. FairAudience\Hooks\SignupHookBridge is
 * never loaded in fair-events' own test process, so the
 * "fair-audience active" suppression guard never trips here.
 */
class SignupEmailHooksTest extends TestCase {

	/**
	 * Reset recorded test emails and seeded rows before each test.
	 */
	protected function setUp(): void {
		parent::setUp();
		$GLOBALS['_fair_test_sent_emails'] = array();
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- test-only fake, no real $wpdb exists here.
		$GLOBALS['wpdb'] = new \Fair_Test_WPDB();
	}

	/**
	 * Seed a fair_events_signups row for EventSignup::get_by_id().
	 *
	 * @param int   $signup_id Row id.
	 * @param array $overrides Column overrides.
	 * @return void
	 */
	private function seed_signup( $signup_id, array $overrides = array() ): void {
		$row = (object) array_merge(
			array(
				'id'             => $signup_id,
				'event_date_id'  => 0,
				'ticket_type_id' => 0,
				'name'           => 'Jane Doe',
				'email'          => 'jane@example.test',
				'amount'         => 0.0,
			),
			$overrides
		);

		$GLOBALS['wpdb']->seed_row( 'wp_fair_events_signups', $signup_id, $row );
	}

	/**
	 * The free-path hook (transaction_id null) sends immediately, with the
	 * signup row's ticket_type_id/amount threaded through.
	 */
	public function test_handle_signup_created_free_path_sends_with_signup_fields(): void {
		$this->seed_signup(
			10,
			array(
				'ticket_type_id' => 3,
				'amount'         => 0.0,
			)
		);

		SignupEmailHooks::handle_signup_created( 10, 0, 'Jane Doe', 'jane@example.test', array(), null );

		$this->assertCount( 1, $GLOBALS['_fair_test_sent_emails'] );
		$sent = $GLOBALS['_fair_test_sent_emails'][0];
		$this->assertSame( 'jane@example.test', $sent['to'] );
		$this->assertStringContainsString( '#10', $sent['message'] );
	}

	/**
	 * The free-path hook does not send when a transaction_id is present — a
	 * paid-but-unconfirmed signup waits for handle_signup_confirmed().
	 */
	public function test_handle_signup_created_paid_path_does_not_send(): void {
		$this->seed_signup( 11 );

		SignupEmailHooks::handle_signup_created( 11, 0, 'Jane Doe', 'jane@example.test', array(), 55 );

		$this->assertCount( 0, $GLOBALS['_fair_test_sent_emails'] );
	}

	/**
	 * The paid-path hook sends once payment is confirmed, with the amount
	 * paid from the signup row surfaced in the email.
	 */
	public function test_handle_signup_confirmed_sends_with_amount_paid(): void {
		$this->seed_signup(
			12,
			array(
				'ticket_type_id' => 0,
				'amount'         => 25.5,
			)
		);

		$signup = (object) array(
			'id'            => 12,
			'event_date_id' => 0,
			'name'          => 'Jane Doe',
			'email'         => 'jane@example.test',
		);

		SignupEmailHooks::handle_signup_confirmed( $signup, (object) array() );

		$this->assertCount( 1, $GLOBALS['_fair_test_sent_emails'] );
		$sent = $GLOBALS['_fair_test_sent_emails'][0];
		$this->assertStringContainsString( 'Amount paid:', $sent['message'] );
		$this->assertStringContainsString( '25.50 EUR', $sent['message'] );
	}
}
