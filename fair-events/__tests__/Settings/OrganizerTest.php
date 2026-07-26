<?php
/**
 * Organizer Settings Tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Settings;

use PHPUnit\Framework\TestCase;
use FairEvents\Settings\Organizer;

/**
 * Tests for the `fair_events_organizer` option's read accessor and sanitizer.
 */
class OrganizerTest extends TestCase {

	/**
	 * Reset the stubbed option store before each test.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options'] = array();
	}

	/**
	 * With nothing stored, get() returns a fully-populated, empty-default shape.
	 *
	 * @return void
	 */
	public function test_get_defaults_when_nothing_stored() {
		$this->assertSame(
			array(
				'name'             => '',
				'type'             => 'Organization',
				'street_address'   => '',
				'address_locality' => '',
				'address_region'   => '',
				'postal_code'      => '',
				'address_country'  => '',
				'same_as'          => array(),
			),
			Organizer::get()
		);
	}

	/**
	 * Get() surfaces stored values verbatim.
	 *
	 * @return void
	 */
	public function test_get_returns_stored_values() {
		$GLOBALS['_fair_test_options'][ Organizer::OPTION ] = array(
			'name'    => 'Acme Club',
			'type'    => 'SportsClub',
			'same_as' => array( 'https://example.com/acme' ),
		);

		$organizer = Organizer::get();

		$this->assertSame( 'Acme Club', $organizer['name'] );
		$this->assertSame( 'SportsClub', $organizer['type'] );
		$this->assertSame( array( 'https://example.com/acme' ), $organizer['same_as'] );
	}

	/**
	 * An invalid stored type falls back to Organization.
	 *
	 * @return void
	 */
	public function test_get_clamps_invalid_type() {
		$GLOBALS['_fair_test_options'][ Organizer::OPTION ] = array( 'type' => 'Person' );

		$this->assertSame( 'Organization', Organizer::get()['type'] );
	}

	/**
	 * Non-array stored option resolves to defaults.
	 *
	 * @return void
	 */
	public function test_get_handles_non_array_stored_value() {
		$GLOBALS['_fair_test_options'][ Organizer::OPTION ] = 'nope';

		$this->assertSame( array(), Organizer::get()['same_as'] );
	}

	/**
	 * Empty string fields are dropped, not stored blank.
	 *
	 * @return void
	 */
	public function test_sanitize_drops_empty_strings() {
		$sanitized = Organizer::sanitize_option(
			array(
				'name'           => '   ',
				'street_address' => 'Main St 1',
			)
		);

		$this->assertArrayNotHasKey( 'name', $sanitized );
		$this->assertSame( 'Main St 1', $sanitized['street_address'] );
	}

	/**
	 * Text fields are trimmed.
	 *
	 * @return void
	 */
	public function test_sanitize_trims_text_fields() {
		$sanitized = Organizer::sanitize_option( array( 'name' => '  Acme Club  ' ) );

		$this->assertSame( 'Acme Club', $sanitized['name'] );
	}

	/**
	 * An unknown type clamps to Organization.
	 *
	 * @return void
	 */
	public function test_sanitize_clamps_unknown_type() {
		$this->assertSame(
			'Organization',
			Organizer::sanitize_option( array( 'type' => 'Person' ) )['type']
		);
	}

	/**
	 * A known type is preserved.
	 *
	 * @return void
	 */
	public function test_sanitize_preserves_known_type() {
		$this->assertSame(
			'SportsClub',
			Organizer::sanitize_option( array( 'type' => 'SportsClub' ) )['type']
		);
	}

	/**
	 * Missing type defaults to Organization.
	 *
	 * @return void
	 */
	public function test_sanitize_defaults_missing_type() {
		$this->assertSame( 'Organization', Organizer::sanitize_option( array() )['type'] );
	}

	/**
	 * Malformed URLs are dropped from same_as.
	 *
	 * @return void
	 */
	public function test_sanitize_drops_malformed_urls() {
		$sanitized = Organizer::sanitize_option(
			array(
				'same_as' => array( 'not a url', 'https://example.com/valid', '' ),
			)
		);

		$this->assertSame( array( 'https://example.com/valid' ), $sanitized['same_as'] );
	}

	/**
	 * Duplicate URLs collapse to one entry.
	 *
	 * @return void
	 */
	public function test_sanitize_dedupes_urls() {
		$sanitized = Organizer::sanitize_option(
			array(
				'same_as' => array(
					'https://example.com/a',
					'https://example.com/a',
				),
			)
		);

		$this->assertSame( array( 'https://example.com/a' ), $sanitized['same_as'] );
	}

	/**
	 * A non-array same_as value sanitizes to an empty list.
	 *
	 * @return void
	 */
	public function test_sanitize_non_array_same_as_returns_empty() {
		$this->assertSame( array(), Organizer::sanitize_option( array( 'same_as' => 'nope' ) )['same_as'] );
	}

	/**
	 * Non-array top-level input sanitizes to an empty array.
	 *
	 * @return void
	 */
	public function test_sanitize_non_array_input_returns_empty() {
		$this->assertSame( array(), Organizer::sanitize_option( 'nope' ) );
	}
}
