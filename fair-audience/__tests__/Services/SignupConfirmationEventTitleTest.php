<?php
/**
 * Event-name decoding and escaping in the registration confirmation email.
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Services;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\PreserveGlobalState;
use PHPUnit\Framework\Attributes\RunInSeparateProcess;
use PHPUnit\Framework\TestCase;
use FairAudience\Services\EmailService;
use FairAudience\Models\Participant;

/**
 * The subject shows the stored event title decoded exactly once (#2291),
 * and both HTML mentions (heading and confirmation sentence) display that
 * same text as literal text, never as markup.
 *
 * These assertions check behavior only, independent of the full-body
 * fixtures in EmailCompositionTest, so they survive a renderer migration.
 */
class SignupConfirmationEventTitleTest extends TestCase {

	/**
	 * Subject template, as passed through the __() stub.
	 */
	private const SUBJECT_PREFIX = 'Signup confirmed — ';

	/**
	 * Reset recorded emails and site state.
	 */
	protected function setUp(): void {
		parent::setUp();
		$GLOBALS['_fair_test_sent_emails'] = array();
		$GLOBALS['_fair_test_options']     = array( 'blogname' => 'Test Site' );
	}

	/**
	 * Clear seeded globals.
	 */
	protected function tearDown(): void {
		unset( $GLOBALS['_fair_test_options'] );
		parent::tearDown();
	}

	/**
	 * Stored title → text the reader should see.
	 *
	 * @return array<string, array{0: ?string, 1: string}>
	 */
	public static function titles(): array {
		return array(
			'named nbsp'           => array( 'La&nbsp;Mutable', "La\u{00A0}Mutable" ),
			'named amp'            => array( 'Rock &amp; Roll', 'Rock & Roll' ),
			'named quot'           => array( '&quot;Quoted&quot; night', '"Quoted" night' ),
			'decimal numeric'      => array( '&#8220;Jazz&#8221; &#38; blues', '“Jazz” & blues' ),
			'hexadecimal numeric'  => array( '&#x201C;Salsa&#x201D; &#x26; tapas', '“Salsa” & tapas' ),
			'accented characters'  => array( 'Café Málaga — niño & Łódź', 'Café Málaga — niño & Łódź' ),
			'literal quotes'       => array( 'Tom\'s "Big" Q&A', 'Tom\'s "Big" Q&A' ),
			'raw HTML-like'        => array( '<b>Bold</b> <script>x()</script>', '<b>Bold</b> <script>x()</script>' ),
			'encoded HTML-like'    => array( '&lt;img src=x onerror=alert(1)&gt;', '<img src=x onerror=alert(1)>' ),
			'nested entities'      => array( '&amp;lt;b&amp;gt; &amp;nbsp; &amp;amp;', '&lt;b&gt; &nbsp; &amp;' ),
			'missing event'        => array( null, 'Event' ),
			'whitespace-only name' => array( '&nbsp; ', 'Event' ),
		);
	}

	/**
	 * Free and paid registrations decode the subject and escape the body.
	 *
	 * @param ?string $stored   Stored post_title, or null for no event.
	 * @param string  $expected Text the reader should see.
	 */
	#[DataProvider( 'titles' )]
	public function test_event_title_reads_as_text_without_link( ?string $stored, string $expected ): void {
		foreach ( array( null, self::paid() ) as $transaction ) {
			$sent = $this->send( $stored, $transaction, 0 );

			$this->assertSame( self::SUBJECT_PREFIX . $expected, $sent['subject'] );
			$this->assertTitleText( $expected, $sent['message'], 'strong' );
		}
	}

	/**
	 * The linked mention escapes the title the same way.
	 *
	 * @param ?string $stored   Stored post_title, or null for no event.
	 * @param string  $expected Text the reader should see.
	 */
	#[DataProvider( 'titles' )]
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_event_title_reads_as_text_in_link( ?string $stored, string $expected ): void {
		require_once dirname( __DIR__ ) . '/fixtures/event-dates-stub.php';

		foreach ( array( null, self::paid() ) as $transaction ) {
			$sent = $this->send( $stored, $transaction, 12 );

			$this->assertSame( self::SUBJECT_PREFIX . $expected, $sent['subject'] );
			$link = $this->assertTitleText( $expected, $sent['message'], 'a' );
			$this->assertSame( \FairEvents\Models\EventDates::URL, $link->getAttribute( 'href' ) );
		}
	}

	/**
	 * Paid transaction row.
	 *
	 * @return object
	 */
	private static function paid(): object {
		return (object) array(
			'amount'   => 25.5,
			'currency' => 'EUR',
		);
	}

	/**
	 * Send one confirmation and return the recorded wp_mail() call.
	 *
	 * @param ?string     $stored        Stored post_title, or null for no event.
	 * @param object|null $transaction   Transaction row, or null for free.
	 * @param int         $event_date_id Event date ID (0 for no link).
	 * @return array Recorded call.
	 */
	private function send( ?string $stored, $transaction, int $event_date_id ): array {
		$GLOBALS['_fair_test_sent_emails'] = array();

		$participant                = new Participant();
		$participant->id            = 7;
		$participant->name          = 'Ana';
		$participant->email         = 'ana@example.test';
		$participant->email_profile = 'minimal';
		$participant->status        = 'confirmed';

		$event = null === $stored ? null : (object) array(
			'ID'         => 5,
			'post_title' => $stored,
		);

		$this->assertTrue( ( new EmailService() )->send_signup_payment_confirmation( $participant, $event, $transaction, array(), $event_date_id ) );
		$this->assertCount( 1, $GLOBALS['_fair_test_sent_emails'] );

		return $GLOBALS['_fair_test_sent_emails'][0];
	}

	/**
	 * Assert the heading and the sentence mention both render exactly the
	 * expected text, with no element created from the title.
	 *
	 * @param string $expected Text the reader should see.
	 * @param string $html     Email body.
	 * @param string $mention  Tag of the sentence mention: 'strong' or 'a'.
	 * @return \DOMElement The sentence mention.
	 */
	private function assertTitleText( string $expected, string $html, string $mention ): \DOMElement {
		$previous = libxml_use_internal_errors( true );
		$document = new \DOMDocument();
		$document->loadHTML( '<?xml encoding="UTF-8">' . $html );
		libxml_clear_errors();
		libxml_use_internal_errors( $previous );

		$xpath    = new \DOMXPath( $document );
		$headings = $xpath->query( '//h1' );
		$mentions = $xpath->query( '//p[contains(., "Your signup for")]/' . $mention );

		$this->assertSame( 1, $headings->length );
		$this->assertSame( 1, $mentions->length );

		foreach ( array( $headings->item( 0 ), $mentions->item( 0 ) ) as $node ) {
			$this->assertSame( $expected, $node->textContent ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- DOM API.
			$this->assertSame( 0, $xpath->query( './*', $node )->length, 'The event title must not create HTML elements.' );
		}

		$this->assertSame( 0, $xpath->query( '//script | //img | //b' )->length );

		return $mentions->item( 0 );
	}
}
