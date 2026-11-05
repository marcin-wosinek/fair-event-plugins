<?php
/**
 * Legacy admission count and purchase provenance tests.
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Database;

// phpcs:disable WordPress.WP.GlobalVariablesOverride.Prohibited -- test-only fake.

use FairAudience\Database\EventParticipantRepository;
use PHPUnit\Framework\Attributes\PreserveGlobalState;
use PHPUnit\Framework\Attributes\RunInSeparateProcess;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/ExpiryWPDB.php';

/**
 * The capacity filter skips relationships a fair-events purchase names as
 * its provenance, only when the active fair-events supports provenance
 * (PAYMENT_HISTORY_MIGRATION.md §4.3, §8.6).
 */
class AdmissionsProvenanceTest extends TestCase {

	/**
	 * Database double.
	 *
	 * @var Expiry_WPDB
	 */
	private $database;

	/**
	 * Install a fresh database double.
	 */
	protected function setUp(): void {
		parent::setUp();
		$this->database  = new Expiry_WPDB();
		$GLOBALS['wpdb'] = $this->database;
	}

	/**
	 * The query the repository ran.
	 *
	 * @param string $scope 'event_date' or 'ticket_type'.
	 * @return array{query: string, args: array}
	 */
	private function count_query( $scope = 'event_date' ) {
		( new EventParticipantRepository() )->count_admissions_without_signup( $scope, 50 );
		return $this->database->last_prepared;
	}

	/**
	 * With an older fair-events (no capability class), the query is the
	 * one from before provenance and reads no provenance column.
	 */
	public function test_older_events_keeps_previous_query(): void {
		$prepared = $this->count_query();

		$this->assertStringNotContainsString( 'legacy_event_participant_id', $prepared['query'] );
		$this->assertCount( 6, $prepared['args'] );
		$this->assertSame( 'wp_fair_events_tickets', $prepared['args'][5] );
	}

	/**
	 * With fair-events storing provenance, relationships it names are
	 * skipped, for both scopes.
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_newer_events_skips_provenance_relationships(): void {
		require_once __DIR__ . '/fakes/fair-events/compatibility-with-provenance.php';
		$GLOBALS['_fair_test_provenance_available'] = true;

		foreach ( array(
			'event_date'  => 'event_date_id',
			'ticket_type' => 'ticket_type_id',
		) as $scope => $column ) {
			$prepared = $this->count_query( $scope );

			$this->assertStringContainsString( 'NOT EXISTS ( SELECT 1 FROM %i AS bp WHERE bp.legacy_event_participant_id = ep.id )', $prepared['query'] );
			$this->assertSame( $column, $prepared['args'][1] );
			$this->assertSame( 'wp_fair_events_signups', $prepared['args'][6] );
			$this->assertSame( substr_count( $prepared['query'], '%' ), count( $prepared['args'] ) );
		}
	}

	/**
	 * A newer fair-events whose schema upgrade hasn't completed yet keeps
	 * the previous query, so the missing column is never read.
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_incomplete_events_upgrade_keeps_previous_query(): void {
		require_once __DIR__ . '/fakes/fair-events/compatibility-with-provenance.php';
		$GLOBALS['_fair_test_provenance_available'] = false;

		$this->assertStringNotContainsString( 'legacy_event_participant_id', $this->count_query()['query'] );
	}

	/**
	 * The marker fair-events checks before starting the backfill.
	 */
	public function test_reports_provenance_support_to_events(): void {
		$this->assertTrue( EventParticipantRepository::excludes_purchase_provenance() );
		$this->assertTrue( EventParticipantRepository::excludes_provenance_activity_selections() );
	}

	/**
	 * The participant-scope activity query the repository ran.
	 *
	 * @return array{query: string, args: array}
	 */
	private function selections_query() {
		( new EventParticipantRepository() )->count_participant_scope_selections( 7, 50, array( 50, 51 ) );
		return $this->database->last_prepared;
	}

	/**
	 * With an older fair-events, participant-scope activities are counted
	 * as before.
	 */
	public function test_older_events_keeps_previous_selection_query(): void {
		$prepared = $this->selections_query();

		$this->assertStringNotContainsString( 'legacy_event_participant_id', $prepared['query'] );
		$this->assertSame( substr_count( $prepared['query'], '%' ), count( $prepared['args'] ) );
	}

	/**
	 * With fair-events storing provenance, the activities of a relationship
	 * a purchase names are left to that purchase's ticket.
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_newer_events_skips_provenance_selections(): void {
		require_once __DIR__ . '/fakes/fair-events/compatibility-with-provenance.php';
		$GLOBALS['_fair_test_provenance_available'] = true;

		$prepared = $this->selections_query();

		$this->assertStringContainsString( 'NOT EXISTS ( SELECT 1 FROM %i AS bp WHERE bp.legacy_event_participant_id = ep.id )', $prepared['query'] );
		$this->assertSame( 'wp_fair_events_signups', end( $prepared['args'] ) );
		$this->assertSame( array( 50, 51 ), array_slice( $prepared['args'], 7, 2 ) );
		$this->assertSame( substr_count( $prepared['query'], '%' ), count( $prepared['args'] ) );
	}
}
