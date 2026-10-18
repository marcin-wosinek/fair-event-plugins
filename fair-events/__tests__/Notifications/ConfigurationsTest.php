<?php
/**
 * Configurations tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Notifications\BulkEmailSettings;
use FairEvents\Notifications\Configurations;
use FairEvents\Notifications\TelegramSettings;
use PHPUnit\Framework\TestCase;

/**
 * Notification configurations: identity, separate storage and listing.
 */
class ConfigurationsTest extends TestCase {

	/**
	 * Start from an empty site.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options'] = array();
	}

	/** New configurations get distinct server-generated IDs and keep their type. */
	public function test_new_configurations_get_their_own_ids() {
		$first  = Configurations::create( Configurations::TELEGRAM, 'Members' );
		$second = Configurations::create( Configurations::TELEGRAM, 'Public' );

		$this->assertNotSame( $first['id'], $second['id'] );
		$this->assertTrue( Configurations::valid_id( $first['id'] ) );
		$this->assertSame( array( $first['id'], $second['id'] ), array_column( Configurations::all( Configurations::TELEGRAM ), 'id' ) );
		$this->assertSame( 'Members', Configurations::get( $first['id'] )['name'] );
		$this->assertTrue( Configurations::exists( $first['id'], Configurations::TELEGRAM ) );
		$this->assertFalse( Configurations::exists( $first['id'], Configurations::BULK_EMAIL ) );
	}

	/** Unknown types and malformed IDs are refused. */
	public function test_invalid_types_and_ids_are_refused() {
		$this->assertNull( Configurations::create( 'sms' ) );
		$this->assertNull( Configurations::create( Configurations::TELEGRAM, '', array(), 'Not valid!' ) );
		$this->assertNull( Configurations::get( '../other' ) );
		$this->assertSame( array(), Configurations::all() );
	}

	/** Creating a fixed ID again returns it unchanged, never overwriting edits. */
	public function test_fixed_id_is_created_once() {
		Configurations::create( Configurations::TELEGRAM, '', array( 'time_of_day' => '10:00' ), 'telegram' );
		TelegramSettings::save( 'telegram', array( 'time_of_day' => '18:45' ) );

		$again = Configurations::create( Configurations::TELEGRAM, '', array( 'time_of_day' => '10:00' ), 'telegram' );

		$this->assertSame( '18:45', $again['settings']['time_of_day'] );
		$this->assertCount( 1, Configurations::all() );
	}

	/** Saving one configuration rewrites only its own option. */
	public function test_each_configuration_is_stored_separately() {
		$first  = Configurations::create( Configurations::TELEGRAM );
		$second = Configurations::create( Configurations::TELEGRAM );
		$before = $GLOBALS['_fair_test_options'][ Configurations::option( $second['id'] ) ];
		$index  = $GLOBALS['_fair_test_options'][ Configurations::INDEX_OPTION ];

		TelegramSettings::save( $first['id'], array( 'day_of_week' => 5 ) );
		Configurations::update( $first['id'], array( 'name' => 'Renamed' ) );

		$this->assertSame( 5, TelegramSettings::get( $first['id'] )['day_of_week'] );
		$this->assertSame( 'Renamed', Configurations::get( $first['id'] )['name'] );
		$this->assertSame( $before, $GLOBALS['_fair_test_options'][ Configurations::option( $second['id'] ) ] );
		$this->assertSame( $index, $GLOBALS['_fair_test_options'][ Configurations::INDEX_OPTION ] );
	}

	/** Names are plain text and bounded. */
	public function test_names_are_sanitized() {
		$record = Configurations::create( Configurations::INDIVIDUAL_EMAIL, '  <b>Team</b>  ' . str_repeat( 'x', 200 ) );

		$this->assertStringStartsWith( '<b>Team</b>', $record['name'] );
		$this->assertSame( Configurations::MAX_NAME_LENGTH, mb_strlen( $record['name'] ) );
	}

	/** Fair Audience's summary says whether any bulk email configuration is on. */
	public function test_bulk_email_summary_covers_every_configuration() {
		$first  = Configurations::create( Configurations::BULK_EMAIL );
		$second = Configurations::create( Configurations::BULK_EMAIL );

		BulkEmailSettings::save( $first['id'], array( 'source_slug' => 'members' ) );
		$summary = get_option( BulkEmailSettings::OPTION );
		$this->assertFalse( $summary['enabled'] );
		$this->assertTrue( $summary['configured'] );
		$this->assertSame( 2, $summary['configurations'] );

		BulkEmailSettings::save(
			$second['id'],
			array(
				'enabled'     => true,
				'source_slug' => 'public',
			)
		);
		$this->assertTrue( get_option( BulkEmailSettings::OPTION )['enabled'] );
	}
}
