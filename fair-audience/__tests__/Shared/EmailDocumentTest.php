<?php
/**
 * Tests for the shared email layout and documents (#2322).
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Shared;

use FairEventsShared\Notifications\BookingConfirmationDocument;
use FairEventsShared\Notifications\BookingConfirmationEmail;
use FairEventsShared\Notifications\EmailLayout;
use FairEventsShared\Notifications\FormSubmissionDocument;
use FairEventsShared\Notifications\FormSubmissionEmail;
use FairEventsShared\Notifications\QuestionnaireAnswerRows;
use PHPUnit\Framework\TestCase;

/**
 * The shared layout is fluid and wraps long content; the booking and form
 * documents keep every section of their legacy counterparts, and the legacy
 * renderers keep their output for older callers.
 */
class EmailDocumentTest extends TestCase {

	private const MESSAGE = '<p>Doors open at 9.</p>';

	/**
	 * Booking arguments with every optional section filled.
	 *
	 * @return array
	 */
	private static function booking_args(): array {
		return array(
			'event_title'                  => 'Meetup &lt;Spring&gt;',
			'participant_name'             => 'Ana &amp; Co',
			'site_name'                    => 'Dance Club',
			'event_date_display'           => 'May 1, 2026 7:00 pm',
			'registration_reference'       => '#42',
			'ticket_type_name'             => 'Early bird',
			'payment_amount_display'       => '25.50 EUR',
			'option_names'                 => array( 'Lunch &amp; drinks', 'T-shirt' ),
			'answers_html'                 => QuestionnaireAnswerRows::row( 'Why?', 'Fun' ),
			'custom_message_html'          => self::MESSAGE,
			'action_url'                   => 'https://example.com/event/',
			'greeting_template'            => 'Hi %s,',
			'confirmation_sentence'        => 'You are in.',
			'event_date_label'             => 'Event date:',
			'registration_reference_label' => 'Registration reference:',
			'ticket_type_label'            => 'Ticket type:',
			'amount_paid_label'            => 'Amount paid:',
			'selected_options_label'       => 'Selected options:',
			'your_answers_label'           => 'Your answers:',
			'action_label'                 => 'Back to the event',
			'sign_off_template'            => 'Thanks,%1$sThe %2$s Team',
		);
	}

	/**
	 * The document fits narrow screens and wraps long words.
	 */
	public function test_document_is_fluid_and_wraps_long_content(): void {
		$html = EmailLayout::document( 'Title', '<p>Body</p>', 'Footer' );

		$this->assertStringContainsString( 'name="viewport"', $html );
		$this->assertStringContainsString( 'width: 100%; max-width: 600px;', $html );
		$this->assertStringContainsString( 'overflow-wrap: break-word;', $html );
		// Fixed 600px width only inside the Outlook-only conditional comment.
		$this->assertSame( 1, substr_count( $html, 'width="600"' ) );
		$this->assertMatchesRegularExpression( '#<!--\[if mso\]><table role="presentation" width="600"#', $html );
		$this->assertSame( 3, substr_count( $html, 'role="presentation"' ) );
		$this->assertStringContainsString( 'Footer', $html );
		$this->assertStringNotContainsString( '<!-- Footer -->', EmailLayout::document( 'Title', 'Body' ) );
	}

	/**
	 * Data tables are not marked as layout tables.
	 */
	public function test_content_tables_stay_data_tables(): void {
		$this->assertStringNotContainsString( 'role=', EmailLayout::details_table( array( array( 'A', 'B' ) ) ) );
		$this->assertStringNotContainsString( 'role=', EmailLayout::answers_table( '' ) );
		$this->assertSame( '', EmailLayout::item_list( array() ) );
	}

	/**
	 * Every booking section renders once, in order, in the shared layout.
	 */
	public function test_booking_document_renders_every_section(): void {
		$html = BookingConfirmationDocument::html( self::booking_args() );

		$order = array(
			'Meetup &lt;Spring&gt;</h1>',
			'Hi <strong>Ana &amp; Co</strong>,',
			'You are in.',
			'May 1, 2026 7:00 pm',
			'#42',
			'Early bird',
			'25.50 EUR',
			'<li style="padding: 4px 0;">Lunch &amp; drinks</li>',
			'Your answers:',
			'Fun',
			self::MESSAGE,
			'href="https://example.com/event/"',
			'Thanks,<br>The Dance Club Team',
		);
		$last  = -1;
		foreach ( $order as $needle ) {
			$this->assertSame( 1, substr_count( $html, $needle ), $needle );
			$position = strpos( $html, $needle );
			$this->assertGreaterThan( $last, $position, $needle );
			$last = $position;
		}

		$this->assertStringContainsString( 'max-width: 600px', $html );
		$this->assertStringContainsString( EmailLayout::HEADER_COLOR . ';', $html );
		$this->assertStringNotContainsString( EmailLayout::HEADER_COLOR_ALERT, $html );
	}

	/**
	 * Empty optional values omit their rows and sections.
	 */
	public function test_booking_document_omits_empty_sections(): void {
		$args = array_merge(
			self::booking_args(),
			array(
				'event_date_display'     => '',
				'ticket_type_name'       => '',
				'payment_amount_display' => '',
				'option_names'           => array(),
				'answers_html'           => '',
				'custom_message_html'    => '  ',
				'action_url'             => '',
			)
		);
		$html = BookingConfirmationDocument::html( $args );

		$this->assertStringContainsString( 'Registration reference:', $html );
		foreach ( array( 'Event date:', 'Ticket type:', 'Amount paid:', 'Selected options:', 'Your answers:', 'Back to the event', '<ul' ) as $absent ) {
			$this->assertStringNotContainsString( $absent, $html );
		}
	}

	/**
	 * A failure notice uses the alert header.
	 */
	public function test_booking_document_alert_header(): void {
		$html = BookingConfirmationDocument::html( array_merge( self::booking_args(), array( 'alert' => true ) ) );

		$this->assertStringContainsString( 'background-color: ' . EmailLayout::HEADER_COLOR_ALERT . ';', $html );
	}

	/**
	 * The form document keeps intro, context, submitter and answers rows.
	 */
	public function test_form_document_renders_every_section(): void {
		$html = FormSubmissionDocument::html(
			array(
				'site_name'      => 'Dance Club',
				'intro'          => 'A new form submission has been received.',
				'context_html'   => '<p>Page: <strong>Contact</strong></p>',
				'submitter_html' => QuestionnaireAnswerRows::row( 'Name', 'Ana' ),
				'answers_html'   => QuestionnaireAnswerRows::row( 'Why?', 'Fun' ),
			)
		);

		$this->assertMatchesRegularExpression( '#<h1 [^>]*>Dance Club</h1>#', $html );
		$this->assertLessThan( strpos( $html, 'Page: <strong>Contact' ), strpos( $html, 'A new form submission' ) );
		$this->assertLessThan( strpos( $html, 'Why?' ), strpos( $html, '>Ana<' ) );
		$this->assertStringContainsString( 'max-width: 600px', $html );
	}

	/**
	 * Legacy renderers keep their output contract for plugins that still
	 * call them: the same fixed 600px layout and every section.
	 */
	public function test_legacy_renderers_keep_their_layout(): void {
		$booking = BookingConfirmationEmail::html( self::booking_args() );
		$this->assertStringContainsString( '<table width="600" cellpadding="0" cellspacing="0"', $booking );
		$this->assertSame( 1, substr_count( $booking, self::MESSAGE ) );
		$this->assertStringContainsString( 'Lunch &amp; drinks', $booking );

		$form = FormSubmissionEmail::html(
			array(
				'site_name'    => 'Dance Club',
				'intro'        => 'Intro',
				'answers_html' => QuestionnaireAnswerRows::row( 'Why?', 'Fun' ),
			)
		);
		$this->assertStringContainsString( '<table width="600" cellpadding="0" cellspacing="0"', $form );
		$this->assertStringContainsString( 'Fun', $form );
	}
}
