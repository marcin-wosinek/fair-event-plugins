<?php
/**
 * Payment link writer, reader and compatibility tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

// The services need a small link-table double in the same file, and swap the
// WordPress database global for the duration of each test.
// phpcs:disable Generic.Files.OneObjectStructurePerFile.MultipleFound
// phpcs:disable WordPress.WP.GlobalVariablesOverride.Prohibited

use FairEvents\Database\Schema;
use FairEvents\Services\PaymentHistoryCompatibility;
use FairEvents\Services\PaymentLinks;
use PHPUnit\Framework\Attributes\PreserveGlobalState;
use PHPUnit\Framework\Attributes\RunInSeparateProcess;
use PHPUnit\Framework\TestCase;

if ( ! defined( 'ARRAY_A' ) ) {
	define( 'ARRAY_A', 'ARRAY_A' );
}

/**
 * Keeps payment link rows, existing tables and signups, and records the
 * statements the services run.
 */
class Payment_Links_WPDB {

	/**
	 * Table prefix.
	 *
	 * @var string
	 */
	public $prefix = 'wp_';

	/**
	 * Tables SHOW TABLES finds.
	 *
	 * @var string[]
	 */
	public $tables = array( 'wp_fair_events_signup_payment_links', 'wp_fair_payment_transactions' );

	/**
	 * Committed link rows.
	 *
	 * @var array[]
	 */
	public $links = array();

	/**
	 * Rows inserted in the open transaction.
	 *
	 * @var array[]
	 */
	private $pending = array();

	/**
	 * Existing signup IDs.
	 *
	 * @var int[]
	 */
	public $signup_ids = array( 5, 6, 7 );

	/**
	 * Insert number (1-based) that fails, or 0.
	 *
	 * @var int
	 */
	public $fail_insert = 0;

	/**
	 * Whether GET_LOCK succeeds.
	 *
	 * @var bool
	 */
	public $lock_available = true;

	/**
	 * Statements run, in order: locks and transaction control.
	 *
	 * @var string[]
	 */
	public $statements = array();

	/**
	 * Inserts attempted.
	 *
	 * @var int
	 */
	private $inserts = 0;

	/**
	 * Escape LIKE wildcards.
	 *
	 * @param string $text Text.
	 * @return string
	 */
	public function esc_like( $text ) {
		return addcslashes( $text, '_%\\' );
	}

	/**
	 * Capture a prepared query.
	 *
	 * @param string $query   Query template.
	 * @param mixed  ...$args Arguments.
	 * @return array
	 */
	public function prepare( $query, ...$args ) {
		if ( isset( $args[0] ) && is_array( $args[0] ) ) {
			$args = $args[0];
		}
		return array(
			'query' => $query,
			'args'  => $args,
		);
	}

	/**
	 * Locks and table checks.
	 *
	 * @param array $prepared Prepared query.
	 * @return string|null
	 */
	public function get_var( $prepared ) {
		if ( 0 === strpos( $prepared['query'], 'SELECT GET_LOCK' ) ) {
			$this->statements[] = 'GET_LOCK ' . $prepared['args'][0];
			return $this->lock_available ? '1' : '0';
		}
		if ( 0 === strpos( $prepared['query'], 'SELECT RELEASE_LOCK' ) ) {
			$this->statements[] = 'RELEASE_LOCK ' . $prepared['args'][0];
			return '1';
		}
		if ( 0 === strpos( $prepared['query'], 'SHOW TABLES LIKE' ) ) {
			$table = stripslashes( $prepared['args'][0] );
			return in_array( $table, $this->tables, true ) ? $table : null;
		}
		return null;
	}

	/**
	 * Links by transaction or signup.
	 *
	 * @param array $prepared Prepared query.
	 * @return array[]
	 */
	public function get_results( $prepared ) {
		$column = false !== strpos( $prepared['query'], 'WHERE transaction_id' ) ? 'transaction_id' : 'signup_id';
		return array_values(
			array_filter(
				array_merge( $this->links, $this->pending ),
				static function ( $row ) use ( $prepared, $column ) {
					return (int) $row[ $column ] === (int) $prepared['args'][1];
				}
			)
		);
	}

	/**
	 * Existing signup IDs among those asked for.
	 *
	 * @param array $prepared Prepared query.
	 * @return string[]
	 */
	public function get_col( $prepared ) {
		return array_map( 'strval', array_values( array_intersect( array_map( 'intval', array_slice( $prepared['args'], 1 ) ), $this->signup_ids ) ) );
	}

	/**
	 * Transaction control.
	 *
	 * @param string $sql Statement.
	 * @return int
	 */
	public function query( $sql ) {
		$this->statements[] = $sql;
		if ( 'COMMIT' === $sql ) {
			$this->links   = array_merge( $this->links, $this->pending );
			$this->pending = array();
		} elseif ( 'ROLLBACK' === $sql ) {
			$this->pending = array();
		}
		return 0;
	}

	/**
	 * Insert a link inside the open transaction.
	 *
	 * @param string $table  Table.
	 * @param array  $data   Row.
	 * @param array  $format Formats.
	 * @return int|false
	 */
	public function insert( $table, $data, $format = array() ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed -- wpdb signature.
		++$this->inserts;
		if ( $this->inserts === $this->fail_insert ) {
			return false;
		}
		$this->pending[] = array( 'id' => (string) ( count( $this->links ) + count( $this->pending ) + 1 ) ) + array_map( 'strval', $data );
		return 1;
	}
}

/**
 * Covers PaymentLinks and PaymentHistoryCompatibility.
 */
class PaymentLinksTest extends TestCase {

	/**
	 * Database double.
	 *
	 * @var Payment_Links_WPDB
	 */
	private $db;

	/**
	 * Install the double at the schema version with payment links.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		parent::setUp();
		$this->db                           = new Payment_Links_WPDB();
		$GLOBALS['wpdb']                    = $this->db;
		$GLOBALS['_fair_test_options']      = array( 'fair_events_db_version' => Schema::DB_VERSION );
		$GLOBALS['_fair_test_transactions'] = array(
			77 => array(
				'id'         => 77,
				'amount'     => '36.00',
				'currency'   => 'EUR',
				'status'     => 'paid',
				'created_at' => '2026-10-01 12:00:00',
			),
		);
		PaymentHistoryCompatibility::reset_cache();
	}

	/**
	 * Restore the shared double.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		$GLOBALS['wpdb']               = new \Fair_Test_WPDB();
		$GLOBALS['_fair_test_options'] = array();
		unset( $GLOBALS['_fair_test_transactions'] );
		PaymentHistoryCompatibility::reset_cache();
		parent::tearDown();
	}

	/**
	 * Load an active Connector.
	 *
	 * @return void
	 */
	private static function activate_connector() {
		require_once __DIR__ . '/fakes/payments-connector/transaction.php';
		require_once __DIR__ . '/fakes/payments-connector/schema.php';
	}

	/**
	 * A link for signup $signup_id.
	 *
	 * @param int   $signup_id Signup ID.
	 * @param float $amount    Allocation.
	 * @return array
	 */
	private static function link( $signup_id, $amount ) {
		return array(
			'signup_id'        => $signup_id,
			'role'             => 'charge',
			'allocated_amount' => $amount,
			'attribution'      => 'backfill',
			'evidence'         => array(
				'type'       => 'metadata_signup_ids',
				'signup_ids' => array( 5, 6, 7 ),
			),
		);
	}

	/**
	 * A shared transaction's set is written in one locked transaction, and
	 * repeating it is a no-op.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_writes_set_atomically_under_lock_and_repeats_as_no_op() {
		self::activate_connector();
		$set = array( self::link( 5, 12 ), self::link( 6, 12 ), self::link( 7, 12 ) );

		$result = PaymentLinks::write( 77, $set );

		$this->assertSame( 3, $result['inserted'] );
		$this->assertSame( 0, $result['unchanged'] );
		$this->assertSame(
			array( 'GET_LOCK wp_fair_events_payment_links_77', 'START TRANSACTION', 'COMMIT', 'RELEASE_LOCK wp_fair_events_payment_links_77' ),
			$this->db->statements
		);
		$this->assertSame( '12.00', $this->db->links[0]['allocated_amount'] );
		$this->assertSame( 'EUR', $this->db->links[0]['currency'] );
		$this->assertSame( '2026-10-01 12:00:00', $this->db->links[0]['created_at'] );

		$again = PaymentLinks::write( 77, $set );
		$this->assertSame( 0, $again['inserted'] );
		$this->assertSame( 3, $again['unchanged'] );
		$this->assertCount( 3, $this->db->links );
	}

	/**
	 * When one insert fails, the links inserted before it are rolled back
	 * and the lock is still released.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_failed_insert_rolls_back_whole_set() {
		self::activate_connector();
		$this->db->fail_insert = 2;

		$result = PaymentLinks::write( 77, array( self::link( 5, 12 ), self::link( 6, 12 ) ) );

		$this->assertSame( 'payment_link_write_failed', $result->get_error_code() );
		$this->assertSame( array(), $this->db->links );
		$this->assertSame( array( 'GET_LOCK wp_fair_events_payment_links_77', 'START TRANSACTION', 'ROLLBACK', 'RELEASE_LOCK wp_fair_events_payment_links_77' ), $this->db->statements );
	}

	/**
	 * A set exceeding the total, a conflict or an unknown purchase writes
	 * nothing.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_refused_sets_write_nothing() {
		self::activate_connector();
		PaymentLinks::write( 77, array( self::link( 5, 30 ) ) );

		$this->assertSame( 'allocation_exceeds_total', PaymentLinks::write( 77, array( self::link( 6, 6.01 ) ) )->get_error_code() );
		$this->assertSame( 'payment_link_conflict', PaymentLinks::write( 77, array( self::link( 6, 1 ), self::link( 5, 29 ) ) )->get_error_code() );
		$this->assertSame( 'payment_link_unknown_purchase', PaymentLinks::write( 77, array( self::link( 99, 1 ) ) )->get_error_code() );
		$this->assertCount( 1, $this->db->links );
		$this->assertSame( 'ROLLBACK', $this->db->statements[ count( $this->db->statements ) - 2 ] );
	}

	/**
	 * A writer that can't get the lock writes nothing.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_busy_lock_writes_nothing() {
		self::activate_connector();
		$this->db->lock_available = false;

		$this->assertSame( 'payment_links_busy', PaymentLinks::write( 77, array( self::link( 5, 1 ) ) )->get_error_code() );
		$this->assertSame( array( 'GET_LOCK wp_fair_events_payment_links_77' ), $this->db->statements );
	}

	/**
	 * Without Connector, or for a deleted transaction, nothing is written,
	 * and the outcome says why.
	 *
	 * @return void
	 */
	public function test_unavailable_connector_or_missing_transaction_is_explicit() {
		$this->assertSame( 'payment_information_unavailable', PaymentLinks::write( 77, array( self::link( 5, 1 ) ) )->get_error_code() );
		$this->assertSame( array(), $this->db->links );
	}

	/**
	 * A deleted transaction is reported as missing.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_missing_transaction_is_explicit() {
		self::activate_connector();

		$this->assertSame( 'missing_transaction', PaymentLinks::write( 78, array( self::link( 5, 1 ) ) )->get_error_code() );
	}

	/**
	 * Before the 3.49.0 schema, nothing is written.
	 *
	 * @return void
	 */
	public function test_storage_before_upgrade_is_unavailable() {
		$GLOBALS['_fair_test_options']['fair_events_db_version'] = '3.48.0';

		$this->assertFalse( PaymentHistoryCompatibility::storage_available() );
		$this->assertSame( 'payment_links_unavailable', PaymentLinks::write_in_transaction( 77, array( self::link( 5, 1 ) ) )->get_error_code() );

		$GLOBALS['_fair_test_options']['fair_events_db_version'] = Schema::DB_VERSION;
		$this->db->tables                                        = array();
		$this->assertFalse( PaymentHistoryCompatibility::storage_available() );
	}

	/**
	 * Links survive a deleted transaction and an inactive Connector; the
	 * reader says the state instead of reporting zero.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_reader_reports_missing_and_unavailable_transactions() {
		self::activate_connector();
		PaymentLinks::write( 77, array( self::link( 5, 30 ) ) );
		$GLOBALS['_fair_test_transactions'][79] = array(
			'id'         => 79,
			'amount'     => '5.00',
			'currency'   => 'EUR',
			'status'     => 'failed',
			'created_at' => '2026-10-02 12:00:00',
		);
		PaymentLinks::write( 79, array( self::link( 5, 5 ) ) );
		unset( $GLOBALS['_fair_test_transactions'][77] );

		$history = PaymentLinks::get_for_signup( 5 );
		$this->assertSame( 'available', $history['payment_information'] );
		$this->assertCount( 2, $history['links'] );
		$this->assertTrue( $history['links'][0]['transaction_missing'] );
		$this->assertNull( $history['links'][0]['transaction'] );
		$this->assertFalse( $history['links'][1]['transaction_missing'] );
		$this->assertSame( 'failed', $history['links'][1]['transaction']['status'] );

		$this->db->tables = array( 'wp_fair_events_signup_payment_links' );
		$history          = PaymentLinks::get_for_signup( 5 );
		$this->assertSame( 'unavailable', $history['payment_information'] );
		$this->assertCount( 2, $history['links'] );
		$this->assertNull( $history['links'][1]['transaction'] );
	}

	/**
	 * Storage exists but authority stays unchanged.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_capabilities_keep_authority_unchanged_in_stage_two() {
		self::activate_connector();

		$this->assertTrue( PaymentHistoryCompatibility::storage_available() );
		$this->assertTrue( PaymentHistoryCompatibility::purchase_provenance_available() );
		$this->assertTrue( PaymentHistoryCompatibility::payment_information_available() );
		$this->assertFalse( PaymentHistoryCompatibility::migration_verified() );
		$this->assertFalse( PaymentHistoryCompatibility::ownership_cutover() );
		$this->assertTrue( PaymentHistoryCompatibility::audience_compatible() );

		$GLOBALS['_fair_test_options'][ PaymentHistoryCompatibility::STATE_OPTION ] = array( 'status' => 'verified' );
		$this->assertTrue( PaymentHistoryCompatibility::migration_verified() );
		$this->assertFalse( PaymentHistoryCompatibility::ownership_cutover() );
	}

	/**
	 * The cutover is on only once an activation is recorded, and a later
	 * verification failure doesn't turn it off: authority never moves back
	 * to the ledger (§8.5). Without the storage it relies on it is off.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_cutover_follows_the_recorded_activation_only() {
		self::activate_connector();
		$option = PaymentHistoryCompatibility::STATE_OPTION;

		$GLOBALS['_fair_test_options'][ $option ]                                     = array( 'status' => 'verified' );
		$GLOBALS['_fair_test_options'][ PaymentHistoryCompatibility::CUTOVER_OPTION ] = array();
		$this->assertFalse( PaymentHistoryCompatibility::ownership_cutover() );

		// An entry in the migration's state, which other writers rewrite, isn't an activation.
		$GLOBALS['_fair_test_options'][ $option ]['cutover'] = array( 'activated_at' => '2026-11-07 10:00:00' );
		$this->assertFalse( PaymentHistoryCompatibility::ownership_cutover() );

		$GLOBALS['_fair_test_options'][ PaymentHistoryCompatibility::CUTOVER_OPTION ] = array(
			'activated_at' => '2026-11-07 10:00:00',
			'user_id'      => 1,
		);
		$this->assertTrue( PaymentHistoryCompatibility::ownership_cutover() );

		$GLOBALS['_fair_test_options'][ $option ]['status'] = 'verification_failed';
		$this->assertFalse( PaymentHistoryCompatibility::migration_verified() );
		$this->assertTrue( PaymentHistoryCompatibility::ownership_cutover() );

		$GLOBALS['_fair_test_options']['fair_events_db_version'] = PaymentHistoryCompatibility::STORAGE_DB_VERSION;
		$this->assertFalse( PaymentHistoryCompatibility::ownership_cutover() );
	}

	/**
	 * Reconciliation needs the 3.52.0 audit on top of the backfill's tables.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_reconciliation_needs_its_audit_schema() {
		self::activate_connector();

		$this->assertTrue( PaymentHistoryCompatibility::reconciliation_available() );

		$GLOBALS['_fair_test_options']['fair_events_db_version'] = '3.51.0';
		PaymentHistoryCompatibility::reset_cache();
		$this->assertFalse( PaymentHistoryCompatibility::reconciliation_available() );
	}

	/**
	 * A Fair Audience that skips provenance admissions but still counts their
	 * participant-scope activities would count a shadow purchase's
	 * activities twice, so it isn't compatible.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_stage_two_audience_is_incompatible() {
		require_once __DIR__ . '/fakes/fair-audience/repository-provenance-admissions-only.php';

		$this->assertFalse( PaymentHistoryCompatibility::audience_compatible() );
	}

	/**
	 * An older Fair Audience, without the provenance-aware filter, isn't
	 * compatible.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_older_audience_is_incompatible() {
		require_once __DIR__ . '/fakes/fair-audience/repository-without-provenance.php';

		$this->assertFalse( PaymentHistoryCompatibility::audience_compatible() );
	}

	/**
	 * A newer Fair Audience is compatible.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_newer_audience_is_compatible() {
		require_once __DIR__ . '/fakes/fair-audience/repository-with-provenance.php';

		$this->assertTrue( PaymentHistoryCompatibility::audience_compatible() );
	}
}
