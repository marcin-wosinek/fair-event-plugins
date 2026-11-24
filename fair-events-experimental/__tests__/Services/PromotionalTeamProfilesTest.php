<?php
/**
 * PromotionalTeamProfiles normalization tests
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairEventsExperimental\Services\PromotionalTeamProfiles;

/**
 * Validates the campaign-facts v1 normalization of profile fields (#2421).
 * The database and attachment reads are exercised by the API spec and a
 * WordPress integration check, not here.
 */
class PromotionalTeamProfilesTest extends TestCase {

	/**
	 * Display name joins trimmed name and surname.
	 */
	public function test_display_name_joins_trimmed_name_and_surname() {
		$this->assertSame( 'Ana Ruiz', PromotionalTeamProfiles::display_name( '  Ana ', ' Ruiz  ' ) );
	}

	/**
	 * Single name stays intact.
	 */
	public function test_single_name_stays_intact() {
		$this->assertSame( 'Madonna', PromotionalTeamProfiles::display_name( 'Madonna', '' ) );
		$this->assertSame( 'Madonna', PromotionalTeamProfiles::display_name( 'Madonna', '   ' ) );
		$this->assertSame( 'Ana María', PromotionalTeamProfiles::display_name( 'Ana María', null ) );
	}

	/**
	 * Blank name has no display name.
	 */
	public function test_blank_name_has_no_display_name() {
		$this->assertNull( PromotionalTeamProfiles::display_name( '  ', '' ) );
	}

	/**
	 * Instagram handle is trimmed and loses one at.
	 */
	public function test_instagram_handle_is_trimmed_and_loses_one_at() {
		$this->assertSame( 'ana.dances', PromotionalTeamProfiles::instagram_handle( '  @ana.dances ' ) );
		$this->assertSame( 'ana_dances', PromotionalTeamProfiles::instagram_handle( 'ana_dances' ) );
	}

	/**
	 * Invalid instagram handle exports as null.
	 */
	public function test_invalid_instagram_handle_exports_as_null() {
		$this->assertNull( PromotionalTeamProfiles::instagram_handle( '' ) );
		$this->assertNull( PromotionalTeamProfiles::instagram_handle( '@' ) );
		$this->assertNull( PromotionalTeamProfiles::instagram_handle( '@@ana' ) );
		$this->assertNull( PromotionalTeamProfiles::instagram_handle( 'ana dances' ) );
		$this->assertNull( PromotionalTeamProfiles::instagram_handle( 'https://instagram.com/ana' ) );
		$this->assertNull( PromotionalTeamProfiles::instagram_handle( str_repeat( 'a', 31 ) ) );
		$this->assertSame( str_repeat( 'a', 30 ), PromotionalTeamProfiles::instagram_handle( str_repeat( 'a', 30 ) ) );
	}

	/**
	 * Submitted instagram must be blank or valid.
	 */
	public function test_submitted_instagram_must_be_blank_or_valid() {
		$this->assertTrue( PromotionalTeamProfiles::is_valid_instagram( '' ) );
		$this->assertTrue( PromotionalTeamProfiles::is_valid_instagram( ' @ana.dances ' ) );
		$this->assertFalse( PromotionalTeamProfiles::is_valid_instagram( 'ana dances' ) );
	}

	/**
	 * Bio keeps line breaks and blank is null.
	 */
	public function test_bio_keeps_line_breaks_and_blank_is_null() {
		$this->assertSame( "Teacher.\n\nDancer.", PromotionalTeamProfiles::bio( " Teacher.\r\n\r\nDancer. \n" ) );
		$this->assertNull( PromotionalTeamProfiles::bio( " \n " ) );
		$this->assertNull( PromotionalTeamProfiles::bio( null ) );
	}
}
