<?php
/**
 * Group permission and pricing rule lookups and deletions.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\Models;

use FairEventsExperimental\Models\GroupPermissionRule;
use FairEventsExperimental\Models\GroupPricingRule;
use FairEventsExperimental\Models\GroupRulePersistence;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/GroupRuleTablesFake.php';

// phpcs:disable Generic.Commenting.DocComment.MissingShort,Squiz.Commenting.FunctionComment.ParamCommentFullStop,Squiz.Commenting.FunctionComment.MissingParamTag

/** Covers the shared persistence through both models' public APIs. */
class GroupRulePersistenceTest extends TestCase {
	private const PERMISSIONS = 'wp_fair_events_group_permission_rules';
	private const PRICING     = 'wp_fair_events_group_pricing_rules';

	/** @var mixed Original $wpdb. */
	private $original_wpdb;

	/** @var GroupRuleTablesFake */
	private $db;

	/**
	 * Both tables hold rules with IDs 1-3, for event dates 10 and 20,
	 * seeded out of ID order.
	 */
	protected function setUp(): void {
		parent::setUp();
		$this->original_wpdb = $GLOBALS['wpdb'] ?? null;
		$this->db            = new GroupRuleTablesFake();
		$GLOBALS['wpdb']     = $this->db; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- test fake, restored in tearDown().

		foreach ( array( array( 3, 10, 7 ), array( 1, 10, 5 ), array( 2, 20, 5 ) ) as list( $id, $event_date_id, $group_id ) ) {
			$this->db->seed(
				GroupRulePersistence::PERMISSION_RULES_TABLE,
				array(
					'id'              => $id,
					'event_date_id'   => $event_date_id,
					'group_id'        => $group_id,
					'permission_type' => 'view_signups',
					'created_at'      => '2026-01-0' . $id . ' 00:00:00',
					'updated_at'      => '2026-02-0' . $id . ' 00:00:00',
				)
			);
			$this->db->seed(
				GroupRulePersistence::PRICING_RULES_TABLE,
				array(
					'id'             => $id,
					'event_date_id'  => $event_date_id,
					'group_id'       => $group_id,
					'discount_type'  => 'percentage',
					'discount_value' => $id . '2.50',
					'created_at'     => '2026-01-0' . $id . ' 00:00:00',
					'updated_at'     => '2026-02-0' . $id . ' 00:00:00',
				)
			);
		}
	}

	/** Restore $wpdb. */
	protected function tearDown(): void {
		$GLOBALS['wpdb'] = $this->original_wpdb; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- restores the original.
		parent::tearDown();
	}

	/** @return array<string, array{class-string, string, string}> */
	public static function models() {
		return array(
			'permission' => array( GroupPermissionRule::class, self::PERMISSIONS, GroupRulePersistence::PERMISSION_RULES_TABLE ),
			'pricing'    => array( GroupPricingRule::class, self::PRICING, GroupRulePersistence::PRICING_RULES_TABLE ),
		);
	}

	/** @param array[] $rows Rows. @return int[] IDs. */
	private static function ids( array $rows ) {
		return array_map( static fn( $row ) => (int) ( is_array( $row ) ? $row['id'] : $row->id ), $rows );
	}

	/** Permission lookup reads its own table and casts IDs. */
	public function test_permission_lookup_hydrates_and_serializes_the_rule() {
		$rule = GroupPermissionRule::get_by_id( 3 );

		$this->assertInstanceOf( GroupPermissionRule::class, $rule );
		$this->assertSame(
			array(
				'id'              => 3,
				'event_date_id'   => 10,
				'group_id'        => 7,
				'permission_type' => 'view_signups',
				'created_at'      => '2026-01-03 00:00:00',
				'updated_at'      => '2026-02-03 00:00:00',
			),
			$rule->to_array()
		);
		$this->assertSame( array( 'SELECT * FROM %i WHERE id = %d LIMIT 1', array( self::PERMISSIONS, 3 ) ), $this->db->queries[0] );
	}

	/** Pricing lookup reads its own table and casts IDs and the discount. */
	public function test_pricing_lookup_hydrates_and_serializes_the_rule() {
		$rule = GroupPricingRule::get_by_id( 3 );

		$this->assertInstanceOf( GroupPricingRule::class, $rule );
		$this->assertSame(
			array(
				'id'             => 3,
				'event_date_id'  => 10,
				'group_id'       => 7,
				'discount_type'  => 'percentage',
				'discount_value' => 32.5,
				'created_at'     => '2026-01-03 00:00:00',
				'updated_at'     => '2026-02-03 00:00:00',
			),
			$rule->to_array()
		);
		$this->assertSame( array( 'SELECT * FROM %i WHERE id = %d LIMIT 1', array( self::PRICING, 3 ) ), $this->db->queries[0] );
	}

	/** @param class-string $model Model. @param string $table Prefixed table. @param string $own Unprefixed table. */
	#[DataProvider( 'models' )]
	public function test_event_date_list_is_filtered_ordered_and_typed( $model, $table, $own ) {
		unset( $own );
		$rules = $model::get_all_by_event_date_id( 10 );

		$this->assertSame( array( 1, 3 ), self::ids( $rules ) );
		$this->assertContainsOnlyInstancesOf( $model, $rules );
		$this->assertSame( array( 0, 1 ), array_keys( $rules ) );
		$this->assertSame(
			array( 'SELECT * FROM %i WHERE event_date_id = %d ORDER BY id ASC', array( $table, 10 ) ),
			$this->db->queries[0]
		);
	}

	/** @param class-string $model Model. @param string $table Prefixed table. @param string $own Unprefixed table. */
	#[DataProvider( 'models' )]
	public function test_missing_records_return_null_and_empty_lists( $model, $table, $own ) {
		unset( $table, $own );
		$this->assertNull( $model::get_by_id( 99 ) );
		$this->assertSame( array(), $model::get_all_by_event_date_id( 99 ) );
	}

	/** @param class-string $model Model. @param string $table Prefixed table. @param string $own Unprefixed table. */
	#[DataProvider( 'models' )]
	public function test_lookup_failures_return_null_and_empty_lists( $model, $table, $own ) {
		unset( $table, $own );
		$this->db->fail = true;

		$this->assertNull( $model::get_by_id( 1 ) );
		$this->assertSame( array(), $model::get_all_by_event_date_id( 10 ) );
	}

	/** @param class-string $model Model. @param string $table Prefixed table. @param string $own Unprefixed table. */
	#[DataProvider( 'models' )]
	public function test_deletions_succeed_for_matched_and_unmatched_rows( $model, $table, $own ) {
		unset( $own );
		$this->assertTrue( $model::delete( 1 ) );
		$this->assertTrue( $model::delete( 99 ) );
		$this->assertTrue( $model::delete_by_event_date_id( 99 ) );

		$this->assertSame(
			array(
				array( $table, array( 'id' => 1 ), array( '%d' ) ),
				array( $table, array( 'id' => 99 ), array( '%d' ) ),
				array( $table, array( 'event_date_id' => 99 ), array( '%d' ) ),
			),
			$this->db->deletes
		);
	}

	/** @param class-string $model Model. @param string $table Prefixed table. @param string $own Unprefixed table. */
	#[DataProvider( 'models' )]
	public function test_deletion_failures_return_false( $model, $table, $own ) {
		unset( $table, $own );
		$this->db->fail = true;

		$this->assertFalse( $model::delete( 1 ) );
		$this->assertFalse( $model::delete_by_event_date_id( 10 ) );
	}

	/** Overlapping IDs: a permission deletion keeps every pricing rule. */
	public function test_deleting_a_permission_rule_leaves_the_pricing_rule_with_the_same_id() {
		GroupPermissionRule::delete( 1 );

		$this->assertSame( array( 3, 2 ), self::ids( $this->db->rows( GroupRulePersistence::PERMISSION_RULES_TABLE ) ) );
		$this->assertSame( array( 3, 1, 2 ), self::ids( $this->db->rows( GroupRulePersistence::PRICING_RULES_TABLE ) ) );
	}

	/** Overlapping IDs: a pricing deletion keeps every permission rule. */
	public function test_deleting_a_pricing_rule_leaves_the_permission_rule_with_the_same_id() {
		GroupPricingRule::delete( 1 );

		$this->assertSame( array( 3, 2 ), self::ids( $this->db->rows( GroupRulePersistence::PRICING_RULES_TABLE ) ) );
		$this->assertSame( array( 3, 1, 2 ), self::ids( $this->db->rows( GroupRulePersistence::PERMISSION_RULES_TABLE ) ) );
	}

	/** @param class-string $model Model. @param string $table Prefixed table. @param string $own Unprefixed table. */
	#[DataProvider( 'models' )]
	public function test_event_date_deletion_keeps_other_events_and_the_other_rule_type( $model, $table, $own ) {
		$other = GroupRulePersistence::PERMISSION_RULES_TABLE === $own
			? GroupRulePersistence::PRICING_RULES_TABLE
			: GroupRulePersistence::PERMISSION_RULES_TABLE;

		$this->assertTrue( $model::delete_by_event_date_id( 10 ) );

		$this->assertSame( array( 2 ), self::ids( $this->db->rows( $own ) ) );
		$this->assertSame( array( 3, 1, 2 ), self::ids( $this->db->rows( $other ) ) );
		$this->assertSame( array( array( $table, array( 'event_date_id' => 10 ), array( '%d' ) ) ), $this->db->deletes );
	}

	/** The permission-only event and group lookup keeps its query and results. */
	public function test_permission_event_and_group_lookup_is_unchanged() {
		$rules = GroupPermissionRule::get_by_event_date_and_group( 10, 5 );

		$this->assertSame( array( 1 ), self::ids( $rules ) );
		$this->assertContainsOnlyInstancesOf( GroupPermissionRule::class, $rules );
		$this->assertSame(
			array( 'SELECT * FROM %i WHERE event_date_id = %d AND group_id = %d ORDER BY id ASC', array( self::PERMISSIONS, 10, 5 ) ),
			$this->db->queries[0]
		);
		$this->assertSame( array(), GroupPermissionRule::get_by_event_date_and_group( 20, 7 ) );

		$this->db->fail = true;
		$this->assertSame( array(), GroupPermissionRule::get_by_event_date_and_group( 10, 5 ) );
	}
}
