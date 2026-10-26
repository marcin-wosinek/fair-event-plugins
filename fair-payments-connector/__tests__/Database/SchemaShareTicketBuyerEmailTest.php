<?php
/**
 * Tests for the initial value of the ticket buyer email disclosure setting.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\Database;

use FairPaymentsConnector\Database\Schema;
use FairPaymentsConnector\Settings\Settings;
use PHPUnit\Framework\TestCase;

/**
 * Schema::migrate_to_v30() sets the setting once, from local evidence that
 * ticket payments already sent buyer emails.
 */
class SchemaShareTicketBuyerEmailTest extends TestCase {

	/**
	 * The shared fake $wpdb, restored after each test.
	 *
	 * @var object
	 */
	private $original_wpdb;

	/**
	 * Install a $wpdb fake returning the given metadata rows.
	 *
	 * @param string[] $rows Transaction metadata JSON.
	 * @return object The fake, recording its queries.
	 */
	private function install_wpdb( array $rows ) {
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- test-only fake.
		$GLOBALS['wpdb'] = new class( $rows ) {
			/**
			 * Table prefix.
			 *
			 * @var string
			 */
			public $prefix = 'wp_';

			/**
			 * Queries run through get_col().
			 *
			 * @var string[]
			 */
			public $queries = array();

			/**
			 * Rows get_col() returns.
			 *
			 * @var string[]
			 */
			private $rows;

			/**
			 * Constructor.
			 *
			 * @param string[] $rows Rows to return.
			 */
			public function __construct( array $rows ) {
				$this->rows = $rows;
			}

			/**
			 * Join the query and its arguments for inspection.
			 *
			 * @param string $query   Query.
			 * @param mixed  ...$args Arguments.
			 * @return string
			 */
			public function prepare( $query, ...$args ) {
				return $query . ' | ' . implode( ' | ', $args );
			}

			/**
			 * Pass-through, like core for strings without wildcards.
			 *
			 * @param string $text Text.
			 * @return string
			 */
			public function esc_like( $text ) {
				return $text;
			}

			/**
			 * Record the query and return the configured rows.
			 *
			 * @param string $query Prepared query.
			 * @return string[]
			 */
			public function get_col( $query ) {
				$this->queries[] = $query;
				return $this->rows;
			}
		};

		return $GLOBALS['wpdb'];
	}

	/**
	 * Start from a site at schema v29 with no disclosure setting.
	 */
	protected function setUp(): void {
		$this->original_wpdb = $GLOBALS['wpdb'];
		unset( $GLOBALS['_fair_test_options'][ Settings::SHARE_TICKET_BUYER_EMAIL ] );
		$GLOBALS['_fair_test_options']['fair_payment_db_version'] = '29.0';
	}

	/**
	 * Restore the shared fake and options.
	 */
	protected function tearDown(): void {
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- restoring the test-only fake.
		$GLOBALS['wpdb'] = $this->original_wpdb;
		unset(
			$GLOBALS['_fair_test_options'][ Settings::SHARE_TICKET_BUYER_EMAIL ],
			$GLOBALS['_fair_test_options']['fair_payment_db_version']
		);
	}

	/**
	 * A site whose ticket transactions carry buyer emails keeps sending them.
	 */
	public function test_enables_sharing_when_ticket_transactions_hold_buyer_emails() {
		$this->install_wpdb(
			array(
				wp_json_encode(
					array(
						'source' => 'fair-events-get-tickets',
						'email'  => 'buyer@example.test',
					)
				),
			)
		);

		Schema::migrate_to_v30();

		$this->assertTrue( Settings::shares_ticket_buyer_email() );
	}

	/**
	 * Without that evidence (a new or ticketless site), sharing starts off.
	 */
	public function test_disables_sharing_without_evidence() {
		$wpdb = $this->install_wpdb( array() );

		Schema::migrate_to_v30();

		$this->assertSame( '0', $GLOBALS['_fair_test_options'][ Settings::SHARE_TICKET_BUYER_EMAIL ] );
		$this->assertFalse( Settings::shares_ticket_buyer_email() );
		$this->assertStringContainsString( '"source":"fair-events-get-tickets"', $wpdb->queries[0] );
	}

	/**
	 * Rows that only look alike (an empty email, another source) are no
	 * evidence.
	 */
	public function test_ignores_rows_without_a_ticket_buyer_email() {
		$this->install_wpdb(
			array(
				wp_json_encode(
					array(
						'source' => 'fair-events-get-tickets',
						'note'   => '"email":"x"',
					)
				),
				wp_json_encode(
					array(
						'source' => 'fair-audience-signup',
						'email'  => 'member@example.test',
						'origin' => '"source":"fair-events-get-tickets"',
					)
				),
			)
		);

		Schema::migrate_to_v30();

		$this->assertFalse( Settings::shares_ticket_buyer_email() );
	}

	/**
	 * An explicit choice is never overwritten, and nothing is scanned.
	 */
	public function test_preserves_an_existing_setting() {
		$GLOBALS['_fair_test_options'][ Settings::SHARE_TICKET_BUYER_EMAIL ] = '';
		$wpdb = $this->install_wpdb(
			array(
				wp_json_encode(
					array(
						'source' => 'fair-events-get-tickets',
						'email'  => 'buyer@example.test',
					)
				),
			)
		);

		Schema::migrate_to_v30();

		$this->assertSame( '', $GLOBALS['_fair_test_options'][ Settings::SHARE_TICKET_BUYER_EMAIL ] );
		$this->assertSame( array(), $wpdb->queries );
	}

	/**
	 * A site already at v30 is not scanned again.
	 */
	public function test_runs_only_once() {
		$GLOBALS['_fair_test_options']['fair_payment_db_version'] = '30.0';
		$wpdb = $this->install_wpdb( array() );

		Schema::migrate_to_v30();

		$this->assertArrayNotHasKey( Settings::SHARE_TICKET_BUYER_EMAIL, $GLOBALS['_fair_test_options'] );
		$this->assertSame( array(), $wpdb->queries );
	}
}
