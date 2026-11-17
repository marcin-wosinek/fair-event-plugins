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
 * Unit tests for building the sitewide organizer node and the
 * event `organizer` reference.
 */
class OrganizationSchemaTest extends TestCase {

	/**
	 * Reset the stubbed option/theme-mod stores before each test.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options']           = array();
		$GLOBALS['_fair_test_theme_mods']        = array();
		$GLOBALS['_fair_test_attachment_urls']   = array();
		$GLOBALS['_fair_test_image_attachments'] = array();
		$GLOBALS['_fair_test_home_url']          = 'https://example.com';
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
	 * Company and NGO types are emitted as their Schema.org types and keep
	 * the organization-only `logo` property.
	 *
	 * @return void
	 */
	public function test_organization_honours_company_and_ngo_types() {
		$GLOBALS['_fair_test_theme_mods']['custom_logo'] = 42;
		$GLOBALS['_fair_test_attachment_urls'][42]       = 'https://example.com/logo.png';

		foreach ( array( 'Corporation', 'NGO' ) as $type ) {
			$GLOBALS['_fair_test_options'][ Organizer::OPTION ] = array(
				'name' => 'Acme',
				'type' => $type,
			);

			$org = OrganizationSchema::organization_to_jsonld();

			$this->assertSame( $type, $org['@type'] );
			$this->assertSame( 'https://example.com/logo.png', $org['logo'] );
			$this->assertSame( $type, OrganizationSchema::organizer_ref()['@type'] );
		}
	}

	/**
	 * A person identity uses `image` (Person has no `logo`) and keeps its
	 * address, links and contact point.
	 *
	 * @return void
	 */
	public function test_person_uses_image_instead_of_logo() {
		$GLOBALS['_fair_test_options'][ Organizer::OPTION ] = array(
			'name'             => 'Ana García',
			'type'             => 'Person',
			'address_locality' => 'Madrid',
			'same_as'          => array( 'https://example.com/ana' ),
			'contact_email'    => 'ana@example.com',
		);
		$GLOBALS['_fair_test_theme_mods']['custom_logo']    = 42;
		$GLOBALS['_fair_test_attachment_urls'][42]          = 'https://example.com/ana.jpg';

		$person = OrganizationSchema::organization_to_jsonld();

		$this->assertSame( 'Person', $person['@type'] );
		$this->assertSame( 'https://example.com/ana.jpg', $person['image'] );
		$this->assertArrayNotHasKey( 'logo', $person );
		$this->assertSame( 'Madrid', $person['address']['addressLocality'] );
		$this->assertSame( array( 'https://example.com/ana' ), $person['sameAs'] );
		$this->assertSame( 'ana@example.com', $person['contactPoint']['email'] );
		$this->assertSame( 'Person', OrganizationSchema::organizer_ref()['@type'] );
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

	/**
	 * The organizer's own `website` overrides `home_url()` in both the
	 * sitewide node and the event `organizer` reference.
	 *
	 * @return void
	 */
	public function test_website_override_used_in_url() {
		$GLOBALS['_fair_test_options'][ Organizer::OPTION ] = array(
			'name'    => 'Acme Club',
			'website' => 'https://acme.example/',
		);

		$this->assertSame( 'https://acme.example/', OrganizationSchema::organization_to_jsonld()['url'] );
		$this->assertSame( 'https://acme.example/', OrganizationSchema::organizer_ref()['url'] );
	}

	/**
	 * The organizer's `logo_id` takes priority over the `custom_logo` theme mod.
	 *
	 * @return void
	 */
	public function test_logo_id_overrides_theme_mod() {
		$GLOBALS['_fair_test_options'][ Organizer::OPTION ] = array(
			'name'    => 'Acme Club',
			'logo_id' => 7,
		);
		$GLOBALS['_fair_test_theme_mods']['custom_logo']    = 42;
		$GLOBALS['_fair_test_attachment_urls'][7]           = 'https://example.com/override-logo.png';
		$GLOBALS['_fair_test_attachment_urls'][42]          = 'https://example.com/theme-logo.png';

		$this->assertSame(
			'https://example.com/override-logo.png',
			OrganizationSchema::organization_to_jsonld()['logo']
		);
	}

	/**
	 * No contactPoint is emitted when neither contact field is set.
	 *
	 * @return void
	 */
	public function test_contact_point_omitted_when_unset() {
		$GLOBALS['_fair_test_options'][ Organizer::OPTION ] = array( 'name' => 'Acme Club' );

		$this->assertArrayNotHasKey( 'contactPoint', OrganizationSchema::organization_to_jsonld() );
	}

	/**
	 * A contactPoint with only the populated field(s) is emitted when set.
	 *
	 * @return void
	 */
	public function test_contact_point_included_when_set() {
		$GLOBALS['_fair_test_options'][ Organizer::OPTION ] = array(
			'name'          => 'Acme Club',
			'contact_email' => 'info@example.com',
			'contact_phone' => '+34 600 000 000',
		);

		$this->assertSame(
			array(
				'@type'       => 'ContactPoint',
				'contactType' => 'customer service',
				'email'       => 'info@example.com',
				'telephone'   => '+34 600 000 000',
			),
			OrganizationSchema::organization_to_jsonld()['contactPoint']
		);
	}

	/**
	 * The contactPoint is never repeated in the per-event organizer reference.
	 *
	 * @return void
	 */
	public function test_contact_point_not_in_organizer_ref() {
		$GLOBALS['_fair_test_options'][ Organizer::OPTION ] = array(
			'name'          => 'Acme Club',
			'contact_email' => 'info@example.com',
		);

		$this->assertArrayNotHasKey( 'contactPoint', OrganizationSchema::organizer_ref() );
	}

	/**
	 * Private notification recipients never reach the sitewide Organization
	 * node or the event organizer reference; the public contact email does.
	 *
	 * @return void
	 */
	public function test_notification_emails_excluded_from_public_output() {
		$GLOBALS['_fair_test_options'][ Organizer::OPTION ] = array(
			'name'                => 'Acme Club',
			'contact_email'       => 'info@example.com',
			'notification_emails' => array( 'private-team@example.com' ),
		);

		$organization = wp_json_encode( OrganizationSchema::organization_to_jsonld() );
		$reference    = wp_json_encode( OrganizationSchema::organizer_ref() );

		$this->assertStringContainsString( 'info@example.com', $organization );
		$this->assertStringNotContainsString( 'private-team@example.com', $organization );
		$this->assertStringNotContainsString( 'private-team@example.com', $reference );
	}

	/**
	 * Another organizer's node uses the given `@id`, carries its own public
	 * identity and never the private recipients or the site logo (#2305).
	 *
	 * @return void
	 */
	public function test_organizer_to_jsonld_builds_another_identity() {
		$GLOBALS['_fair_test_theme_mods']['custom_logo'] = 42;
		$GLOBALS['_fair_test_attachment_urls'][42]       = 'https://example.com/site-logo.png';

		$node = OrganizationSchema::organizer_to_jsonld(
			array(
				'id'                  => '11111111-1111-4111-8111-111111111111',
				'is_default'          => false,
				'type'                => 'SportsClub',
				'name'                => 'North Club',
				'website'             => 'https://north.example',
				'address_locality'    => 'Bilbao',
				'same_as'             => array( 'https://example.com/north' ),
				'logo_id'             => 0,
				'contact_email'       => 'hello@north.example',
				'contact_phone'       => '',
				'notification_emails' => array( 'north-team@example.com' ),
			),
			'https://example.com/#organizer-11111111-1111-4111-8111-111111111111'
		);

		$this->assertSame( 'SportsClub', $node['@type'] );
		$this->assertSame( 'https://example.com/#organizer-11111111-1111-4111-8111-111111111111', $node['@id'] );
		$this->assertSame( 'North Club', $node['name'] );
		$this->assertSame( 'https://north.example', $node['url'] );
		$this->assertSame( 'Bilbao', $node['address']['addressLocality'] );
		$this->assertSame( array( 'https://example.com/north' ), $node['sameAs'] );
		$this->assertSame( 'hello@north.example', $node['contactPoint']['email'] );
		$this->assertArrayNotHasKey( 'logo', $node );
		$this->assertStringNotContainsString( 'north-team@example.com', wp_json_encode( $node ) );
	}

	/**
	 * The sitewide node keeps its `@id` and its site logo fallback.
	 *
	 * @return void
	 */
	public function test_organization_keeps_its_identity_and_site_logo() {
		$GLOBALS['_fair_test_options'][ Organizer::OPTION ] = array( 'name' => 'Acme Club' );
		$GLOBALS['_fair_test_theme_mods']['custom_logo']    = 42;
		$GLOBALS['_fair_test_attachment_urls'][42]          = 'https://example.com/site-logo.png';

		$org = OrganizationSchema::organization_to_jsonld();

		$this->assertSame( 'https://example.com/#organization', $org['@id'] );
		$this->assertSame( 'https://example.com/site-logo.png', $org['logo'] );
	}
}
