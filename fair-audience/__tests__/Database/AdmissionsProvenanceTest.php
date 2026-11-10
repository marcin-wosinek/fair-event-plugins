<?php
/**
 * Purchase provenance markers tests.
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Database;

use FairAudience\Database\EventParticipantRepository;
use PHPUnit\Framework\TestCase;

/**
 * Fair Audience reports no admissions or participant-scope activities to
 * fair-events' capacity (#2251), so it never counts a relationship next to
 * the purchase backfilled from it, and tells fair-events so
 * (PAYMENT_HISTORY_MIGRATION.md §4.3, §8.6).
 */
class AdmissionsProvenanceTest extends TestCase {

	/**
	 * The markers fair-events checks before shadow writes and the backfill.
	 */
	public function test_reports_provenance_support_to_events(): void {
		$this->assertTrue( EventParticipantRepository::excludes_purchase_provenance() );
		$this->assertTrue( EventParticipantRepository::excludes_provenance_activity_selections() );
	}

	/**
	 * The legacy capacity counts are gone: relationships without a purchase
	 * take no place.
	 */
	public function test_reports_no_legacy_capacity(): void {
		$this->assertFalse( method_exists( EventParticipantRepository::class, 'count_admissions_without_signup' ) );
		$this->assertFalse( method_exists( EventParticipantRepository::class, 'count_participant_scope_selections' ) );
	}
}
