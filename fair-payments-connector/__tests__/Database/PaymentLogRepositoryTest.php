<?php
/**
 * PaymentLogRepository tests
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\Database;

use PHPUnit\Framework\TestCase;
use FairPaymentsConnector\Database\PaymentLogRepository;

require_once __DIR__ . '/fixtures-payment-log-wpdb.php';

/**
 * Pruning queries and the data kept on new log rows.
 */
class PaymentLogRepositoryTest extends TestCase {

	/**
	 * Recording $wpdb.
	 *
	 * @var PaymentLogWPDB
	 */
	private $wpdb;

	/**
	 * The $wpdb installed before this test.
	 *
	 * @var object|null
	 */
	private $previous_wpdb;

	/**
	 * Install the fake $wpdb.
	 */
	protected function setUp(): void {
		$this->previous_wpdb = $GLOBALS['wpdb'] ?? null;
		$this->wpdb          = new PaymentLogWPDB();
		$GLOBALS['wpdb']     = $this->wpdb; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- unit test installs a $wpdb double.
	}

	/**
	 * Restore the suite's $wpdb and the request.
	 */
	protected function tearDown(): void {
		$GLOBALS['wpdb'] = $this->previous_wpdb; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- restores the suite's $wpdb double.
		unset( $_SERVER['REMOTE_ADDR'] );
	}

	/**
	 * The only row written by the test.
	 *
	 * @return array
	 */
	private function logged_row() {
		$this->assertCount( 1, $this->wpdb->inserted_rows );
		return $this->wpdb->inserted_rows[0];
	}

	/**
	 * Pruning is one prepared, bounded, oldest-first delete whose cutoff comes
	 * from the database clock and keeps a row exactly at the cutoff.
	 */
	public function test_prune_runs_one_prepared_bounded_delete() {
		$this->wpdb->query_results = array( 3 );

		$deleted = ( new PaymentLogRepository() )->prune_older_than( 90, 500 );

		$this->assertSame( 3, $deleted );
		$this->assertSame(
			array(
				array(
					'DELETE FROM %i WHERE created_at < DATE_SUB( CURRENT_TIMESTAMP, INTERVAL %d DAY ) ORDER BY created_at ASC, id ASC LIMIT %d',
					'wp_fair_payment_log',
					90,
					500,
				),
			),
			$this->wpdb->queries
		);
	}

	/**
	 * The window and limit always reach the query as integers.
	 */
	public function test_prune_casts_window_and_limit_to_integers() {
		( new PaymentLogRepository() )->prune_older_than( '30', '10' );

		$this->assertSame( 30, $this->wpdb->queries[0][2] );
		$this->assertSame( 10, $this->wpdb->queries[0][3] );
	}

	/**
	 * A database error is reported as false, distinct from zero rows deleted,
	 * and pruning never writes to the payment log itself.
	 */
	public function test_prune_reports_database_failure_without_logging() {
		$this->wpdb->query_results = array( false );

		$repository = new PaymentLogRepository();

		$this->assertFalse( $repository->prune_older_than( 90, 500 ) );
		$this->assertSame( 0, $repository->prune_older_than( 90, 500 ) );
		$this->assertSame( array(), $this->wpdb->inserted_rows );
	}

	/**
	 * The client IP is never stored, for any level.
	 */
	public function test_log_omits_the_client_ip() {
		$_SERVER['REMOTE_ADDR'] = '203.0.113.7';

		( new PaymentLogRepository() )->log( 'webhook_failed', array( 'level' => 'error' ) );

		$row = $this->logged_row();
		$this->assertNull( $row['ip_address'] );
		$this->assertNotEmpty( $row['request_id'] );
	}

	/**
	 * Correlation and diagnostic fields survive; secrets, free text, nested
	 * payloads and unknown fields are dropped.
	 */
	public function test_log_keeps_only_allowlisted_context_fields() {
		( new PaymentLogRepository() )->log(
			'mollie_call_failed',
			array(
				'transaction_id' => 7,
				'level'          => 'error',
				'context'        => array(
					'mollie_payment_id' => 'tr_WDqYK6vllg',
					'post_id'           => '42',
					'amount'            => '10.50',
					'currency'          => 'EUR',
					'status'            => 'open',
					'testmode'          => true,
					'exception_class'   => 'Mollie\\Api\\Exceptions\\ApiException',
					'exception_message' => 'Error executing API call: Request body {"apiKey":"live_secret"}',
					'description'       => 'Ticket for Jane Doe',
					'checkout_url'      => 'https://www.mollie.com/checkout/abc?token=x',
					'access_token'      => 'access_secret',
					'headers'           => array( 'Authorization' => 'Bearer secret' ),
					'request'           => array( 'body' => array( 'nested' => 'secret' ) ),
				),
			)
		);

		$context = json_decode( $this->logged_row()['context'], true );

		$this->assertSame(
			array(
				'mollie_payment_id' => 'tr_WDqYK6vllg',
				'post_id'           => 42,
				'amount'            => 10.5,
				'currency'          => 'EUR',
				'status'            => 'open',
				'testmode'          => true,
				'exception_class'   => 'Mollie\\Api\\Exceptions\\ApiException',
			),
			$context
		);
		$this->assertStringNotContainsString( 'secret', $this->logged_row()['context'] );
	}

	/**
	 * Allowlisted fields with values of the wrong shape are dropped too.
	 */
	public function test_log_drops_allowlisted_fields_with_invalid_values() {
		( new PaymentLogRepository() )->log(
			'payment_creation_started',
			array(
				'context' => array(
					'post_id'           => 'abc',
					'amount'            => array( 'value' => '10.00' ),
					'currency'          => 'euro',
					'status'            => 'Paid <script>',
					'mollie_payment_id' => 'tr_1; DROP TABLE',
					'testmode'          => 'yes',
					'exception_class'   => 'Error: card 4111 declined',
					'user_id'           => 0,
				),
			)
		);

		$this->assertNull( $this->logged_row()['context'] );
	}

	/**
	 * Pre-encoded JSON strings are opaque and are not stored.
	 */
	public function test_log_drops_string_context() {
		( new PaymentLogRepository() )->log(
			'payment_creation_started',
			array( 'context' => '{"apiKey":"live_secret"}' )
		);

		$this->assertNull( $this->logged_row()['context'] );
	}

	/**
	 * The sanitizer is usable on its own and returns null for non-arrays.
	 */
	public function test_sanitize_context_handles_empty_input() {
		$this->assertNull( PaymentLogRepository::sanitize_context( null ) );
		$this->assertNull( PaymentLogRepository::sanitize_context( array() ) );
		$this->assertSame(
			array( 'reason' => 'mollie_not_configured' ),
			PaymentLogRepository::sanitize_context( array( 'reason' => 'mollie_not_configured' ) )
		);
	}
}
