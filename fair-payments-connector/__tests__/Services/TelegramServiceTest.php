<?php
/**
 * TelegramService Tests
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\Services;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use FairPaymentsConnector\Services\TelegramService;
use FairPaymentsConnector\Settings\NotificationSettings;

/**
 * Unit tests for TelegramService::render_template() — the purchased-item
 * rendering described in issue #1458: only the lines relevant to what was
 * actually purchased should appear, with no empty labeled lines.
 */
class TelegramServiceTest extends TestCase {

	/**
	 * Service under test.
	 *
	 * @var TelegramService
	 */
	private TelegramService $service;

	/**
	 * Default notification template, shared by Telegram and email.
	 *
	 * @var string
	 */
	private string $template;

	/**
	 * Set up the service and template before each test.
	 */
	protected function setUp(): void {
		$this->service  = new TelegramService();
		$this->template = NotificationSettings::default_template();
	}

	/**
	 * Base context with every optional field empty, as NotificationHooks::build_context()
	 * defaults them before the fair_payment_notification_context filter runs.
	 *
	 * @param array $overrides Fields to override.
	 * @return array
	 */
	private function context( array $overrides = array() ): array {
		$base = array(
			'test_label'             => '',
			'site_domain'            => 'example.test',
			'event_title'            => '',
			'event_url'              => '',
			'participant_name'       => 'Jane Doe',
			'participant_name_short' => 'Jane D.',
			'participant_url'        => 'https://example.test/wp-admin/',
			'participant_email'      => 'jane@example.test',
			'amount'                 => '45.00',
			'currency'               => 'EUR',
			'group_label'            => '',
			'fee_label'              => '',
			'ticket_label'           => '',
			'activities'             => '',
			'discounts'              => '',
			'transaction_id'         => '123',
			'date'                   => '2026-08-14',
		);

		return array_merge( $base, $overrides );
	}

	/**
	 * A membership-fee payment names the group and fee, and shows none of
	 * the event-ticket/activity/discount lines.
	 */
	public function test_membership_fee_payment_shows_group_and_fee_only() {
		$result = $this->service->render_template(
			$this->template,
			$this->context(
				array(
					'group_label' => 'Acroyoga Club',
					'fee_label'   => 'Annual membership',
				)
			)
		);

		$this->assertStringContainsString( 'Group: Acroyoga Club', $result );
		$this->assertStringContainsString( 'Fee: Annual membership', $result );
		$this->assertStringNotContainsString( 'Ticket:', $result );
		$this->assertStringNotContainsString( 'Activities:', $result );
		$this->assertStringNotContainsString( 'Discounts:', $result );
		$this->assertStringNotContainsString( '<a href=""></a>', $result );
	}

	/**
	 * A ticket-only signup (no activities, no discount) shows just the
	 * ticket line.
	 */
	public function test_ticket_only_signup_shows_ticket_only() {
		$result = $this->service->render_template(
			$this->template,
			$this->context( array( 'ticket_label' => 'Regular' ) )
		);

		$this->assertStringContainsString( 'Ticket: Regular', $result );
		$this->assertStringNotContainsString( 'Activities:', $result );
		$this->assertStringNotContainsString( 'Discounts:', $result );
		$this->assertStringNotContainsString( 'Group:', $result );
		$this->assertStringNotContainsString( 'Fee:', $result );
	}

	/**
	 * A signup with selected activities shows both the ticket and
	 * activities lines, and no discounts/group/fee lines.
	 */
	public function test_signup_with_activities_shows_ticket_and_activities() {
		$result = $this->service->render_template(
			$this->template,
			$this->context(
				array(
					'ticket_label' => 'Regular',
					'activities'   => 'Workshop A, Workshop B',
				)
			)
		);

		$this->assertStringContainsString( 'Ticket: Regular', $result );
		$this->assertStringContainsString( 'Activities: Workshop A, Workshop B', $result );
		$this->assertStringNotContainsString( 'Discounts:', $result );
		$this->assertStringNotContainsString( 'Group:', $result );
		$this->assertStringNotContainsString( 'Fee:', $result );
	}

	/**
	 * A discounted signup shows both the ticket and discounts lines, and
	 * no activities/group/fee lines.
	 */
	public function test_discounted_signup_shows_ticket_and_discounts() {
		$result = $this->service->render_template(
			$this->template,
			$this->context(
				array(
					'ticket_label' => 'Regular',
					'discounts'    => 'Students -20%',
				)
			)
		);

		$this->assertStringContainsString( 'Ticket: Regular', $result );
		$this->assertStringContainsString( 'Discounts: Students -20%', $result );
		$this->assertStringNotContainsString( 'Activities:', $result );
		$this->assertStringNotContainsString( 'Group:', $result );
		$this->assertStringNotContainsString( 'Fee:', $result );
	}

	/**
	 * When related records no longer resolve (deleted ticket type, fee,
	 * group, activities), every optional line is omitted — only the header,
	 * participant, and total remain.
	 */
	public function test_missing_historical_data_omits_every_optional_line() {
		$result = $this->service->render_template( $this->template, $this->context() );

		$this->assertStringNotContainsString( 'Ticket:', $result );
		$this->assertStringNotContainsString( 'Activities:', $result );
		$this->assertStringNotContainsString( 'Discounts:', $result );
		$this->assertStringNotContainsString( 'Group:', $result );
		$this->assertStringNotContainsString( 'Fee:', $result );
		$this->assertStringNotContainsString( '<a href=""></a>', $result );

		// Header, participant, and total remain.
		$this->assertStringContainsString( 'example.test', $result );
		$this->assertStringContainsString( 'Jane Doe', $result );
		$this->assertStringContainsString( 'Total: 45.00 EUR', $result );
	}

	/**
	 * Stored event titles with named, numeric and quote entities render as
	 * readable text: `&nbsp;` becomes U+00A0, and nothing shows an entity.
	 *
	 * @param string $stored   Title as WordPress stores it.
	 * @param string $expected Escaped Telegram HTML for the title.
	 */
	#[DataProvider( 'provide_encoded_titles' )]
	public function test_encoded_event_title_renders_readable( string $stored, string $expected ) {
		$result = $this->service->render_template(
			$this->template,
			$this->context(
				array(
					'event_title' => $stored,
					'event_url'   => 'https://example.test/events/la-mutable/',
				)
			)
		);

		$this->assertStringContainsString(
			'<a href="https://example.test/events/la-mutable/">' . $expected . '</a>',
			$result
		);
	}

	/**
	 * Encoded titles and their expected Telegram HTML.
	 *
	 * @return array<string, array{string, string}>
	 */
	public static function provide_encoded_titles(): array {
		return array(
			'nbsp'           => array( 'La&nbsp;Mutable', "La\u{00A0}Mutable" ),
			'amp'            => array( 'Rock &amp; Roll', 'Rock &amp; Roll' ),
			'texturized'     => array( '&#8220;Jam&#8221; night', "\u{201C}Jam\u{201D} night" ),
			'hex numeric'    => array( 'Caf&#xE9;', "Caf\u{00E9}" ),
			'quotes'         => array( '&quot;Open&quot; &#039;mic&#039;', '&quot;Open&quot; &#039;mic&#039;' ),
			'nested entity'  => array( 'Use &amp;lt;b&amp;gt;', 'Use &amp;lt;b&amp;gt;' ),
			'raw ampersand'  => array( 'Rock & Roll', 'Rock &amp; Roll' ),
			'angle brackets' => array( '1 < 2 > 0', '1 &lt; 2 &gt; 0' ),
			'accents, emoji' => array( "Ni\u{00F1}os \u{1F389} \u{00E0} la f\u{00EA}te", "Ni\u{00F1}os \u{1F389} \u{00E0} la f\u{00EA}te" ),
		);
	}

	/**
	 * A nested entity is decoded once: `&amp;lt;` shows a literal `&lt;`
	 * (escaped as `&amp;lt;`), never a `<` character.
	 */
	public function test_nested_entity_is_not_double_decoded() {
		$result = $this->service->render_template(
			$this->template,
			$this->context( array( 'ticket_label' => 'VIP &amp;lt;3' ) )
		);

		$this->assertStringContainsString( 'Ticket: VIP &amp;lt;3', $result );
		$this->assertStringNotContainsString( 'VIP &lt;3', $result );
		$this->assertStringNotContainsString( 'VIP <3', $result );
	}

	/**
	 * An already-escaped value is not escaped twice: `&amp;` displays as `&`.
	 */
	public function test_stored_entity_is_not_double_escaped() {
		$result = $this->service->render_template(
			$this->template,
			$this->context( array( 'activities' => 'Salsa &amp; Bachata' ) )
		);

		$this->assertStringContainsString( 'Activities: Salsa &amp; Bachata', $result );
		$this->assertStringNotContainsString( '&amp;amp;', $result );
	}

	/**
	 * Tag-like dynamic values, raw or entity-encoded, display as text and
	 * cannot add formatting or links to the message.
	 */
	public function test_dynamic_values_cannot_inject_markup() {
		$result = $this->service->render_template(
			$this->template,
			$this->context(
				array(
					'test_label'       => '<i>x</i>',
					'event_title'      => '&lt;a href=&quot;https://evil.test&quot;&gt;Free&lt;/a&gt;',
					'event_url'        => 'https://example.test/e/',
					'participant_name' => '<b>Jane</b> <a href="https://evil.test">Doe</a>',
					'ticket_label'     => '<code>VIP</code>',
					'discounts'        => '&lt;/b&gt;Promo',
				)
			)
		);

		$this->assertStringNotContainsString( 'evil.test"', $result );
		$this->assertStringNotContainsString( '<i>', $result );
		$this->assertStringNotContainsString( '<code>', $result );
		$this->assertStringNotContainsString( '</b>Promo', $result );
		$this->assertSame( 1, substr_count( $result, '<b>' ) );
		$this->assertSame( 2, substr_count( $result, '<a href=' ) );
		$this->assertStringContainsString(
			'<a href="https://example.test/e/">&lt;a href=&quot;https://evil.test&quot;&gt;Free&lt;/a&gt;</a>',
			$result
		);
		$this->assertStringContainsString( 'Discounts: &lt;/b&gt;Promo', $result );
	}

	/**
	 * The template's bold heading and both links survive, and link
	 * destinations keep their query strings.
	 */
	public function test_template_formatting_and_links_are_preserved() {
		$result = $this->service->render_template(
			$this->template,
			$this->context(
				array(
					'test_label'      => '[TEST] ',
					'event_title'     => 'La&nbsp;Mutable',
					'event_url'       => 'https://example.test/?p=12&lang=es',
					'participant_url' => 'https://example.test/wp-admin/admin.php?page=fair-audience-participant&id=7',
				)
			)
		);

		$lines = explode( "\n", $result );
		$this->assertSame( '<b>[TEST] example.test</b>', $lines[0] );
		$this->assertSame( "<a href=\"https://example.test/?p=12&amp;lang=es\">La\u{00A0}Mutable</a>", $lines[1] );
		$this->assertSame(
			'<a href="https://example.test/wp-admin/admin.php?page=fair-audience-participant&amp;id=7">Jane Doe</a>',
			$lines[2]
		);
		$this->assertSame( 'Total: 45.00 EUR', end( $lines ) );
	}

	/**
	 * Without PII, the abbreviated name is decoded and escaped once, and
	 * the email is omitted; with PII, the full decoded name shows.
	 */
	public function test_participant_name_decoding_respects_privacy_setting() {
		$context = $this->context(
			array(
				'participant_name'       => 'Ren&eacute;e O&#039;Brien &amp; Co',
				'participant_name_short' => '',
			)
		);

		$full  = $this->service->render_template( $this->template, $context, true );
		$short = $this->service->render_template( $this->template, $context, false );

		$this->assertStringContainsString( ">Ren\u{00E9}e O&#039;Brien &amp; Co</a>", $full );
		$this->assertStringContainsString( ">Ren\u{00E9}e O.</a>", $short );
		$this->assertStringNotContainsString( 'Brien', $short );

		$provided = $this->service->render_template(
			$this->template,
			$this->context( array( 'participant_name_short' => 'Ren&eacute;e &lt;O.&gt;' ) ),
			false
		);
		$this->assertStringContainsString( ">Ren\u{00E9}e &lt;O.&gt;</a>", $provided );
	}

	/**
	 * Encoded values in optional lines still render, and lines whose value
	 * is empty are still dropped.
	 */
	public function test_optional_lines_with_encoded_values() {
		$result = $this->service->render_template(
			$this->template,
			$this->context(
				array(
					'group_label' => 'Acro &amp; Yoga',
					'fee_label'   => 'Annual&nbsp;fee',
				)
			)
		);

		$this->assertStringContainsString( 'Group: Acro &amp; Yoga', $result );
		$this->assertStringContainsString( "Fee: Annual\u{00A0}fee", $result );
		$this->assertStringNotContainsString( 'Ticket:', $result );
		$this->assertStringNotContainsString( '<a href=""></a>', $result );
	}
}
