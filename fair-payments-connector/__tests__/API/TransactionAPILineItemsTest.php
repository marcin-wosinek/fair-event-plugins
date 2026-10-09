<?php
/**
 * Transaction API line-item and total tests.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\API;

use FairPaymentsConnector\API\TransactionAPI;
use PHPUnit\Framework\TestCase;

/**
 * TransactionAPI::create_transaction() charges the canonical total of its
 * line items, stores each line already rounded, and writes nothing when the
 * line items or a filtered total are refused.
 */
class TransactionAPILineItemsTest extends TestCase {

	/**
	 * The suite's $wpdb double, restored after each test.
	 *
	 * @var object|null
	 */
	private $previous_wpdb;

	/**
	 * Start each test with an empty $wpdb double and no filters.
	 */
	protected function setUp(): void {
		$this->previous_wpdb = $GLOBALS['wpdb'] ?? null;
		$GLOBALS['wpdb']     = new \Fair_Test_WPDB(); // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- unit test installs a $wpdb double.
		unset( $GLOBALS['_fair_test_filters'] );
	}

	/**
	 * Restore the suite's $wpdb double and drop the test's filters.
	 */
	protected function tearDown(): void {
		$GLOBALS['wpdb'] = $this->previous_wpdb; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- restores the suite's $wpdb double.
		unset( $GLOBALS['_fair_test_filters'] );
	}

	/**
	 * The transaction rows written during the test.
	 *
	 * @return array[]
	 */
	private function transactions(): array {
		return array_values(
			array_filter(
				$GLOBALS['wpdb']->inserted_rows,
				static function ( $row ) {
					return array_key_exists( 'access_token', $row );
				}
			)
		);
	}

	/**
	 * The line-item rows written during the test.
	 *
	 * @return array[]
	 */
	private function line_items(): array {
		return array_values(
			array_filter(
				$GLOBALS['wpdb']->inserted_rows,
				static function ( $row ) {
					return array_key_exists( 'unit_amount', $row );
				}
			)
		);
	}

	/**
	 * Assert that a call was refused with the given code and wrote nothing.
	 *
	 * @param string $code   Expected error code.
	 * @param mixed  $result What create_transaction() returned.
	 */
	private function assertRefused( $code, $result ): void {
		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( $code, $result->get_error_code() );
		$this->assertSame( array(), $this->transactions() );
		$this->assertSame( array(), $this->line_items() );
	}

	/**
	 * Ordinary two-decimal prices are charged and stored as they are.
	 */
	public function test_ordinary_prices_are_unchanged() {
		$result = TransactionAPI::create_transaction(
			array(
				array(
					'name'     => 'Ticket',
					'quantity' => 2,
					'amount'   => 12.5,
				),
				array(
					'name'   => 'Workshop',
					'amount' => '19.99',
				),
			)
		);

		$this->assertSame( 1, $result );
		$this->assertSame( 44.99, $this->transactions()[0]['amount'] );

		$lines = $this->line_items();
		$this->assertCount( 2, $lines );
		$this->assertSame( array( 2, 12.5, 25.0 ), array( $lines[0]['quantity'], $lines[0]['unit_amount'], $lines[0]['total_amount'] ) );
		$this->assertSame( array( 1, 19.99, 19.99 ), array( $lines[1]['quantity'], $lines[1]['unit_amount'], $lines[1]['total_amount'] ) );
	}

	/**
	 * Sub-cent prices are rounded per unit and per line before they are
	 * stored, and the transaction amount is the sum of the stored lines.
	 */
	public function test_stores_normalized_amounts_that_add_up_to_the_transaction() {
		TransactionAPI::create_transaction(
			array(
				array(
					'name'     => 'Ticket',
					'quantity' => 3,
					'amount'   => 10.005,
				),
				array(
					'name'   => 'Workshop',
					'amount' => 5.004,
				),
				array(
					'name'   => 'Fee',
					'amount' => 0.005,
				),
			)
		);

		$lines = $this->line_items();
		$this->assertSame( array( 10.01, 30.03 ), array( $lines[0]['unit_amount'], $lines[0]['total_amount'] ) );
		$this->assertSame( array( 5.0, 5.0 ), array( $lines[1]['unit_amount'], $lines[1]['total_amount'] ) );
		$this->assertSame( array( 0.01, 0.01 ), array( $lines[2]['unit_amount'], $lines[2]['total_amount'] ) );

		$this->assertSame( 35.04, $this->transactions()[0]['amount'] );
		$this->assertSame( 35.04, round( array_sum( array_column( $lines, 'total_amount' ) ), 2 ) );
	}

	/**
	 * A negative line is a discount; a zero line names something free.
	 */
	public function test_accepts_discount_and_zero_lines() {
		$result = TransactionAPI::create_transaction(
			array(
				array(
					'name'     => 'Ticket',
					'quantity' => 2,
					'amount'   => 10,
				),
				array(
					'name'   => 'Solidarity discount',
					'amount' => -5,
				),
				array(
					'name'   => 'Free workshop',
					'amount' => 0,
				),
			)
		);

		$this->assertSame( 1, $result );
		$this->assertSame( 15.0, $this->transactions()[0]['amount'] );
		$this->assertSame( array( 20.0, -5.0, 0.0 ), array_column( $this->line_items(), 'total_amount' ) );
	}

	/**
	 * A total with nothing to pay is not a transaction.
	 *
	 * @return array[]
	 */
	public function non_positive_totals(): array {
		return array(
			'exact cancellation' => array(
				array(
					array(
						'name'   => 'Ticket',
						'amount' => 10,
					),
					array(
						'name'   => 'Discount',
						'amount' => -10,
					),
				),
			),
			'rounds to zero'     => array(
				array(
					array(
						'name'   => 'Ticket',
						'amount' => 0.004,
					),
				),
			),
			'negative total'     => array(
				array(
					array(
						'name'   => 'Ticket',
						'amount' => 3,
					),
					array(
						'name'   => 'Discount',
						'amount' => -5,
					),
				),
			),
		);
	}

	/**
	 * Zero and negative totals are refused: nothing is written.
	 *
	 * @dataProvider non_positive_totals
	 *
	 * @param array[] $line_items Line items.
	 */
	public function test_refuses_non_positive_totals( $line_items ) {
		$this->assertRefused( 'invalid_transaction_total', TransactionAPI::create_transaction( $line_items ) );
	}

	/**
	 * Quantities that are not positive whole numbers.
	 *
	 * @return array[]
	 */
	public function invalid_quantities(): array {
		return array(
			'zero'         => array( 0 ),
			'negative'     => array( -1 ),
			'fractional'   => array( 1.5 ),
			'not a number' => array( 'two' ),
		);
	}

	/**
	 * A quantity is a positive whole number.
	 *
	 * @dataProvider invalid_quantities
	 *
	 * @param mixed $quantity Quantity to refuse.
	 */
	public function test_refuses_invalid_quantities( $quantity ) {
		$this->assertRefused(
			'invalid_line_item_quantity',
			TransactionAPI::create_transaction(
				array(
					array(
						'name'     => 'Ticket',
						'quantity' => $quantity,
						'amount'   => 10,
					),
				)
			)
		);
	}

	/**
	 * A whole number sent as a string or float is still a quantity.
	 */
	public function test_accepts_whole_number_quantities_of_any_type() {
		TransactionAPI::create_transaction(
			array(
				array(
					'name'     => 'Ticket',
					'quantity' => '2',
					'amount'   => 10,
				),
				array(
					'name'     => 'Workshop',
					'quantity' => 3.0,
					'amount'   => 1,
				),
			)
		);

		$this->assertSame( array( 2, 3 ), array_column( $this->line_items(), 'quantity' ) );
		$this->assertSame( 23.0, $this->transactions()[0]['amount'] );
	}

	/**
	 * Amounts that are not finite numbers.
	 *
	 * @return array[]
	 */
	public function invalid_amounts(): array {
		return array(
			'infinite'          => array( INF ),
			'negative infinite' => array( -INF ),
			'not a number'      => array( NAN ),
			'overflowing'       => array( '1e999' ),
			'text'              => array( 'ten' ),
			'missing'           => array( null ),
		);
	}

	/**
	 * An amount is a finite number.
	 *
	 * @dataProvider invalid_amounts
	 *
	 * @param mixed $amount Amount to refuse.
	 */
	public function test_refuses_non_finite_amounts( $amount ) {
		$this->assertRefused(
			'invalid_line_item_amount',
			TransactionAPI::create_transaction(
				array(
					array(
						'name'   => 'Ticket',
						'amount' => $amount,
					),
				)
			)
		);
	}

	/**
	 * Line items changed by the filter are what is charged and stored.
	 */
	public function test_filtered_line_items_are_charged_and_stored() {
		$GLOBALS['_fair_test_filters']['fair_payment_before_validate_line_items'] = static function ( $line_items ) {
			$line_items[] = array(
				'name'   => 'Discount',
				'amount' => -2.5,
			);
			return $line_items;
		};

		TransactionAPI::create_transaction(
			array(
				array(
					'name'   => 'Ticket',
					'amount' => 10,
				),
			)
		);

		$this->assertSame( 7.5, $this->transactions()[0]['amount'] );
		$this->assertSame( array( 10.0, -2.5 ), array_column( $this->line_items(), 'total_amount' ) );
	}

	/**
	 * Line items a filter made invalid are refused like any others.
	 */
	public function test_validates_line_items_again_after_the_filter() {
		$GLOBALS['_fair_test_filters']['fair_payment_before_validate_line_items'] = static function ( $line_items ) {
			$line_items[0]['quantity'] = 0;
			return $line_items;
		};

		$this->assertRefused(
			'invalid_line_item_quantity',
			TransactionAPI::create_transaction(
				array(
					array(
						'name'   => 'Ticket',
						'amount' => 10,
					),
				)
			)
		);
	}

	/**
	 * A total changed without changing the line items is refused.
	 */
	public function test_refuses_a_total_only_override() {
		$GLOBALS['_fair_test_filters']['fair_payment_calculated_total'] = static function ( $total ) {
			return $total - 1;
		};

		$this->assertRefused(
			'transaction_total_mismatch',
			TransactionAPI::create_transaction(
				array(
					array(
						'name'   => 'Ticket',
						'amount' => 10,
					),
				)
			)
		);
	}

	/**
	 * A total filter returning the same amount, even with float noise or as
	 * a string, changes nothing.
	 */
	public function test_accepts_a_total_filter_that_keeps_the_amount() {
		$GLOBALS['_fair_test_filters']['fair_payment_calculated_total'] = static function ( $total ) {
			return (string) ( $total + 0.001 );
		};

		$result = TransactionAPI::create_transaction(
			array(
				array(
					'name'   => 'Ticket',
					'amount' => 10,
				),
			)
		);

		$this->assertSame( 1, $result );
		$this->assertSame( 10.0, $this->transactions()[0]['amount'] );
	}

	/**
	 * The transaction filter may change metadata and other fields.
	 */
	public function test_transaction_filter_may_change_metadata() {
		$GLOBALS['_fair_test_filters']['fair_payment_before_create_transaction'] = static function ( $data ) {
			$data['metadata']['campaign'] = 'spring';
			$data['description']          = 'Changed';
			return $data;
		};

		$result = TransactionAPI::create_transaction(
			array(
				array(
					'name'   => 'Ticket',
					'amount' => 10,
				),
			),
			array( 'metadata' => array( 'source' => 'test' ) )
		);

		$this->assertSame( 1, $result );
		$transaction = $this->transactions()[0];
		$this->assertSame( 10.0, $transaction['amount'] );
		$this->assertSame( 'Changed', $transaction['description'] );
		$this->assertSame(
			array(
				'source'   => 'test',
				'campaign' => 'spring',
			),
			json_decode( $transaction['metadata'], true )
		);
	}

	/**
	 * The transaction filter may not change the amount.
	 */
	public function test_refuses_an_amount_changed_by_the_transaction_filter() {
		$GLOBALS['_fair_test_filters']['fair_payment_before_create_transaction'] = static function ( $data ) {
			$data['amount'] = 1;
			return $data;
		};

		$this->assertRefused(
			'transaction_total_mismatch',
			TransactionAPI::create_transaction(
				array(
					array(
						'name'   => 'Ticket',
						'amount' => 10,
					),
				)
			)
		);
	}

	/**
	 * The amount the caller decided on matches: the transaction is created.
	 */
	public function test_accepts_a_matching_expected_amount() {
		$result = TransactionAPI::create_transaction(
			array(
				array(
					'name'     => 'Ticket',
					'quantity' => 2,
					'amount'   => 10.005,
				),
			),
			array( 'expected_amount' => 20.02 )
		);

		$this->assertSame( 1, $result );
		$this->assertSame( 20.02, $this->transactions()[0]['amount'] );
	}

	/**
	 * The amount the caller decided on differs by a cent: refused.
	 */
	public function test_refuses_an_expected_amount_mismatch() {
		$this->assertRefused(
			'transaction_amount_mismatch',
			TransactionAPI::create_transaction(
				array(
					array(
						'name'     => 'Ticket',
						'quantity' => 2,
						'amount'   => 10.005,
					),
				),
				array( 'expected_amount' => 20.01 )
			)
		);
	}

	/**
	 * A filter changing the line items after the caller decided on an amount
	 * is refused rather than charged.
	 */
	public function test_refuses_filtered_line_items_that_miss_the_expected_amount() {
		$GLOBALS['_fair_test_filters']['fair_payment_before_validate_line_items'] = static function ( $line_items ) {
			$line_items[0]['amount'] = 12;
			return $line_items;
		};

		$this->assertRefused(
			'transaction_amount_mismatch',
			TransactionAPI::create_transaction(
				array(
					array(
						'name'   => 'Ticket',
						'amount' => 10,
					),
				),
				array( 'expected_amount' => 10 )
			)
		);
	}
}
