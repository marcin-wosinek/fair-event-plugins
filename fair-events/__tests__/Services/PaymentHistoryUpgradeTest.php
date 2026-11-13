<?php
/**
 * Supported upgrade path tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use FairEvents\Services\PaymentHistoryUpgrade;
use PHPUnit\Framework\TestCase;

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
}
