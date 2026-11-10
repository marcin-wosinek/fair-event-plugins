<?php
/**
 * Configuration deletion tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Notifications\ConfigurationMigration;
use FairEvents\Notifications\Configurations;
use FairEvents\Notifications\IndividualEmailDispatcher;
use FairEvents\Notifications\IndividualEmailSettings;
use FairEvents\Notifications\ScheduledSends;
use FairEvents\Notifications\TelegramDispatcher;
use FairEvents\Notifications\TelegramSettings;
use PHPUnit\Framework\TestCase;

/**
 * Deleting a configuration: only it goes, its queued sends are cancelled,
 * its history stays, and no save or send started elsewhere brings it back.
 */
class ConfigurationDeletionTest extends TestCase {

	private const QUEUED_AT = 1790000000;

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
		$GLOBALS['_fair_test_options'] = array( ConfigurationMigration::OPTION => $migrated );
		$GLOBALS['_fair_test_cron']    = array();
		unset( $GLOBALS['_fair_test_cron_on_schedule'] );
	}

	/**
	 * Drop the scheduling hook.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		unset( $GLOBALS['_fair_test_cron_on_schedule'] );
	}

	/**
	 * An enabled individual email configuration.
	 *
	 * @param string $name Name.
	 * @return array Record.
	 */
	private function individual( $name = '' ) {
		$settings              = IndividualEmailSettings::defaults();
		$settings['enabled']   = true;
		$settings['recipient'] = 'team@example.com';
		return Configurations::create( Configurations::INDIVIDUAL_EMAIL, $name, IndividualEmailSettings::sanitize( $settings ) );
	}

	/**
	 * Queued sends of a hook, by configuration ID.
	 *
	 * @param string $hook Cron hook.
	 * @return array[]
	 */
	private function queued( $hook ) {
		return array_column( ScheduledSends::events( $hook ), 1 );
	}

	/** Only the selected configuration is deleted; the others and its run history stay. */
	public function test_delete_removes_only_the_selected_configuration() {
		$kept    = $this->individual( 'Kept' );
		$deleted = $this->individual( 'Deleted' );
		update_option( Configurations::option( $deleted['id'], 'runs' ), array( 'week' => 'sent' ) );
		$kept_option = $GLOBALS['_fair_test_options'][ Configurations::option( $kept['id'] ) ];

		$result = Configurations::delete( $deleted['id'] );

		$this->assertSame( 'Deleted', $result['name'] );
		$this->assertNull( Configurations::get( $deleted['id'] ) );
		$this->assertSame( array( $kept['id'] ), array_column( Configurations::all(), 'id' ) );
		$this->assertSame( $kept_option, $GLOBALS['_fair_test_options'][ Configurations::option( $kept['id'] ) ] );
		$this->assertSame( array( 'week' => 'sent' ), get_option( Configurations::option( $deleted['id'], 'runs' ) ) );
	}

	/** Deleting an unknown or malformed ID changes nothing. */
	public function test_delete_of_a_missing_configuration_changes_nothing() {
		$kept   = $this->individual();
		$before = $GLOBALS['_fair_test_options'];

		$this->assertFalse( Configurations::delete( 'unknown' ) );
		$this->assertFalse( Configurations::delete( '../other' ) );
		$this->assertSame( $before, $GLOBALS['_fair_test_options'] );
		$this->assertTrue( Configurations::exists( $kept['id'] ) );
	}

	/** A save that lands after the deletion is refused and never recreates the configuration. */
	public function test_save_after_delete_does_not_recreate_it() {
		$record = Configurations::create( Configurations::TELEGRAM, 'Members' );
		Configurations::delete( $record['id'] );

		$this->assertFalse( TelegramSettings::save( $record['id'], TelegramSettings::defaults() ) );
		$this->assertFalse( Configurations::update( $record['id'], array( 'name' => 'Back' ) ) );
		$this->assertArrayNotHasKey( Configurations::option( $record['id'] ), $GLOBALS['_fair_test_options'] );
		$this->assertSame( array(), Configurations::all() );
	}

	/** Deleting cancels the configuration's queued sends and next send, and only those. */
	public function test_clear_deleted_cancels_only_its_sends() {
		$kept                                = $this->individual();
		$deleted                             = $this->individual();
		$hook                                = IndividualEmailDispatcher::HOOK;
		$GLOBALS['_fair_test_cron'][ $hook ] = array(
			array( self::QUEUED_AT, array( '2026-W42', $kept['id'] ) ),
			array( self::QUEUED_AT, array( '2026-W42', $deleted['id'] ) ),
			array( self::QUEUED_AT + 60, array( '2026-W43', $deleted['id'] ) ),
			array( self::QUEUED_AT, array( '2026-W42' ) ),
		);
		update_option( Configurations::option( $deleted['id'], 'next_run' ), array( 'send_week' => '2026-W42' ) );

		Configurations::delete( $deleted['id'] );
		ScheduledSends::clear_deleted( $hook, $deleted['id'], Configurations::INDIVIDUAL_EMAIL );

		// A send queued without an ID belongs to the type's first configuration, not this one.
		$this->assertSame( array( array( '2026-W42', $kept['id'] ), array( '2026-W42' ) ), $this->queued( $hook ) );
		$this->assertFalse( get_option( Configurations::option( $deleted['id'], 'next_run' ) ) );
	}

	/** Deleting a type's first configuration also cancels sends queued before configurations had IDs. */
	public function test_clear_deleted_cancels_legacy_sends_of_the_first_configuration() {
		$id   = Configurations::legacy_id( Configurations::TELEGRAM );
		$hook = TelegramDispatcher::HOOK;
		Configurations::create( Configurations::TELEGRAM, '', array(), $id );
		$GLOBALS['_fair_test_cron'][ $hook ] = array(
			array( self::QUEUED_AT, array( '2026-09-14', $id ) ),
			array( self::QUEUED_AT, array( '2026-09-14' ) ),
		);

		Configurations::delete( $id );
		ScheduledSends::clear_deleted( $hook, $id, Configurations::TELEGRAM );

		$this->assertSame( array(), $this->queued( $hook ) );
	}

	/** The migration marker stays, so a deleted first configuration is not created again. */
	public function test_deleted_first_configuration_is_not_migrated_again() {
		$id = Configurations::legacy_id( Configurations::INDIVIDUAL_EMAIL );
		Configurations::create( Configurations::INDIVIDUAL_EMAIL, '', array(), $id );
		update_option( IndividualEmailSettings::OPTION, array( 'enabled' => true ) );

		Configurations::delete( $id );
		ConfigurationMigration::run();

		$this->assertNull( Configurations::get( $id ) );
	}

	/** A queued send of a deleted configuration neither runs nor queues the following one. */
	public function test_send_of_a_deleted_configuration_does_nothing() {
		$record = $this->individual();
		Configurations::delete( $record['id'] );

		IndividualEmailDispatcher::handle( '2026-W42', $record['id'] );

		$this->assertSame( array(), $this->queued( IndividualEmailDispatcher::HOOK ) );
		$this->assertFalse( get_option( Configurations::option( $record['id'], 'next_run' ) ) );
	}

	/** A deletion that lands while a send is starting leaves nothing queued and does not start it. */
	public function test_deletion_while_a_send_starts_leaves_nothing_queued() {
		$settings                                     = TelegramSettings::defaults();
		$settings['enabled']                          = true;
		$settings['providers']['telegram']['enabled'] = true;
		$record                                       = Configurations::create( Configurations::TELEGRAM, '', TelegramSettings::normalize( $settings ) );
		$GLOBALS['_fair_test_cron_on_schedule']       = static function () use ( $record ) {
			Configurations::delete( $record['id'] );
			ScheduledSends::clear_deleted( TelegramDispatcher::HOOK, $record['id'], Configurations::TELEGRAM );
		};

		TelegramDispatcher::handle( '2026-09-14', $record['id'] );

		$this->assertSame( array(), $this->queued( TelegramDispatcher::HOOK ) );
		$this->assertFalse( get_option( Configurations::option( $record['id'], 'next_run' ) ) );
		// The send itself never started, so it recorded no run.
		$this->assertFalse( get_option( Configurations::option( $record['id'], 'runs' ) ) );
	}

	/** A request that listed a configuration before it was deleted does not queue its next send. */
	public function test_deletion_while_scheduling_on_load_leaves_nothing_queued() {
		$record                                 = $this->individual();
		$GLOBALS['_fair_test_cron_on_schedule'] = static function () use ( $record ) {
			Configurations::delete( $record['id'] );
			ScheduledSends::clear_deleted( IndividualEmailDispatcher::HOOK, $record['id'], Configurations::INDIVIDUAL_EMAIL );
		};

		IndividualEmailDispatcher::init();

		$this->assertSame( array(), $this->queued( IndividualEmailDispatcher::HOOK ) );
		$this->assertFalse( get_option( Configurations::option( $record['id'], 'next_run' ) ) );
	}
}
