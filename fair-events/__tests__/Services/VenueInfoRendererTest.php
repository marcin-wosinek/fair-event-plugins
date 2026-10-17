<?php
/**
 * Venue Info block renderer unit tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairEvents\Models\Venue;
use FairEvents\Services\VenueInfoRenderer;

/**
 * Tests the markup, name-link priority, and URL safety of the Venue Info
 * block. Venue lookup by ID is exercised by the block's E2E spec.
 */
class VenueInfoRendererTest extends TestCase {
 // phpcs:disable Squiz.Commenting.FunctionComment.Missing

	private function venue( array $fields ) {
		$venue = new Venue();
		foreach ( $fields as $key => $value ) {
			$venue->$key = $value;
		}
		$venue->name = $venue->name ?? 'Riverside Hall';
		return $venue;
	}

	private function name_href( $html ) {
		if ( preg_match( '#__name"><a href="([^"]*)"#', $html, $m ) ) {
			return html_entity_decode( $m[1] );
		}
		return null;
	}

	public function test_name_links_website_first() {
		$html = VenueInfoRenderer::render_venue(
			$this->venue(
				array(
					'website_url'      => 'https://riverside.example.org',
					'address'          => 'Example Street 1',
					'instagram_handle' => 'riverside',
				)
			),
			'class="wp-block-fair-events-venue-info"'
		);
		$this->assertSame( 'https://riverside.example.org', $this->name_href( $html ) );
	}

	public function test_name_falls_back_to_maps_then_instagram_then_text() {
		$maps = VenueInfoRenderer::render_venue(
			$this->venue(
				array(
					'address'          => 'Example Street 1',
					'instagram_handle' => 'riverside',
				)
			),
			''
		);
		$this->assertStringStartsWith( 'https://www.google.com/maps/search/', $this->name_href( $maps ) );

		$instagram = VenueInfoRenderer::render_venue( $this->venue( array( 'instagram_handle' => '@riverside' ) ), '' );
		$this->assertSame( 'https://www.instagram.com/riverside/', $this->name_href( $instagram ) );

		$plain = VenueInfoRenderer::render_venue( $this->venue( array( 'facebook_page_link' => 'https://facebook.com/riverside' ) ), '' );
		$this->assertNull( $this->name_href( $plain ) );
		$this->assertStringContainsString( '__name">Riverside Hall</p>', $plain );
	}

	public function test_lists_labelled_links_in_order_with_new_tab_attributes() {
		$html = VenueInfoRenderer::render_venue(
			$this->venue(
				array(
					'website_url'        => 'https://riverside.example.org',
					'latitude'           => '39.47',
					'longitude'          => '-0.37',
					'facebook_page_link' => 'https://www.facebook.com/riverside',
					'instagram_handle'   => 'riverside',
				)
			),
			''
		);
		preg_match_all( '#__link--(\w+)"><a href="[^"]*" target="_blank" rel="noopener noreferrer">(\w[\w ]*)<#', $html, $m );
		$this->assertSame( array( 'website', 'maps', 'facebook', 'instagram' ), $m[1] );
		$this->assertSame( array( 'Website', 'Google Maps', 'Facebook', 'Instagram' ), $m[2] );
		$this->assertSame( 5, substr_count( $html, 'target="_blank" rel="noopener noreferrer"' ) );
	}

	public function test_omits_missing_fields_without_empty_markup() {
		$html = VenueInfoRenderer::render_venue( $this->venue( array() ), 'class="x"' );
		$this->assertSame( '<div class="x"><p class="wp-block-fair-events-venue-info__name">Riverside Hall</p></div>', $html );
	}

	public function test_escapes_venue_text() {
		$html = VenueInfoRenderer::render_venue(
			$this->venue(
				array(
					'name'    => '<b>Hall</b> & "Co"',
					'address' => "<script>x</script>\nLine 2",
				)
			),
			''
		);
		$this->assertStringNotContainsString( '<b>', $html );
		$this->assertStringNotContainsString( '<script>', $html );
		$this->assertStringContainsString( '&lt;b&gt;Hall&lt;/b&gt; &amp; &quot;Co&quot;', $html );
		$this->assertStringContainsString( '&lt;script&gt;x&lt;/script&gt;<br>' . "\n" . 'Line 2', $html );
	}

	public function test_rejects_unsafe_or_malformed_urls() {
		$this->assertNull( VenueInfoRenderer::safe_url( 'javascript:alert(1)' ) );
		$this->assertNull( VenueInfoRenderer::safe_url( 'ftp://example.org/file' ) );
		$this->assertNull( VenueInfoRenderer::safe_url( '//example.org' ) );
		$this->assertNull( VenueInfoRenderer::safe_url( 'example.org' ) );
		$this->assertNull( VenueInfoRenderer::safe_url( 'https://exa mple.org' ) );
		$this->assertNull( VenueInfoRenderer::safe_url( 'https://example.org/"onmouseover' ) );
		$this->assertNull( VenueInfoRenderer::safe_url( '' ) );
		$this->assertNull( VenueInfoRenderer::safe_url( null ) );
		$this->assertSame( 'https://example.org/a?b=1', VenueInfoRenderer::safe_url( ' https://example.org/a?b=1 ' ) );
		$this->assertSame( 'HTTP://example.org', VenueInfoRenderer::safe_url( 'HTTP://example.org' ) );
	}

	public function test_normalizes_instagram_handles() {
		$this->assertSame( 'https://www.instagram.com/riverside.hall_1/', VenueInfoRenderer::instagram_url( 'riverside.hall_1' ) );
		$this->assertSame( 'https://www.instagram.com/riverside/', VenueInfoRenderer::instagram_url( ' @riverside ' ) );
		$this->assertNull( VenueInfoRenderer::instagram_url( 'https://instagram.com/riverside' ) );
		$this->assertNull( VenueInfoRenderer::instagram_url( 'not a handle' ) );
		$this->assertNull( VenueInfoRenderer::instagram_url( '@' ) );
		$this->assertNull( VenueInfoRenderer::instagram_url( str_repeat( 'a', 31 ) ) );
		$this->assertNull( VenueInfoRenderer::instagram_url( null ) );
	}

	public function test_unsafe_website_falls_through_to_next_destination() {
		$html = VenueInfoRenderer::render_venue(
			$this->venue(
				array(
					'website_url'      => 'javascript:alert(1)',
					'instagram_handle' => 'riverside',
				)
			),
			''
		);
		$this->assertSame( 'https://www.instagram.com/riverside/', $this->name_href( $html ) );
		$this->assertStringNotContainsString( 'javascript', $html );
		$this->assertStringNotContainsString( '__link--website', $html );
	}

	public function test_invalid_ids_render_nothing() {
		$this->assertSame( '', VenueInfoRenderer::render( 0, '' ) );
		$this->assertSame( '', VenueInfoRenderer::render( -3, '' ) );
		$this->assertSame( '', VenueInfoRenderer::render( 'abc', '' ) );
		$this->assertSame( '', VenueInfoRenderer::render( null, '' ) );
	}
}
