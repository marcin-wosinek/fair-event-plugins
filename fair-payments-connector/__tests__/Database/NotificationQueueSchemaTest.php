<?php
/**
 * NotificationQueueSchema tests
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\Database;

use PHPUnit\Framework\TestCase;
use FairPaymentsConnector\Database\NotificationQueueSchema;
use FairPaymentsConnector\Settings\NotificationSettings;

require_once __DIR__ . '/fixtures-query-recording-wpdb.php';

/**
 * Rows queued by the experimental plugin are adopted exactly once.
 */
class NotificationQueueSchemaTest extends TestCase {

	/**
	 * Recording $wpdb.
	 *
	 * @var QueryRecordingWPDB
	 */
	private $wpdb;

	/**
	 * The $wpdb installed before this test.
	 *
	 * @var object|null
	 */
	private $previous_wpdb;

	/**
	 * Install the fake $wpdb and reset options.
	 */
	protected function setUp(): void {
		$this->previous_wpdb           = $GLOBALS['wpdb'] ?? null;
		$this->wpdb                    = new QueryRecordingWPDB();
		$GLOBALS['wpdb']               = $this->wpdb; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- unit test installs a $wpdb double.
		$GLOBALS['_fair_test_options'] = array();
	}

	/**
	 * Restore the suite's $wpdb.
	 */
	protected function tearDown(): void {
		$GLOBALS['wpdb'] = $this->previous_wpdb; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- restores the suite's $wpdb double.
	}

	/**
	 * A fresh site has nothing to backfill and records the current version so
	 * the experimental plugin's own upgrade never runs.
	 */
	public function test_fresh_queue_records_the_version_without_touching_rows() {
		NotificationQueueSchema::adopt_legacy_queue();

		$this->assertSame( array(), $this->wpdb->queries );
		$this->assertSame( 2, $GLOBALS['_fair_test_options'][ NotificationQueueSchema::LEGACY_VERSION_OPTION ] );
	}

	/**
	 * A queue already at the experimental plugin's current version is left alone.
	 */
	public function test_current_experimental_queue_is_left_alone() {
		$GLOBALS['_fair_test_options'][ NotificationQueueSchema::LEGACY_VERSION_OPTION ] = 2;

		NotificationQueueSchema::adopt_legacy_queue();

		$this->assertSame( array(), $this->wpdb->queries );
	}

	/**
	 * Rows from the first experimental queue get a delivery state: sent rows
	 * become `sent`, unsent rows take their digest route's frequency.
	 */
	public function test_first_version_queue_is_backfilled_once() {
		$GLOBALS['_fair_test_options'][ NotificationQueueSchema::LEGACY_VERSION_OPTION ] = 1;
		$GLOBALS['_fair_test_options'][ NotificationSettings::ROUTES_OPTION ]            = array(
			array(
				'id'        => 'weekly-route',
				'frequency' => 'weekly',
			),
			array(
				'id'        => 'now-route',
				'frequency' => 'immediate',
			),
			array( 'frequency' => 'hourly' ),
		);

		NotificationQueueSchema::adopt_legacy_queue();

		$this->assertSame(
			array(
				array( 'UPDATE %i SET status = %s WHERE sent_at IS NOT NULL', 'wp_fair_payment_notification_queue', 'sent' ),
				array( 'UPDATE %i SET frequency = %s WHERE route_id = %s AND sent_at IS NULL', 'wp_fair_payment_notification_queue', 'weekly', 'weekly-route' ),
			),
			$this->wpdb->queries
		);
		$this->assertSame( 2, $GLOBALS['_fair_test_options'][ NotificationQueueSchema::LEGACY_VERSION_OPTION ] );

		NotificationQueueSchema::adopt_legacy_queue();

		$this->assertCount( 2, $this->wpdb->queries );
	}
}
