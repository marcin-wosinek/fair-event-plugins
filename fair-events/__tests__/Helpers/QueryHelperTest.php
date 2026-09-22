<?php
/**
 * QueryHelper unit tests
 *
 * These filters build raw SQL fragments from a WP_Query's query vars — pure
 * string construction once $wpdb is faked, so no live WordPress/database is
 * needed. Swaps $GLOBALS['wpdb'] for a purpose-built double (see
 * QueryHelperTestWPDB's docblock for why Fair_Test_WPDB's shared stub isn't
 * used here) and restores the original in tearDown().
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Helpers;

use PHPUnit\Framework\TestCase;
use FairEvents\Helpers\QueryHelper;

require_once __DIR__ . '/QueryHelperTestWPDB.php';
require_once __DIR__ . '/QueryHelperTestQuery.php';

/**
 * Tests for QueryHelper
 */
class QueryHelperTest extends TestCase {

	/**
	 * Original global $wpdb, restored in tearDown().
	 *
	 * @var mixed
	 */
	private $original_wpdb;

	/**
	 * Swap $GLOBALS['wpdb'] for the string-returning double.
	 */
	protected function setUp(): void {
		$this->original_wpdb = $GLOBALS['wpdb'] ?? null;
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- test-only double.
		$GLOBALS['wpdb'] = new \QueryHelperTestWPDB();
	}

	/**
	 * Restore the original $GLOBALS['wpdb'].
	 */
	protected function tearDown(): void {
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- restoring the pre-test double.
		$GLOBALS['wpdb'] = $this->original_wpdb;
	}

	/**
	 * The join_dates_table() filter is a no-op when the block hasn't engaged
	 * the custom table query.
	 */
	public function test_join_is_unchanged_when_query_var_unset() {
		$query = new \QueryHelperTestQuery( array() );

		$this->assertSame( 'ORIGINAL', QueryHelper::join_dates_table( 'ORIGINAL', $query ) );
	}

	/**
	 * The join resolves a post either directly by event_id or, for a
	 * generated occurrence with no event_id of its own, through its master
	 * row's event_id.
	 */
	public function test_join_resolves_master_linked_event_id() {
		$query = new \QueryHelperTestQuery( array( 'fair_events_date_query' => true ) );

		$join = QueryHelper::join_dates_table( '', $query );

		$this->assertStringContainsString( 'wp_posts.ID = wp_fair_event_dates.event_id', $join );
		$this->assertStringContainsString( 'wp_fair_event_dates.event_id IS NULL', $join );
		$this->assertStringContainsString( 'wp_fair_event_dates.master_id IS NOT NULL', $join );
		$this->assertStringContainsString( 'WHERE fair_ed_master.id = wp_fair_event_dates.master_id', $join );
	}

	/**
	 * The filter_by_dates() filter is a no-op when no date query was requested.
	 */
	public function test_where_is_unchanged_when_no_date_query() {
		$query = new \QueryHelperTestQuery( array() );

		$this->assertSame( 'ORIGINAL', QueryHelper::filter_by_dates( 'ORIGINAL', $query ) );
	}

	/**
	 * The 'all' filter (a bare `true` date query, not an array) still
	 * excludes inactive rows, but adds no date boundary.
	 */
	public function test_where_excludes_inactive_rows_for_all_filter() {
		$query = new \QueryHelperTestQuery( array( 'fair_events_date_query' => true ) );

		$where = QueryHelper::filter_by_dates( '', $query );

		$this->assertSame( " AND wp_fair_event_dates.status = 'active'", $where );
	}

	/**
	 * The "upcoming" filter (start_after) compares the raw start_datetime —
	 * no null fallback needed since start is never missing.
	 */
	public function test_where_upcoming_filters_by_start_after() {
		$query = new \QueryHelperTestQuery(
			array( 'fair_events_date_query' => array( 'start_after' => '2026-06-01 00:00:00' ) )
		);

		$where = QueryHelper::filter_by_dates( '', $query );

		$this->assertStringContainsString( "wp_fair_event_dates.status = 'active'", $where );
		$this->assertStringContainsString( "wp_fair_event_dates.start_datetime >= '2026-06-01 00:00:00'", $where );
	}

	/**
	 * The "past" filter (end_before) compares the *effective* end —
	 * COALESCE'd to start_datetime — so a single-instant event with no end
	 * still becomes "past" once its start time passes.
	 */
	public function test_where_past_filter_coalesces_missing_end_to_start() {
		$query = new \QueryHelperTestQuery(
			array( 'fair_events_date_query' => array( 'end_before' => '2026-06-01 00:00:00' ) )
		);

		$where = QueryHelper::filter_by_dates( '', $query );

		$this->assertStringContainsString(
			"COALESCE( wp_fair_event_dates.end_datetime, wp_fair_event_dates.start_datetime ) < '2026-06-01 00:00:00'",
			$where
		);
	}

	/**
	 * The "ongoing" filter (start_before + end_after) also COALESCEs the end
	 * boundary.
	 */
	public function test_where_ongoing_filter_coalesces_missing_end() {
		$query = new \QueryHelperTestQuery(
			array(
				'fair_events_date_query' => array(
					'start_before' => '2026-06-01 00:00:00',
					'end_after'    => '2026-06-01 00:00:00',
				),
			)
		);

		$where = QueryHelper::filter_by_dates( '', $query );

		$this->assertStringContainsString( 'wp_fair_event_dates.start_datetime <= ', $where );
		$this->assertStringContainsString(
			'COALESCE( wp_fair_event_dates.end_datetime, wp_fair_event_dates.start_datetime ) >= ',
			$where
		);
	}

	/**
	 * The group_by_post() filter is a no-op when the block hasn't engaged the
	 * custom table query.
	 */
	public function test_groupby_is_unchanged_when_query_var_unset() {
		$query = new \QueryHelperTestQuery( array() );

		$this->assertSame( 'ORIGINAL', QueryHelper::group_by_post( 'ORIGINAL', $query ) );
	}

	/**
	 * The group_by_post() filter dedupes by post ID whenever the custom table
	 * query is engaged, so a post with several matching date rows isn't
	 * repeated.
	 */
	public function test_groupby_dedupes_by_post_id() {
		$query = new \QueryHelperTestQuery( array( 'fair_events_date_query' => true ) );

		$this->assertSame( 'wp_posts.ID', QueryHelper::group_by_post( '', $query ) );
	}

	/**
	 * The order_by_dates() filter is a no-op when no order was requested.
	 */
	public function test_orderby_is_unchanged_when_no_order() {
		$query = new \QueryHelperTestQuery( array() );

		$this->assertSame( 'ORIGINAL', QueryHelper::order_by_dates( 'ORIGINAL', $query ) );
	}

	/**
	 * Ascending order aggregates with MIN so group_by_post()'s GROUP BY stays
	 * valid under ONLY_FULL_GROUP_BY, picking each post's soonest occurrence.
	 */
	public function test_orderby_ascending_uses_min_aggregate() {
		$query = new \QueryHelperTestQuery( array( 'fair_events_order' => 'ASC' ) );

		$this->assertSame( 'MIN( wp_fair_event_dates.start_datetime ) ASC', QueryHelper::order_by_dates( '', $query ) );
	}

	/**
	 * Descending order ("past" filter) aggregates with MAX, picking each
	 * post's most recent occurrence.
	 */
	public function test_orderby_descending_uses_max_aggregate() {
		$query = new \QueryHelperTestQuery( array( 'fair_events_order' => 'DESC' ) );

		$this->assertSame( 'MAX( wp_fair_event_dates.start_datetime ) DESC', QueryHelper::order_by_dates( '', $query ) );
	}
}
