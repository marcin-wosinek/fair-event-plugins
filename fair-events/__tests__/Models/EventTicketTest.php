<?php
/**
 * EventTicket single-unit operation tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Models;

use FairEvents\Models\EventTicket;
use PHPUnit\Framework\TestCase;

/**
 * Verifies the guards written into the queries that cancel, delete and move
 * individual ticket units. What they do to stored rows is covered against a
 * real database by fair-audience's TicketOperations.api.spec.js.
 */
class EventTicketTest extends TestCase {

	/**
	 * Install a fresh database double.
	 */
	protected function setUp(): void {
		parent::setUp();
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- test-only fake.
		$GLOBALS['wpdb'] = new \Fair_Test_WPDB();
	}

	/**
	 * Cancelling targets one unit and never one that is already inactive.
	 */
	public function test_cancel_targets_one_active_unit(): void {
		EventTicket::cancel( 7 );

		$prepared = $GLOBALS['wpdb']->last_prepared;
		$this->assertStringContainsString( 'SET status = %s WHERE id = %d AND status NOT IN', $prepared['query'] );
		$this->assertSame(
			array_merge( array( 'wp_fair_events_tickets', 'cancelled', 7 ), EventTicket::INACTIVE_STATUSES ),
			$prepared['args']
		);
	}

	/**
	 * Only a cancelled unit can be marked deleted, and only once.
	 */
	public function test_mark_deleted_requires_a_cancelled_unit(): void {
		$this->assertFalse( EventTicket::mark_deleted( 7 ) );

		$prepared = $GLOBALS['wpdb']->last_prepared;
		$this->assertStringContainsString( 'SET deleted_at = %s WHERE id = %d AND status = %s AND deleted_at IS NULL', $prepared['query'] );
		$this->assertSame( 7, $prepared['args'][2] );
		$this->assertSame( 'cancelled', $prepared['args'][3] );
	}

	/**
	 * A unit that was not marked is not announced as deleted.
	 */
	public function test_unmarked_unit_is_not_announced(): void {
		unset( $GLOBALS['_fair_test_actions']['fair_events_tickets_deleting'] );

		EventTicket::mark_deleted( 7 );

		$this->assertArrayNotHasKey( 'fair_events_tickets_deleting', $GLOBALS['_fair_test_actions'] ?? array() );
	}

	/**
	 * Deleted units are left out of the units participants hold, whichever
	 * statuses are asked for.
	 */
	public function test_held_units_leave_out_deleted_ones(): void {
		EventTicket::get_held_by_participants( 5, array( 10 ) );
		$this->assertStringContainsString( 'AND deleted_at IS NULL', $GLOBALS['wpdb']->last_prepared['query'] );

		EventTicket::get_held_by_participants( 5, array( 10 ), array( 'cancelled' ) );
		$this->assertStringContainsString( 'status IN (%s) AND deleted_at IS NULL', $GLOBALS['wpdb']->last_prepared['query'] );
	}

	/**
	 * Moving a signup takes along only the units still on its date.
	 */
	public function test_signup_move_takes_only_units_on_the_source_date(): void {
		EventTicket::set_active_units_column( 3, 'event_date_id', 9, 5 );

		$prepared = $GLOBALS['wpdb']->last_prepared;
		$this->assertStringContainsString( 'WHERE signup_id = %d AND event_date_id = %d AND status NOT IN', $prepared['query'] );
		$this->assertSame( array( 'event_date_id', 9, 3, 5 ), array_slice( $prepared['args'], 1, 4 ) );
	}

	/**
	 * A type change still reaches every active unit, wherever it is.
	 */
	public function test_type_change_reaches_units_on_every_date(): void {
		EventTicket::set_active_units_column( 3, 'ticket_type_id', 4 );

		$this->assertStringNotContainsString( 'event_date_id = %d', $GLOBALS['wpdb']->last_prepared['query'] );
	}
}
