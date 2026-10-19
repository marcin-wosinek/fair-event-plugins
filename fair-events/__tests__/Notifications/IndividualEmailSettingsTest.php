<?php
/**
 * IndividualEmailSettings tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Notifications\Configurations;
use FairEvents\Notifications\IndividualEmailSettings;
use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\DataProvider;

/**
 * Recipient and selection validation, and the stored defaults.
 */
class IndividualEmailSettingsTest extends TestCase {

	/**
	 * Reset options.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options'] = array();
	}

	/** The channel starts off, listing every local event, with no recipient. */
	public function test_starts_disabled_without_a_recipient() {
		$settings = IndividualEmailSettings::stored( 'missing' );

		$this->assertFalse( $settings['enabled'] );
		$this->assertSame( '', $settings['recipient'] );
		$this->assertSame( IndividualEmailSettings::LOCAL_EVENTS, $settings['event_selection'] );
		$this->assertSame( 1, $settings['day_of_week'] );
		$this->assertSame( '08:00', $settings['time_of_day'] );
		$this->assertTrue( $settings['skip_empty'] );
	}

	/** One plain address is accepted; surrounding spaces are not part of it. */
	public function test_accepts_one_address() {
		$this->assertSame( 'organizer@example.com', IndividualEmailSettings::parse_recipient( 'organizer@example.com' ) );
		$this->assertSame( 'team+events@example.co.uk', IndividualEmailSettings::parse_recipient( '  team+events@example.co.uk ' ) );
		$this->assertSame( '', IndividualEmailSettings::parse_recipient( '' ) );
		$this->assertSame( '', IndividualEmailSettings::parse_recipient( '   ' ) );
	}

	/**
	 * Lists, display names and header injection are refused, not repaired.
	 *
	 * @param mixed $value Recipient.
	 */
	#[DataProvider( 'invalid_recipients' )]
	public function test_refuses_anything_but_one_address( $value ) {
		$this->assertNull( IndividualEmailSettings::parse_recipient( $value ) );
	}

	/**
	 * Values that are not exactly one address.
	 *
	 * @return array[]
	 */
	public static function invalid_recipients() {
		return array(
			'comma list'       => array( 'a@example.com,b@example.com' ),
			'semicolon list'   => array( 'a@example.com; b@example.com' ),
			'space list'       => array( 'a@example.com b@example.com' ),
			'display name'     => array( 'Ann <a@example.com>' ),
			'header injection' => array( "a@example.com\r\nBcc: b@example.com" ),
			'trailing newline' => array( "a@example.com\n" ),
			'encoded newline'  => array( "a@example.com\x0BBcc:b@example.com" ),
			'no domain'        => array( 'organizer' ),
			'two at signs'     => array( 'a@b@example.com' ),
			'array'            => array( array( 'a@example.com' ) ),
			'too long'         => array( str_repeat( 'a', 250 ) . '@example.com' ),
		);
	}

	/** An invalid stored recipient never survives sanitizing. */
	public function test_sanitize_drops_an_invalid_recipient() {
		$settings = IndividualEmailSettings::sanitize(
			array(
				'enabled'   => true,
				'recipient' => "a@example.com\nBcc: b@example.com",
			)
		);

		$this->assertSame( '', $settings['recipient'] );
	}

	/** A selection is every local event or a source slug, nothing else. */
	public function test_selection_is_local_events_or_a_source_slug() {
		$this->assertTrue( IndividualEmailSettings::valid_selection( IndividualEmailSettings::LOCAL_EVENTS ) );
		$this->assertTrue( IndividualEmailSettings::valid_selection( 'city-events' ) );
		$this->assertFalse( IndividualEmailSettings::valid_selection( '' ) );
		$this->assertFalse( IndividualEmailSettings::valid_selection( 'City Events' ) );
		$this->assertFalse( IndividualEmailSettings::valid_selection( null ) );

		// A saved source slug is kept as it is, so a source that later
		// disappears is reported instead of becoming "all local events".
		$this->assertSame( 'city-events', IndividualEmailSettings::sanitize( array( 'event_selection' => 'city-events' ) )['event_selection'] );
	}

	/** Saving one configuration writes only its own option. */
	public function test_saving_uses_its_own_option() {
		Configurations::create( Configurations::INDIVIDUAL_EMAIL, '', array(), 'mine' );
		Configurations::create( Configurations::INDIVIDUAL_EMAIL, '', array(), 'other' );
		$other = $GLOBALS['_fair_test_options']['fair_events_notification_config_other'];

		IndividualEmailSettings::save(
			'mine',
			array(
				'recipient'   => 'organizer@example.com',
				'time_of_day' => '06:15',
			)
		);

		$this->assertSame( $other, $GLOBALS['_fair_test_options']['fair_events_notification_config_other'] );
		$this->assertArrayNotHasKey( IndividualEmailSettings::OPTION, $GLOBALS['_fair_test_options'] );
		$this->assertSame( '06:15', IndividualEmailSettings::stored( 'mine' )['time_of_day'] );
		$this->assertSame( '08:00', IndividualEmailSettings::stored( 'other' )['time_of_day'] );
	}

	/** The wording is sanitized like the bulk email's. */
	public function test_wording_is_sanitized() {
		$settings = IndividualEmailSettings::sanitize(
			array(
				'subject' => 'Events {week_start}',
				'intro'   => '<strong>Hello</strong><script>alert(1)</script>',
			)
		);

		$this->assertSame( 'Events {week_start}', $settings['subject'] );
		$this->assertSame( '<strong>Hello</strong>', $settings['intro'] );
	}
}
