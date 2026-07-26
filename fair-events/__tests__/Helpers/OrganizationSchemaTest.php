<?php
/**
 * Tests for OrganizationSchema JSON-LD shaping.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Helpers;

use PHPUnit\Framework\TestCase;
use FairEvents\Helpers\OrganizationSchema;
use FairEvents\Settings\Organizer;

/**
 * Unit tests for building the sitewide Organization/SportsClub node and the
 * event `organizer` reference.
 */
class OrganizationSchemaTest extends TestCase {

	/**
	 * Reset the stubbed option/theme-mod stores before each test.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options']         = array();
		$GLOBALS['_fair_test_theme_mods']      = array();
		$GLOBALS['_fair_test_attachment_urls'] = array();
		$GLOBALS['_fair_test_home_url']        = 'https://example.com';
	}

	/**
	 * With no name configured, the sitewide block is null.
	 *
	 * @return void
	 */
	public function test_organization_null_when_no_name() {
		$this->assertNull( OrganizationSchema::organization_to_jsonld() );
	}

	/**
	 * A configured name yields a minimal Organization node.
	 *
	 * @return void
	 */
	public function test_organization_minimal_with_name_only() {
		$GLOBALS['_fair_test_options'][ Organizer::OPTION ] = array( 'name' => 'Acme Club' );

		$org = OrganizationSchema::organization_to_jsonld();

		$this->assertSame( 'Organization', $org['@type'] );
		$this->assertSame( 'https://example.com/#organization', $org['@id'] );
		$this->assertSame( 'Acme Club', $org['name'] );
		$this->assertSame( 'https://example.com', $org['url'] );
		$this->assertArrayNotHasKey( 'address', $org );
		$this->assertArrayNotHasKey( 'sameAs', $org );
		$this->assertArrayNotHasKey( 'logo', $org );
	}

	/**
	 * The configured type (SportsClub) is honoured.
	 *
	 * @return void
	 */
	public function test_organization_honours_sports_club_type() {
		$GLOBALS['_fair_test_options'][ Organizer::OPTION ] = array(
			'name' => 'Acme Club',
			'type' => 'SportsClub',
		);

		$this->assertSame( 'SportsClub', OrganizationSchema::organization_to_jsonld()['@type'] );
	}

	/**
	 * A partial address only includes the filled parts.
	 *
	 * @return void
	 */
	public function test_organization_partial_address() {
		$GLOBALS['_fair_test_options'][ Organizer::OPTION ] = array(
			'name'             => 'Acme Club',
			'address_locality' => 'Madrid',
			'address_country'  => 'ES',
		);

		$address = OrganizationSchema::organization_to_jsonld()['address'];

		$this->assertSame( 'PostalAddress', $address['@type'] );
		$this->assertSame( 'Madrid', $address['addressLocality'] );
		$this->assertSame( 'ES', $address['addressCountry'] );
		$this->assertArrayNotHasKey( 'streetAddress', $address );
	}

	/**
	 * The `sameAs` list is included when links are configured.
	 *
	 * @return void
	 */
	public function test_organization_includes_same_as() {
		$GLOBALS['_fair_test_options'][ Organizer::OPTION ] = array(
			'name'    => 'Acme Club',
			'same_as' => array( 'https://example.com/acme' ),
		);

		$this->assertSame(
			array( 'https://example.com/acme' ),
			OrganizationSchema::organization_to_jsonld()['sameAs']
		);
	}

	/**
	 * The logo is omitted when the site has none set.
	 *
	 * @return void
	 */
	public function test_organization_omits_logo_when_unset() {
		$GLOBALS['_fair_test_options'][ Organizer::OPTION ] = array( 'name' => 'Acme Club' );

		$this->assertArrayNotHasKey( 'logo', OrganizationSchema::organization_to_jsonld() );
	}

	/**
	 * The logo is included, resolved from the custom_logo theme mod.
	 *
	 * @return void
	 */
	public function test_organization_includes_logo_when_set() {
		$GLOBALS['_fair_test_options'][ Organizer::OPTION ] = array( 'name' => 'Acme Club' );
		$GLOBALS['_fair_test_theme_mods']['custom_logo']    = 42;
		$GLOBALS['_fair_test_attachment_urls'][42]          = 'https://example.com/logo.png';

		$this->assertSame(
			'https://example.com/logo.png',
			OrganizationSchema::organization_to_jsonld()['logo']
		);
	}

	/**
	 * The logo is omitted when the theme mod points at a deleted attachment.
	 *
	 * @return void
	 */
	public function test_organization_omits_logo_when_attachment_gone() {
		$GLOBALS['_fair_test_options'][ Organizer::OPTION ] = array( 'name' => 'Acme Club' );
		$GLOBALS['_fair_test_theme_mods']['custom_logo']    = 42;

		$this->assertArrayNotHasKey( 'logo', OrganizationSchema::organization_to_jsonld() );
	}

	/**
	 * With no name configured, organizer_ref() falls back to the site
	 * name/home URL, verbatim, without an @id.
	 *
	 * @return void
	 */
	public function test_organizer_ref_fallback_unconfigured() {
		$GLOBALS['_fair_test_bloginfo'] = array( 'name' => 'Test Site' );

		$this->assertSame(
			array(
				'@type' => 'Organization',
				'name'  => 'Test Site',
				'url'   => 'https://example.com',
			),
			OrganizationSchema::organizer_ref()
		);
	}

	/**
	 * With a name configured, organizer_ref() references the sitewide node.
	 *
	 * @return void
	 */
	public function test_organizer_ref_uses_configured_identity() {
		$GLOBALS['_fair_test_options'][ Organizer::OPTION ] = array(
			'name' => 'Acme Club',
			'type' => 'SportsClub',
		);

		$this->assertSame(
			array(
				'@type' => 'SportsClub',
				'@id'   => 'https://example.com/#organization',
				'name'  => 'Acme Club',
				'url'   => 'https://example.com',
			),
			OrganizationSchema::organizer_ref()
		);
	}
}
