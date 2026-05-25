<?php
/**
 * Settings Tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Settings;

use PHPUnit\Framework\TestCase;
use FairEvents\Settings\Settings;

/**
 * Test enabled-post-types resolution and the Events CPT switch.
 */
class SettingsTest extends TestCase {
	/**
	 * Reset the stubbed option store before each test.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options'] = array();
	}

	/**
	 * Sanitizing no longer force-adds fair_event.
	 *
	 * @return void
	 */
	public function test_sanitize_drops_fair_event() {
		$settings = new Settings();
		$this->assertSame(
			array( 'page' ),
			$settings->sanitize_enabled_post_types( array( 'fair_event', 'page' ) )
		);
	}

	/**
	 * Sanitizing dedupes and drops empties.
	 *
	 * @return void
	 */
	public function test_sanitize_dedupes_and_filters() {
		$settings = new Settings();
		$this->assertSame(
			array( 'post' ),
			$settings->sanitize_enabled_post_types( array( 'post', 'post', '' ) )
		);
	}

	/**
	 * Non-array input sanitizes to an empty list.
	 *
	 * @return void
	 */
	public function test_sanitize_non_array_returns_empty() {
		$settings = new Settings();
		$this->assertSame( array(), $settings->sanitize_enabled_post_types( 'nope' ) );
	}

	/**
	 * With the switch on, fair_event is present in the effective list.
	 *
	 * @return void
	 */
	public function test_get_enabled_includes_fair_event_when_switch_on() {
		$GLOBALS['_fair_test_options']['fair_events_register_post_type'] = true;
		$GLOBALS['_fair_test_options']['fair_events_enabled_post_types'] = array( 'page' );
		$this->assertSame( array( 'fair_event', 'page' ), Settings::get_enabled_post_types() );
	}

	/**
	 * With the switch off, fair_event is dropped from the effective list.
	 *
	 * @return void
	 */
	public function test_get_enabled_excludes_fair_event_when_switch_off() {
		$GLOBALS['_fair_test_options']['fair_events_register_post_type'] = false;
		$GLOBALS['_fair_test_options']['fair_events_enabled_post_types'] = array( 'fair_event', 'page' );
		$this->assertSame( array( 'page' ), Settings::get_enabled_post_types() );
	}

	/**
	 * With the switch off and no other type, fall back to page.
	 *
	 * @return void
	 */
	public function test_get_enabled_falls_back_to_page_when_off_and_empty() {
		$GLOBALS['_fair_test_options']['fair_events_register_post_type'] = false;
		$GLOBALS['_fair_test_options']['fair_events_enabled_post_types'] = array();
		$this->assertSame( array( 'page' ), Settings::get_enabled_post_types() );
	}

	/**
	 * Defaults (nothing stored) resolve to just the Events CPT.
	 *
	 * @return void
	 */
	public function test_get_enabled_defaults_to_fair_event() {
		$this->assertSame( array( 'fair_event' ), Settings::get_enabled_post_types() );
	}
}
