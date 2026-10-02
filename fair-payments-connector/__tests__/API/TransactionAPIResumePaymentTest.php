<?php
/**
 * Transaction API payment resumption tests.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\API;

use FairPaymentsConnector\API\TransactionAPI;
use PHPUnit\Framework\TestCase;

/**
 * TransactionAPI::resume_payment() must never start a second provider
 * payment for a transaction: it returns the open one, starts one only for a
 * transaction that has none, and refuses everything else.
 */
class TransactionAPIResumePaymentTest extends TestCase {

	/**
	 * The suite's $wpdb double, restored after each test.
	 *
	 * @var object|null
	 */
	private $previous_wpdb;

	/**
	 * Remember the suite's $wpdb double.
	 */
	protected function setUp(): void {
		$this->previous_wpdb = $GLOBALS['wpdb'] ?? null;
	}

	/**
	 * Restore the suite's $wpdb double.
	 */
	protected function tearDown(): void {
		$GLOBALS['wpdb'] = $this->previous_wpdb; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- restores the suite's $wpdb double.
	}

	/**
	 * Resume the payment of a transaction stored as the given row.
	 *
	 * @param array|null $row  Transaction columns, or null for no such transaction.
	 * @param array      $args Payment arguments.
	 * @return array|\WP_Error
	 */
	private function resume( $row, array $args = array() ) {
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- unit test installs a $wpdb double.
		$GLOBALS['wpdb'] = new class( $row ) {
			/**
			 * Table prefix.
			 *
			 * @var string
			 */
			public $prefix = 'wp_';

			/**
			 * The one transaction row every lookup resolves to.
			 *
			 * @var object|null
			 */
			private $row;

			/**
			 * Store the transaction row.
			 *
			 * @param array|null $row Transaction columns.
			 */
			public function __construct( $row ) {
				$this->row = null === $row ? null : (object) $row;
			}

			/**
			 * Stub of $wpdb->prepare().
			 *
			 * @param string $query Query.
			 * @return string
			 */
			public function prepare( $query ) {
				return $query;
			}

			/**
			 * Stub of $wpdb->get_row().
			 *
			 * @return object|null
			 */
			public function get_row() {
				return $this->row;
			}
		};

		return TransactionAPI::resume_payment( 77, $args );
	}

	/**
	 * A started, still open payment is returned as it is.
	 */
	public function test_returns_the_open_checkout_without_starting_another() {
		$result = $this->resume(
			array(
				'status'               => 'pending_payment',
				'mollie_payment_id'    => 'tr_open',
				'checkout_url'         => 'https://pay.example.test/tr_open',
				'payment_initiated_at' => '2035-01-01 10:00:00',
			)
		);

		$this->assertSame(
			array(
				'checkout_url'      => 'https://pay.example.test/tr_open',
				'mollie_payment_id' => 'tr_open',
				'status'            => 'pending_payment',
			),
			$result
		);
	}

	/**
	 * A payment that is over, or in flight at the bank, cannot be continued.
	 *
	 * @dataProvider closed_statuses
	 * @param string $status Transaction status.
	 */
	public function test_refuses_a_payment_that_is_over( $status ) {
		$result = $this->resume(
			array(
				'status'               => $status,
				'mollie_payment_id'    => 'tr_done',
				'checkout_url'         => 'https://pay.example.test/tr_done',
				'payment_initiated_at' => '2035-01-01 10:00:00',
			)
		);

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'payment_not_resumable', $result->get_error_code() );
		$this->assertSame( 409, $result->get_error_data()['status'] );
	}

	/**
	 * Statuses a payment cannot be continued from.
	 *
	 * @return array[]
	 */
	public static function closed_statuses() {
		return array(
			'paid'     => array( 'paid' ),
			'pending'  => array( 'pending' ),
			'failed'   => array( 'failed' ),
			'canceled' => array( 'canceled' ),
			'expired'  => array( 'expired' ),
		);
	}

	/**
	 * A started payment without a checkout link has nothing to return to.
	 */
	public function test_refuses_a_started_payment_without_a_checkout() {
		$result = $this->resume(
			array(
				'status'               => 'pending_payment',
				'mollie_payment_id'    => 'tr_lost',
				'checkout_url'         => '',
				'payment_initiated_at' => '2035-01-01 10:00:00',
			)
		);

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'payment_not_resumable', $result->get_error_code() );
	}

	/**
	 * A transaction whose payment never started goes through
	 * initiate_payment(), whose own validation answers here.
	 */
	public function test_starts_the_payment_of_a_transaction_that_has_none() {
		$result = $this->resume(
			array(
				'status'               => 'draft',
				'mollie_payment_id'    => '',
				'checkout_url'         => '',
				'payment_initiated_at' => null,
			)
		);

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'missing_redirect_url', $result->get_error_code() );
	}

	/**
	 * An unknown transaction is reported as such.
	 */
	public function test_reports_an_unknown_transaction() {
		$result = $this->resume( null );

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'transaction_not_found', $result->get_error_code() );
	}
}
