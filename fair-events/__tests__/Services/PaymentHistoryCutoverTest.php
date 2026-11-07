<?php
/**
 * Payment history cutover activation rule tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use FairEvents\Services\PaymentHistoryCompatibility;
use FairEvents\Services\PaymentHistoryCutover;
use PHPUnit\Framework\Attributes\PreserveGlobalState;
use PHPUnit\Framework\Attributes\RunInSeparateProcess;
use PHPUnit\Framework\TestCase;

// The activation test swaps the WordPress database global for a double.
// phpcs:disable WordPress.WP.GlobalVariablesOverride.Prohibited

/**
 * Covers PAYMENT_HISTORY_MIGRATION.md §8.13: what blocks the stage 4
 * activation, what needs repair after it, and what it records. The
 * activation itself, with its locks and audit, is covered by
 * PaymentHistoryCutover.api.spec.js.
 */
class PaymentHistoryCutoverTest extends TestCase {

	/**
	 * Facts of a site ready to switch.
	 *
	 * @return array
	 */
	private static function ready() {
		return array(
			'storage'               => true,
			'verified'              => true,
			'backfill_status'       => 'verified',
			'shadow_write_coverage' => true,
			'payment_information'   => true,
			'audience_compatible'   => true,
			'audience_lifecycle'    => true,
			'outstanding_work'      => array(),
		);
	}

	/**
	 * Reset the stored options.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		parent::setUp();
		$GLOBALS['_fair_test_options'] = array();
	}

	/**
	 * A verified site with current plugins and no queued work can switch.
	 *
	 * @return void
	 */
	public function test_ready_site_has_no_blockers(): void {
		$this->assertSame( array(), PaymentHistoryCutover::blockers( self::ready() ) );
	}

	/**
	 * Each missing condition blocks with its own code.
	 *
	 * @return void
	 */
	public function test_each_condition_blocks_with_its_code(): void {
		$cases = array(
			'storage'               => array( false, 'storage_unavailable' ),
			'verified'              => array( false, 'migration_unverified' ),
			'shadow_write_coverage' => array( false, 'shadow_writes_incomplete' ),
			'payment_information'   => array( false, 'payment_information_unavailable' ),
			'audience_compatible'   => array( false, 'audience_incompatible' ),
			'audience_lifecycle'    => array( false, 'audience_lifecycle_unavailable' ),
			'outstanding_work'      => array( array( 'transaction' => array( 'failed' => 1 ) ), 'shadow_work_outstanding' ),
		);
		foreach ( $cases as $fact => list( $value, $code ) ) {
			$facts          = self::ready();
			$facts[ $fact ] = $value;
			$this->assertSame( array( $code ), PaymentHistoryCutover::blockers( $facts ), $fact );
		}
	}

	/**
	 * An older Fair Audience, without the purchase lifecycle, blocks the
	 * activation even when everything else is ready (§8.12).
	 *
	 * @return void
	 */
	public function test_older_audience_blocks_activation(): void {
		$facts                       = self::ready();
		$facts['audience_lifecycle'] = false;

		$this->assertContains( 'audience_lifecycle_unavailable', PaymentHistoryCutover::blockers( $facts ) );
	}

	/**
	 * After the activation, a failed re-verification or an older Fair
	 * Audience is reported for repair; nothing reports authority going back.
	 *
	 * @return void
	 */
	public function test_issues_after_activation_call_for_forward_repair(): void {
		$this->assertSame( array(), PaymentHistoryCutover::issues( self::ready(), true ) );

		$facts                        = self::ready();
		$facts['verified']            = false;
		$facts['backfill_status']     = 'verification_failed';
		$facts['audience_lifecycle']  = false;
		$facts['payment_information'] = false;
		$this->assertSame(
			array( 'audience_lifecycle_unavailable', 'payment_information_unavailable', 'verification_failed' ),
			PaymentHistoryCutover::issues( $facts, true )
		);

		// A re-verification in progress isn't a failure.
		$facts                    = self::ready();
		$facts['verified']        = false;
		$facts['backfill_status'] = 'running';
		$this->assertSame( array(), PaymentHistoryCutover::issues( $facts, true ) );

		$this->assertSame( array( 'storage_unavailable' ), PaymentHistoryCutover::issues( self::ready(), false ) );
	}

	/**
	 * The record names the administrator, the backup confirmation and the
	 * verification it relied on.
	 *
	 * @return void
	 */
	public function test_record_references_the_verification(): void {
		$backfill = array(
			'status'       => 'verified',
			'cutoffs'      => array(
				'transaction_id'  => 40,
				'relationship_id' => 12,
			),
			'completed_at' => '2026-11-06 09:00:00',
			'verification' => array( 'checked_at' => '2026-11-06 09:01:00' ),
		);
		$record   = PaymentHistoryCutover::record(
			$backfill,
			array(
				'event_dates' => 3,
				'blocking'    => 0,
				'incomplete'  => 1,
			),
			array( 'open' => 2 ),
			7,
			'2026-11-07 10:00:00'
		);

		$this->assertSame( '2026-11-07 10:00:00', $record['activated_at'] );
		$this->assertSame( 7, $record['user_id'] );
		$this->assertSame( '2026-11-07 10:00:00', $record['backup_confirmed_at'] );
		$this->assertSame( 'backfill-verification:2026-11-06 09:01:00', $record['reference'] );
		$this->assertSame( $backfill['cutoffs'], $record['verification']['cutoffs'] );
		$this->assertSame( 1, $record['verification']['comparisons']['incomplete'] );
		$this->assertSame( array( 'open' => 2 ), $record['verification']['findings'] );
	}

	/**
	 * Without a confirmed backup nothing is checked or written.
	 *
	 * @return void
	 */
	public function test_activation_requires_backup_confirmation(): void {
		$result = PaymentHistoryCutover::activate( array( 'user_id' => 1 ) );

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'backup_required', $result->get_error_code() );
		$this->assertArrayNotHasKey( PaymentHistoryCompatibility::CUTOVER_OPTION, $GLOBALS['_fair_test_options'] );
	}

	/**
	 * A second activation is refused and leaves the first one as it was.
	 *
	 * @return void
	 */
	public function test_second_activation_is_refused(): void {
		$first = array(
			'activated_at' => '2026-11-07 10:00:00',
			'user_id'      => 1,
		);
		$GLOBALS['_fair_test_options'][ PaymentHistoryCompatibility::CUTOVER_OPTION ] = $first;

		$result = PaymentHistoryCutover::activate(
			array(
				'backup_confirmed' => true,
				'user_id'          => 2,
			)
		);

		$this->assertSame( 'cutover_active', $result->get_error_code() );
		$this->assertSame( $first, $GLOBALS['_fair_test_options'][ PaymentHistoryCompatibility::CUTOVER_OPTION ] );
	}

	/**
	 * A database double that finds no table and no stored option.
	 *
	 * @return object
	 */
	private static function empty_database() {
		return new class() {
			/**
			 * Table prefix.
			 *
			 * @var string
			 */
			public $prefix = 'wp_';

			/**
			 * Options table.
			 *
			 * @var string
			 */
			public $options = 'wp_options';

			/**
			 * Statements run.
			 *
			 * @var string[]
			 */
			public $statements = array();

			/**
			 * Escape for LIKE.
			 *
			 * @param string $text Text.
			 * @return string
			 */
			public function esc_like( $text ) {
				return $text;
			}

			/**
			 * Keep the query.
			 *
			 * @param string $query Query.
			 * @return string
			 */
			public function prepare( $query ) {
				return $query;
			}

			/**
			 * Nothing exists.
			 *
			 * @param string $query Query.
			 * @return null
			 */
			public function get_var( $query ) {
				$this->statements[] = $query;
				return null;
			}
		};
	}

	/**
	 * With a Fair Audience from before the purchase lifecycle, activate()
	 * refuses before taking a lock or writing anything (§8.12).
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_activation_refuses_with_an_older_audience(): void {
		require_once __DIR__ . '/fakes/fair-audience/repository-with-provenance.php';
		$GLOBALS['wpdb']               = self::empty_database();
		$GLOBALS['_fair_test_options'] = array();

		$this->assertFalse( PaymentHistoryCompatibility::audience_lifecycle_available() );

		$result = PaymentHistoryCutover::activate(
			array(
				'backup_confirmed' => true,
				'user_id'          => 1,
			)
		);

		$this->assertSame( 'cutover_blocked', $result->get_error_code() );
		$this->assertContains( 'audience_lifecycle_unavailable', $result->get_error_data()['blockers'] );
		$this->assertArrayNotHasKey( PaymentHistoryCompatibility::CUTOVER_OPTION, $GLOBALS['_fair_test_options'] );
		$this->assertEmpty( preg_grep( '/GET_LOCK/', $GLOBALS['wpdb']->statements ) );
	}

	/**
	 * A Fair Audience with the lifecycle, or none at all, doesn't block.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_current_audience_reports_the_lifecycle(): void {
		$this->assertTrue( PaymentHistoryCompatibility::audience_lifecycle_available() );

		require_once __DIR__ . '/fakes/fair-audience/repository-with-provenance.php';
		require_once __DIR__ . '/fakes/fair-audience/events-lifecycle.php';
		$this->assertTrue( PaymentHistoryCompatibility::audience_lifecycle_available() );
	}
}
