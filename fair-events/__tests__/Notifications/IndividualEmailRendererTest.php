<?php
/**
 * IndividualEmailRenderer tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Notifications\IndividualEmailRenderer;
use PHPUnit\Framework\TestCase;

/**
 * The email shared by the preview, the test and the scheduled send.
 */
class IndividualEmailRendererTest extends TestCase {

	private const WEEK = array(
		'start' => '2026-10-12',
		'end'   => '2026-10-18',
	);

	/**
	 * Use UTC.
	 *
	 * @return void
	 */
	protected function setUp(): void {
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

	/** The subject placeholders become the week's dates. */
	public function test_subject_placeholders_are_replaced() {
		$email = IndividualEmailRenderer::compose( array( 'subject' => 'Events {week_start} to {week_end}' ), self::WEEK, array() );

		$this->assertSame( 'Events 2026-10-12 to 2026-10-18', $email['subject'] );
	}

	/** Each event shows when it happens and links to its page. */
	public function test_lists_events_with_time_and_link() {
		$email = IndividualEmailRenderer::compose(
			array(),
			self::WEEK,
			array(
				self::occurrence(),
				self::occurrence(
					array(
						'title'   => 'Festival',
						'start'   => '2026-10-16 00:00:00',
						'end'     => '2026-10-18 00:00:00',
						'all_day' => true,
						'url'     => '',
					)
				),
			)
		);

		$this->assertFalse( $email['empty'] );
		$this->assertStringContainsString( '12–18 Oct 2026', $email['html'] );
		$this->assertStringContainsString( '<strong>Wed, 18:30</strong> — <a href="https://example.com/concert/">Concert night</a>', $email['html'] );
		$this->assertStringContainsString( '<strong>Fri–Sun</strong> — Festival', $email['html'] );
	}

	/** Event titles are escaped and only web links are linked. */
	public function test_event_content_is_escaped() {
		$email = IndividualEmailRenderer::compose(
			array(),
			self::WEEK,
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

	/** The text around the events keeps basic HTML and loses scripts. */
	public function test_intro_and_outro_are_sanitized() {
		$email = IndividualEmailRenderer::compose(
			array(
				'intro' => '<strong>Hello</strong><script>alert(1)</script>',
				'outro' => 'See you',
			),
			self::WEEK,
			array( self::occurrence() )
		);

		$this->assertStringContainsString( '<p><strong>Hello</strong></p>', $email['html'] );
		$this->assertStringContainsString( '<p>See you</p>', $email['html'] );
		$this->assertStringNotContainsString( '<script', $email['html'] );
		$this->assertLessThan( strpos( $email['html'], 'Concert night' ), strpos( $email['html'], 'Hello' ) );
		$this->assertGreaterThan( strpos( $email['html'], 'Concert night' ), strpos( $email['html'], 'See you' ) );
	}

	/** An empty week says so, for when empty weeks are still sent. */
	public function test_empty_week_has_an_explicit_message() {
		$email = IndividualEmailRenderer::compose( array( 'intro' => 'Hello' ), self::WEEK, array() );

		$this->assertTrue( $email['empty'] );
		$this->assertStringContainsString( 'No events are scheduled for 12–18 Oct 2026.', $email['html'] );
		$this->assertStringContainsString( 'Hello', $email['html'] );
	}

	/** An event without a title still gets a visible label. */
	public function test_untitled_event_has_a_fallback() {
		$email = IndividualEmailRenderer::compose( array(), self::WEEK, array( self::occurrence( array( 'title' => '' ) ) ) );

		$this->assertStringContainsString( '(untitled event)', $email['html'] );
	}
}
