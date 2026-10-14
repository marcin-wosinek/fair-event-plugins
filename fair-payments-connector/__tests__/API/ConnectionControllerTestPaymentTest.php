<?php
/**
 * Test payment confirmation tests.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\API;

use FairPaymentsConnector\API\ConnectionController;
use PHPUnit\Framework\TestCase;

/**
 * A test payment in live mode is created only for the context the
 * administrator confirmed; anything else is refused before a transaction
 * exists (#1773).
 */
class ConnectionControllerTestPaymentTest extends TestCase {

	/**
	 * The suite's options and $wpdb double, restored after each test.
	 *
	 * @var array
	 */
	private $previous = array();

	/**
	 * Install a connected live-mode site whose $wpdb fails the test if a
	 * transaction is ever written.
	 */
	protected function setUp(): void {
		$this->previous = array(
			'options' => $GLOBALS['_fair_test_options'] ?? array(),
			'wpdb'    => $GLOBALS['wpdb'] ?? null,
		);

		$GLOBALS['_fair_test_options'] = array(
			'fair_payment_mollie_connected'  => true,
			'fair_payment_mode'              => 'live',
			'fair_payment_currency'          => 'PLN',
			'fair_payment_mollie_profile_id' => 'pfl_live',
			'fair_payment_organization_id'   => 'org_live',
		);

		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- unit test installs a $wpdb double.
		$GLOBALS['wpdb'] = new class() {
			/**
			 * Table prefix.
			 *
			 * @var string
			 */
			public $prefix = 'wp_';

			/**
			 * Any database call means a transaction is being created.
			 *
			 * @param string $name Method name.
			 * @param array  $args Arguments.
			 * @throws \LogicException Always.
			 */
			public function __call( $name, $args ) {
				throw new \LogicException( 'Unexpected database call: ' . esc_html( $name ) );
			}
		};
	}

	/**
	 * Restore the suite's options and $wpdb double.
	 */
	protected function tearDown(): void {
		$GLOBALS['_fair_test_options'] = $this->previous['options'];
		$GLOBALS['wpdb']               = $this->previous['wpdb']; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- restores the suite's $wpdb double.
	}

	/**
	 * The context the site currently confirms against.
	 *
	 * @return array
	 */
	private function current_context() {
		return array(
			'mode'            => 'live',
			'currency'        => 'PLN',
			'profile_id'      => 'pfl_live',
			'organization_id' => 'org_live',
		);
	}

	/**
	 * The preview reports the amount, currency, mode and account.
	 */
	public function test_context_reports_what_a_payment_would_use() {
		$response = ( new ConnectionController() )->get_test_payment_context();

		$this->assertSame( 200, $response->status );
		$this->assertSame( '1.00', $response->data['amount'] );
		$this->assertSame( 'PLN', $response->data['currency'] );
		$this->assertSame( 'live', $response->data['mode'] );
		$this->assertSame( 'pfl_live', $response->data['profile_id'] );
		$this->assertSame( 'org_live', $response->data['organization_id'] );
		$this->assertStringContainsString( 'PLN', $response->data['amount_display'] );
	}

	/**
	 * The preview refuses a site with no Mollie connection.
	 */
	public function test_context_requires_a_connection() {
		$GLOBALS['_fair_test_options']['fair_payment_mollie_connected'] = false;

		$result = ( new ConnectionController() )->get_test_payment_context();

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'not_connected', $result->get_error_code() );
	}

	/**
	 * A live payment without a confirmation is refused, with the current
	 * context for the dialog.
	 */
	public function test_live_payment_requires_a_confirmation() {
		$result = ( new ConnectionController() )->create_test_payment( new \WP_REST_Request() );

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'test_payment_confirmation_required', $result->get_error_code() );
		$this->assertSame( 409, $result->get_error_data()['status'] );
		$this->assertSame( 'PLN', $result->get_error_data()['context']['currency'] );
	}

	/**
	 * Each confirmed field that no longer matches refuses the payment.
	 *
	 * @dataProvider changed_fields
	 *
	 * @param string $field Field that changed since the confirmation.
	 * @param string $value Value the administrator confirmed.
	 */
	public function test_changed_context_is_refused( $field, $value ) {
		$confirmed           = $this->current_context();
		$confirmed[ $field ] = $value;

		$result = ( new ConnectionController() )->create_test_payment(
			new \WP_REST_Request( array( 'confirmed' => $confirmed ) )
		);

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'test_payment_context_changed', $result->get_error_code() );
		$this->assertSame( 409, $result->get_error_data()['status'] );
	}

	/**
	 * Fields a confirmation covers, each with an outdated value.
	 *
	 * @return array
	 */
	public static function changed_fields() {
		return array(
			'mode'         => array( 'mode', 'test' ),
			'currency'     => array( 'currency', 'EUR' ),
			'profile'      => array( 'profile_id', 'pfl_other' ),
			'organization' => array( 'organization_id', 'org_other' ),
		);
	}
}
