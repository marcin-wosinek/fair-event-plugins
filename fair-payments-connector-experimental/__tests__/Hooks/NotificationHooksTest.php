<?php
/**
 * NotificationHooks enqueue tests
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\Tests\Hooks;

use PHPUnit\Framework\TestCase;
use FairPaymentsConnectorExperimental\Hooks\NotificationHooks;
use FairPaymentsConnectorExperimental\Settings\Settings;

require_once __DIR__ . '/fixtures-insert-recording-wpdb.php';

/**
 * Paid transactions on digest routes are queued with the route's frequency,
 * amount, currency, destination and PII-filtered rendered text.
 */
class NotificationHooksTest extends TestCase {

	/**
	 * Recording $wpdb.
	 *
	 * @var InsertRecordingWPDB
	 */
	private $wpdb;

	/**
	 * Install the fake $wpdb and reset option/event state.
	 */
	protected function setUp(): void {
		$this->wpdb                          = new InsertRecordingWPDB();
		$GLOBALS['wpdb']                     = $this->wpdb; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- unit test installs a $wpdb double.
		$GLOBALS['_fair_test_options']       = array();
		$GLOBALS['_fair_test_single_events'] = array();
	}

	/**
	 * Restore global state.
	 */
	protected function tearDown(): void {
		unset( $GLOBALS['wpdb'] );
	}

	/**
	 * Configure notification routes.
	 *
	 * @param array[] $routes Route overrides; each is merged over a daily email route.
	 */
	private function set_routes( array $routes ): void {
		$GLOBALS['_fair_test_options'][ Settings::ROUTES_OPTION ] = array_map(
			function ( $route ) {
				return array_merge(
					array(
						'id'          => 'route-a',
						'enabled'     => true,
						'channel'     => 'email',
						'destination' => 'owner@example.test',
						'frequency'   => 'daily',
						'include_pii' => true,
					),
					$route
				);
			},
			$routes
		);
	}

	/**
	 * Fire the paid hook for a representative transaction.
	 */
	private function pay(): void {
		$transaction = (object) array(
			'id'         => 77,
			'amount'     => '45.00',
			'currency'   => 'EUR',
			'created_at' => '2026-09-20 10:00:00',
			'testmode'   => 0,
		);

		$hooks = new class() extends NotificationHooks {
			/**
			 * Add participant details the way fair-audience does through the filter.
			 *
			 * @param object $payment     Payment.
			 * @param object $transaction Transaction.
			 * @return array
			 */
			public function build_context( $payment, $transaction ) {
				return array_merge(
					parent::build_context( $payment, $transaction ),
					array(
						'participant_name'  => 'Jane Doe',
						'participant_email' => 'jane@example.test',
					)
				);
			}
		};

		$hooks->on_payment_paid( (object) array(), $transaction );
	}

	/**
	 * A daily route queues one row carrying everything the digest needs.
	 */
	public function test_daily_route_queues_a_row_with_its_delivery_snapshot() {
		$this->set_routes( array( array() ) );

		$this->pay();

		$this->assertCount( 1, $this->wpdb->inserts );
		list( $table, $row ) = $this->wpdb->inserts[0];
		$this->assertSame( 'wp_fair_payment_notification_queue', $table );
		$this->assertSame( 'route-a', $row['route_id'] );
		$this->assertSame( 'daily', $row['frequency'] );
		$this->assertSame( 'email', $row['channel'] );
		$this->assertSame( 'owner@example.test', $row['destination'] );
		$this->assertSame( '45.00', $row['amount'] );
		$this->assertSame( 'EUR', $row['currency'] );
		$this->assertSame( 'pending', $row['status'] );
		$this->assertArrayNotHasKey( 'sent_at', $row );
		$this->assertSame( array(), $GLOBALS['_fair_test_single_events'] );
	}

	/**
	 * Include PII on: the queued text carries the participant's full name.
	 */
	public function test_include_pii_writes_the_full_name() {
		$this->set_routes( array( array( 'include_pii' => true ) ) );

		$this->pay();

		$this->assertStringContainsString( 'Jane Doe', $this->wpdb->inserts[0][1]['rendered_text'] );
	}

	/**
	 * Include PII off: the queued text holds only the abbreviated name and no
	 * email address, so nothing sensitive is ever written to the queue.
	 */
	public function test_pii_disabled_route_queues_only_the_abbreviated_name() {
		$this->set_routes( array( array( 'include_pii' => false ) ) );

		$this->pay();

		$text = $this->wpdb->inserts[0][1]['rendered_text'];
		$this->assertStringContainsString( 'Jane D.', $text );
		$this->assertStringNotContainsString( 'Doe', $text );
		$this->assertStringNotContainsString( 'jane@example.test', $text );
		$this->assertStringContainsString( '45.00', $text );
	}

	/**
	 * Each digest route snapshots its own frequency; disabled and immediate
	 * routes queue nothing.
	 */
	public function test_each_route_snapshots_its_own_frequency() {
		$this->set_routes(
			array(
				array(
					'id'        => 'hourly-route',
					'frequency' => 'hourly',
				),
				array(
					'id'        => 'weekly-route',
					'frequency' => 'weekly',
				),
				array(
					'id'      => 'off-route',
					'enabled' => false,
				),
				array(
					'id'        => 'now-route',
					'frequency' => 'immediate',
				),
			)
		);

		$this->pay();

		$this->assertSame(
			array(
				'hourly-route' => 'hourly',
				'weekly-route' => 'weekly',
			),
			array_column( array_column( $this->wpdb->inserts, 1 ), 'frequency', 'route_id' )
		);
		$this->assertCount( 1, $GLOBALS['_fair_test_single_events'] );
	}

	/**
	 * A failed insert does not raise and does not stop the remaining routes.
	 */
	public function test_failed_insert_does_not_stop_other_routes() {
		$this->wpdb->fail = true;
		$this->set_routes(
			array(
				array( 'id' => 'first' ),
				array( 'id' => 'second' ),
			)
		);

		$this->pay();

		$this->assertCount( 2, $this->wpdb->inserts );
	}
}
