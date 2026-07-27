<?php
/**
 * GroupSignupPricing::allowed_ticket_types() / discount_note_label() tests
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairAudience\Services\GroupSignupPricing;

/**
 * Validates the pure group-restriction filtering and discount-note formatting
 * logic behind #1242, without needing fair-events-experimental /
 * fair-audience-experimental loaded — both methods accept duck-typed objects
 * (an `id` property for ticket types, `discount_type`/`discount_value`/
 * `group_id` for a rule) rather than the concrete experimental classes.
 */
class GroupSignupPricingTest extends TestCase {

	/**
	 * Build a ticket type stub with the given id.
	 *
	 * @param int $id Ticket type ID.
	 * @return object
	 */
	private function ticket_type( $id ) {
		$type     = new \stdClass();
		$type->id = $id;
		return $type;
	}

	/**
	 * Build a discount rule stub.
	 *
	 * @param string $discount_type  'percentage' or 'amount'.
	 * @param float  $discount_value Discount magnitude.
	 * @param int    $group_id       Group ID.
	 * @return object
	 */
	private function rule( $discount_type, $discount_value, $group_id = 1 ) {
		$rule                 = new \stdClass();
		$rule->discount_type  = $discount_type;
		$rule->discount_value = $discount_value;
		$rule->group_id       = $group_id;
		return $rule;
	}

	/**
	 * An unrestricted ticket type (no entry in the restrictions map) is
	 * always visible, anonymous or not.
	 */
	public function test_unrestricted_type_is_visible_to_anonymous() {
		$types  = array( $this->ticket_type( 1 ) );
		$result = GroupSignupPricing::allowed_ticket_types( $types, array(), array() );

		$this->assertCount( 1, $result );
		$this->assertSame( 1, $result[0]->id );
	}

	/**
	 * A restricted ticket type is hidden from an anonymous visitor
	 * (no member group IDs at all).
	 */
	public function test_restricted_type_hidden_for_anonymous() {
		$types            = array( $this->ticket_type( 1 ) );
		$restrictions_map = array( 1 => array( 5 ) );
		$result           = GroupSignupPricing::allowed_ticket_types( $types, $restrictions_map, array() );

		$this->assertSame( array(), $result );
	}

	/**
	 * A restricted ticket type is hidden from a participant who belongs to
	 * groups, but not the permitted one.
	 */
	public function test_restricted_type_hidden_for_non_member() {
		$types            = array( $this->ticket_type( 1 ) );
		$restrictions_map = array( 1 => array( 5 ) );
		$result           = GroupSignupPricing::allowed_ticket_types( $types, $restrictions_map, array( 6, 7 ) );

		$this->assertSame( array(), $result );
	}

	/**
	 * A restricted ticket type is shown to a participant who belongs to one
	 * of the permitted groups.
	 */
	public function test_restricted_type_shown_for_member() {
		$types            = array( $this->ticket_type( 1 ) );
		$restrictions_map = array( 1 => array( 5, 6 ) );
		$result           = GroupSignupPricing::allowed_ticket_types( $types, $restrictions_map, array( 6 ) );

		$this->assertCount( 1, $result );
		$this->assertSame( 1, $result[0]->id );
	}

	/**
	 * Mixed list: only the restricted-and-disallowed type is dropped, other
	 * types are kept, and the result is reindexed.
	 */
	public function test_mixed_list_filters_only_disallowed_restricted_type() {
		$types = array( $this->ticket_type( 1 ), $this->ticket_type( 2 ), $this->ticket_type( 3 ) );

		$restrictions_map = array(
			2 => array( 5 ), // Restricted, viewer isn't a member.
			3 => array( 6 ), // Restricted, viewer is a member.
		);

		$result = GroupSignupPricing::allowed_ticket_types( $types, $restrictions_map, array( 6 ) );

		$this->assertCount( 2, $result );
		$this->assertSame( array( 1, 3 ), array_map( fn( $t ) => $t->id, $result ) );
	}

	/**
	 * Percentage discount note matches the legacy string verbatim.
	 */
	public function test_discount_note_label_percentage() {
		$label = GroupSignupPricing::discount_note_label( $this->rule( 'percentage', 20 ), 'Volunteers' );

		$this->assertSame( '20% discount applied (Volunteers)', $label );
	}

	/**
	 * Amount discount note matches the legacy string verbatim.
	 */
	public function test_discount_note_label_amount() {
		$label = GroupSignupPricing::discount_note_label( $this->rule( 'amount', 5 ), 'Staff' );

		$this->assertSame( '€5.00 discount applied (Staff)', $label );
	}
}
