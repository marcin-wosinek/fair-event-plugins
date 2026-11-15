<?php
/**
 * Supported upgrade path tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

// The stored-data check needs a scripted database double in this file, and
// swaps the WordPress database global for the duration of each such test.
// phpcs:disable Generic.Files.OneObjectStructurePerFile.MultipleFound
// phpcs:disable WordPress.WP.GlobalVariablesOverride.Prohibited

use FairEvents\Services\PaymentHistoryUpgrade;
use PHPUnit\Framework\TestCase;

/**
 * Scripted database for PaymentHistoryUpgrade::source_history(): which
 * tables and columns exist, what each COUNT returns and which reads fail.
 */
class Source_History_WPDB {

	/**
	 * Table prefix.
	 *
	 * @var string
	 */
	public $prefix = 'wp_';

	/**
	 * Error of the last query, as wpdb reports it.
	 *
	 * @var string
	 */
	public $last_error = '';

	/**
	 * Existing tables (without prefix) and their columns; null means every column.
	 *
	 * @var array<string, string[]|null>
	 */
	public $tables = array();

	/**
	 * COUNT results by table (without prefix).
	 *
	 * @var array<string, int>
	 */
	public $counts = array();

	/**
	 * Tables (without prefix) whose COUNT fails.
	 *
	 * @var string[]
	 */
	public $failing = array();

	/**
	 * Whether SHOW TABLES itself fails.
	 *
	 * @var bool
	 */
	public $show_tables_fails = false;

	/**
	 * Every COUNT query run, in order.
	 *
	 * @var array<int, array{query: string, args: array}>
	 */
	public $counted = array();

	/**
	 * Capture a prepared query.
	 *
	 * @param string $query Query template.
	 * @param mixed  ...$args Arguments.
	 * @return array
	 */
	public function prepare( $query, ...$args ) {
		return array(
			'query' => $query,
			'args'  => $args,
		);
	}

	/**
	 * LIKE escaping is irrelevant here.
	 *
	 * @param string $text Text.
	 * @return string
	 */
	public function esc_like( $text ) {
		return $text;
	}

	/**
	 * Table name without the prefix.
	 *
	 * @param string $table Table name.
	 * @return string
	 */
	private function short( $table ) {
		return substr( (string) $table, strlen( $this->prefix ) );
	}

	/**
	 * SHOW TABLES and COUNT queries.
	 *
	 * @param array $prepared From prepare().
	 * @return string|null
	 */
	public function get_var( $prepared ) {
		$this->last_error = '';
		if ( str_starts_with( $prepared['query'], 'SHOW TABLES' ) ) {
			if ( $this->show_tables_fails ) {
				$this->last_error = 'Lost connection';
				return null;
			}
			return array_key_exists( $this->short( $prepared['args'][0] ), $this->tables ) ? $prepared['args'][0] : null;
		}

		$table = $this->short( $prepared['args'][0] );
		if ( in_array( $table, $this->failing, true ) ) {
			$this->last_error = "Unknown column in '{$table}'";
			return null;
		}
		$this->counted[] = $prepared;
		return (string) ( $this->counts[ $table ] ?? 0 );
	}

	/**
	 * SHOW COLUMNS queries.
	 *
	 * @param array $prepared From prepare().
	 * @return array
	 */
	public function get_results( $prepared ) {
		$this->last_error = '';
		$table            = $this->short( $prepared['args'][0] );
		$columns          = array_key_exists( $table, $this->tables ) ? $this->tables[ $table ] : array();
		if ( null === $columns || in_array( $prepared['args'][1], $columns, true ) ) {
			return array( (object) array( 'Field' => $prepared['args'][1] ) );
		}
		return array();
	}
}

/**
 * Covers PAYMENT_HISTORY_MIGRATION.md §8.17: which recorded state counts as
 * a finished migration, what each missing condition reports, what the
 * evidence keeps, cleanup readiness and the staging verification record.
 * The decision against a live site (fresh, migrated and unmigrated
 * installations, both plugins' entry points) is covered by
 * PaymentHistoryUpgrade.api.spec.js.
 */
class PaymentHistoryUpgradeTest extends TestCase {

	/**
	 * Facts of a site that finished the migration on the intermediate release.
	 *
	 * @return array
	 */
	private static function migrated() {
		return array(
			'storage'                 => true,
			'cutover'                 => array(
				'activated_at' => '2026-11-01 10:00:00',
				'user_id'      => 1,
				'reference'    => 'backfill-verification:2026-10-31 09:00:00',
				'audit_id'     => 7,
				'verification' => array( 'checked_at' => '2026-10-31 09:00:00' ),
			),
			'readers'                 => array(
				'activated_at' => '2026-11-02 10:00:00',
				'reason'       => 'reader_cutover',
				'user_id'      => 1,
				'audit_id'     => 9,
			),
			'verified'                => true,
			'verification_checked_at' => '2026-11-02 09:00:00',
			'audience_tables'         => true,
			'migration_work'          => 0,
			'open_findings'           => 0,
		);
	}

	/**
	 * Reset the stored options and this request's decision.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		parent::setUp();
		$GLOBALS['_fair_test_options'] = array();
		PaymentHistoryUpgrade::reset();
		$this->original_wpdb = $GLOBALS['wpdb'];
	}

	/**
	 * Restore the shared database double.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		$GLOBALS['wpdb'] = $this->original_wpdb;
		parent::tearDown();
	}

	/**
	 * The bootstrap's database double.
	 *
	 * @var object
	 */
	private $original_wpdb;

	/**
	 * An existing site from before the migration (DB 3.47.0, no migration
	 * storage) whose tables hold the given counts. Fair Payments Connector
	 * isn't installed unless its table is listed.
	 *
	 * @param array<string, int>    $counts Counts by table, without prefix.
	 * @param array<string, ?array> $extra_tables More tables and their columns.
	 * @return Source_History_WPDB
	 */
	private static function existing_site( array $counts = array(), array $extra_tables = array() ) {
		$GLOBALS['_fair_test_options']['fair_events_db_version'] = '3.47.0';

		$db              = new Source_History_WPDB();
		$db->tables      = array_merge(
			array(
				'fair_events_signups'                     => null,
				'fair_events_tickets'                     => null,
				'fair_audience_event_participants'        => null,
				'fair_audience_event_participant_options' => null,
			),
			$extra_tables
		);
		$db->counts      = $counts;
		$GLOBALS['wpdb'] = $db;
		return $db;
	}

	/**
	 * Both switches, a clean verification and nothing outstanding make a
	 * finished migration.
	 *
	 * @return void
	 */
	public function test_finished_migration_is_eligible(): void {
		$this->assertSame(
			array(
				'basis'    => PaymentHistoryUpgrade::BASIS_MIGRATED,
				'blockers' => array(),
			),
			PaymentHistoryUpgrade::decide( self::migrated() )
		);
	}

	/**
	 * Each missing condition blocks with its own code.
	 *
	 * @return void
	 */
	public function test_each_missing_condition_blocks_with_its_code(): void {
		$cases = array(
			'cutover'        => array( null, 'ownership_cutover_missing' ),
			'readers'        => array( null, 'readers_missing' ),
			'verified'       => array( false, 'migration_unverified' ),
			'migration_work' => array( 2, 'migration_work_outstanding' ),
			'open_findings'  => array( 1, 'findings_open' ),
		);
		foreach ( $cases as $fact => list( $value, $code ) ) {
			$facts          = self::migrated();
			$facts[ $fact ] = $value;
			$this->assertSame(
				array(
					'basis'    => null,
					'blockers' => array( $code ),
				),
				PaymentHistoryUpgrade::decide( $facts ),
				$fact
			);
		}
	}

	/**
	 * A site where the intermediate release never ran has nothing to read.
	 *
	 * @return void
	 */
	public function test_site_without_migration_storage_is_unsupported(): void {
		$facts            = self::migrated();
		$facts['storage'] = false;
		$this->assertSame( array( 'storage_unavailable' ), PaymentHistoryUpgrade::decide( $facts )['blockers'] );
	}

	/**
	 * An existing site with the migration storage but no migration lists
	 * everything it still has to do.
	 *
	 * @return void
	 */
	public function test_unmigrated_site_lists_every_step(): void {
		$this->assertSame(
			array( 'ownership_cutover_missing', 'readers_missing', 'migration_unverified' ),
			PaymentHistoryUpgrade::decide(
				array(
					'storage'         => true,
					'cutover'         => null,
					'readers'         => null,
					'verified'        => false,
					'audience_tables' => true,
					'migration_work'  => 0,
					'open_findings'   => 0,
				)
			)['blockers']
		);
	}

	/**
	 * The intermediate release's "nothing to migrate" record counts while
	 * Fair Audience still has no tables; once it does, the full migration
	 * is required.
	 *
	 * @return void
	 */
	public function test_no_source_history_record_counts_only_without_audience_tables(): void {
		$facts = array(
			'storage'         => true,
			'cutover'         => null,
			'readers'         => array(
				'activated_at' => '2026-11-02 10:00:00',
				'reason'       => 'no_source_history',
				'user_id'      => 0,
			),
			'verified'        => false,
			'audience_tables' => false,
			'migration_work'  => 0,
			'open_findings'   => 0,
		);
		$this->assertSame( PaymentHistoryUpgrade::BASIS_NO_SOURCE_HISTORY, PaymentHistoryUpgrade::decide( $facts )['basis'] );

		$facts['audience_tables'] = true;
		$this->assertSame(
			array( 'ownership_cutover_missing', 'readers_missing', 'migration_unverified' ),
			PaymentHistoryUpgrade::decide( $facts )['blockers']
		);
	}

	/**
	 * The evidence keeps what the decision relied on, not the whole
	 * activation records the cleanup may later remove.
	 *
	 * @return void
	 */
	public function test_migrated_evidence_keeps_the_activations_it_relied_on(): void {
		$record = PaymentHistoryUpgrade::evidence_record( PaymentHistoryUpgrade::BASIS_MIGRATED, self::migrated() );

		$this->assertSame( 'migrated', $record['basis'] );
		$this->assertMatchesRegularExpression( '/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $record['recorded_at'] );
		$this->assertArrayHasKey( 'fair-events', $record['plugin_versions'] );
		$this->assertSame(
			array(
				'activated_at' => '2026-11-01 10:00:00',
				'reference'    => 'backfill-verification:2026-10-31 09:00:00',
				'audit_id'     => 7,
			),
			$record['ownership_cutover']
		);
		$this->assertSame(
			array(
				'activated_at' => '2026-11-02 10:00:00',
				'reason'       => 'reader_cutover',
				'audit_id'     => 9,
			),
			$record['readers']
		);
		$this->assertSame( '2026-11-02 09:00:00', $record['verification_checked_at'] );

		$fresh = PaymentHistoryUpgrade::evidence_record( PaymentHistoryUpgrade::BASIS_FRESH_INSTALL, array() );
		$this->assertSame( array( 'basis', 'recorded_at', 'plugin_versions' ), array_keys( $fresh ) );
	}

	/**
	 * A fresh installation records its evidence once, and a later record
	 * never replaces it.
	 *
	 * @return void
	 */
	public function test_fresh_install_evidence_is_recorded_once(): void {
		PaymentHistoryUpgrade::record_fresh_install();
		$first = PaymentHistoryUpgrade::get_evidence();
		$this->assertSame( 'fresh_install', $first['basis'] );

		PaymentHistoryUpgrade::reset();
		$this->assertTrue( PaymentHistoryUpgrade::allows_initialization() );

		PaymentHistoryUpgrade::record_fresh_install();
		$this->assertSame( $first, PaymentHistoryUpgrade::get_evidence() );
	}

	/**
	 * Recorded evidence allows initialization without reading the site.
	 *
	 * @return void
	 */
	public function test_recorded_evidence_allows_initialization(): void {
		$GLOBALS['_fair_test_options'][ PaymentHistoryUpgrade::EVIDENCE_OPTION ] = array(
			'basis'       => 'migrated',
			'recorded_at' => '2026-11-03 10:00:00',
		);
		$this->assertTrue( PaymentHistoryUpgrade::allows_initialization() );
		$this->assertSame( array(), PaymentHistoryUpgrade::refusal_blockers() );
	}

	/**
	 * Cleanup readiness is never implied by being safe to upgrade: it also
	 * needs a clean state now and the staging checks. Once the cleanup ran
	 * it reports that instead, and a fresh installation has nothing to
	 * clean up.
	 *
	 * @return void
	 */
	public function test_cleanup_readiness_is_separate_from_upgrade_safety(): void {
		$evidence = array( 'basis' => 'migrated' );
		$staging  = array(
			'verified_on' => '2026-11-04',
			'checks'      => array_fill_keys( PaymentHistoryUpgrade::STAGING_CHECKS, true ),
		);

		$this->assertSame(
			array(
				'applicable' => true,
				'ready'      => true,
				'completed'  => null,
				'blockers'   => array(),
			),
			PaymentHistoryUpgrade::cleanup_readiness( $evidence, self::migrated(), $staging )
		);

		$facts                                      = self::migrated();
		$facts['open_findings']                     = 3;
		$facts['migration_work']                    = 1;
		$staging['checks']['audience_reactivation'] = false;
		$blocked                                    = PaymentHistoryUpgrade::cleanup_readiness( null, $facts, $staging );
		$this->assertFalse( $blocked['ready'] );
		$this->assertSame(
			array( 'upgrade_unsafe', 'migration_work_outstanding', 'findings_open', 'staging_verification_incomplete' ),
			$blocked['blockers']
		);

		$fresh = PaymentHistoryUpgrade::cleanup_readiness( array( 'basis' => 'fresh_install' ), self::migrated(), null );
		$this->assertFalse( $fresh['applicable'] );
		$this->assertFalse( $fresh['ready'] );
	}

	/**
	 * A recorded cleanup reports what was done, whatever the site looks
	 * like now, so a repeat is a no-op; it never counts without evidence.
	 *
	 * @return void
	 */
	public function test_recorded_cleanup_is_reported_as_done(): void {
		$record = array( 'completed_at' => '2026-11-13 10:00:00' );
		$facts  = self::migrated();
		// A finding opened after the cleanup doesn't make it pending again.
		$facts['open_findings'] = 2;

		$done = PaymentHistoryUpgrade::cleanup_readiness( array( 'basis' => 'migrated' ), $facts, null, $record );
		$this->assertTrue( $done['applicable'] );
		$this->assertFalse( $done['ready'] );
		$this->assertSame( $record, $done['completed'] );
		$this->assertSame( array(), $done['blockers'] );

		$this->assertNull( PaymentHistoryUpgrade::cleanup_readiness( null, $facts, null, $record )['completed'] );
	}

	/**
	 * The staging verification stores the date, versions, every check and
	 * who recorded it.
	 *
	 * @return void
	 */
	public function test_staging_verification_is_recorded(): void {
		$GLOBALS['_fair_test_users'] = array( 5 => (object) array( 'display_name' => 'Ada Admin' ) );
		$result                      = PaymentHistoryUpgrade::record_staging_verification(
			array(
				'verified_on' => '2026-11-04',
				'versions'    => array(
					'fair-payments-connector' => '2.9.0',
					'fair-events'             => ' 2.3.0 ',
					'fair-audience'           => '',
				),
				'checks'      => array(
					'representative_purchases' => true,
					'statistics_revenue'       => true,
					'unknown_check'            => true,
				),
				'note'        => 'Staging copy of 3 November.',
			),
			5,
			'2026-11-11'
		);

		$this->assertIsArray( $result );
		$this->assertSame( '2026-11-04', $result['verified_on'] );
		$this->assertSame(
			array(
				'fair-payments-connector' => '2.9.0',
				'fair-events'             => '2.3.0',
				'fair-audience'           => null,
			),
			$result['versions']
		);
		$this->assertSame(
			array(
				'representative_purchases'     => true,
				'statistics_revenue'           => true,
				'shared_allocations'           => false,
				'finance_participant_attempts' => false,
				'audience_reactivation'        => false,
			),
			$result['checks']
		);
		$this->assertSame( 5, $result['user_id'] );
		$this->assertSame( 'Ada Admin', $result['user_name'] );
		$this->assertFalse( PaymentHistoryUpgrade::staging_complete( $result ) );
	}

	/**
	 * Invalid dates, versions and notes are refused with the fields named.
	 *
	 * @return void
	 */
	public function test_staging_verification_refuses_invalid_fields(): void {
		$result = PaymentHistoryUpgrade::record_staging_verification(
			array(
				'verified_on' => '2026-11-12',
				'versions'    => array(
					'fair-events'   => '',
					'fair-audience' => '2.0.0; DROP',
				),
				'note'        => str_repeat( 'a', PaymentHistoryUpgrade::NOTE_MAX_LENGTH + 1 ),
			),
			5,
			'2026-11-11'
		);

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'invalid_staging_verification', $result->get_error_code() );
		$this->assertSame(
			array( 'verified_on', 'versions.fair-audience', 'versions.fair-events', 'note' ),
			$result->get_error_data()['fields']
		);
		$this->assertArrayNotHasKey( PaymentHistoryUpgrade::STAGING_OPTION, $GLOBALS['_fair_test_options'] );

		$this->assertInstanceOf(
			\WP_Error::class,
			PaymentHistoryUpgrade::record_staging_verification(
				array(
					'verified_on' => '2026-02-30',
					'versions'    => array( 'fair-events' => '2.3.0' ),
				),
				5,
				'2026-11-11'
			)
		);
	}

	/**
	 * An existing site with events, free signups and participant profiles
	 * but no payment history initializes without the intermediate release
	 * or Fair Payments Connector, and records what it checked. No
	 * migration verification or activation is manufactured.
	 *
	 * @return void
	 */
	public function test_existing_site_without_source_history_initializes(): void {
		$db = self::existing_site();

		$this->assertTrue( PaymentHistoryUpgrade::allows_initialization() );
		$this->assertSame( array(), PaymentHistoryUpgrade::refusal_blockers() );

		$evidence = PaymentHistoryUpgrade::get_evidence();
		$this->assertSame( PaymentHistoryUpgrade::BASIS_VERIFIED_NO_HISTORY, $evidence['basis'] );
		$this->assertSame( PaymentHistoryUpgrade::HISTORY_SOURCES, $evidence['sources_checked'] );
		$this->assertFalse( $evidence['connector_active'] );
		$this->assertArrayNotHasKey( 'readers', $evidence );
		$this->assertArrayNotHasKey( 'ownership_cutover', $evidence );
		$this->assertSame(
			array( 'fair_events_db_version', PaymentHistoryUpgrade::EVIDENCE_OPTION ),
			array_keys( $GLOBALS['_fair_test_options'] )
		);

		// Only rows count: the coverage conditions keep free signups and
		// tickets from counting as admissions.
		$admissions = array_values(
			array_filter(
				$db->counted,
				static function ( $query ) {
					return 'wp_fair_audience_event_participants' === $query['args'][0];
				}
			)
		);
		$this->assertCount( 1, $admissions );
		$this->assertStringContainsString( 'NOT EXISTS ( SELECT 1 FROM %i AS s', $admissions[0]['query'] );
		$this->assertStringContainsString( 'NOT EXISTS ( SELECT 1 FROM %i AS t', $admissions[0]['query'] );
	}

	/**
	 * Initializing again reads nothing and keeps the first evidence.
	 *
	 * @return void
	 */
	public function test_repeated_initialization_keeps_the_first_evidence(): void {
		$db = self::existing_site();
		$this->assertTrue( PaymentHistoryUpgrade::allows_initialization() );
		$first       = PaymentHistoryUpgrade::get_evidence();
		$db->counted = array();

		PaymentHistoryUpgrade::reset();
		$db->counts = array( 'fair_events_signups' => 4 );
		$this->assertTrue( PaymentHistoryUpgrade::allows_initialization() );
		$this->assertSame( $first, PaymentHistoryUpgrade::get_evidence() );
		$this->assertSame( array(), $db->counted );
	}

	/**
	 * Each kind of source history refuses initialization and writes
	 * nothing, whether or not Fair Payments Connector is active.
	 *
	 * @return void
	 */
	public function test_each_source_of_history_refuses(): void {
		$cases = array(
			// Retained by an inactive or deleted Connector.
			'payment_transactions'      => array( 'fair_payment_transactions', array( 'fair_payment_transactions' => null ) ),
			// Includes a signup naming a deleted transaction.
			'signup_payment_references' => array( 'fair_events_signups', array() ),
			'payment_links'             => array( 'fair_events_signup_payment_links', array( 'fair_events_signup_payment_links' => null ) ),
			'audience_ledger'           => array( 'fair_audience_event_participant_transactions', array( 'fair_audience_event_participant_transactions' => null ) ),
			// A free Audience registration with no Events signup or ticket.
			'legacy_admissions'         => array( 'fair_audience_event_participants', array() ),
			'participant_activities'    => array( 'fair_audience_event_participant_options', array() ),
			'migration_work'            => array( 'fair_events_payment_shadow_work', array( 'fair_events_payment_shadow_work' => null ) ),
			'migration_findings'        => array( 'fair_events_payment_history_findings', array( 'fair_events_payment_history_findings' => null ) ),
		);
		foreach ( $cases as $source => list( $table, $tables ) ) {
			$GLOBALS['_fair_test_options'] = array();
			PaymentHistoryUpgrade::reset();
			self::existing_site( array( $table => 1 ), $tables );

			$this->assertFalse( PaymentHistoryUpgrade::allows_initialization(), $source );
			$this->assertSame( array( 'storage_unavailable', 'source_history_found' ), PaymentHistoryUpgrade::refusal_blockers(), $source );
			$this->assertSame( 1, PaymentHistoryUpgrade::refusal_history()['sources'][ $source ], $source );
			$this->assertNull( PaymentHistoryUpgrade::get_evidence(), $source );
		}
	}

	/**
	 * Purchases a started migration created are read once the column exists.
	 *
	 * @return void
	 */
	public function test_backfilled_purchases_are_read_when_the_column_exists(): void {
		$db                                = self::existing_site( array(), array( 'fair_events_signups' => array( 'transaction_id', 'participant_id', 'legacy_event_participant_id' ) ) );
		$db->counts['fair_events_signups'] = 0;

		$history = PaymentHistoryUpgrade::source_history();
		$this->assertSame( PaymentHistoryUpgrade::HISTORY_ABSENT, $history['state'] );
		$backfill = array_values(
			array_filter(
				$db->counted,
				static function ( $query ) {
					return str_contains( $query['query'], 'legacy_event_participant_id IS NOT NULL' );
				}
			)
		);
		$this->assertCount( 1, $backfill );
	}

	/**
	 * Without the tables a rule needs to recognise covered registrations,
	 * every registration is counted, never ignored.
	 *
	 * @return void
	 */
	public function test_admissions_without_events_tables_count_every_registration(): void {
		$db = self::existing_site();
		unset( $db->tables['fair_events_signups'], $db->tables['fair_events_tickets'] );

		PaymentHistoryUpgrade::source_history();
		$admissions = array_values(
			array_filter(
				$db->counted,
				static function ( $query ) {
					return 'wp_fair_audience_event_participants' === $query['args'][0];
				}
			)
		);
		$this->assertStringNotContainsString( 'NOT EXISTS', $admissions[0]['query'] );
		$this->assertSame( array( 'wp_fair_audience_event_participants', 'pending_payment', 'signed_up' ), $admissions[0]['args'] );
	}

	/**
	 * A failed read, or a table without the columns a read needs, is
	 * uncertainty: it refuses with its own code.
	 *
	 * @return void
	 */
	public function test_failed_reads_refuse_as_unverifiable(): void {
		self::existing_site( array( 'fair_events_signups' => 3 ) );
		$GLOBALS['wpdb']->failing = array( 'fair_audience_event_participant_options' );

		$this->assertFalse( PaymentHistoryUpgrade::allows_initialization() );
		$this->assertSame( array( 'storage_unavailable', 'source_history_unverifiable' ), PaymentHistoryUpgrade::refusal_blockers() );
		$this->assertNull( PaymentHistoryUpgrade::refusal_history()['sources']['participant_activities'] );
		$this->assertNull( PaymentHistoryUpgrade::get_evidence() );

		PaymentHistoryUpgrade::reset();
		self::existing_site();
		$GLOBALS['wpdb']->show_tables_fails = true;
		$this->assertFalse( PaymentHistoryUpgrade::allows_initialization() );
		$this->assertContains( 'source_history_unverifiable', PaymentHistoryUpgrade::refusal_blockers() );
	}

	/**
	 * Absent tables are empty sources; anything unreadable outranks found history.
	 *
	 * @return void
	 */
	public function test_history_state_from_counts(): void {
		$empty = array_fill_keys( PaymentHistoryUpgrade::HISTORY_SOURCES, 0 );
		$this->assertSame( PaymentHistoryUpgrade::HISTORY_ABSENT, PaymentHistoryUpgrade::history_state( $empty ) );

		$found                           = $empty;
		$found['participant_activities'] = 2;
		$this->assertSame( PaymentHistoryUpgrade::HISTORY_PRESENT, PaymentHistoryUpgrade::history_state( $found ) );

		$found['payment_links'] = null;
		$this->assertSame( PaymentHistoryUpgrade::HISTORY_UNVERIFIABLE, PaymentHistoryUpgrade::history_state( $found ) );

		unset( $empty['migration_findings'] );
		$this->assertSame( PaymentHistoryUpgrade::HISTORY_UNVERIFIABLE, PaymentHistoryUpgrade::history_state( $empty ) );
	}

	/**
	 * A site recorded without history has nothing to clean up, and its
	 * checklist is the fresh installation's.
	 *
	 * @return void
	 */
	public function test_verified_no_history_has_nothing_to_clean_up(): void {
		$readiness = PaymentHistoryUpgrade::cleanup_readiness( array( 'basis' => PaymentHistoryUpgrade::BASIS_VERIFIED_NO_HISTORY ), self::migrated(), null );
		$this->assertFalse( $readiness['applicable'] );
		$this->assertSame( array(), $readiness['blockers'] );
	}
}
