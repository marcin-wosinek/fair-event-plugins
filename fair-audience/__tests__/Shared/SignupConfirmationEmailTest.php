<?php
/**
 * FairEventsShared\Notifications\SignupConfirmationEmail formatting tests.
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Shared;

use PHPUnit\Framework\TestCase;
use FairEventsShared\Notifications\SignupConfirmationEmail;

/**
 * Unit tests for the shared signup confirmation email formatter — subject
 * assembly and each optional detail section's shown/hidden behavior.
 */
class SignupConfirmationEmailTest extends TestCase {

	/**
	 * Minimal required args for html() — every optional field defaults to
	 * empty/omitted unless a test overrides it.
	 *
	 * @param array $overrides Args to merge over the defaults.
	 * @return array Complete args array for html().
	 */
	private function args( array $overrides = array() ): array {
		return array_merge(
			array(
				'event_title'                  => 'Test Event',
				'participant_name'             => 'Jane Doe',
				'site_name'                    => 'Test Site',
				'event_date_display'           => '',
				'registration_reference'       => '',
				'ticket_type_name'             => '',
				'payment_amount_display'       => '',
				'option_names'                 => array(),
				'answers_html'                 => '',
				'greeting_template'            => 'Hi %s,',
				'confirmation_sentence'        => 'Your signup is confirmed.',
				'event_date_label'             => 'Event date:',
				'registration_reference_label' => 'Registration reference:',
				'ticket_type_label'            => 'Ticket type:',
				'amount_paid_label'            => 'Amount paid:',
				'selected_options_label'       => 'Selected options:',
				'your_answers_label'           => 'Your answers:',
				'sign_off_template'            => 'Thanks,%1$sThe %2$s Team',
			),
			$overrides
		);
	}

	/**
	 * Subject() interpolates the event title into the translated template.
	 */
	public function test_subject_interpolates_event_title(): void {
		$this->assertSame(
			'Signup confirmed — Test Event',
			SignupConfirmationEmail::subject( 'Signup confirmed — %s', 'Test Event' )
		);
	}

	/**
	 * Html() greets the participant by name and includes the event title as the header.
	 */
	public function test_html_includes_greeting_and_header(): void {
		$html = SignupConfirmationEmail::html( $this->args() );

		$this->assertStringContainsString( '<h1 style="margin: 0; font-size: 24px; font-weight: bold;">Test Event</h1>', $html );
		$this->assertStringContainsString( 'Hi <strong>Jane Doe</strong>,', $html );
		$this->assertStringContainsString( 'Your signup is confirmed.', $html );
	}

	/**
	 * Every optional detail row (event date, registration reference, ticket
	 * type, amount paid) is omitted when its data value is empty.
	 */
	public function test_html_omits_all_detail_rows_when_empty(): void {
		$html = SignupConfirmationEmail::html( $this->args() );

		$this->assertStringNotContainsString( 'Event date:', $html );
		$this->assertStringNotContainsString( 'Registration reference:', $html );
		$this->assertStringNotContainsString( 'Ticket type:', $html );
		$this->assertStringNotContainsString( 'Amount paid:', $html );
	}

	/**
	 * The event date row renders only when event_date_display is non-empty.
	 */
	public function test_html_shows_event_date_row_when_present(): void {
		$html = SignupConfirmationEmail::html( $this->args( array( 'event_date_display' => 'January 1, 2026 10:00 am' ) ) );

		$this->assertStringContainsString( 'Event date:', $html );
		$this->assertStringContainsString( 'January 1, 2026 10:00 am', $html );
	}

	/**
	 * The registration reference row renders only when non-empty.
	 */
	public function test_html_shows_registration_reference_row_when_present(): void {
		$html = SignupConfirmationEmail::html( $this->args( array( 'registration_reference' => '#42' ) ) );

		$this->assertStringContainsString( 'Registration reference:', $html );
		$this->assertStringContainsString( '#42', $html );
	}

	/**
	 * The ticket type row renders only when non-empty.
	 */
	public function test_html_shows_ticket_type_row_when_present(): void {
		$html = SignupConfirmationEmail::html( $this->args( array( 'ticket_type_name' => 'VIP' ) ) );

		$this->assertStringContainsString( 'Ticket type:', $html );
		$this->assertStringContainsString( 'VIP', $html );
	}

	/**
	 * The amount paid row renders only when non-empty.
	 */
	public function test_html_shows_amount_paid_row_when_present(): void {
		$html = SignupConfirmationEmail::html( $this->args( array( 'payment_amount_display' => '12.50 EUR' ) ) );

		$this->assertStringContainsString( 'Amount paid:', $html );
		$this->assertStringContainsString( '12.50 EUR', $html );
	}

	/**
	 * The selected-options list is omitted when option_names is empty.
	 */
	public function test_html_omits_options_list_when_empty(): void {
		$html = SignupConfirmationEmail::html( $this->args() );

		$this->assertStringNotContainsString( 'Selected options:', $html );
	}

	/**
	 * The selected-options list renders each name as an <li> when present.
	 */
	public function test_html_shows_options_list_when_present(): void {
		$html = SignupConfirmationEmail::html( $this->args( array( 'option_names' => array( 'Workshop A', 'Workshop B' ) ) ) );

		$this->assertStringContainsString( 'Selected options:', $html );
		$this->assertStringContainsString( '<li style="padding: 4px 0;">Workshop A</li>', $html );
		$this->assertStringContainsString( '<li style="padding: 4px 0;">Workshop B</li>', $html );
	}

	/**
	 * The answers section is omitted when answers_html is empty.
	 */
	public function test_html_omits_answers_section_when_empty(): void {
		$html = SignupConfirmationEmail::html( $this->args() );

		$this->assertStringNotContainsString( 'Your answers:', $html );
	}

	/**
	 * The answers section wraps the pre-rendered fragment in a table when present.
	 */
	public function test_html_shows_answers_section_when_present(): void {
		$html = SignupConfirmationEmail::html( $this->args( array( 'answers_html' => '<tr><td>Question</td><td>Answer</td></tr>' ) ) );

		$this->assertStringContainsString( 'Your answers:', $html );
		$this->assertStringContainsString( '<tr><td>Question</td><td>Answer</td></tr>', $html );
	}

	/**
	 * The sign-off and footer both include the site name.
	 */
	public function test_html_includes_site_name_in_sign_off_and_footer(): void {
		$html = SignupConfirmationEmail::html( $this->args() );

		$this->assertStringContainsString( 'Thanks,<br>The Test Site Team', $html );
		// Footer repeats the site name in its own <p>.
		$this->assertSame( 2, substr_count( $html, 'Test Site' ) );
	}

	/**
	 * The linked-event-title helper falls back to plain bold markup when no
	 * URL is given.
	 */
	public function test_linked_event_title_bolds_when_url_empty(): void {
		$this->assertSame(
			'<strong>Test Event</strong>',
			SignupConfirmationEmail::linked_event_title( 'Test Event' )
		);
	}

	/**
	 * The linked-event-title helper wraps the title in a styled link when a
	 * URL is given.
	 */
	public function test_linked_event_title_links_when_url_present(): void {
		$this->assertSame(
			'<a href="https://example.com/event" style="color:#0073aa; font-weight:bold; text-decoration:underline;">Test Event</a>',
			SignupConfirmationEmail::linked_event_title( 'Test Event', 'https://example.com/event' )
		);
	}
}
