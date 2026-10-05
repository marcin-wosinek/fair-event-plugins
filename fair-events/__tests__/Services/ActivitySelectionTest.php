<?php
/**
 * ActivitySelection pure logic tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairEvents\Services\ActivitySelection;

/**
 * Validates the activity rule a ticket type imposes on a selection.
 * Database-backed validation is exercised via API integration tests.
 */
class ActivitySelectionTest extends TestCase {

	/** Without a ticket type the event-date minimum applies, with no maximum. */
	public function test_global_minimum_applies_without_ticket_type() {
		$this->assertSame(
			array(
				'enabled' => true,
				'minimum' => 2,
				'maximum' => null,
			),
			ActivitySelection::selection_rule( 2 )
		);
	}

	/** Ticket-specific values replace the global fallback. */
	public function test_ticket_rule_is_authoritative_and_preserves_unlimited_maximum() {
		$type                     = new \stdClass();
		$type->activities_enabled = true;
		$type->recurrence_scope   = 'single_instance';
		$type->minimum_activities = 1;
		$type->maximum_activities = null;
		$this->assertSame(
			array(
				'enabled' => true,
				'minimum' => 1,
				'maximum' => null,
			),
			ActivitySelection::selection_rule( 3, $type )
		);
	}

	/** Disabled and multi-instance types never allow activity selection. */
	public function test_disabled_and_multiple_instance_types_disable_activities() {
		$type                     = new \stdClass();
		$type->activities_enabled = false;
		$type->recurrence_scope   = 'single_instance';
		$type->minimum_activities = 2;
		$type->maximum_activities = 4;
		$this->assertFalse( ActivitySelection::selection_rule( 0, $type )['enabled'] );

		$type->activities_enabled = true;
		$type->recurrence_scope   = 'multiple_instances';
		$this->assertFalse( ActivitySelection::selection_rule( 0, $type )['enabled'] );
	}
}
