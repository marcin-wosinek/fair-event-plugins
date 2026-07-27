<?php
/**
 * Tests for the vendored FairEventsShared\Admin\SettingsPage.
 *
 * Lives in fair-events/__tests__/ per TESTING.md — this plugin already has
 * phpunit.xml, a stub bootstrap, and `npm run test:php` wired into CI, and it
 * tests exactly the vendored copy that ships in this plugin's build.
 *
 * @package FairEvents
 */

namespace FairEventsShared\Tests\Admin;

use PHPUnit\Framework\TestCase;
use FairEventsShared\Admin\SettingsPage;

/**
 * Tests the save-handler gating logic and the extension-point filter.
 */
class SettingsPageTest extends TestCase {

	/**
	 * Reset the stubbed option store and filter registry before each test.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options']             = array();
		$GLOBALS['_fair_test_update_option_calls'] = array();
		$GLOBALS['_fair_test_filters']             = array();
	}

	/**
	 * A field id absent from the posted allowlist is skipped entirely — its
	 * option is left untouched. `$posted_ids` is a form-integrity allowlist
	 * (protects against a truncated or forged POST flipping a field that was
	 * never rendered), not a deactivation guard — see
	 * test_build_updates_ignores_ids_with_no_registered_field() for that.
	 *
	 * @return void
	 */
	public function test_build_updates_skips_fields_not_in_the_posted_allowlist() {
		$fields = array(
			array(
				'id'     => 'fair-events/bundled-translations',
				'option' => 'fair_events_features',
				'key'    => 'bundled-translations',
				'locked' => false,
			),
		);

		$updates = SettingsPage::build_updates( $fields, array(), array() );

		$this->assertSame( array(), $updates );
	}

	/**
	 * A posted+checked id with no matching entry in `$fields` (its plugin was
	 * deactivated between page load and submit, so collect_fields() no
	 * longer returns its descriptor) writes nothing. This is the real
	 * deactivation guard — re-collecting `$fields` at save time, not the
	 * `$posted_ids` allowlist.
	 *
	 * @return void
	 */
	public function test_build_updates_ignores_ids_with_no_registered_field() {
		$updates = SettingsPage::build_updates(
			array(),
			array( 'fair-form/bundled-translations' ),
			array( 'fair-form/bundled-translations' )
		);

		$this->assertSame( array(), $updates );
	}

	/**
	 * A posted field whose checkbox was not checked resolves to false, not
	 * "leave alone" — matching real HTML checkbox semantics.
	 *
	 * @return void
	 */
	public function test_build_updates_resolves_unchecked_box_to_false() {
		$fields = array(
			array(
				'id'     => 'fair-events/bundled-translations',
				'option' => 'fair_events_features',
				'key'    => 'bundled-translations',
				'locked' => false,
			),
		);

		$updates = SettingsPage::build_updates( $fields, array( 'fair-events/bundled-translations' ), array() );

		$this->assertSame(
			array( 'fair_events_features' => array( 'bundled-translations' => false ) ),
			$updates
		);
	}

	/**
	 * A locked field is never written, even when posted and checked — the UI
	 * cannot override a wp-config decision.
	 *
	 * @return void
	 */
	public function test_build_updates_never_writes_locked_fields() {
		$fields = array(
			array(
				'id'     => 'fair-audience/bundled-translations',
				'option' => 'fair_audience_features',
				'key'    => 'bundled-translations',
				'locked' => true,
			),
		);

		$updates = SettingsPage::build_updates(
			$fields,
			array( 'fair-audience/bundled-translations' ),
			array( 'fair-audience/bundled-translations' )
		);

		$this->assertSame( array(), $updates );
	}

	/**
	 * Multiple fields targeting the same option are grouped into a single
	 * key => bool map for that option.
	 *
	 * @return void
	 */
	public function test_build_updates_groups_multiple_keys_for_the_same_option() {
		$fields = array(
			array(
				'id'     => 'fair-events/bundled-translations',
				'option' => 'fair_events_features',
				'key'    => 'bundled-translations',
				'locked' => false,
			),
			array(
				'id'     => 'fair-events/some-other-setting',
				'option' => 'fair_events_features',
				'key'    => 'some-other-setting',
				'locked' => false,
			),
		);

		$posted_ids  = array( 'fair-events/bundled-translations', 'fair-events/some-other-setting' );
		$checked_ids = array( 'fair-events/some-other-setting' );

		$updates = SettingsPage::build_updates( $fields, $posted_ids, $checked_ids );

		$this->assertSame(
			array(
				'fair_events_features' => array(
					'bundled-translations' => false,
					'some-other-setting'   => true,
				),
			),
			$updates
		);
	}

	/**
	 * Malformed descriptors (missing id/option/key) are dropped by
	 * collect_fields(), and defaults are filled in for the rest.
	 *
	 * @return void
	 */
	public function test_collect_fields_drops_malformed_entries_and_fills_defaults() {
		$GLOBALS['_fair_test_filters']['fair_event_plugins_settings_fields'] = function ( $fields ) {
			$fields[] = array(
				'id'     => '',
				'option' => 'x',
				'key'    => 'y',
			); // Missing id — dropped.
			$fields[] = array(
				'option' => 'x',
				'key'    => 'y',
			); // No id key at all — dropped.
			$fields[] = array(
				'id'     => 'fair-events/bundled-translations',
				'option' => 'fair_events_features',
				'key'    => 'bundled-translations',
				'label'  => 'Fair Events',
			);
			return $fields;
		};

		$fields = SettingsPage::collect_fields();

		$this->assertCount( 1, $fields );
		$this->assertSame( 'fair-events/bundled-translations', $fields[0]['id'] );
		$this->assertSame( 'general', $fields[0]['section'] );
		$this->assertFalse( $fields[0]['locked'] );
		$this->assertSame( '', $fields[0]['description'] );
	}

	/**
	 * A field registered by an arbitrary third party via the
	 * `fair_event_plugins_settings_fields` filter is picked up alongside
	 * fields from any other plugin — the extension-point contract.
	 *
	 * @return void
	 */
	public function test_collect_fields_picks_up_third_party_registration() {
		$GLOBALS['_fair_test_filters']['fair_event_plugins_settings_fields'] = function ( $fields ) {
			$fields[] = array(
				'section' => 'third-party',
				'id'      => 'acme/some-setting',
				'option'  => 'acme_settings',
				'key'     => 'some-setting',
				'label'   => 'Acme setting',
				'value'   => true,
			);
			return $fields;
		};

		$fields = SettingsPage::collect_fields();

		$this->assertCount( 1, $fields );
		$this->assertSame( 'acme/some-setting', $fields[0]['id'] );
		$this->assertSame( 'acme_settings', $fields[0]['option'] );
		$this->assertTrue( $fields[0]['value'] );
	}

	/**
	 * Saving groups all changed keys for the same option into a single
	 * update_option() call, and leaves the stored value untouched for a
	 * locked field.
	 *
	 * @return void
	 */
	public function test_save_writes_each_option_once_and_respects_locked_fields() {
		$fields = array(
			array(
				'id'     => 'fair-events/bundled-translations',
				'option' => 'fair_events_features',
				'key'    => 'bundled-translations',
				'locked' => false,
			),
			array(
				'id'     => 'fair-events/ticketing',
				'option' => 'fair_events_features',
				'key'    => 'ticketing',
				'locked' => true,
			),
			array(
				'id'     => 'fair-audience/bundled-translations',
				'option' => 'fair_audience_features',
				'key'    => 'bundled-translations',
				'locked' => false,
			),
		);

		$GLOBALS['_fair_test_options']['fair_events_features']   = array( 'ticketing' => true );
		$GLOBALS['_fair_test_options']['fair_audience_features'] = array();

		$posted = array(
			'fair_event_plugins_fields' => array(
				'fair-events/bundled-translations',
				'fair-events/ticketing',
				'fair-audience/bundled-translations',
			),
			'fair_event_plugins_values' => array(
				'fair-events/bundled-translations'   => '1',
				'fair-events/ticketing'              => '1',
				'fair-audience/bundled-translations' => '1',
			),
		);

		$updates = SettingsPage::save( $fields, $posted );

		$this->assertSame(
			array(
				'fair_events_features'   => array( 'bundled-translations' => true ),
				'fair_audience_features' => array( 'bundled-translations' => true ),
			),
			$updates
		);

		// One update_option() call per distinct option — not per field.
		$this->assertSame(
			array( 'fair_events_features', 'fair_audience_features' ),
			$GLOBALS['_fair_test_update_option_calls']
		);

		// Locked ticketing key is untouched by the write.
		$this->assertTrue( $GLOBALS['_fair_test_options']['fair_events_features']['ticketing'] );
	}
}
