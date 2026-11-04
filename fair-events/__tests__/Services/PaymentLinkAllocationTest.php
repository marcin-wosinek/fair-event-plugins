<?php
/**
 * Payment link allocation rule tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use FairEvents\Services\PaymentLinkAllocation;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Covers PAYMENT_HISTORY_MIGRATION.md §5.1: field validation, rounding,
 * roles, duplicate handling, protected attribution and the rule that a
 * transaction's allocations never exceed its total.
 */
class PaymentLinkAllocationTest extends TestCase {

	/**
	 * A €30 EUR transaction.
	 *
	 * @param array $overrides Fields to replace.
	 * @return array
	 */
	private static function transaction( array $overrides = array() ) {
		return $overrides + array(
			'id'         => 77,
			'amount'     => '30.00',
			'currency'   => 'EUR',
			'created_at' => '2026-10-01 12:00:00',
		);
	}

	/**
	 * A valid link.
	 *
	 * @param array $overrides Fields to replace.
	 * @return array
	 */
	private static function link( array $overrides = array() ) {
		return $overrides + array(
			'signup_id'        => 5,
			'role'             => 'charge',
			'allocated_amount' => 30,
			'attribution'      => 'live',
			'evidence'         => array(
				'type'      => 'metadata_signup_id',
				'signup_id' => 5,
			),
		);
	}

	/**
	 * A stored row as the table returns it.
	 *
	 * @param array $overrides Fields to replace.
	 * @return array
	 */
	private static function stored( array $overrides = array() ) {
		return $overrides + array(
			'id'               => '1',
			'signup_id'        => '5',
			'transaction_id'   => '77',
			'role'             => 'charge',
			'allocated_amount' => '30.00',
			'currency'         => 'EUR',
			'attribution'      => 'live',
			'evidence'         => '{"type":"checkout"}',
			'created_at'       => '2026-10-01 12:00:00',
		);
	}

	/**
	 * A single-purchase link is normalized and takes the transaction's
	 * currency and creation time.
	 *
	 * @return void
	 */
	public function test_valid_link_is_normalized() {
		$plan = PaymentLinkAllocation::prepare( array( self::link( array( 'signup_id' => '5' ) ) ), self::transaction( array( 'currency' => 'eur' ) ), array() );

		$this->assertSame( array(), $plan['unchanged'] );
		$this->assertSame(
			array(
				'signup_id'        => 5,
				'transaction_id'   => 77,
				'role'             => 'charge',
				'allocated_amount' => 30.0,
				'currency'         => 'EUR',
				'attribution'      => 'live',
				'evidence'         => '{"type":"metadata_signup_id","signup_id":5}',
				'created_at'       => '2026-10-01 12:00:00',
			),
			$plan['insert'][0]
		);
	}

	/**
	 * Invalid fields, each with the field it names.
	 *
	 * @return array
	 */
	public static function invalid_links() {
		return array(
			'zero signup'        => array( array( 'signup_id' => 0 ), 'signup_id' ),
			'negative signup'    => array( array( 'signup_id' => -3 ), 'signup_id' ),
			'float signup'       => array( array( 'signup_id' => 5.5 ), 'signup_id' ),
			'text signup'        => array( array( 'signup_id' => '5abc' ), 'signup_id' ),
			'unknown role'       => array( array( 'role' => 'refund' ), 'role' ),
			'unknown attrib.'    => array( array( 'attribution' => 'guessed' ), 'attribution' ),
			'negative amount'    => array( array( 'allocated_amount' => -1 ), 'allocated_amount' ),
			'text amount'        => array( array( 'allocated_amount' => 'ten' ), 'allocated_amount' ),
			'other currency'     => array( array( 'currency' => 'USD' ), 'currency' ),
			'no evidence'        => array( array( 'evidence' => null ), 'evidence' ),
			'evidence no type'   => array( array( 'evidence' => array( 'signup_id' => 5 ) ), 'evidence' ),
			'evidence bad type'  => array( array( 'evidence' => array( 'type' => 'Has Spaces' ) ), 'evidence' ),
			'oversized evidence' => array(
				array(
					'evidence' => array(
						'type' => 'note',
						'note' => str_repeat( 'x', 70000 ),
					),
				),
				'evidence',
			),
			'bad created_at'     => array( array( 'created_at' => 'yesterday' ), 'created_at' ),
		);
	}

	/**
	 * Every field is validated and the set is refused.
	 *
	 * @param array  $overrides Invalid fields.
	 * @param string $field     Field the error names.
	 * @return void
	 */
	#[DataProvider( 'invalid_links' )]
	public function test_invalid_link_is_refused( array $overrides, $field ) {
		$result = PaymentLinkAllocation::prepare( array( self::link( $overrides ) ), self::transaction(), array() );

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'invalid_payment_link', $result->get_error_code() );
		$this->assertSame( $field, $result->get_error_data()['field'] );
	}

	/**
	 * Every contract role is accepted.
	 *
	 * @return array
	 */
	public static function roles() {
		return array(
			array( 'charge' ),
			array( 'additional_charge' ),
			array( 'upgrade' ),
			array( 'legacy_refund_record' ),
		);
	}

	/**
	 * Roles from the contract are accepted.
	 *
	 * @param string $role Role.
	 * @return void
	 */
	#[DataProvider( 'roles' )]
	public function test_contract_roles_are_accepted( $role ) {
		$plan = PaymentLinkAllocation::prepare( array( self::link( array( 'role' => $role ) ) ), self::transaction(), array() );

		$this->assertSame( $role, $plan['insert'][0]['role'] );
	}

	/**
	 * A transaction without a valid total or currency can't take links.
	 *
	 * @return void
	 */
	public function test_invalid_transaction_is_refused() {
		foreach ( array( array( 'amount' => -1 ), array( 'amount' => null ), array( 'currency' => 'EURO' ), array( 'id' => 0 ) ) as $overrides ) {
			$result = PaymentLinkAllocation::prepare( array( self::link() ), self::transaction( $overrides ), array() );
			$this->assertSame( 'invalid_payment_transaction', $result->get_error_code() );
		}
		$this->assertSame( 'invalid_payment_link', PaymentLinkAllocation::prepare( array(), self::transaction(), array() )->get_error_code() );
	}

	/**
	 * Amounts round half up to cents, and allocations exactly reaching the
	 * total are accepted even when raw floats would exceed it.
	 *
	 * @return void
	 */
	public function test_amounts_round_half_up_and_compare_in_cents() {
		$plan = PaymentLinkAllocation::prepare(
			array(
				self::link( array( 'allocated_amount' => '0.105' ) ),
				self::link(
					array(
						'signup_id'        => 6,
						'allocated_amount' => 0.2,
					)
				),
			),
			self::transaction( array( 'amount' => '0.31' ) ),
			array()
		);

		$this->assertSame( 0.11, $plan['insert'][0]['allocated_amount'] );
		$this->assertSame( 0.2, $plan['insert'][1]['allocated_amount'] );

		$plan = PaymentLinkAllocation::prepare(
			array(
				self::link( array( 'allocated_amount' => 0.1 ) ),
				self::link(
					array(
						'signup_id'        => 6,
						'allocated_amount' => 0.2,
					)
				),
			),
			self::transaction( array( 'amount' => '0.30' ) ),
			array()
		);
		$this->assertCount( 2, $plan['insert'] );
	}

	/**
	 * A shared transaction can be split, but never beyond its total, and
	 * a remainder below it is allowed.
	 *
	 * @return void
	 */
	public function test_allocations_never_exceed_total() {
		$shared = array(
			self::link( array( 'allocated_amount' => 12 ) ),
			self::link(
				array(
					'signup_id'        => 6,
					'allocated_amount' => 12,
				)
			),
			self::link(
				array(
					'signup_id'        => 7,
					'allocated_amount' => 12,
				)
			),
		);

		$this->assertCount( 3, PaymentLinkAllocation::prepare( $shared, self::transaction( array( 'amount' => 36 ) ), array() )['insert'] );
		$this->assertCount( 3, PaymentLinkAllocation::prepare( $shared, self::transaction( array( 'amount' => 40 ) ), array() )['insert'] );

		$result = PaymentLinkAllocation::prepare( $shared, self::transaction( array( 'amount' => '35.99' ) ), array() );
		$this->assertSame( 'allocation_exceeds_total', $result->get_error_code() );
		$this->assertSame( 36.0, (float) $result->get_error_data()['allocated'] );
	}

	/**
	 * Links already stored count against the total.
	 *
	 * @return void
	 */
	public function test_existing_links_count_against_total() {
		$existing = array( self::stored( array( 'allocated_amount' => '20.00' ) ) );

		$ok = PaymentLinkAllocation::prepare(
			array(
				self::link(
					array(
						'signup_id'        => 6,
						'allocated_amount' => 10,
					)
				),
			),
			self::transaction(),
			$existing
		);
		$this->assertCount( 1, $ok['insert'] );

		$result = PaymentLinkAllocation::prepare(
			array(
				self::link(
					array(
						'signup_id'        => 6,
						'allocated_amount' => '10.01',
					)
				),
			),
			self::transaction(),
			$existing
		);
		$this->assertSame( 'allocation_exceeds_total', $result->get_error_code() );
	}

	/**
	 * Repeating an identical write is a no-op and is not counted twice.
	 *
	 * @return void
	 */
	public function test_identical_repeat_is_unchanged() {
		$plan = PaymentLinkAllocation::prepare( array( self::link( array( 'allocated_amount' => '30.0' ) ) ), self::transaction(), array( self::stored() ) );

		$this->assertSame( array(), $plan['insert'] );
		$this->assertSame( '1', $plan['unchanged'][0]['id'] );
	}

	/**
	 * A different allocation for an existing link is a conflict, and the
	 * whole set is refused, including its valid links.
	 *
	 * @return void
	 */
	public function test_conflicting_duplicate_refuses_whole_set() {
		$result = PaymentLinkAllocation::prepare(
			array(
				self::link(
					array(
						'signup_id'        => 6,
						'allocated_amount' => 0,
					)
				),
				self::link( array( 'allocated_amount' => 25 ) ),
			),
			self::transaction(),
			array( self::stored() )
		);

		$this->assertSame( 'payment_link_conflict', $result->get_error_code() );
		$this->assertSame( 1, $result->get_error_data()['index'] );
		$this->assertSame( 1, $result->get_error_data()['existing_id'] );
	}

	/**
	 * The same purchase and role can't appear twice in one set; the same
	 * purchase with another role can.
	 *
	 * @return void
	 */
	public function test_duplicate_within_set_is_refused() {
		$result = PaymentLinkAllocation::prepare(
			array(
				self::link( array( 'allocated_amount' => 10 ) ),
				self::link( array( 'allocated_amount' => 10 ) ),
			),
			self::transaction(),
			array()
		);
		$this->assertSame( 'duplicate_payment_link', $result->get_error_code() );

		$plan = PaymentLinkAllocation::prepare(
			array(
				self::link( array( 'allocated_amount' => 10 ) ),
				self::link(
					array(
						'role'             => 'additional_charge',
						'allocated_amount' => 10,
					)
				),
			),
			self::transaction(),
			array()
		);
		$this->assertCount( 2, $plan['insert'] );
	}

	/**
	 * A backfill write never changes a live or reconciled link: the same
	 * allocation leaves the stored attribution and evidence in place, and a
	 * different one is refused.
	 *
	 * @return void
	 */
	public function test_backfill_never_changes_live_or_reconciled_links() {
		foreach ( array( 'live', 'reconciled' ) as $attribution ) {
			$stored = self::stored(
				array(
					'attribution' => $attribution,
					'evidence'    => '{"type":"administrator","user_id":1}',
				)
			);

			$plan = PaymentLinkAllocation::prepare( array( self::link( array( 'attribution' => 'backfill' ) ) ), self::transaction(), array( $stored ) );
			$this->assertSame( array(), $plan['insert'] );
			$this->assertSame( $attribution, $plan['unchanged'][0]['attribution'] );
			$this->assertSame( '{"type":"administrator","user_id":1}', $plan['unchanged'][0]['evidence'] );

			$result = PaymentLinkAllocation::prepare(
				array(
					self::link(
						array(
							'attribution'      => 'backfill',
							'allocated_amount' => 15,
						)
					),
				),
				self::transaction(),
				array( $stored )
			);
			$this->assertSame( 'payment_link_conflict', $result->get_error_code() );
		}
	}

	/**
	 * A stored link in another currency conflicts even with equal amounts.
	 *
	 * @return void
	 */
	public function test_currency_difference_is_a_conflict() {
		$result = PaymentLinkAllocation::prepare( array( self::link() ), self::transaction(), array( self::stored( array( 'currency' => 'USD' ) ) ) );

		$this->assertSame( 'payment_link_conflict', $result->get_error_code() );
	}
}
