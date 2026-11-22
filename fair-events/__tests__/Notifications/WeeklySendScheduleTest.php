<?php
/**
 * WeeklySendSchedule tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Notifications\BulkEmailDispatcher;
use FairEvents\Notifications\BulkEmailSettings;
use FairEvents\Notifications\ConfigurationMigration;
use FairEvents\Notifications\Configurations;
use FairEvents\Notifications\IndividualEmailDispatcher;
use FairEvents\Notifications\IndividualEmailSettings;
use FairEvents\Notifications\ScheduledSends;
use FairEvents\Notifications\WeeklySendSchedule;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * The cron lifecycle both weekly emails share: one queued send per
 * configuration, rescheduled on settings changes, kept while overdue,
 * removed when disabled or deleted, and retried after a failed enqueue.
 */
class WeeklySendScheduleTest extends TestCase {

	/**
	 * Start from an empty site whose types were all migrated.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$migrated = array();
		foreach ( Configurations::TYPES as $type ) {
			$migrated[ $type ] = array( 'version' => ConfigurationMigration::VERSION );
		}
		$GLOBALS['_fair_test_options']   = array( ConfigurationMigration::OPTION => $migrated );
		$GLOBALS['_fair_test_cron']      = array();
		$GLOBALS['_fair_test_cron_fail'] = array();
		$GLOBALS['_fair_test_timezone']  = 'UTC';
		unset( $GLOBALS['_fair_test_cron_on_schedule'] );
	}

	/**
	 * Clean up.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		unset( $GLOBALS['_fair_test_timezone'], $GLOBALS['_fair_test_cron_on_schedule'] );
		$GLOBALS['_fair_test_cron_fail'] = array();
	}

	/**
	 * Both weekly email dispatchers with their settings class.
	 *
	 * @return array[]
	 */
	public static function dispatchers() {
		return array(
			'bulk email'       => array( BulkEmailDispatcher::class, BulkEmailSettings::class, Configurations::BULK_EMAIL ),
			'individual email' => array( IndividualEmailDispatcher::class, IndividualEmailSettings::class, Configurations::INDIVIDUAL_EMAIL ),
		);
	}

	/**
	 * Sanitized settings of a type.
	 *
	 * @param string $settings_class Settings class.
	 * @param array  $overrides      Field overrides.
	 * @return array
	 */
	private static function settings( $settings_class, array $overrides = array() ) {
		return $settings_class::sanitize(
			array_merge(
				$settings_class::defaults(),
				array(
					'enabled'     => true,
					'source_slug' => 'members',
					'recipient'   => 'team@example.com',
					'day_of_week' => 1,
					'time_of_day' => '08:00',
				),
				$overrides
			)
		);
	}

	/**
	 * The schedule a dispatcher uses.
	 *
	 * @param string $dispatcher Dispatcher class.
	 * @param string $type       Notification type.
	 * @return WeeklySendSchedule
	 */
	private static function schedule( $dispatcher, $type ) {
		return new WeeklySendSchedule( $dispatcher::HOOK, $type );
	}

	/**
	 * Queued sends of a hook, as `array( timestamp, args )`.
	 *
	 * @param string $hook Cron hook.
	 * @return array[]
	 */
	private static function queued( $hook ) {
		return ScheduledSends::events( $hook );
	}

	/**
	 * A moment in UTC.
	 *
	 * @param string $time Time.
	 * @param string $zone Timezone.
	 * @return \DateTimeImmutable
	 */
	private static function moment( $time, $zone = 'UTC' ) {
		return new \DateTimeImmutable( $time, new \DateTimeZone( $zone ) );
	}

	/**
	 * Changing the schedule replaces the queued send with one from the new
	 * settings, stored in the same option format and with the same arguments.
	 *
	 * @param string $dispatcher     Dispatcher class.
	 * @param string $settings_class Settings class.
	 * @param string $type           Notification type.
	 */
	#[DataProvider( 'dispatchers' )]
	public function test_reschedule_replaces_the_queued_send( $dispatcher, $settings_class, $type ) {
		$dispatcher::reschedule( 'first', self::settings( $settings_class ) );
		$before = $dispatcher::next_run( 'first' );

		$dispatcher::reschedule( 'first', self::settings( $settings_class, array( 'time_of_day' => '21:30' ) ) );

		$queued = self::queued( $dispatcher::HOOK );
		$next   = $dispatcher::next_run( 'first' );
		$this->assertCount( 1, $queued );
		$this->assertSame( array( $next['send_week'], 'first' ), $queued[0][1] );
		$this->assertSame( $next['timestamp'], $queued[0][0] );
		$this->assertNotSame( $before['timestamp'], $next['timestamp'] );
		$this->assertSame( '21:30', self::moment( '@' . $next['timestamp'] )->format( 'H:i' ) );
		$this->assertSame( $next, get_option( Configurations::option( 'first', 'next_run' ) ) );
	}

	/**
	 * A send that is already due is kept on an enabled settings change: it
	 * queues the following send from the new settings when it runs.
	 *
	 * @param string $dispatcher     Dispatcher class.
	 * @param string $settings_class Settings class.
	 * @param string $type           Notification type.
	 */
	#[DataProvider( 'dispatchers' )]
	public function test_overdue_send_is_kept_on_an_enabled_change( $dispatcher, $settings_class, $type ) {
		$due = time() - 60;
		$GLOBALS['_fair_test_cron'][ $dispatcher::HOOK ][] = array( $due, array( '2026-W47', 'first' ) );
		update_option(
			Configurations::option( 'first', 'next_run' ),
			array(
				'timestamp' => $due,
				'send_week' => '2026-W47',
			)
		);

		$dispatcher::reschedule( 'first', self::settings( $settings_class, array( 'day_of_week' => 4 ) ) );

		$this->assertSame( array( array( $due, array( '2026-W47', 'first' ) ) ), self::queued( $dispatcher::HOOK ) );
		$this->assertSame(
			array(
				'timestamp' => $due,
				'send_week' => '2026-W47',
			),
			$dispatcher::next_run( 'first' )
		);
	}

	/**
	 * Disabling removes the queued send, also an overdue one, and only that
	 * configuration's.
	 *
	 * @param string $dispatcher     Dispatcher class.
	 * @param string $settings_class Settings class.
	 * @param string $type           Notification type.
	 */
	#[DataProvider( 'dispatchers' )]
	public function test_disabling_removes_only_its_queued_send( $dispatcher, $settings_class, $type ) {
		$dispatcher::reschedule( 'second', self::settings( $settings_class ) );
		$second = $dispatcher::next_run( 'second' );
		$GLOBALS['_fair_test_cron'][ $dispatcher::HOOK ][] = array( time() - 60, array( '2026-W47', 'first' ) );
		update_option(
			Configurations::option( 'first', 'next_run' ),
			array(
				'timestamp' => time() - 60,
				'send_week' => '2026-W47',
			)
		);

		$dispatcher::reschedule( 'first', self::settings( $settings_class, array( 'enabled' => false ) ) );

		$this->assertNull( $dispatcher::next_run( 'first' ) );
		$this->assertFalse( get_option( Configurations::option( 'first', 'next_run' ) ) );
		$this->assertSame( $second, $dispatcher::next_run( 'second' ) );
		$this->assertSame( array( array( $second['send_week'], 'second' ) ), array_column( self::queued( $dispatcher::HOOK ), 1 ) );
	}

	/**
	 * A failed enqueue records no next send; the next initialization queues it once.
	 *
	 * @param string $dispatcher     Dispatcher class.
	 * @param string $settings_class Settings class.
	 * @param string $type           Notification type.
	 */
	#[DataProvider( 'dispatchers' )]
	public function test_failed_enqueue_is_retried_on_initialization( $dispatcher, $settings_class, $type ) {
		ini_set( 'error_log', '/dev/null' ); // phpcs:ignore WordPress.PHP.IniSet.Risky -- keeps the expected failure log out of the test output.
		$record   = Configurations::create( $type, '', self::settings( $settings_class ) );
		$schedule = self::schedule( $dispatcher, $type );
		$GLOBALS['_fair_test_cron_fail'][ $dispatcher::HOOK ] = true;

		$schedule->ensure( $record['id'], self::settings( $settings_class ) );

		$this->assertSame( array(), self::queued( $dispatcher::HOOK ) );
		$this->assertArrayNotHasKey( Configurations::option( $record['id'], 'next_run' ), $GLOBALS['_fair_test_options'] );

		$GLOBALS['_fair_test_cron_fail'] = array();
		$schedule->ensure( $record['id'], self::settings( $settings_class ) );
		$schedule->ensure( $record['id'], self::settings( $settings_class ) );

		$this->assertCount( 1, self::queued( $dispatcher::HOOK ) );
		$this->assertNotNull( $dispatcher::next_run( $record['id'] ) );
	}

	/**
	 * A send whose following send cannot be queued still runs, and leaves no
	 * next send recorded for initialization to retry.
	 *
	 * @param string $dispatcher     Dispatcher class.
	 * @param string $settings_class Settings class.
	 * @param string $type           Notification type.
	 */
	#[DataProvider( 'dispatchers' )]
	public function test_failed_enqueue_of_the_following_send_does_not_stop_the_send( $dispatcher, $settings_class, $type ) {
		ini_set( 'error_log', '/dev/null' ); // phpcs:ignore WordPress.PHP.IniSet.Risky -- keeps the expected failure log out of the test output.
		$record = Configurations::create( $type, '', self::settings( $settings_class ) );
		$GLOBALS['_fair_test_cron_fail'][ $dispatcher::HOOK ] = true;

		$this->assertTrue( self::schedule( $dispatcher, $type )->advance( $record['id'], self::settings( $settings_class ), self::moment( '2026-10-05 08:00' ) ) );
		$this->assertSame( array(), self::queued( $dispatcher::HOOK ) );
		$this->assertNull( $dispatcher::next_run( $record['id'] ) );
	}

	/**
	 * Starting a send queues the following week's send; a disabled
	 * configuration queues none.
	 *
	 * @param string $dispatcher     Dispatcher class.
	 * @param string $settings_class Settings class.
	 * @param string $type           Notification type.
	 */
	#[DataProvider( 'dispatchers' )]
	public function test_starting_a_send_queues_the_following_one( $dispatcher, $settings_class, $type ) {
		$record   = Configurations::create( $type, '', self::settings( $settings_class ) );
		$schedule = self::schedule( $dispatcher, $type );

		$this->assertTrue( $schedule->advance( $record['id'], self::settings( $settings_class ), self::moment( '2026-10-05 08:00' ) ) );
		$this->assertSame( array( array( '2026-W42', $record['id'] ) ), array_column( self::queued( $dispatcher::HOOK ), 1 ) );
		$this->assertSame( '2026-10-12 08:00', self::moment( '@' . $dispatcher::next_run( $record['id'] )['timestamp'] )->format( 'Y-m-d H:i' ) );

		$GLOBALS['_fair_test_cron'] = array();
		$this->assertTrue( $schedule->advance( $record['id'], self::settings( $settings_class, array( 'enabled' => false ) ), self::moment( '2026-10-05 08:00' ) ) );
		$this->assertSame( array(), self::queued( $dispatcher::HOOK ) );
	}

	/**
	 * A configuration deleted while its send starts or its next send is
	 * queued on load leaves nothing queued, and its send does not start.
	 *
	 * @param string $dispatcher     Dispatcher class.
	 * @param string $settings_class Settings class.
	 * @param string $type           Notification type.
	 */
	#[DataProvider( 'dispatchers' )]
	public function test_deletion_during_scheduling_leaves_nothing_queued( $dispatcher, $settings_class, $type ) {
		$record                                 = Configurations::create( $type, '', self::settings( $settings_class ) );
		$schedule                               = self::schedule( $dispatcher, $type );
		$GLOBALS['_fair_test_cron_on_schedule'] = static function () use ( $record, $dispatcher, $type ) {
			Configurations::delete( $record['id'] );
			ScheduledSends::clear_deleted( $dispatcher::HOOK, $record['id'], $type );
		};

		$this->assertFalse( $schedule->advance( $record['id'], self::settings( $settings_class ), self::moment( '2026-10-05 08:00' ) ) );
		$this->assertSame( array(), self::queued( $dispatcher::HOOK ) );
		$this->assertFalse( get_option( Configurations::option( $record['id'], 'next_run' ) ) );

		$other                                  = Configurations::create( $type, '', self::settings( $settings_class ) );
		$GLOBALS['_fair_test_cron_on_schedule'] = static function () use ( $other, $dispatcher, $type ) {
			Configurations::delete( $other['id'] );
			ScheduledSends::clear_deleted( $dispatcher::HOOK, $other['id'], $type );
		};
		$schedule->ensure( $other['id'], self::settings( $settings_class ) );

		$this->assertSame( array(), self::queued( $dispatcher::HOOK ) );
		$this->assertFalse( get_option( Configurations::option( $other['id'], 'next_run' ) ) );
	}

	/**
	 * A queued send of a deleted configuration neither runs nor queues the
	 * following one, and its run history stays.
	 *
	 * @param string $dispatcher     Dispatcher class.
	 * @param string $settings_class Settings class.
	 * @param string $type           Notification type.
	 */
	#[DataProvider( 'dispatchers' )]
	public function test_send_of_a_deleted_configuration_does_nothing( $dispatcher, $settings_class, $type ) {
		$record = Configurations::create( $type, '', self::settings( $settings_class ) );
		update_option( Configurations::option( $record['id'], 'runs' ), array( '2026-W41' => array( 'status' => 'sent' ) ) );
		Configurations::delete( $record['id'] );

		$dispatcher::handle( '2026-W42', $record['id'] );

		$this->assertSame( array(), self::queued( $dispatcher::HOOK ) );
		$this->assertFalse( get_option( Configurations::option( $record['id'], 'next_run' ) ) );
		$this->assertCount( 1, $dispatcher::runs( $record['id'] ) );
	}

	/**
	 * A send queued before configurations had IDs belongs to the type's first configuration.
	 *
	 * @param string $dispatcher     Dispatcher class.
	 * @param string $settings_class Settings class.
	 * @param string $type           Notification type.
	 */
	#[DataProvider( 'dispatchers' )]
	public function test_send_without_a_configuration_is_the_first_configuration( $dispatcher, $settings_class, $type ) {
		$schedule = self::schedule( $dispatcher, $type );

		$this->assertSame( Configurations::legacy_id( $type ), $schedule->config_id( '' ) );
		$this->assertSame( 'other', $schedule->config_id( 'other' ) );
	}

	/**
	 * Removing every send clears the hook and each configuration's next send,
	 * and leaves other types' sends alone.
	 *
	 * @param string $dispatcher     Dispatcher class.
	 * @param string $settings_class Settings class.
	 * @param string $type           Notification type.
	 */
	#[DataProvider( 'dispatchers' )]
	public function test_unschedule_all_clears_only_its_type( $dispatcher, $settings_class, $type ) {
		$record = Configurations::create( $type, '', self::settings( $settings_class ) );
		$dispatcher::reschedule( $record['id'], self::settings( $settings_class ) );
		$GLOBALS['_fair_test_cron']['fair_events_other_hook'] = array( array( time() + 60, array() ) );

		$dispatcher::unschedule_all();

		$this->assertSame( array(), self::queued( $dispatcher::HOOK ) );
		$this->assertFalse( get_option( Configurations::option( $record['id'], 'next_run' ) ) );
		$this->assertCount( 1, $GLOBALS['_fair_test_cron']['fair_events_other_hook'] );
	}

	/** Without Fair Audience able to send, loading removes queued bulk sends. */
	public function test_bulk_sends_are_removed_while_fair_audience_is_unavailable() {
		$record = Configurations::create( Configurations::BULK_EMAIL, '', self::settings( BulkEmailSettings::class ) );
		BulkEmailDispatcher::reschedule( $record['id'], self::settings( BulkEmailSettings::class ) );

		BulkEmailDispatcher::init();

		$this->assertSame( array(), self::queued( BulkEmailDispatcher::HOOK ) );
		$this->assertNull( BulkEmailDispatcher::next_run( $record['id'] ) );
	}

	/** Loading queues each enabled individual email configuration once, and none for a disabled one. */
	public function test_initialization_queues_each_enabled_configuration_once() {
		$enabled  = Configurations::create( Configurations::INDIVIDUAL_EMAIL, '', self::settings( IndividualEmailSettings::class ) );
		$disabled = Configurations::create( Configurations::INDIVIDUAL_EMAIL, '', self::settings( IndividualEmailSettings::class, array( 'enabled' => false ) ) );

		IndividualEmailDispatcher::init();
		IndividualEmailDispatcher::init();

		$this->assertSame( array( $enabled['id'] ), array_column( array_column( self::queued( IndividualEmailDispatcher::HOOK ), 1 ), 1 ) );
		$this->assertNull( IndividualEmailDispatcher::next_run( $disabled['id'] ) );
	}

	/**
	 * Send weeks across the ISO year boundary, and a used one skipped there.
	 */
	public function test_send_weeks_across_the_iso_year_boundary() {
		$settings = array(
			'day_of_week' => 7,
			'time_of_day' => '18:00',
		);
		$after    = self::moment( '2026-12-30 12:00' );

		$due = WeeklySendSchedule::next_due( $settings, $after, '' );
		$this->assertSame( '2027-01-03 18:00', $due->format( 'Y-m-d H:i' ) );
		$this->assertSame( '2026-W53', WeeklySendSchedule::iso_week( $due ) );
		$this->assertSame( '2026-12-28', WeeklySendSchedule::week_start( '2026-W53' ) );

		$skipped = WeeklySendSchedule::next_due( $settings, $after, '2026-W53' );
		$this->assertSame( '2027-01-10 18:00', $skipped->format( 'Y-m-d H:i' ) );
		$this->assertSame( '2027-W01', WeeklySendSchedule::iso_week( $skipped ) );
	}

	/**
	 * The send week follows the site timezone, not UTC.
	 */
	public function test_send_week_follows_the_site_timezone() {
		$settings = array(
			'day_of_week' => 1,
			'time_of_day' => '00:30',
		);
		$after    = self::moment( '2026-10-04 23:00', 'UTC' )->setTimezone( new \DateTimeZone( 'Europe/Madrid' ) );

		$due = WeeklySendSchedule::next_due( $settings, $after, '' );

		$this->assertSame( '2026-10-12 00:30', $due->format( 'Y-m-d H:i' ) );
		$this->assertSame( '2026-W42', WeeklySendSchedule::iso_week( $due ) );
		$this->assertSame( '2026-W41', WeeklySendSchedule::iso_week( $after ) );
	}

	/**
	 * A used send week is recorded per configuration and skipped when scheduling.
	 *
	 * @param string $dispatcher     Dispatcher class.
	 * @param string $settings_class Settings class.
	 * @param string $type           Notification type.
	 */
	#[DataProvider( 'dispatchers' )]
	public function test_used_send_week_is_skipped_when_queuing( $dispatcher, $settings_class, $type ) {
		$record = Configurations::create( $type, '', self::settings( $settings_class ) );
		WeeklySendSchedule::mark_sent( $record['id'], '2026-W42' );

		self::schedule( $dispatcher, $type )->advance( $record['id'], self::settings( $settings_class ), self::moment( '2026-10-05 08:00' ) );

		$this->assertSame( '2026-W42', WeeklySendSchedule::last_sent_week( $record['id'] ) );
		$this->assertSame( '', WeeklySendSchedule::last_sent_week( 'other' ) );
		$this->assertSame( array( array( '2026-W43', $record['id'] ) ), array_column( self::queued( $dispatcher::HOOK ), 1 ) );
	}
}
