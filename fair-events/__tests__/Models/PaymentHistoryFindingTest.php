<?php
/**
 * Payment history finding filter tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Models;

// The model needs a query-capturing wpdb double in the same file and swaps
// the WordPress database global for the duration of each test.
// phpcs:disable Generic.Files.OneObjectStructurePerFile.MultipleFound
// phpcs:disable WordPress.WP.GlobalVariablesOverride.Prohibited

use FairEvents\Models\PaymentHistoryFinding;
use PHPUnit\Framework\TestCase;

/**
 * Records the prepared queries and answers counts with zero.
 */
class Payment_History_Finding_WPDB {
	/**
	 * WordPress table prefix.
	 *
	 * @var string
	 */
	public $prefix = 'wp_';

	/**
	 * Prepared queries, in order.
	 *
	 * @var array[]
	 */
	public $prepared = array();

	/**
	 * Capture a prepared query.
	 *
	 * @param string $query   Query template.
	 * @param mixed  ...$args Query arguments, or one array of them.
	 * @return array Prepared query capture.
	 */
	public function prepare( $query, ...$args ) {
		if ( 1 === count( $args ) && is_array( $args[0] ) ) {
			$args = $args[0];
		}
		$capture          = array(
			'query' => $query,
			'args'  => $args,
		);
		$this->prepared[] = $capture;
		return $capture;
	}

	/**
	 * A count.
	 *
	 * @return string
	 */
	public function get_var() {
		return '0';
	}

	/**
	 * Rows.
	 *
	 * @return array
	 */
	public function get_results() {
		return array();
	}
}

/**
 * The transaction filters (#2219) leave findings alone under "All" and match
 * nothing while Connector's transactions can't be read.
 */
class PaymentHistoryFindingTest extends TestCase {

	/**
	 * Database double used by the test.
	 *
	 * @var Payment_History_Finding_WPDB
	 */
	private $wpdb;

	/**
	 * Database global before the test.
	 *
	 * @var mixed
	 */
	private $original_wpdb;

	/**
	 * Swap in the database double.
	 */
	protected function setUp(): void {
		parent::setUp();
		$this->original_wpdb = $GLOBALS['wpdb'] ?? null;
		$this->wpdb          = new Payment_History_Finding_WPDB();
		$GLOBALS['wpdb']     = $this->wpdb;
	}

	/**
	 * Restore the database global.
	 */
	protected function tearDown(): void {
		$GLOBALS['wpdb'] = $this->original_wpdb;
		parent::tearDown();
	}

	/**
	 * Under "All" the count adds no transaction condition, so findings
	 * without an identifiable transaction stay listed.
	 */
	public function test_all_adds_no_transaction_condition(): void {
		PaymentHistoryFinding::count(
			PaymentHistoryFinding::MODE_BACKFILL,
			array(
				'transaction_statuses' => array(),
				'payment_mode'         => PaymentHistoryFinding::FILTER_ALL,
			)
		);

		$this->assertCount( 1, $this->wpdb->prepared );
		$this->assertStringNotContainsString( 'EXISTS', $this->wpdb->prepared[0]['query'] );
		$this->assertStringNotContainsString( '1 = 0', $this->wpdb->prepared[0]['query'] );
	}

	/**
	 * An active filter matches nothing without Connector, and never queries
	 * its storage.
	 */
	public function test_active_filters_match_nothing_without_connector(): void {
		foreach ( array(
			array( 'transaction_statuses' => array( 'canceled' ) ),
			array( 'transaction_statuses' => array( 'open', 'pending_payment' ) ),
			array( 'payment_mode' => PaymentHistoryFinding::PAYMENT_MODE_TEST ),
			array(
				'payment_mode'         => PaymentHistoryFinding::PAYMENT_MODE_LIVE,
				'transaction_statuses' => array( 'expired' ),
			),
		) as $filters ) {
			$this->wpdb->prepared = array();
			PaymentHistoryFinding::count( PaymentHistoryFinding::MODE_BACKFILL, $filters );
			PaymentHistoryFinding::query( PaymentHistoryFinding::MODE_BACKFILL, $filters );

			$this->assertCount( 2, $this->wpdb->prepared );
			foreach ( $this->wpdb->prepared as $prepared ) {
				$this->assertStringContainsString( '1 = 0', $prepared['query'], wp_json_encode( $filters ) );
				$this->assertStringNotContainsString( 'EXISTS', $prepared['query'] );
			}
		}
	}
}
