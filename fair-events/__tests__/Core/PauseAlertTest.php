<?php
/**
 * PauseAlert tests (#2445).
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Core;

use FairEvents\Core\PauseAlert;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/Pause_Alert_Test_WPDB.php';

/**
 * Incidents, deduplication, recovery, retries and mail failure.
 */
class PauseAlertTest extends TestCase {

	/**
	 * Fixed start time.
	 */
	const T0 = 1800000000;

	/**
	 * Lock double.
	 *
	 * @var Pause_Alert_Test_WPDB
	 */
	private $db;

	/**
	 * Fresh site, empty mailbox, unlocked database.
	 */
	protected function setUp(): void {
		parent::setUp();
		$GLOBALS['_fair_test_options']     = array(
			'admin_email' => 'owner@example.test',
			'blogname'    => 'Dance Club',
		);
		$GLOBALS['_fair_test_sent_emails'] = array();
		$GLOBALS['_fair_test_mail_fails']  = false;
		$GLOBALS['_fair_test_mail_throws'] = false;
		$this->db                          = new Pause_Alert_Test_WPDB();
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- test-only fake, no real $wpdb exists here.
		$GLOBALS['wpdb'] = $this->db;
		PauseAlert::reset();
	}

	/**
	 * Restore the bootstrap doubles.
	 */
	protected function tearDown(): void {
		PauseAlert::reset();
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- test-only fake, no real $wpdb exists here.
		$GLOBALS['wpdb']                   = new \Fair_Test_WPDB();
		$GLOBALS['_fair_test_mail_fails']  = false;
		$GLOBALS['_fair_test_mail_throws'] = false;
		parent::tearDown();
	}

	/**
	 * One request that sees a library conflict.
	 *
	 * @param int    $now         Unix time.
	 * @param string $context     Request context.
	 * @param array  $responsible Responsible plugin names.
	 * @return void
	 */
	private function library_conflict( $now, $context = PauseAlert::CONTEXT_FRONTEND, array $responsible = array() ) {
		PauseAlert::observe_pause(
			PauseAlert::CAUSE_LIBRARY,
			array(
				'responsible' => $responsible,
				'unknown'     => empty( $responsible ),
			),
			$context
		);
		PauseAlert::process( $now );
	}

	/**
	 * One healthy library request.
	 *
	 * @param int    $now     Unix time.
	 * @param string $context Request context.
	 * @return void
	 */
	private function library_healthy( $now, $context ) {
		PauseAlert::observe_recovery( PauseAlert::CAUSE_LIBRARY, $context );
		PauseAlert::process( $now );
	}

	/**
	 * One request refused by the migration gate.
	 *
	 * @param int      $now      Unix time.
	 * @param string[] $blockers Blocker codes.
	 * @return void
	 */
	private function migration_refused( $now, array $blockers = array( 'migration_work_outstanding' ) ) {
		PauseAlert::observe_migration_refusal( $blockers );
		PauseAlert::process( $now );
	}

	/**
	 * Mail sent so far.
	 *
	 * @return array[]
	 */
	private function sent() {
		return $GLOBALS['_fair_test_sent_emails'];
	}

	/**
	 * A version conflict emails the site's administration address once,
	 * naming the site, the cause, the impact and the plugin to update.
	 */
	public function test_library_conflict_emails_admin_address_once(): void {
		$this->library_conflict( self::T0, PauseAlert::CONTEXT_FRONTEND, array( 'Fair Timetable' ) );
		$this->library_conflict( self::T0 + 10 );

		$this->assertCount( 1, $this->sent() );
		$mail = $this->sent()[0];
		$this->assertSame( 'owner@example.test', $mail['to'] );
		$this->assertStringContainsString( 'Dance Club', $mail['subject'] );
		$this->assertStringContainsString( 'Dance Club (https://example.com/)', $mail['message'] );
		$this->assertStringContainsString( 'Fair Timetable loaded an outdated copy', $mail['message'] );
		$this->assertStringContainsString( 'ticket purchases are unavailable', $mail['message'] );
		$this->assertStringContainsString( '1. Update Fair Timetable.', $mail['message'] );
		$this->assertStringNotContainsString( '/vendor/', $mail['message'] );
	}

	/**
	 * A copy outside any installed plugin falls back to updating every
	 * Fair plugin.
	 */
	public function test_library_conflict_without_known_plugin_recommends_updating_all(): void {
		$this->library_conflict( self::T0 );

		$this->assertStringContainsString( 'another plugin loaded an outdated copy', $this->sent()[0]['message'] );
		$this->assertStringContainsString( '1. Update all Fair plugins.', $this->sent()[0]['message'] );
	}

	/**
	 * An unfinished migration emails the known blocker labels, the
	 * recovery steps and the guidance links, and nothing it can't name.
	 */
	public function test_migration_refusal_emails_recovery_steps(): void {
		$this->migration_refused( self::T0, array( 'migration_work_outstanding', 'findings_open', 'unknown_code' ) );

		$this->assertCount( 1, $this->sent() );
		$message = $this->sent()[0]['message'];
		$this->assertSame( 'owner@example.test', $this->sent()[0]['to'] );
		$this->assertStringContainsString( 'payment history migration', $message );
		$this->assertStringContainsString( '- Some payment records still wait to be moved.', $message );
		$this->assertStringContainsString( '- Some migration findings are still open.', $message );
		$this->assertStringNotContainsString( 'unknown_code', $message );
		$this->assertStringContainsString( '1. Back up the database', $message );
		$this->assertStringContainsString( 'build-2.2.0', $message );
		$this->assertStringContainsString( 'releases/tag/build-2.2.0', $message );
		$this->assertStringContainsString( 'DEPLOYMENT.md#upgrade-notes', $message );
	}

	/**
	 * Both causes are separate incidents with one alert each.
	 */
	public function test_causes_are_independent_incidents(): void {
		$this->library_conflict( self::T0 );
		$this->migration_refused( self::T0 + 1 );
		$this->library_conflict( self::T0 + 2 );
		$this->migration_refused( self::T0 + 3 );

		$this->assertCount( 2, $this->sent() );
	}

	/**
	 * Healthy requests send nothing and store nothing.
	 */
	public function test_healthy_requests_send_nothing(): void {
		$this->library_healthy( self::T0, PauseAlert::CONTEXT_FRONTEND );
		PauseAlert::observe_migration_allowed();
		PauseAlert::process( self::T0 );

		$this->assertSame( array(), $this->sent() );
		$this->assertArrayNotHasKey( PauseAlert::OPTION, $GLOBALS['_fair_test_options'] );
		$this->assertSame( array(), $this->db->statements, 'no lock taken on a healthy site' );
	}

	/**
	 * A repeat that changes nothing doesn't take the lock.
	 */
	public function test_unchanged_repeat_skips_the_lock(): void {
		$this->library_conflict( self::T0 );
		$this->db->statements = array();
		$this->library_conflict( self::T0 + 5 );

		$this->assertSame( array(), $this->db->statements );
	}

	/**
	 * A request that can't take the lock sends nothing; the next one does.
	 */
	public function test_lock_held_elsewhere_skips_the_send(): void {
		$this->db->lock_available = false;
		$this->library_conflict( self::T0 );
		$this->assertSame( array(), $this->sent() );

		$this->db->lock_available = true;
		$this->library_conflict( self::T0 + 1 );
		$this->assertCount( 1, $this->sent() );
	}

	/**
	 * A conflict seen only in admin survives healthy frontend requests,
	 * closes on a healthy admin request, and a later conflict alerts again.
	 */
	public function test_admin_only_conflict_recovers_only_in_admin(): void {
		$this->library_conflict( self::T0, PauseAlert::CONTEXT_ADMIN );
		$this->library_healthy( self::T0 + 1, PauseAlert::CONTEXT_FRONTEND );
		$this->library_conflict( self::T0 + 2, PauseAlert::CONTEXT_ADMIN );
		$this->library_healthy( self::T0 + 3, PauseAlert::CONTEXT_FRONTEND );
		$this->assertCount( 1, $this->sent() );

		$this->library_healthy( self::T0 + 4, PauseAlert::CONTEXT_ADMIN );
		$this->assertArrayNotHasKey( PauseAlert::OPTION, $GLOBALS['_fair_test_options'] );

		$this->library_conflict( self::T0 + 5, PauseAlert::CONTEXT_ADMIN );
		$this->assertCount( 2, $this->sent() );
	}

	/**
	 * A conflict seen in both contexts closes only after both recover.
	 */
	public function test_conflict_in_both_contexts_needs_both_to_recover(): void {
		$this->library_conflict( self::T0, PauseAlert::CONTEXT_ADMIN );
		$this->library_conflict( self::T0 + 1, PauseAlert::CONTEXT_FRONTEND );
		$this->library_healthy( self::T0 + 2, PauseAlert::CONTEXT_ADMIN );
		$this->library_conflict( self::T0 + 3, PauseAlert::CONTEXT_FRONTEND );
		$this->assertCount( 1, $this->sent() );

		$this->library_healthy( self::T0 + 4, PauseAlert::CONTEXT_FRONTEND );
		$this->library_conflict( self::T0 + 5, PauseAlert::CONTEXT_FRONTEND );
		$this->assertCount( 2, $this->sent() );
	}

	/**
	 * A healthy migration decision closes the migration incident; a later
	 * refusal alerts again. A library observation doesn't close it.
	 */
	public function test_migration_recovery_allows_new_alert(): void {
		$this->migration_refused( self::T0 );
		$this->library_healthy( self::T0 + 1, PauseAlert::CONTEXT_FRONTEND );
		$this->migration_refused( self::T0 + 2 );
		$this->assertCount( 1, $this->sent() );

		PauseAlert::observe_migration_allowed();
		PauseAlert::process( self::T0 + 3 );
		$this->migration_refused( self::T0 + 4 );
		$this->assertCount( 2, $this->sent() );
	}

	/**
	 * A changed diagnosis updates the open incident without a new alert.
	 */
	public function test_changed_diagnosis_updates_without_new_alert(): void {
		$this->migration_refused( self::T0, array( 'migration_work_outstanding' ) );
		$this->migration_refused( self::T0 + 1, array( 'findings_open' ) );

		$this->assertCount( 1, $this->sent() );
		$state = PauseAlert::read_state( true );
		$this->assertSame( array( 'findings_open' ), $state[ PauseAlert::CAUSE_MIGRATION ]['diagnosis']['blockers'] );
	}

	/**
	 * A failed send retries after an hour, then 24 hours after that, and
	 * stops at three attempts.
	 */
	public function test_failed_sends_retry_with_bounded_delays(): void {
		$GLOBALS['_fair_test_mail_fails'] = true;

		$this->migration_refused( self::T0 );
		$this->migration_refused( self::T0 + HOUR_IN_SECONDS - 1 );
		$this->assertSame( 1, $this->attempts() );

		$this->migration_refused( self::T0 + HOUR_IN_SECONDS );
		$this->assertSame( 2, $this->attempts() );

		$second = self::T0 + HOUR_IN_SECONDS;
		$this->migration_refused( $second + DAY_IN_SECONDS - 1 );
		$this->assertSame( 2, $this->attempts() );

		$this->migration_refused( $second + DAY_IN_SECONDS );
		$this->assertSame( 3, $this->attempts() );

		$this->migration_refused( $second + 30 * DAY_IN_SECONDS );
		$this->assertSame( 3, $this->attempts() );
	}

	/**
	 * A thrown mail exception is caught and counted like a failure; the
	 * retry that succeeds ends the attempts.
	 */
	public function test_mail_exception_is_contained_and_retried(): void {
		$GLOBALS['_fair_test_mail_throws'] = true;
		$this->library_conflict( self::T0 );
		$this->assertSame( 1, $this->attempts( PauseAlert::CAUSE_LIBRARY ) );

		$GLOBALS['_fair_test_mail_throws'] = false;
		$this->library_conflict( self::T0 + HOUR_IN_SECONDS );
		$this->library_conflict( self::T0 + 2 * DAY_IN_SECONDS );

		$this->assertCount( 1, $this->sent() );
		$this->assertSame( 2, $this->attempts( PauseAlert::CAUSE_LIBRARY ) );
	}

	/**
	 * A reserved attempt counts even if the request never recorded its
	 * result.
	 */
	public function test_reserved_attempt_counts_without_result(): void {
		$GLOBALS['_fair_test_options'][ PauseAlert::OPTION ] = array(
			PauseAlert::CAUSE_MIGRATION => array(
				'opened_at'       => self::T0,
				'attempts'        => 1,
				'last_attempt_at' => self::T0,
				'sent'            => false,
				'contexts'        => array( PauseAlert::CONTEXT_FRONTEND => true ),
				'diagnosis'       => array( 'blockers' => array( 'findings_open' ) ),
			),
		);

		$this->migration_refused( self::T0 + 60, array( 'findings_open' ) );
		$this->assertSame( array(), $this->sent() );
	}

	/**
	 * Without a valid administration address nothing is sent.
	 */
	public function test_invalid_admin_email_sends_nothing(): void {
		$GLOBALS['_fair_test_options']['admin_email'] = 'not-an-address';
		$this->migration_refused( self::T0 );

		$this->assertSame( array(), $this->sent() );
	}

	/**
	 * Attempts made for a cause.
	 *
	 * @param string $cause Cause.
	 * @return int
	 */
	private function attempts( $cause = PauseAlert::CAUSE_MIGRATION ) {
		$state = PauseAlert::read_state( true );
		return (int) ( $state[ $cause ]['attempts'] ?? 0 );
	}
}
