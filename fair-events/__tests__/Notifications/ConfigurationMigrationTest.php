<?php
/**
 * ConfigurationMigration tests
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
use FairEvents\Notifications\Ownership;
use FairEvents\Notifications\TelegramDispatcher;
use FairEvents\Notifications\TelegramSettings;
use PHPUnit\Framework\TestCase;

/**
 * Giving each type's former single settings, state and queued sends a
 * configuration ID.
 */
class ConfigurationMigrationTest extends TestCase {
	private const QUEUED_AT = 1791010800;

	/**
	 * Start from a site where Fair Events took both channels over.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options']     = array(
			Ownership::OPTION => array(
				Ownership::TELEGRAM   => array( 'migrated_at' => '2026-09-01 00:00:00' ),
				Ownership::BULK_EMAIL => array( 'migrated_at' => '2026-09-01 00:00:00' ),
			),
		);
		$GLOBALS['_fair_test_cron']        = array();
		$GLOBALS['_fair_test_sent_emails'] = array();
	}

	/**
	 * Seed the individual email as it was saved before configurations had IDs.
	 *
	 * @return void
	 */
	private function seed_individual_email() {
		$GLOBALS['_fair_test_options'][ IndividualEmailSettings::OPTION ]                    = array(
			'enabled'     => true,
			'recipient'   => 'organizer@example.com',
			'day_of_week' => 3,
			'time_of_day' => '06:45',
			'subject'     => 'Our week',
		);
		$GLOBALS['_fair_test_options'][ IndividualEmailDispatcher::LEGACY_RUNS_OPTION ]      = array( '2026-W41' => array( 'status' => 'sent' ) );
		$GLOBALS['_fair_test_options'][ IndividualEmailDispatcher::LEGACY_LAST_SENT_OPTION ] = '2026-W41';
		$GLOBALS['_fair_test_options'][ IndividualEmailDispatcher::LEGACY_NEXT_RUN_OPTION ]  = array(
			'timestamp' => self::QUEUED_AT,
			'send_week' => '2026-W42',
		);
		$GLOBALS['_fair_test_cron'][ IndividualEmailDispatcher::HOOK ]                       = array( array( self::QUEUED_AT, array( '2026-W42' ) ) );
	}

	/** Settings, on/off state, history and the last sent week move to the type's configuration. */
	public function test_settings_and_state_move_to_the_configuration() {
		$this->seed_individual_email();

		ConfigurationMigration::run();

		$settings = IndividualEmailSettings::stored( 'individual_email' );
		$this->assertTrue( $settings['enabled'] );
		$this->assertSame( 'organizer@example.com', $settings['recipient'] );
		$this->assertSame( '06:45', $settings['time_of_day'] );
		$this->assertSame( 'Our week', $settings['subject'] );
		$this->assertSame( 'sent', IndividualEmailDispatcher::runs( 'individual_email' )[0]['status'] );
		$this->assertSame( '2026-W41', BulkEmailDispatcher::last_sent_week( 'individual_email' ) );
		$this->assertTrue( ConfigurationMigration::is_migrated( Configurations::INDIVIDUAL_EMAIL ) );
	}

	/** A queued send keeps its time and week and gains the configuration; nothing is sent. */
	public function test_queued_send_is_requeued_with_the_configuration() {
		$this->seed_individual_email();

		ConfigurationMigration::run();

		$this->assertSame(
			array( array( self::QUEUED_AT, array( '2026-W42', 'individual_email' ) ) ),
			$GLOBALS['_fair_test_cron'][ IndividualEmailDispatcher::HOOK ]
		);
		$this->assertSame(
			array(
				'timestamp' => self::QUEUED_AT,
				'send_week' => '2026-W42',
			),
			IndividualEmailDispatcher::next_run( 'individual_email' )
		);
		$this->assertArrayNotHasKey( IndividualEmailDispatcher::LEGACY_NEXT_RUN_OPTION, $GLOBALS['_fair_test_options'] );
		$this->assertSame( array(), $GLOBALS['_fair_test_sent_emails'] );
	}

	/** Running it again changes nothing, also after the configuration was edited. */
	public function test_migration_can_run_again() {
		$this->seed_individual_email();
		ConfigurationMigration::run();
		IndividualEmailSettings::save( 'individual_email', array( 'recipient' => 'new@example.com' ) );
		$GLOBALS['_fair_test_options'][ ConfigurationMigration::OPTION ] = array();
		$options = $GLOBALS['_fair_test_options'];
		$cron    = $GLOBALS['_fair_test_cron'];

		ConfigurationMigration::run();

		$this->assertSame( 'new@example.com', IndividualEmailSettings::stored( 'individual_email' )['recipient'] );
		$this->assertCount( 3, Configurations::all() );
		$this->assertSame( $cron, $GLOBALS['_fair_test_cron'] );
		unset( $options[ ConfigurationMigration::OPTION ], $GLOBALS['_fair_test_options'][ ConfigurationMigration::OPTION ] );
		$this->assertSame( $options, $GLOBALS['_fair_test_options'] );
	}

	/** An interrupted migration resumes without duplicating sends or overwriting edits. */
	public function test_interrupted_migration_resumes() {
		$this->seed_individual_email();
		// The first attempt created the configuration and re-queued the send, then stopped.
		Configurations::create( Configurations::INDIVIDUAL_EMAIL, 'Edited', IndividualEmailSettings::sanitize( array( 'recipient' => 'edited@example.com' ) ), 'individual_email' );
		$GLOBALS['_fair_test_cron'][ IndividualEmailDispatcher::HOOK ][] = array( self::QUEUED_AT, array( '2026-W42', 'individual_email' ) );

		ConfigurationMigration::run();

		$this->assertSame( 'edited@example.com', IndividualEmailSettings::stored( 'individual_email' )['recipient'] );
		$this->assertSame( 'Edited', Configurations::get( 'individual_email' )['name'] );
		$this->assertSame(
			array( array( self::QUEUED_AT, array( '2026-W42', 'individual_email' ) ) ),
			$GLOBALS['_fair_test_cron'][ IndividualEmailDispatcher::HOOK ]
		);
		$this->assertTrue( ConfigurationMigration::is_migrated( Configurations::INDIVIDUAL_EMAIL ) );
	}

	/** A type that was never set up gets its configuration, turned off. */
	public function test_unused_types_get_a_paused_configuration() {
		ConfigurationMigration::run();

		$this->assertSame( array( 'telegram', 'bulk_email', 'individual_email' ), array_column( Configurations::all(), 'id' ) );
		$this->assertFalse( TelegramSettings::get( 'telegram' )['enabled'] );
		$this->assertFalse( BulkEmailSettings::stored( 'bulk_email' )['enabled'] );
		$this->assertFalse( IndividualEmailSettings::stored( 'individual_email' )['enabled'] );
		$this->assertTrue( ConfigurationMigration::is_complete() );
		$this->assertSame( array(), $GLOBALS['_fair_test_cron'] );
	}

	/** Telegram keeps its on state, chats and queued send. */
	public function test_telegram_keeps_its_state() {
		$GLOBALS['_fair_test_options'][ TelegramSettings::OPTION ]                   = array(
			'enabled'     => true,
			'source_slug' => 'city',
			'page_id'     => 12,
			'providers'   => array(
				'telegram' => array(
					'enabled'  => true,
					'chat_ids' => array( '@city' ),
				),
			),
		);
		$GLOBALS['_fair_test_options'][ TelegramDispatcher::LEGACY_NEXT_RUN_OPTION ] = array(
			'timestamp'  => self::QUEUED_AT,
			'week_start' => '2026-10-12',
		);
		$GLOBALS['_fair_test_cron'][ TelegramDispatcher::HOOK ]                      = array( array( self::QUEUED_AT, array( '2026-10-12' ) ) );

		ConfigurationMigration::run();

		$settings = TelegramSettings::get( 'telegram' );
		$this->assertTrue( $settings['enabled'] );
		$this->assertSame( array( '@city' ), $settings['providers']['telegram']['chat_ids'] );
		$this->assertSame( '2026-10-12', TelegramDispatcher::next_run( 'telegram' )['week_start'] );
		$this->assertSame( self::QUEUED_AT, TelegramDispatcher::next_run( 'telegram' )['timestamp'] );
	}

	/** A channel still sent by its former owner waits, and migrates once it is taken over. */
	public function test_channel_taken_over_later_migrates_then() {
		unset( $GLOBALS['_fair_test_options'][ Ownership::OPTION ][ Ownership::BULK_EMAIL ] );

		ConfigurationMigration::run();

		$this->assertFalse( Configurations::exists( 'bulk_email' ) );
		$this->assertFalse( ConfigurationMigration::is_migrated( Configurations::BULK_EMAIL ) );
		$this->assertFalse( ConfigurationMigration::is_complete() );

		// The takeover copies Fair Audience's settings, then the next run migrates them.
		$GLOBALS['_fair_test_options'][ Ownership::OPTION ][ Ownership::BULK_EMAIL ]   = array( 'migrated_at' => '2026-10-01 00:00:00' );
		$GLOBALS['_fair_test_options'][ BulkEmailSettings::OPTION ]                    = array(
			'enabled'     => true,
			'source_slug' => 'members',
		);
		$GLOBALS['_fair_test_options'][ BulkEmailDispatcher::LEGACY_LAST_SENT_OPTION ] = '2026-W40';

		ConfigurationMigration::run();

		$this->assertTrue( BulkEmailSettings::stored( 'bulk_email' )['enabled'] );
		$this->assertSame( '2026-W40', BulkEmailDispatcher::last_sent_week( 'bulk_email' ) );
		$this->assertTrue( ConfigurationMigration::is_complete() );
	}

	/** Once migrated, the bulk email option holds Fair Audience's summary, and is not migrated again. */
	public function test_bulk_email_option_becomes_a_summary() {
		$GLOBALS['_fair_test_options'][ BulkEmailSettings::OPTION ] = array(
			'enabled'     => true,
			'source_slug' => 'members',
			'subject'     => 'Weekly',
		);

		ConfigurationMigration::run();

		$this->assertSame(
			array(
				'summary'        => true,
				'enabled'        => true,
				'configured'     => true,
				'configurations' => 1,
			),
			get_option( BulkEmailSettings::OPTION )
		);
		$this->assertSame( 'Weekly', BulkEmailSettings::stored( 'bulk_email' )['subject'] );
	}
}
