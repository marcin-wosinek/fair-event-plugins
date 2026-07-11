<?php
/**
 * WeeklyDigestRenderer sanitize/render tests
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairAudience\Services\WeeklyDigestRenderer;

/**
 * Validates the pure config-sanitizing and HTML-shaping logic. Live WP
 * rendering (EmailService wrapping, actual mail delivery) is covered by
 * the API integration tests, not here.
 */
class WeeklyDigestRendererTest extends TestCase {

	/**
	 * Build a minimal week structure with the given days.
	 *
	 * @param array $days Day entries, each `{ weekday, month_name, day_num, events }`.
	 * @return array Week data shaped like WeeklyEventsProvider::get_week().
	 */
	private function week( array $days ) {
		return array(
			'source' => 'demo',
			'week'   => array(
				'start' => '2026-07-06',
				'end'   => '2026-07-12',
			),
			'days'   => $days,
		);
	}

	/**
	 * Non-array input falls back to the defaults untouched.
	 */
	public function test_sanitize_config_falls_back_to_defaults_for_non_array() {
		$this->assertSame( WeeklyDigestRenderer::default_config(), WeeklyDigestRenderer::sanitize_config( 'not-an-array' ) );
	}

	/**
	 * A day_of_week value outside 1-7 falls back to the default.
	 */
	public function test_sanitize_config_rejects_out_of_range_day_of_week() {
		$config = WeeklyDigestRenderer::sanitize_config( array( 'day_of_week' => 9 ) );
		$this->assertSame( 1, $config['day_of_week'] );
	}

	/**
	 * A time_of_day value not matching HH:MM falls back to the default.
	 */
	public function test_sanitize_config_rejects_malformed_time_of_day() {
		$config = WeeklyDigestRenderer::sanitize_config( array( 'time_of_day' => 'not-a-time' ) );
		$this->assertSame( '08:00', $config['time_of_day'] );
	}

	/**
	 * A well-formed HH:MM value is kept as-is.
	 */
	public function test_sanitize_config_accepts_valid_time_of_day() {
		$config = WeeklyDigestRenderer::sanitize_config( array( 'time_of_day' => '23:45' ) );
		$this->assertSame( '23:45', $config['time_of_day'] );
	}

	/**
	 * A week_scope value outside 'current'/'next' falls back to the default.
	 */
	public function test_sanitize_config_rejects_invalid_week_scope() {
		$config = WeeklyDigestRenderer::sanitize_config( array( 'week_scope' => 'yesterday' ) );
		$this->assertSame( 'current', $config['week_scope'] );
	}

	/**
	 * 'next' is a valid week_scope value.
	 */
	public function test_sanitize_config_accepts_next_week_scope() {
		$config = WeeklyDigestRenderer::sanitize_config( array( 'week_scope' => 'next' ) );
		$this->assertSame( 'next', $config['week_scope'] );
	}

	/**
	 * Truthy/falsy scalars for enabled/skip_empty are coerced to booleans.
	 */
	public function test_sanitize_config_coerces_enabled_and_skip_empty_to_booleans() {
		$config = WeeklyDigestRenderer::sanitize_config(
			array(
				'enabled'    => 1,
				'skip_empty' => 0,
			)
		);
		$this->assertTrue( $config['enabled'] );
		$this->assertFalse( $config['skip_empty'] );
	}

	/**
	 * The source_slug is run through sanitize_title().
	 */
	public function test_sanitize_config_slugifies_source() {
		$config = WeeklyDigestRenderer::sanitize_config( array( 'source_slug' => 'Main Calendar' ) );
		$this->assertSame( 'main-calendar', $config['source_slug'] );
	}

	/**
	 * A week is empty when every day has no events.
	 */
	public function test_is_week_empty_true_when_no_day_has_events() {
		$week = $this->week(
			array(
				array( 'events' => array() ),
				array( 'events' => array() ),
			)
		);
		$this->assertTrue( WeeklyDigestRenderer::is_week_empty( $week ) );
	}

	/**
	 * A week is not empty when at least one day has events.
	 */
	public function test_is_week_empty_false_when_any_day_has_events() {
		$week = $this->week(
			array(
				array( 'events' => array() ),
				array( 'events' => array( array( 'title' => 'Meetup' ) ) ),
			)
		);
		$this->assertFalse( WeeklyDigestRenderer::is_week_empty( $week ) );
	}

	/**
	 * {week_start}/{week_end} placeholders are replaced with the week's dates.
	 */
	public function test_render_subject_replaces_week_placeholders() {
		$week    = $this->week( array() );
		$subject = WeeklyDigestRenderer::render_subject( 'Events {week_start} – {week_end}', $week );
		$this->assertSame( 'Events 2026-07-06 – 2026-07-12', $subject );
	}

	/**
	 * An empty week renders the "no events" fallback message.
	 */
	public function test_render_returns_fallback_message_for_empty_week() {
		$week = $this->week(
			array(
				array( 'events' => array() ),
			)
		);
		$html = WeeklyDigestRenderer::render( $week );
		$this->assertStringContainsString( 'No events scheduled this week.', $html );
	}

	/**
	 * A day with events renders its heading and a linked, timed event.
	 */
	public function test_render_includes_day_heading_and_linked_event() {
		$week = $this->week(
			array(
				array(
					'weekday'    => 'Monday',
					'month_name' => 'July',
					'day_num'    => '6',
					'events'     => array(
						array(
							'title'      => 'Weekly Standup',
							'url'        => 'https://example.test/event/1',
							'start_time' => '09:00',
						),
					),
				),
			)
		);

		$html = WeeklyDigestRenderer::render( $week );

		$this->assertStringContainsString( 'Monday, July 6', $html );
		$this->assertStringContainsString( '09:00', $html );
		$this->assertStringContainsString( '<a href="https://example.test/event/1">Weekly Standup</a>', $html );
	}

	/**
	 * All-day events are labeled instead of showing a start time.
	 */
	public function test_render_marks_all_day_events() {
		$week = $this->week(
			array(
				array(
					'weekday'    => 'Monday',
					'month_name' => 'July',
					'day_num'    => '6',
					'events'     => array(
						array(
							'title'   => 'Conference',
							'all_day' => true,
						),
					),
				),
			)
		);

		$html = WeeklyDigestRenderer::render( $week );

		$this->assertStringContainsString( 'All day', $html );
		$this->assertStringContainsString( 'Conference', $html );
	}

	/**
	 * Event titles are escaped, never rendered as raw HTML.
	 */
	public function test_render_escapes_event_titles() {
		$week = $this->week(
			array(
				array(
					'weekday'    => 'Monday',
					'month_name' => 'July',
					'day_num'    => '6',
					'events'     => array(
						array( 'title' => '<script>alert(1)</script>' ),
					),
				),
			)
		);

		$html = WeeklyDigestRenderer::render( $week );

		$this->assertStringNotContainsString( '<script>', $html );
		$this->assertStringContainsString( '&lt;script&gt;', $html );
	}

	/**
	 * Intro HTML is prepended above the day listing.
	 */
	public function test_render_prepends_intro_html() {
		$week = $this->week( array() );
		$html = WeeklyDigestRenderer::render( $week, '<p>Hello!</p>' );
		$this->assertStringContainsString( '<p>Hello!</p>', $html );
	}

	/**
	 * Outro HTML is appended below the day listing.
	 */
	public function test_render_appends_outro_html() {
		$week = $this->week( array() );
		$html = WeeklyDigestRenderer::render( $week, '', '<p>See you there!</p>' );
		$this->assertStringContainsString( '<p>See you there!</p>', $html );
		$this->assertGreaterThan(
			strpos( $html, 'No events scheduled this week.' ),
			strpos( $html, 'See you there!' )
		);
	}
}
