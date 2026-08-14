<?php
/**
 * TelegramService Tests
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairPaymentsConnectorExperimental\Services\TelegramService;
use FairPaymentsConnectorExperimental\Settings\Settings;

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
		$this->template = Settings::default_template();
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
}
