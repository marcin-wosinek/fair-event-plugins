<?php
/**
 * WeeklyEmailRenderer tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Notifications\WeeklyEmailRenderer;
use FairEvents\Services\WeeklyEventsProvider;
use PHPUnit\Framework\TestCase;

/**
 * The content shared by the individual email and the subscribers' email.
 */
class WeeklyEmailRendererTest extends TestCase {

	private const WEEK = array(
		'start' => '2026-10-12',
		'end'   => '2026-10-18',
	);

	/**
	 * Use UTC.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		unset( $GLOBALS['_fair_test_timezone'] );
	}

	/**
	 * An occurrence.
	 *
	 * @param array $overrides Field overrides.
	 * @return array
	 */
	private static function occurrence( array $overrides = array() ) {
		return array_merge(
			array(
				'title'   => 'Concert night',
				'start'   => '2026-10-14 18:30:00',
				'end'     => '2026-10-14 21:00:00',
				'all_day' => false,
				'url'     => 'https://example.com/concert/',
			),
			$overrides
		);
	}

	/**
	 * Render a week of occurrences.
	 *
	 * @param array[] $occurrences Occurrences.
	 * @param array   $settings    Email settings.
	 * @param array   $week        Week boundaries.
	 * @return array{subject: string, html: string, empty: bool}
	 */
	private static function compose( array $occurrences, array $settings = array(), array $week = self::WEEK ) {
		return WeeklyEmailRenderer::compose( WeeklyEventsProvider::week_data( $week, $occurrences ), $settings );
	}

	/** The subject placeholders become the week's dates. */
	public function test_subject_placeholders_are_replaced() {
		$email = self::compose( array(), array( 'subject' => 'Events {week_start} to {week_end}' ) );

		$this->assertSame( 'Events 2026-10-12 to 2026-10-18', $email['subject'] );
	}

	/** Events are listed under their day, in start order, with their time. */
	public function test_events_are_grouped_by_day_in_order() {
		$email = self::compose(
			array(
				self::occurrence(
					array(
						'title' => 'Late show',
						'start' => '2026-10-14 21:00:00',
						'end'   => '2026-10-14 23:00:00',
					)
				),
				self::occurrence(),
			)
		);

		$html = $email['html'];
		$this->assertStringContainsString( '<h3 style="margin: 20px 0 10px 0; font-size: 16px;">Wednesday, October 14</h3>', $html );
		$this->assertStringContainsString( '<strong>18:30</strong> — <a href="https://example.com/concert/">Concert night</a>', $html );
		$this->assertLessThan( strpos( $html, 'Late show' ), strpos( $html, 'Concert night' ) );
		$this->assertSame( 1, substr_count( $html, '<h3' ) );
	}

	/** A multi-day all-day event shows on each of its days within the week only. */
	public function test_multi_day_event_is_clipped_to_the_week() {
		$email = self::compose(
			array(
				self::occurrence(
					array(
						'title'   => 'Festival',
						'start'   => '2026-10-17 00:00:00',
						'end'     => '2026-10-20 00:00:00',
						'all_day' => true,
						'url'     => '',
					)
				),
			)
		);

		$this->assertSame( 2, substr_count( $email['html'], '<strong>All day</strong> — Festival' ) );
		$this->assertStringContainsString( 'Saturday, October 17', $email['html'] );
		$this->assertStringContainsString( 'Sunday, October 18', $email['html'] );
		$this->assertStringNotContainsString( 'Monday, October 19', $email['html'] );
	}

	/** Days and times follow the site timezone, also across a DST change. */
	public function test_days_follow_the_site_timezone_across_dst() {
		$GLOBALS['_fair_test_timezone'] = 'Europe/Madrid';

		$email = self::compose(
			array(
				self::occurrence(
					array(
						'start' => '2026-10-25 00:30:00',
						'end'   => '2026-10-25 02:00:00',
					)
				),
			),
			array(),
			array(
				'start' => '2026-10-19',
				'end'   => '2026-10-25',
			)
		);

		$this->assertStringContainsString( 'Sunday, October 25</h3>', $email['html'] );
		$this->assertStringContainsString( '<strong>00:30</strong>', $email['html'] );
	}

	/** Links to other sites name where they lead. */
	public function test_external_links_are_attributed() {
		$email = self::compose(
			array(
				self::occurrence( array( 'url' => 'https://www.partner.org/gig' ) ),
				self::occurrence( array( 'url' => 'https://www.instagram.com/theband/' ) ),
				self::occurrence( array( 'url' => 'https://instagram.com/p/abc123/' ) ),
			)
		);

		$this->assertStringContainsString( '(by partner.org)', $email['html'] );
		$this->assertStringContainsString( '(by @theband)', $email['html'] );
		$this->assertStringContainsString( '(by instagram.com)', $email['html'] );
	}

	/** Links to this site have no attribution. */
	public function test_internal_links_are_not_attributed() {
		$email = self::compose( array( self::occurrence() ) );

		$this->assertStringNotContainsString( '(by', $email['html'] );
	}

	/** Titles are escaped, entities are not doubled, and only web links are linked. */
	public function test_event_content_is_escaped() {
		$email = self::compose(
			array(
				self::occurrence(
					array(
						'title' => 'Rock &amp; <script>alert(1)</script>',
						'url'   => 'javascript:alert(1)',
					)
				),
			)
		);

		$this->assertStringContainsString( 'Rock &amp; &lt;script&gt;alert(1)&lt;/script&gt;', $email['html'] );
		$this->assertStringNotContainsString( '<script', $email['html'] );
		$this->assertStringNotContainsString( 'href', $email['html'] );
	}

	/** An event without a title still gets a visible label. */
	public function test_untitled_event_has_a_fallback() {
		$email = self::compose( array( self::occurrence( array( 'title' => '' ) ) ) );

		$this->assertStringContainsString( '(untitled event)', $email['html'] );
	}

	/** An empty week says so between the introduction and conclusion. */
	public function test_empty_week_keeps_the_surrounding_text() {
		$email = self::compose(
			array(),
			array(
				'intro' => 'Hello',
				'outro' => 'Bye',
			)
		);

		$this->assertTrue( $email['empty'] );
		$html = $email['html'];
		$this->assertStringContainsString( 'No events are scheduled for 12–18 Oct 2026.', $html );
		$this->assertLessThan( strpos( $html, 'No events' ), strpos( $html, 'Hello' ) );
		$this->assertGreaterThan( strpos( $html, 'No events' ), strpos( $html, 'Bye' ) );
	}

	/** The surrounding text keeps basic HTML and loses scripts. */
	public function test_intro_and_outro_are_sanitized() {
		$email = self::compose(
			array( self::occurrence() ),
			array(
				'intro' => '<strong>Hello</strong><script>alert(1)</script>',
				'outro' => 'See you',
			)
		);

		$this->assertStringContainsString( '<strong>Hello</strong>', $email['html'] );
		$this->assertStringContainsString( '<p>See you</p>', $email['html'] );
		$this->assertStringNotContainsString( '<script', $email['html'] );
	}
}
