<?php
/**
 * TicketCapacity hold and buyer-message tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairEvents\Services\TicketCapacity;

/**
 * Validates the database-free parts of capacity accounting: which signups
 * hold their places, what a signup asks of capacity, and the messages a
 * buyer sees when a limit is reached. Counting against real tables is
 * exercised by TicketCapacity.api.spec.js.
 */
class TicketCapacityTest extends TestCase {

	/**
	 * Build a signup row stub.
	 *
	 * @param string      $status             Signup status.
	 * @param string|null $payment_expires_at UTC hold expiry.
	 * @return object
	 */
	private function signup( $status, $payment_expires_at = null ) {
		return (object) array(
			'status'             => $status,
			'payment_expires_at' => $payment_expires_at,
		);
	}

	/**
	 * Confirmed signups and running payment holds keep their places; every
	 * other state has released them.
	 */
	public function test_only_confirmed_and_running_holds_keep_places(): void {
		$future = gmdate( 'Y-m-d H:i:s', time() + 60 );
		$past   = gmdate( 'Y-m-d H:i:s', time() - 60 );

		$this->assertTrue( TicketCapacity::signup_holds_places( $this->signup( 'confirmed' ) ) );
		$this->assertTrue( TicketCapacity::signup_holds_places( $this->signup( 'pending_payment', $future ) ) );
		$this->assertFalse( TicketCapacity::signup_holds_places( $this->signup( 'pending_payment', $past ) ) );
		$this->assertFalse( TicketCapacity::signup_holds_places( $this->signup( 'pending_payment' ) ) );
		$this->assertFalse( TicketCapacity::signup_holds_places( $this->signup( 'failed', $future ) ) );
		$this->assertFalse( TicketCapacity::signup_holds_places( $this->signup( 'expired' ) ) );
	}

	/**
	 * A signup asks for its quantity on its event date and ticket type.
	 */
	public function test_demand_for_signup_uses_quantity(): void {
		$this->assertSame(
			array(
				'event_date_id'  => 5,
				'ticket_type_id' => 7,
				'quantity'       => 4,
			),
			TicketCapacity::demand_for_signup(
				(object) array(
					'event_date_id'  => 5,
					'ticket_type_id' => 7,
					'quantity'       => 4,
				)
			)
		);

		$this->assertSame(
			array(
				'event_date_id'  => 5,
				'ticket_type_id' => 0,
				'quantity'       => 1,
			),
			TicketCapacity::demand_for_signup(
				(object) array(
					'event_date_id'  => 5,
					'ticket_type_id' => null,
					'quantity'       => 0,
				)
			)
		);
	}

	/**
	 * A sold-out ticket type and a partly available one read differently.
	 */
	public function test_ticket_type_shortage_messages(): void {
		$sold_out = TicketCapacity::shortage_error(
			array(
				'scope'     => 'ticket_type',
				'id'        => 7,
				'remaining' => 0,
			)
		);
		$this->assertSame( 'ticket_type_sold_out', $sold_out->get_error_code() );
		$this->assertSame( 'This ticket type is sold out.', $sold_out->get_error_message() );
		$this->assertSame(
			array(
				'status'    => 409,
				'remaining' => 0,
			),
			$sold_out->get_error_data()
		);

		$few_left = TicketCapacity::shortage_error(
			array(
				'scope'     => 'ticket_type',
				'id'        => 7,
				'remaining' => 2,
			)
		);
		$this->assertSame( 'Only 2 tickets of this type are left.', $few_left->get_error_message() );
	}

	/**
	 * A full event and an event with one place left read differently.
	 */
	public function test_event_shortage_messages(): void {
		$full = TicketCapacity::shortage_error(
			array(
				'scope'     => 'event_date',
				'id'        => 5,
				'remaining' => 0,
			)
		);
		$this->assertSame( 'event_full', $full->get_error_code() );
		$this->assertSame( 'This event is fully booked.', $full->get_error_message() );

		$one_left = TicketCapacity::shortage_error(
			array(
				'scope'     => 'event_date',
				'id'        => 5,
				'remaining' => 1,
			)
		);
		$this->assertSame( 'Only 1 place is left.', $one_left->get_error_message() );
	}
}
