<?php
/**
 * OccurrenceFields unit tests
 *
 * Covers standalone, iCal, and API occurrences (no WordPress post lookups
 * needed). The post-backed featured-image branch of format_image() calls
 * has_post_thumbnail()/get_the_post_thumbnail(), which aren't stubbed here,
 * and is covered by the WP-CLI eval-file manual check instead (see
 * TESTING.md).
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Helpers;

use PHPUnit\Framework\TestCase;
use FairEvents\Helpers\OccurrenceFields;

/**
 * Tests for OccurrenceFields
 */
class OccurrenceFieldsTest extends TestCase {

	/**
	 * Build a minimal standalone occurrence DTO, overridable per test.
	 *
	 * @param array $overrides Fields to override.
	 * @return array Occurrence DTO.
	 */
	private function make_occurrence( array $overrides = array() ) {
		return array_merge(
			array(
				'title'       => 'Community Picnic',
				'url'         => 'https://example.com/events/picnic',
				'start'       => '2026-06-15 18:00:00',
				'end'         => '2026-06-15 20:00:00',
				'all_day'     => false,
				'description' => 'Bring your own blanket.',
				'location'    => array(
					'mode'    => 'in_person',
					'name'    => 'Central Park',
					'address' => '1 Park Ave',
				),
				'source'      => 'standalone',
				'event_id'    => null,
			),
			$overrides
		);
	}

	/**
	 * A fully populated occurrence fills in every token.
	 */
	public function test_full_occurrence_populates_every_token() {
		$tokens = OccurrenceFields::build_tokens( $this->make_occurrence() );

		$this->assertSame( 'Community Picnic', $tokens['{{title}}'] );
		$this->assertSame( '<a href="https://example.com/events/picnic">', $tokens['{{title_link_open}}'] );
		$this->assertSame( '</a>', $tokens['{{title_link_close}}'] );
		$this->assertSame( 'https://example.com/events/picnic', $tokens['{{url}}'] );
		$this->assertSame( 'Bring your own blanket.', $tokens['{{description}}'] );
		$this->assertSame( 'Central Park, 1 Park Ave', $tokens['{{location}}'] );
		$this->assertSame( '', $tokens['{{image}}'] );
		$this->assertSame( 'Standalone event', $tokens['{{source_type}}'] );
		$this->assertNotSame( '', $tokens['{{start}}'] );
		$this->assertNotSame( '', $tokens['{{date_range}}'] );
	}

	/**
	 * A missing title falls back to a translated placeholder instead of
	 * rendering blank.
	 */
	public function test_missing_title_falls_back_to_placeholder() {
		$tokens = OccurrenceFields::build_tokens( $this->make_occurrence( array( 'title' => '' ) ) );

		$this->assertSame( '(untitled event)', $tokens['{{title}}'] );
	}

	/**
	 * A missing URL renders the title unlinked: both wrapper tokens resolve
	 * to '', not a broken `href=""` anchor.
	 */
	public function test_missing_url_renders_title_unlinked() {
		$tokens = OccurrenceFields::build_tokens( $this->make_occurrence( array( 'url' => '' ) ) );

		$this->assertSame( '', $tokens['{{title_link_open}}'] );
		$this->assertSame( '', $tokens['{{title_link_close}}'] );
		$this->assertSame( '', $tokens['{{url}}'] );
	}

	/**
	 * A missing description resolves to '', so the pattern renders without it
	 * rather than a literal unresolved token.
	 */
	public function test_missing_description_is_empty() {
		$tokens = OccurrenceFields::build_tokens( $this->make_occurrence( array( 'description' => '' ) ) );

		$this->assertSame( '', $tokens['{{description}}'] );
	}

	/**
	 * A null location resolves to '' rather than a fatal or a literal
	 * "Array" string.
	 */
	public function test_null_location_is_empty() {
		$tokens = OccurrenceFields::build_tokens( $this->make_occurrence( array( 'location' => null ) ) );

		$this->assertSame( '', $tokens['{{location}}'] );
	}

	/**
	 * An online-only location (no physical name/address) falls back to a
	 * translated "Online" label instead of an empty string.
	 */
	public function test_online_only_location_shows_online_label() {
		$tokens = OccurrenceFields::build_tokens(
			$this->make_occurrence(
				array(
					'location' => array(
						'mode'        => 'online',
						'joining_url' => 'https://example.com/join',
					),
				)
			)
		);

		$this->assertSame( 'Online', $tokens['{{location}}'] );
	}

	/**
	 * An iCal/API occurrence's location is a raw string, not the neutral
	 * array shape — it passes through unchanged.
	 */
	public function test_string_location_passes_through() {
		$tokens = OccurrenceFields::build_tokens(
			$this->make_occurrence(
				array(
					'source'   => 'ical',
					'location' => 'Community Hall',
				)
			)
		);

		$this->assertSame( 'Community Hall', $tokens['{{location}}'] );
	}

	/**
	 * Source type labels are distinct per source, so a pattern author can
	 * badge provenance.
	 */
	public function test_source_type_labels() {
		$this->assertSame(
			'Event',
			OccurrenceFields::build_tokens( $this->make_occurrence( array( 'source' => 'post' ) ) )['{{source_type}}']
		);
		$this->assertSame(
			'Calendar feed',
			OccurrenceFields::build_tokens( $this->make_occurrence( array( 'source' => 'ical' ) ) )['{{source_type}}']
		);
		$this->assertSame(
			'External source',
			OccurrenceFields::build_tokens( $this->make_occurrence( array( 'source' => 'api' ) ) )['{{source_type}}']
		);
	}

	/**
	 * The render() method replaces every token in arbitrary pattern content.
	 */
	public function test_render_replaces_tokens_in_pattern_content() {
		$pattern = '<!-- wp:html -->{{title_link_open}}{{title}}{{title_link_close}} — {{date_range}}<!-- /wp:html -->';

		$rendered = OccurrenceFields::render( $this->make_occurrence(), $pattern );

		$this->assertStringContainsString( '<a href="https://example.com/events/picnic">Community Picnic</a>', $rendered );
		$this->assertStringNotContainsString( '{{', $rendered );
	}

	/**
	 * A post-source occurrence with no event_id never attempts an image
	 * lookup (which would fatal without a live WordPress environment).
	 */
	public function test_post_source_without_event_id_has_no_image() {
		$tokens = OccurrenceFields::build_tokens(
			$this->make_occurrence(
				array(
					'source'   => 'post',
					'event_id' => null,
				)
			)
		);

		$this->assertSame( '', $tokens['{{image}}'] );
	}

	/**
	 * A grouped recurring-series entry makes {{date_range}} the combined
	 * summary and fills the separate summary/next-occurrence tokens.
	 */
	public function test_series_entry_fills_recurrence_tokens() {
		$tokens = OccurrenceFields::build_tokens(
			$this->make_occurrence(
				array(
					'start'  => '2040-10-01 18:00:00',
					'end'    => '2040-10-01 20:00:00',
					'series' => array(
						'id'              => 5,
						'rrule'           => 'FREQ=WEEKLY',
						'recurrence_mode' => 'rule',
						'anchor_start'    => '2040-01-02 18:00:00',
						'all_day'         => false,
					),
				)
			)
		);

		$this->assertSame( 'Weekly on Mondays at 18:00; next occurrence: 1 October 2040', $tokens['{{date_range}}'] );
		$this->assertSame( 'Weekly on Mondays at 18:00', $tokens['{{recurrence_summary}}'] );
		$this->assertSame( '1 October 2040', $tokens['{{next_occurrence}}'] );
	}

	/**
	 * A non-series entry leaves the summary empty and keeps its date range.
	 */
	public function test_single_entry_has_empty_recurrence_summary() {
		$tokens = OccurrenceFields::build_tokens(
			$this->make_occurrence(
				array(
					'start' => '2040-10-01 18:00:00',
					'end'   => '2040-10-01 20:00:00',
				)
			)
		);

		$this->assertSame( '', $tokens['{{recurrence_summary}}'] );
		$this->assertSame( '18:00—20:00, 1 October 2040', $tokens['{{date_range}}'] );
		$this->assertSame( '18:00—20:00, 1 October 2040', $tokens['{{next_occurrence}}'] );
	}
}
